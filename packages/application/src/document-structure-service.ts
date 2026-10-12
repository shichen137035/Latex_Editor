import { createHash } from "node:crypto";
import {
  AppError, defaultPreviewDirectives, includeNewBuiltInDirectives, inferBlockKind, type BlockApiResult, type BlockApiWarning, type BlockCard,
  type BlockDetail, type DocumentBlock, type DocumentBlockApi, type DocumentStructure,
  type FindBlocksInput, type InsertBlockInput, type ListBlocksInput, type ProjectTreeNode,
  type SourceRange, type PreviewDirectiveDefinition, type DocumentTextVersion
} from "@latex-editor/contracts";
import { BlockQueryIndex, SourceIndex, getBlockCapabilities, type BlockGraphManager } from "@latex-editor/editor-core";
import { parsePreview, STRUCTURE_PARSER_REVISION } from "@latex-editor/editor-core/preview/parser";
import { previewBlocksForReconciliation } from "@latex-editor/editor-core/preview/reconciliation";
import type { EnvironmentDefinition, PreviewDocument, PreviewNode, SourceSpan } from "@latex-editor/editor-core/preview/types";
import type { ProjectBlockGraphService, BlockGraphFilePort } from "./block-graph-service.js";

export interface DocumentStructureFilePort extends BlockGraphFilePort {
  listTree(projectId: string): Promise<ProjectTreeNode[]>;
  getFileVersion?(projectId: string, path: string): Promise<string>;
  getTextVersion?(projectId: string, path: string, content: string): DocumentTextVersion;
}
type FileCache = { content: string; configuration: string; document: PreviewDocument; index: SourceIndex };
type Context = { graph: BlockGraphManager; structure: DocumentStructure; sources: Map<string, string>; definitions: EnvironmentDefinition[]; directives: PreviewDirectiveDefinition[]; queryIndex: BlockQueryIndex };
class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly revisions?: { expectedRevision: number; currentRevision: number }) { super(message); }
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const rangeOf = (span: SourceSpan): SourceRange => ({ start: span.startOffset, end: span.endOffset, startLine: span.startLine, startColumn: span.startColumn, endLine: span.endLine, endColumn: span.endColumn });
const keyOf = (type: string, start: number, end: number) => `${type}\0${start}\0${end}`;
const limitOf = (limit = 50) => {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new ApiError("INVALID_GRAPH_QUERY", "limit must be an integer between 1 and 500.");
  return limit;
};

/**
 * Source-aware block API. Reuses the Preview parser and stable graph identities.
 * Source is cached only in memory; structure.json never stores document bodies.
 * All providers share the graph's project mutation lock and optimistic revisions.
 */
export class ProjectDocumentStructureService {
  readonly #cache = new Map<string, Map<string, FileCache>>();
  readonly #textCache = new Map<string, Map<string, { content: string; token: string }>>();
  readonly #queryCache = new Map<string, { token: string; index: BlockQueryIndex }>();
  constructor(readonly files: DocumentStructureFilePort, readonly graphs: ProjectBlockGraphService,
    readonly ids: { next(): string }, readonly definitions: (projectId: string) => Promise<EnvironmentDefinition[]> = async () => [],
    readonly directives: (projectId: string) => Promise<PreviewDirectiveDefinition[]> = async () => defaultPreviewDirectives) {}

  api(projectId: string): DocumentBlockApi {
    const run = <T>(action: (context: Context) => T | Promise<T>) => this.#run(projectId, action);
    return {
      list_blocks: (input = {}) => run((context) => this.#list(context, input)),
      find_blocks: (input = {}) => run((context) => this.#find(context, input)),
      get_block: ({ blockId }) => run((context) => this.#detail(context, this.#block(context, blockId))),
      get_blocks: ({ blockIds }) => run((context) => {
        if (!Array.isArray(blockIds) || blockIds.length > 100) throw new ApiError("INVALID_GRAPH_QUERY", "Provide at most 100 blockIds.");
        return blockIds.map((id) => this.#detail(context, this.#block(context, id)));
      }),
      get_block_source: ({ blockId }) => run((context) => {
        const block = this.#block(context, blockId);
        return { blockId, revision: block.revision, content: this.#source(context, block), textVersion: context.structure.files[block.source.fileId]?.textVersion };
      }),
      replace_block_content: (input) => run(context => this.#replaceContent(projectId, context, input)),
      replace_block_range: (input) => run(context => this.#replaceContent(projectId, context, input, input)),
      insert_block: (input) => run((context) => this.#insert(projectId, context, input)),
      delete_block: (input) => run(async (context) => {
        const block = this.#block(context, input.blockId);
        this.#revision(block, input.expectedRevision);
        if (!getBlockCapabilities(block).deletable) throw new ApiError("BLOCK_DELETE_FORBIDDEN", "This block cannot be deleted; empty structural blocks retain their editing placeholder.");
        const deletedIds = this.#descendants(context.structure, block.id);
        await this.#edit(projectId, context, block.source.fileId, block.source.range.start, block.source.range.end, "");
        for (const id of deletedIds) if (context.graph.getBlock(id)) context.graph.removeBlock(id);
        for (const id of deletedIds) delete context.structure.blocks[id];
        context.graph.setDocumentStructure(context.structure);
        await this.#refresh(projectId, context.graph);
        return { deletedIds };
      }),
      set_block_semantic: (input) => run((context) => {
        const block = this.#block(context, input.blockId);
        this.#revision(block, input.expectedRevision);
        block.semantic ??= {};
        if (input.summary) {
          if (typeof input.summary.text !== "string" || !["ai", "user"].includes(input.summary.source)) throw new ApiError("INVALID_GRAPH_QUERY", "Invalid summary.");
          block.semantic.summary = { ...input.summary, blockRevision: block.revision };
        }
        if (input.tags) {
          for (const tags of [input.tags.user, input.tags.ai]) if (tags && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string"))) throw new ApiError("INVALID_GRAPH_QUERY", "Tags must be string arrays.");
          block.semantic.tags = { user: input.tags.user ?? block.semantic.tags?.user ?? [], ai: input.tags.ai ?? block.semantic.tags?.ai ?? [], blockRevision: block.revision };
        }
        context.structure.structureRevision++;
        return this.#detail(context, block);
      })
    };
  }

  async #replaceContent(projectId: string, context: Context, input: Parameters<DocumentBlockApi["replace_block_content"]>[0], range?: Parameters<DocumentBlockApi["replace_block_range"]>[0]) {
    let content = input.content;
    const block = this.#block(context, input.blockId);
    this.#revision(block, input.expectedRevision);
    if (block.kind !== "content") throw new ApiError("STRUCTURAL_BLOCK_HAS_NO_DIRECT_CONTENT", "Edit the structural block's content children instead.");
    if (typeof content !== "string") throw new ApiError("INVALID_GRAPH_QUERY", "content must be a string.");
    const original = this.#source(context, block);
    if (range) {
      if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end < range.start || range.end > original.length) throw new ApiError("BLOCK_RANGE_INVALID", "The relative range is outside the returned block source.");
      if (typeof range.expectedText !== "string" || original.slice(range.start, range.end) !== range.expectedText) throw new ApiError("BLOCK_TEXT_MISMATCH", "The expected source does not match; refetch the block before editing.");
      content = original.slice(0, range.start) + content + original.slice(range.end);
    }
    if (block.placeholder && !content.trim()) return this.#detail(context, block);
    const { start, end } = block.source.range;
    const source = context.sources.get(block.source.fileId)!;
    const planned = parsePreview(source.slice(0, start) + content + source.slice(end), block.source.fileId, context.definitions, context.directives);
    const findContent = (nodes: PreviewNode[]): boolean => nodes.some((node) => {
      const type = node.kind === "block" ? node.environmentId : node.contentType;
      const contentKind = node.kind === "content" || node.semanticKind === "content";
      const inside = node.source.startOffset >= start && node.source.startOffset < start + content.length;
      return (inside && contentKind && type === block.type) || (node.kind === "block" && findContent(node.children));
    });
    // Explicit children of a content block are intentionally absent from the
    // normal parser tree, so validate their source as an independent fragment.
    const valid = block.metadata?.apiExplicitChild
      ? parsePreview(content, block.source.fileId, context.definitions, context.directives).nodes.some((node) => (node.kind === "block" ? node.environmentId : node.contentType) === block.type)
      : findContent(planned.nodes);
    if (!valid) throw new ApiError("BLOCK_RANGE_INVALID", "Keep the content block's wrapper/type; use delete_block to remove it, or the environment conversion workflow to change type.");
    await this.#edit(projectId, context, block.source.fileId, range ? start + range.start : start, range ? start + range.end : end, range ? input.content : content);
    const refreshed = await this.#refresh(projectId, context.graph);
    // Empty placeholders materialize with the same identity when text is entered.
    return this.#detail(refreshed, this.#block(refreshed, block.id));
  }

  async snapshot(projectId: string): Promise<BlockApiResult<DocumentStructure>> { return this.#run(projectId, (context) => structuredClone(context.structure)); }
  releaseProjectCache(projectId: string): void {
    this.#cache.delete(projectId);
    this.#textCache.delete(projectId);
    this.#queryCache.delete(projectId);
  }

  async #run<T>(projectId: string, action: (context: Context) => T | Promise<T>): Promise<BlockApiResult<T>> {
    try {
      return await this.graphs.withDocumentGraph(projectId, async (graph) => {
        const context = await this.#refresh(projectId, graph);
        const data = await action(context);
        const latest = graph.getDocumentStructure() ?? context.structure;
        const warnings: BlockApiWarning[] = Object.values(latest.blocks)
          .filter((block) => block.state === "active" && block.kind === "content" && block.childIds.length > 0)
          .map((block) => ({ code: "CONTENT_BLOCK_HAS_CHILDREN", message: "Content blocks normally have no child blocks; this structure was preserved.", blockId: block.id }));
        return { ok: true, data, warnings } as const;
      });
    } catch (error) {
      return { ok: false, error: {
        code: error instanceof ApiError || error instanceof AppError ? error.code : "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : "Block operation failed.",
        ...(error instanceof ApiError ? error.revisions : {})
      } };
    }
  }

  async #refresh(projectId: string, graph: BlockGraphManager): Promise<Context> {
    const definitions = (await this.definitions(projectId)).map((definition) => ({ ...definition, enabled: true }));
    const directives = includeNewBuiltInDirectives(await this.directives(projectId));
    const configuration = JSON.stringify({ definitions, directives: directives.map(({ id, enabled, match, placement }) => ({ id, enabled, match, placement })) });
    const old = graph.getDocumentStructure();
    const configurationFingerprint = hash(`${STRUCTURE_PARSER_REVISION}\0${configuration}`);
    const relationSnapshot = graph.toSnapshot();
    const structure: DocumentStructure = { schemaVersion: 2, structureRevision: old?.structureRevision ?? 0, configurationFingerprint, files: {}, roots: [], blocks: {}, dependencies: relationSnapshot.dependencies, relations: relationSnapshot.relations ?? [], relationSchemaVersion: 1 };
    const paths: string[] = [], auxPaths: string[] = [];
    const walk = (nodes: ProjectTreeNode[]) => {
      for (const node of nodes) {
        if (node.kind === "directory" && ![".git", "node_modules", ".texweave", ".latex-editor"].includes(node.name)) walk(node.children ?? []);
        if (node.kind === "file" && /\.tex$/i.test(node.name)) paths.push(node.relativePath);
        if (node.kind === "file" && /\.aux$/i.test(node.name)) auxPaths.push(node.relativePath);
      }
    };
    const tree = await this.files.listTree(projectId);
    walk(tree);
    // Compiler output often lives in the editor metadata directory; index only aux numbering there.
    const auxWalk = (nodes: ProjectTreeNode[]) => {
      for (const node of nodes) { if (node.kind === "directory" && ![".git", "node_modules"].includes(node.name)) auxWalk(node.children ?? []); else if (node.kind === "file" && /\.aux$/i.test(node.name) && !auxPaths.includes(node.relativePath)) auxPaths.push(node.relativePath); }
    };
    auxWalk(tree);
    paths.sort();
    const sources = new Map<string, string>();
    let cache = this.#cache.get(projectId);
    if (!cache) { cache = new Map(); this.#cache.set(projectId, cache); }
    const nodeMaps = new Map<string, Map<string, PreviewNode>>();
    for (const path of paths) {
      const content = await this.#read(projectId, path);
      sources.set(path, content);
      const fingerprint = hash(content);
      const previous = old?.files[path];
      structure.files[path] = { path, version: previous ? previous.version + (previous.fingerprint !== fingerprint ? 1 : 0) : 1, fingerprint,
        textVersion: this.files.getTextVersion?.(projectId, path, content) ?? { kind: "saved", fingerprint } };
      const cached = cache.get(path);
      const document = cached?.content === content && cached.configuration === configuration ? cached.document : parsePreview(content, path, definitions, directives);
      const configurationChanged = cached !== undefined && cached.configuration !== configuration;
      cache.set(path, { content, configuration, document, index: cached?.content === content ? cached.index : new SourceIndex(content) });
      if (!previous || previous.fingerprint !== fingerprint || configurationChanged || old?.indexDirty || old?.configurationFingerprint !== configurationFingerprint) {
        graph.reconcileParsedBlocks(path, previewBlocksForReconciliation(document, content).blocks, () => this.ids.next());
      }
    }
    for (const path of Object.keys(old?.files ?? {})) if (!sources.has(path)) { graph.reconcileParsedBlocks(path, [], () => this.ids.next()); cache.delete(path); }

    const numbered = new Map<string, string>();
    const numberingDates = new Map<string, bigint>();
    const numberingInputs: string[] = [];
    for (const path of auxPaths.sort()) {
      try {
        const aux = await this.#read(projectId, path);
        numberingInputs.push(`${path}:${hash(aux)}`);
        const token = this.#textCache.get(projectId)?.get(path)?.token;
        const timestamp = token && /^\d+:/.test(token) ? BigInt(token.split(":")[0]!) : 0n;
        for (const match of aux.matchAll(/\\newlabel\{([^}]+)\}\s*\{\{([^{}]+)\}/g)) {
          if (match[1] && match[2] && !match[1].endsWith("@cref") && timestamp >= (numberingDates.get(match[1]) ?? -1n)) {
            numbered.set(match[1], match[2]); numberingDates.set(match[1], timestamp);
          }
        }
      } catch (error) { if (!(error instanceof AppError) || error.code !== "FILE_NOT_FOUND") throw error; }
    }
    structure.numberingFingerprint = hash(numberingInputs.join("\n"));
    if (old && !old.indexDirty && old.configurationFingerprint === configurationFingerprint && old.numberingFingerprint === structure.numberingFingerprint && JSON.stringify(old.files) === JSON.stringify(structure.files)) {
      return { graph, structure: old, sources, definitions, directives, queryIndex: this.#index(projectId, old) };
    }
    for (const path of paths) {
      const nodes = new Map<string, PreviewNode>();
      const collect = (entries: PreviewNode[]) => { for (const node of entries) { nodes.set(keyOf(node.kind === "block" ? node.environmentId : node.contentType, node.source.startOffset, node.source.endOffset), node); if (node.kind === "block") collect(node.children); } };
      collect(cache.get(path)!.document.nodes);
      nodeMaps.set(path, nodes);
    }

    // Materialize the empty paragraph using its original placeholder ID.
    let snapshot = graph.toSnapshot();
    for (const placeholder of Object.values(old?.blocks ?? {})) {
      if (!placeholder.placeholder || !placeholder.parentId) continue;
      const children = snapshot.structuralParents.filter((edge) => edge.parent === placeholder.parentId);
      const child = children.length === 1 ? graph.getBlock(children[0]!.child) : undefined;
      if (child?.type === "paragraph" && !old?.blocks[child.id] && !graph.getBlock(placeholder.id)) {
        graph.removeBlock(child.id);
        graph.addBlock({ ...child, id: placeholder.id });
        graph.setStructuralParent(placeholder.id, placeholder.parentId);
      }
    }
    snapshot = graph.toSnapshot();
    structure.dependencies = snapshot.dependencies;
    structure.relations = snapshot.relations ?? [];
    const unbound = snapshot.blocks.filter((block) => !block.fileId || !block.range);
    if (unbound.length) structure.unboundBlocks = unbound;
    const parentIds = new Map(snapshot.structuralParents.map((edge) => [edge.child, edge.parent]));
    const ordinals = new Map<string, number>();
    const ordered = [...snapshot.blocks].sort((a, b) => (a.fileId ?? "").localeCompare(b.fileId ?? "") || (a.range?.start ?? 0) - (b.range?.start ?? 0) || (b.range?.end ?? 0) - (a.range?.end ?? 0));
    for (const node of ordered) {
      if (!node.fileId || !node.range) continue;
      const previous = old?.blocks[node.id];
      const raw = sources.get(node.fileId);
      const parsed = nodeMaps.get(node.fileId)?.get(keyOf(node.type, node.range.start, node.range.end));
      const local = !parsed && node.metadata?.apiExplicitChild && raw !== undefined ? parsePreview(raw.slice(node.range.start, node.range.end), node.fileId, definitions, directives).nodes[0] : undefined;
      const contentFingerprint = raw === undefined ? previous?.identity?.contentFingerprint : hash(raw.slice(node.range.start, node.range.end));
      const range: SourceRange = parsed ? rangeOf(parsed.source) : cache.get(node.fileId)?.index.range(node.range.start, node.range.end) ?? { ...node.range, startLine: node.source?.startLine ?? 1, startColumn: node.source?.startColumn ?? 1, endLine: node.source?.endLine ?? 1, endColumn: node.source?.endColumn ?? 1 };
      const ordinal = (ordinals.get(node.type) ?? 0) + 1;
      if (node.state === "active") ordinals.set(node.type, ordinal);
      const display = node.label ? numbered.get(node.label) : undefined;
      const block: DocumentBlock = {
        id: node.id, type: node.type, kind: node.kind, origin: node.origin ?? "user", state: node.state ?? "active",
        parentId: parentIds.get(node.id) ?? null, childIds: [],
        source: { fileId: node.fileId, range, ...(parsed?.kind === "block" ? { bodyRange: rangeOf(parsed.body) } : local?.kind === "block" ? { bodyRange: cache.get(node.fileId)!.index.range(node.range.start + local.body.startOffset, node.range.start + local.body.endOffset) } : {}) },
        revision: previous ? previous.revision + (previous.identity?.contentFingerprint !== contentFingerprint || previous.type !== node.type || previous.kind !== node.kind || previous.state !== node.state ? 1 : 0) : 1,
        numbering: { ordinal, ...(display ? { display } : {}) },
        identity: { ...(typeof node.metadata?.parserFingerprint === "string" ? { parserFingerprint: node.metadata.parserFingerprint } : {}), ...(contentFingerprint ? { contentFingerprint } : {}) },
        ...(node.title === undefined ? {} : { title: node.title }), ...(node.label === undefined ? {} : { label: node.label }),
        ...(previous?.semantic ? { semantic: structuredClone(previous.semantic) } : {}),
        ...(previous?.capabilityOverrides ? { capabilityOverrides: previous.capabilityOverrides } : {}),
        ...(node.metadata === undefined ? {} : { metadata: structuredClone(node.metadata) })
      };
      structure.blocks[node.id] = block;
    }
    for (const block of Object.values(structure.blocks)) {
      if (block.state !== "active") continue;
      const parent = block.parentId ? structure.blocks[block.parentId] : undefined;
      if (parent?.state === "active") parent.childIds.push(block.id);
      else { block.parentId = null; structure.roots.push(block.id); }
    }
    for (const parent of Object.values(structure.blocks)) {
      if (parent.state !== "active" || parent.kind !== "structural" || parent.childIds.length) continue;
      const point = parent.source.bodyRange ?? parent.source.range;
      const id = `placeholder:${parent.id}`;
      const empty = { start: point.end, end: point.end, startLine: point.endLine, endLine: point.endLine, startColumn: point.endColumn, endColumn: point.endColumn };
      structure.blocks[id] = { id, type: "paragraph", kind: "content", origin: "virtual", state: "active", parentId: parent.id, childIds: [], source: { fileId: parent.source.fileId, range: empty }, revision: old?.blocks[id]?.revision ?? 1, placeholder: true, identity: { contentFingerprint: hash("") }, ...(old?.blocks[id]?.semantic ? { semantic: structuredClone(old.blocks[id]!.semantic) } : {}) };
      parent.childIds.push(id);
    }
    if (JSON.stringify({ ...structure, structureRevision: 0 }) !== JSON.stringify({ ...old, structureRevision: 0 })) structure.structureRevision++;
    graph.setDocumentStructure(structure);
    return { graph, structure, sources, definitions, directives, queryIndex: this.#index(projectId, structure) };
  }

  #index(projectId: string, structure: DocumentStructure): BlockQueryIndex {
    const cached = this.#queryCache.get(projectId);
    const token = JSON.stringify([structure.structureRevision, structure.configurationFingerprint, structure.numberingFingerprint, structure.files]);
    if (cached?.token === token) return cached.index;
    const index = new BlockQueryIndex(structure);
    this.#queryCache.set(projectId, { token, index });
    return index;
  }

  async #read(projectId: string, path: string): Promise<string> {
    if (!this.files.getFileVersion) return (await this.files.readText(projectId, path)).content;
    const token = await this.files.getFileVersion(projectId, path);
    let entries = this.#textCache.get(projectId);
    if (!entries) { entries = new Map(); this.#textCache.set(projectId, entries); }
    const cached = entries.get(path);
    if (cached?.token === token) return cached.content;
    const content = (await this.files.readText(projectId, path)).content;
    if (token !== await this.files.getFileVersion(projectId, path)) throw new ApiError("EXTERNAL_MODIFICATION_CONFLICT", "Source changed while being read. Retry the operation.");
    entries.set(path, { token, content });
    return content;
  }

  #block(context: Context, id: string): DocumentBlock {
    const block = context.structure.blocks[id];
    if (!block || block.state !== "active") throw new ApiError("BLOCK_NOT_FOUND", `Active block does not exist: ${id}`);
    return block;
  }
  #revision(block: DocumentBlock, revision: number): void {
    if (!Number.isInteger(revision)) throw new ApiError("INVALID_GRAPH_QUERY", "expectedRevision is required.");
    if (block.revision !== revision) throw new ApiError("STALE_BLOCK", "The block changed; fetch it again before editing.", { expectedRevision: revision, currentRevision: block.revision });
  }
  #source(context: Context, block: DocumentBlock): string {
    const content = context.sources.get(block.source.fileId);
    if (content === undefined) throw new ApiError("FILE_NOT_FOUND", "The block's source file is unavailable.");
    return content.slice(block.source.range.start, block.source.range.end);
  }
  #card(block: DocumentBlock): BlockCard {
    const semanticStale = Boolean((block.semantic?.summary && block.semantic.summary.blockRevision !== block.revision) || (block.semantic?.tags && block.semantic.tags.blockRevision !== block.revision));
    return {
      id: block.id, type: block.type, kind: block.kind, childCount: block.childIds.length,
      ...(block.title ? { title: block.title } : {}), ...(block.label ? { label: block.label } : {}),
      ...(block.numbering?.display ? { number: block.numbering.display } : {}), ...(block.numbering?.ordinal ? { ordinal: block.numbering.ordinal } : {}),
      ...(block.semantic?.summary ? { summary: block.semantic.summary.text } : {}),
      ...(block.semantic?.tags ? { tags: [...new Set([...block.semantic.tags.user, ...block.semantic.tags.ai])] } : {}),
      ...(block.placeholder ? { placeholder: true } : {}), ...(semanticStale ? { semanticStale: true } : {})
    };
  }
  #detail(context: Context, block: DocumentBlock): BlockDetail {
    return { ...this.#card(block), origin: block.origin, revision: block.revision,
      parent: block.parentId ? this.#card(this.#block(context, block.parentId)) : null,
      children: block.childIds.map((id) => this.#card(this.#block(context, id))),
      location: { fileId: block.source.fileId, startLine: block.source.range.startLine, endLine: block.source.range.endLine },
      textVersion: context.structure.files[block.source.fileId]?.textVersion,
      capabilities: getBlockCapabilities(block) };
  }
  #descendants(structure: DocumentStructure, id: string): string[] {
    const result = [id];
    for (let index = 0; index < result.length; index++) result.push(...(structure.blocks[result[index]!]!.childIds));
    return result;
  }
  #candidates(context: Context, parentId: string | null | undefined, recursive: boolean): DocumentBlock[] {
    if (parentId === undefined) return Object.values(context.structure.blocks).filter((block) => block.state === "active");
    const ids = parentId === null ? context.structure.roots : this.#block(context, parentId).childIds;
    return (recursive ? ids.flatMap((id) => this.#descendants(context.structure, id)) : ids).map((id) => this.#block(context, id));
  }
  #list(context: Context, input: ListBlocksInput): BlockCard[] {
    const limit = limitOf(input.limit);
    const matches = new Set(context.queryIndex.select({ ...(input.types ? { type: input.types } : {}), ...(input.kind ? { kind: input.kind } : {}), ...(input.origin ? { origin: input.origin } : {}), ...(input.fileId ? { file: input.fileId } : {}) }).map((block) => block.id));
    return this.#candidates(context, input.parentId, input.recursive ?? true).filter((block) => matches.has(block.id) &&
      (!input.fileId || block.source.fileId === input.fileId) && (!input.kind || block.kind === input.kind)
      && (!input.origin || block.origin === input.origin) && (!input.types || input.types.includes(block.type))).slice(0, limit).map((block) => this.#card(block));
  }
  #find(context: Context, input: FindBlocksInput): BlockCard[] {
    const limit = limitOf(input.limit), types = input.type ? (Array.isArray(input.type) ? input.type : [input.type]) : undefined;
    const query = input.query?.trim().toLocaleLowerCase();
    const indexed = context.queryIndex.select({ ...(types ? { type: types } : {}), ...(input.kind ? { kind: input.kind } : {}), ...(input.fileId ? { file: input.fileId } : {}), ...(input.label ? { label: input.label } : {}), ...(input.number ? { number: input.number } : {}), ...(input.ordinal !== undefined ? { ordinal: input.ordinal } : {}), ...(input.tags ? { tags: input.tags } : {}) });
    const allowed = input.parentId === undefined ? undefined : new Set(this.#candidates(context, input.parentId, true).map((block) => block.id));
    const candidates = indexed.filter((block) => (!allowed || allowed.has(block.id)) &&
      (!types || types.includes(block.type)) && (!input.kind || input.kind === block.kind)
      && (!input.fileId || input.fileId === block.source.fileId) && (!input.label || input.label === block.label)
      && (!input.number || input.number === block.numbering?.display) && (input.ordinal === undefined || input.ordinal === block.numbering?.ordinal)
      && (!input.tags || input.tags.every((tag) => [...(block.semantic?.tags?.user ?? []), ...(block.semantic?.tags?.ai ?? [])].includes(tag))));
    if (!query) return candidates.slice(0, limit).map((block) => this.#card(block));
    const hits: Array<{ block: DocumentBlock; score: number }> = [], unresolved: DocumentBlock[] = [];
    for (const block of candidates) {
      const metadata = [block.label, block.numbering?.display, block.title].filter((value): value is string => Boolean(value)).map((value) => value.toLocaleLowerCase());
      const tags = [...(block.semantic?.tags?.user ?? []), ...(block.semantic?.tags?.ai ?? [])];
      const score = metadata.includes(query) ? 5 : metadata.some((value) => value.includes(query)) ? 4 : tags.some((tag) => tag.toLocaleLowerCase().includes(query)) ? 3 : block.semantic?.summary?.text.toLocaleLowerCase().includes(query) ? 2 : 0;
      if (score) hits.push({ block, score }); else unresolved.push(block);
    }
    // Metadata first. Only read body ranges if the metadata results do not fill the requested page.
    if (hits.length < limit) for (const block of unresolved) {
      if (block.kind === "content" && !block.placeholder && this.#source(context, block).toLocaleLowerCase().includes(query)) hits.push({ block, score: 1 });
      if (hits.length >= limit) break;
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ block }) => this.#card(block));
  }

  async #edit(projectId: string, context: Context, path: string, start: number, end: number, replacement: string): Promise<void> {
    const source = context.sources.get(path)!;
    if ((await this.files.readText(projectId, path)).content !== source) throw new ApiError("EXTERNAL_MODIFICATION_CONFLICT", "Source changed during the operation; retry with a fresh block revision.");
    const next = source.slice(0, start) + replacement + source.slice(end);
    await this.files.writeText(projectId, path, next);
    context.graph.mapUserBlockRanges(path, [[{ start, end, newLength: replacement.length }]]);
  }

  async #insert(projectId: string, context: Context, input: InsertBlockInput): Promise<BlockDetail> {
    if (!input.block || !/^[A-Za-z][A-Za-z0-9_:@*-]*$/.test(input.block.type)) throw new ApiError("INVALID_GRAPH_QUERY", "Invalid block type.");
    const parent = input.parentId === null ? undefined : this.#block(context, input.parentId);
    if (parent && input.expectedRevision !== undefined) this.#revision(parent, input.expectedRevision);
    const fileId = parent?.source.fileId ?? input.fileId ?? (Object.keys(context.structure.files).length === 1 ? Object.keys(context.structure.files)[0] : undefined);
    if (!fileId || !context.sources.has(fileId)) throw new ApiError("INVALID_GRAPH_QUERY", "Choose a fileId for a root insertion in a multi-file project.");
    const source = context.sources.get(fileId)!;
    const body = parent?.source.bodyRange ?? parent?.source.range;
    const documentStart = /\\begin\{document\}/.exec(source);
    let start = body?.start ?? (documentStart ? documentStart.index + documentStart[0].length : 0);
    if (input.position === "end") start = body?.end ?? (source.lastIndexOf("\\end{document}") >= 0 ? source.lastIndexOf("\\end{document}") : source.length);
    else if (input.position !== "start") {
      const id = "before" in input.position ? input.position.before : input.position.after;
      const sibling = this.#block(context, id);
      if (sibling.parentId !== input.parentId || sibling.source.fileId !== fileId) throw new ApiError("INVALID_GRAPH_QUERY", "The insertion anchor must be a sibling in the same file.");
      start = "before" in input.position ? sibling.source.range.start : sibling.source.range.end;
    }
    const type = input.block.type;
    const content = input.block.content ?? "";
    if (typeof content !== "string") throw new ApiError("INVALID_GRAPH_QUERY", "content must be a string.");
    if (!content && type === "paragraph" && parent?.kind === "structural" && parent.childIds.length === 1) {
      const placeholder = context.structure.blocks[parent.childIds[0]!]!;
      if (placeholder.placeholder) return this.#detail(context, placeholder);
    }
    const definition = context.definitions.find((definition) => definition.id === type);
    const match = definition?.match;
    let snippet = content;
    if (match?.kind === "virtual-block") {
      const title = input.block.title;
      if (title && /["\r\n]/.test(title)) throw new ApiError("INVALID_GRAPH_QUERY", "A virtual block title must not contain quotes or newlines.");
      snippet = `% tw:block-begin type=${match.type}${title ? ` title="${title}"` : ""}\n${content}\n% tw:block-end`;
    } else if (type === "display-math" || match?.kind === "display-math") snippet = `\\[\n${content}\n\\]`;
    else if (match?.kind === "command" || ["chapter", "section", "subsection", "subsubsection"].includes(type)) {
      const title = input.block.title ?? "";
      if (/[{}\r\n]/.test(title)) throw new ApiError("INVALID_GRAPH_QUERY", "A heading title must not contain unbalanced delimiters.");
      snippet = `\\${match?.kind === "command" ? match.command : type}{${title}}\n${content}`;
    } else if (type !== "paragraph") {
      const name = match?.kind === "latex-environment" ? match.name : type.replace(/^custom:/, "");
      snippet = `\\begin{${name}}\n${content}\n\\end{${name}}`;
    }
    const replacement = `\n\n${snippet}\n\n`;
    const planned = parsePreview(source.slice(0, start) + replacement + source.slice(start), fileId, context.definitions, context.directives);
    const sameType = (candidate: string) => candidate.replace(/^custom:/, "") === type.replace(/^custom:/, "");
    const plannedById = new Map<string, PreviewNode>();
    const collectPlanned = (nodes: PreviewNode[]) => { for (const node of nodes) { plannedById.set(node.id, node); if (node.kind === "block") collectPlanned(node.children); } };
    collectPlanned(planned.nodes);
    const findPlanned = (nodes: PreviewNode[]): PreviewNode | undefined => {
      for (const node of nodes) {
        if (node.source.startOffset === start + 2 && (node.kind === "block" ? sameType(node.environmentId) : type === "paragraph")) return node;
        if (node.kind === "block") { const found = findPlanned(node.children); if (found) return found; }
      }
      return undefined;
    };
    const proposed = findPlanned(planned.nodes);
    if (parent?.kind !== "content" && !proposed) throw new ApiError("BLOCK_RANGE_INVALID", "The requested source does not form a block at this position.");
    if (parent?.origin === "environment" && parent.kind === "structural" && proposed) {
      const actualParent = proposed.parentId ? plannedById.get(proposed.parentId) : undefined;
      if (actualParent?.source.startOffset !== parent.source.range.start) throw new ApiError("BLOCK_RANGE_INVALID", "The insertion would escape the requested parent or cross an existing block boundary.");
    }
    await this.#edit(projectId, context, fileId, start, start, replacement);
    let refreshed = await this.#refresh(projectId, context.graph);
    let inserted = Object.values(refreshed.structure.blocks).find((block) => block.state === "active" && !block.placeholder && block.source.fileId === fileId && block.source.range.start === start + 2 && sameType(block.type));
    // Explicit children in a content block are permitted, even though parser-created
    // math/image/table internals are intentionally not document blocks.
    if (!inserted && parent?.kind === "content") {
      const parsed = parsePreview(snippet, fileId, context.definitions, context.directives);
      const offset = start + 2;
      const index = new SourceIndex(source.slice(0, start) + replacement + source.slice(start));
      const add = (nodes: PreviewNode[], parentId: string) => {
        for (const node of nodes) {
          const id = this.ids.next(), nodeType = node.kind === "block" ? node.environmentId : node.contentType;
          const from = offset + node.source.startOffset, to = offset + node.source.endOffset;
          const range = index.range(from, to);
          context.graph.addBlock({ id, type: nodeType, kind: node.kind === "block" ? node.semanticKind ?? inferBlockKind(nodeType) : "content", origin: "user", fileId, range: { start: from, end: to }, state: "active",
            source: { relativePath: fileId, startLine: range.startLine, startColumn: range.startColumn, endLine: range.endLine, endColumn: range.endColumn },
            ...(node.kind === "block" && node.latexLabel ? { label: node.latexLabel } : {}), ...(node.kind === "block" && node.title ? { title: node.title } : {}),
            metadata: { apiExplicitChild: true, parserFingerprint: hash(snippet.slice(node.source.startOffset, node.source.endOffset)) } });
          context.graph.setStructuralParent(id, parentId);
          if (node.kind === "block") add(node.children, id);
        }
      };
      add(parsed.nodes, parent.id);
      context.graph.setDocumentStructure({ ...refreshed.structure, indexDirty: true });
      refreshed = await this.#refresh(projectId, context.graph);
      inserted = Object.values(refreshed.structure.blocks).find((block) => block.source.fileId === fileId && block.source.range.start === start + 2 && sameType(block.type));
    }
    if (!inserted) throw new ApiError("BLOCK_RANGE_INVALID", "Inserted source could not be identified as a block.");
    return this.#detail(refreshed, inserted);
  }
}
