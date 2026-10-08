import { createHash } from "node:crypto";
import { AppError, defaultPreviewDirectives, includeNewBuiltInDirectives, type DocumentTextVersion, type WorkingDocumentInput, type WorkingDocumentResult } from "@latex-editor/contracts";
import { BlockGraphManager } from "@latex-editor/editor-core";
import { parsePreview } from "@latex-editor/editor-core/preview/parser";
import { tryIncrementalPreviewUpdate } from "@latex-editor/editor-core/preview/incremental";
import { previewBlocksForReconciliation } from "@latex-editor/editor-core/preview/reconciliation";
import type { EnvironmentDefinition, PreviewDocument } from "@latex-editor/editor-core/preview/types";
import type { PreviewDirectiveDefinition } from "@latex-editor/contracts";
import type { DocumentStructureFilePort } from "./document-structure-service.js";
import type { ProjectBlockGraphService } from "./block-graph-service.js";

const metadataPath = ".texweave/structure.json";
const fingerprint = (content: string) => createHash("sha256").update(content).digest("hex");
type BufferFile = WorkingDocumentInput["files"][number];
type Session = { id: string; revision: number; files: Map<string, BufferFile>; metadata?: string; baseline?: string | undefined };
type ParsedFile = { source: string; configuration: string; document: PreviewDocument };
const conflict = (message: string) => new AppError("DOCUMENT_VERSION_CONFLICT", message);

/** An explicit editor read view. Unsaved source and its graph never reach disk. */
export class WorkingDocumentFiles implements DocumentStructureFilePort {
  readonly sessions = new Map<string, Session>();
  constructor(readonly disk: DocumentStructureFilePort) {}
  assertSavedSource(projectId: string, path: string): void {
    if (this.sessions.get(projectId)?.files.has(path)) throw conflict("Unversioned source-range updates cannot modify a working document. Submit a versioned document snapshot instead.");
  }
  async readText(projectId: string, path: string): Promise<{ content: string }> {
    const session = this.sessions.get(projectId);
    if (path === metadataPath && session?.files.size && session.metadata !== undefined) return { content: session.metadata };
    const file = session?.files.get(path);
    return file ? { content: file.content } : this.disk.readText(projectId, path);
  }
  async writeText(projectId: string, path: string, content: string): Promise<unknown> {
    const session = this.sessions.get(projectId);
    if (path === metadataPath && session?.files.size) { session.metadata = content; return; }
    if (session?.files.has(path)) throw new AppError("UNSAVED_DOCUMENT", "Save the document before applying a source operation to this file.");
    const result = await this.disk.writeText(projectId, path, content);
    if (path === metadataPath && session) delete session.metadata;
    return result;
  }
  listTree(projectId: string) { return this.disk.listTree(projectId); }
  async getFileVersion(projectId: string, path: string): Promise<string> {
    const session = this.sessions.get(projectId);
    if (session?.files.has(path)) return `working:${session.id}:${session.revision}`;
    // Ports without version support still get a content-based token.
    return this.disk.getFileVersion?.(projectId, path) ?? fingerprint((await this.disk.readText(projectId, path)).content);
  }
  getTextVersion(projectId: string, path: string, content: string): DocumentTextVersion {
    const session = this.sessions.get(projectId);
    return session?.files.has(path) ? { kind: "working", fingerprint: fingerprint(content), sessionId: session.id, revision: session.revision }
      : { kind: "saved", fingerprint: fingerprint(content) };
  }
  async savedMetadata(projectId: string): Promise<string | undefined> {
    try { return (await this.disk.readText(projectId, metadataPath)).content; }
    catch (error) { if (error instanceof AppError && error.code === "FILE_NOT_FOUND") return undefined; throw error; }
  }
  async savedGraph(projectId: string): Promise<BlockGraphManager> {
    let content = await this.savedMetadata(projectId);
    if (content === undefined) {
      try { content = (await this.disk.readText(projectId, ".texweave/block-graph.json")).content; }
      catch (error) { if (!(error instanceof AppError) || error.code !== "FILE_NOT_FOUND") throw error; }
    }
    return content === undefined ? BlockGraphManager.empty() : BlockGraphManager.fromUnknown(JSON.parse(content));
  }
}

/** One monotonic, project-scoped editor session; AI/CLI keep disk-only services. */
export class ProjectWorkingDocumentService {
  readonly #retired = new Set<string>();
  readonly #parses = new Map<string, Map<string, ParsedFile>>();
  constructor(readonly files: WorkingDocumentFiles, readonly graphs: ProjectBlockGraphService, readonly ids: { next(): string },
    readonly definitions: (projectId: string) => Promise<EnvironmentDefinition[]> = async () => [],
    readonly directives: (projectId: string) => Promise<PreviewDirectiveDefinition[]> = async () => defaultPreviewDirectives,
    readonly releaseCache: (projectId: string) => void = () => undefined) {}

  async sync(projectId: string, input: WorkingDocumentInput): Promise<WorkingDocumentResult> {
    this.#validate(input);
    return this.graphs.withSourceUpdate(projectId, async (graph) => {
      const previous = this.files.sessions.get(projectId);
      if (this.#retired.has(input.sessionId) || previous && (previous.id !== input.sessionId || input.revision <= previous.revision)) {
        throw conflict("The editor snapshot is stale or belongs to another session.");
      }
      // Validate every baseline before changing any source or metadata state.
      const disk = new Map<string, string>();
      for (const file of input.files) {
        const content = (await this.files.disk.readText(projectId, file.fileId)).content;
        if (content !== file.savedContent) throw conflict(`The saved file changed outside this editor: ${file.fileId}`);
        disk.set(file.fileId, content);
      }
      const dirty = new Map(input.files.filter(file => file.content !== file.savedContent).map(file => [file.fileId, file]));
      const discardedFiles = new Set<string>();
      for (const [path, file] of previous?.files ?? []) {
        if (!dirty.has(path)) {
          const saved = disk.get(path) ?? (await this.files.disk.readText(projectId, path)).content;
          if (saved !== file.content) discardedFiles.add(path);
          disk.set(path, saved);
        }
      }
      const savedMetadata = await this.files.savedMetadata(projectId);
      const discarded = discardedFiles.size > 0;
      if (previous?.files.size && !dirty.size && !discarded && savedMetadata !== previous.baseline) throw conflict("Saved structure metadata changed while the editor had unsaved documents.");
      if (discarded) graph = restoreSavedFiles(graph, await this.files.savedGraph(projectId), discardedFiles);
      const session: Session = { id: input.sessionId, revision: input.revision, files: dirty,
        ...(dirty.size ? { baseline: previous?.files.size && !discarded ? previous.baseline : savedMetadata } : {}) };
      const definitions = (await this.definitions(projectId)).map(definition => ({ ...definition, enabled: true }));
      const directives = includeNewBuiltInDirectives(await this.directives(projectId));
      const configuration = JSON.stringify([definitions, directives]);
      const cache = this.#parses.get(projectId) ?? new Map<string, ParsedFile>();
      const nextCache = new Map<string, ParsedFile>();
      const semanticIds: WorkingDocumentResult["semanticIds"] = {};
      const sourceFiles = new Map(input.files.map(file => [file.fileId, file]));
      const sources = new Map(input.files.map(file => [file.fileId, file.content]));
      for (const path of previous?.files.keys() ?? []) if (!sources.has(path)) sources.set(path, disk.get(path)!);
      for (const [path, content] of sources) {
        const before = discardedFiles.has(path) ? disk.get(path) : previous?.files.get(path)?.content ?? disk.get(path);
        if (before !== undefined && before !== content) {
          const transactions = recordedEdits(sourceFiles.get(path)?.rangeChanges, before, content);
          graph.mapUserBlockRanges(path, transactions ?? [[sourceEdit(before, content)]]);
        }
        const prior = cache.get(path);
        const incremental = prior?.configuration === configuration && prior.source !== content
          ? tryIncrementalPreviewUpdate(prior.document, prior.source, content, path, definitions, undefined, directives) : undefined;
        const document = prior?.configuration === configuration && prior.source === content ? prior.document
          : incremental && "document" in incremental ? incremental.document : parsePreview(content, path, definitions, directives);
        nextCache.set(path, { source: content, configuration, document });
        const parsed = previewBlocksForReconciliation(document, content);
        semanticIds[path] = graph.reconcileParsedBlocks(path, parsed.blocks, () => this.ids.next()).transientToBlockId;
      }
      // The next structure query must rebuild its index from this exact read view.
      const structure = graph.getDocumentStructure();
      if (structure) {
        const versions = { ...structure.files };
        for (const [path, content] of sources) {
          const previousFile = versions[path], contentFingerprint = fingerprint(content);
          versions[path] = { path, version: previousFile ? previousFile.version + (previousFile.fingerprint !== contentFingerprint ? 1 : 0) : 1,
            fingerprint: contentFingerprint,
            textVersion: dirty.has(path) ? { kind: "working", fingerprint: contentFingerprint, sessionId: input.sessionId, revision: input.revision }
              : { kind: "saved", fingerprint: contentFingerprint } };
        }
        graph.setDocumentStructure({ ...structure, files: versions, indexDirty: true });
      }
      for (const [path, content] of disk) {
        if ((await this.files.disk.readText(projectId, path)).content !== content) throw conflict(`The file changed while preparing its structure: ${path}`);
      }
      this.files.sessions.set(projectId, session);
      this.#parses.set(projectId, nextCache);
      return { graph, changed: true, resetHistory: discarded,
        rollback: () => { if (previous) this.files.sessions.set(projectId, previous); else this.files.sessions.delete(projectId); },
        result: { revision: input.revision, snapshot: graph.toSnapshot(), semanticIds } };
    });
  }

  async close(projectId: string, sessionId: string): Promise<void> {
    if (typeof sessionId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(sessionId)) throw conflict("Invalid document session.");
    await this.graphs.releaseSourceView(projectId, () => {
      const session = this.files.sessions.get(projectId);
      this.#retired.add(sessionId);
      if (this.#retired.size > 256) this.#retired.delete(this.#retired.values().next().value!);
      if (session?.id !== sessionId) return false;
      this.files.sessions.delete(projectId);
      this.#parses.delete(projectId);
      this.releaseCache(projectId);
      return true;
    });
  }

  /** Saves require the current buffer and its disk baseline, never an obsolete document version. */
  async save(projectId: string, path: string, content: string): Promise<unknown> {
    return this.graphs.withSourceUpdate(projectId, async (graph) => {
      const session = this.files.sessions.get(projectId);
      const file = session?.files.get(path);
      if (file) {
        if (file.content !== content || (await this.files.disk.readText(projectId, path)).content !== file.savedContent) {
          throw conflict(`Refusing to overwrite another document version: ${path}`);
        }
        if (session!.files.size === 1 && await this.files.savedMetadata(projectId) !== session!.baseline) throw conflict("Saved structure metadata changed while editing.");
      }
      const result = await this.files.disk.writeText(projectId, path, content);
      if (!file) return { graph, result, changed: false };
      const nextSession = { ...session!, files: new Map(session!.files) };
      nextSession.files.delete(path);
      this.files.sessions.set(projectId, nextSession);
      const structure = graph.getDocumentStructure();
      if (structure) {
        const files = { ...structure.files };
        if (files[path]) files[path] = { ...files[path]!, textVersion: { kind: "saved", fingerprint: fingerprint(content) } };
        graph.setDocumentStructure({ ...structure, files, indexDirty: true });
      }
      // Promote only when every dirty file has been saved; otherwise keep the graph in memory.
      return { graph, result, changed: true, rollback: () => {
        // Text was saved, but metadata failed. Keep the working graph for a safe retry.
        session!.files.set(path, { ...file, savedContent: content });
        this.files.sessions.set(projectId, session!);
      } };
    });
  }

  async mutateEntries<T>(projectId: string, paths: string[], operation: () => Promise<T>): Promise<T> {
    return this.graphs.withSourceUpdate(projectId, async graph => {
      for (const file of this.files.sessions.get(projectId)?.files.keys() ?? []) {
        if (paths.some(path => file === path || file.startsWith(`${path}/`))) throw new AppError("UNSAVED_DOCUMENT", "Save the document before moving or removing its file or folder.");
      }
      const result = await operation();
      const structure = graph.getDocumentStructure();
      if (structure) graph.setDocumentStructure({ ...structure, indexDirty: true });
      return { graph, result, changed: !!structure };
    });
  }

  #validate(input: WorkingDocumentInput): void {
    if (!input || typeof input.sessionId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(input.sessionId) || !Number.isSafeInteger(input.revision) || input.revision < 1 || !Array.isArray(input.files) || input.files.length > 512) throw conflict("Invalid editor snapshot.");
    const paths = new Set<string>();
    for (const file of input.files) {
      if (!file || typeof file.fileId !== "string" || !/\.tex$/i.test(file.fileId) || file.fileId.includes("\\") || file.fileId.startsWith("/") || file.fileId.includes(":") || file.fileId.split("/").some(part => !part || part === "." || part === "..") || typeof file.content !== "string" || typeof file.savedContent !== "string" || paths.has(file.fileId.toLowerCase())) throw conflict("Invalid or duplicate editor file.");
      paths.add(file.fileId.toLowerCase());
    }
  }
}

function sourceEdit(before: string, after: string) {
  let start = 0, end = before.length, nextEnd = after.length;
  while (start < end && start < nextEnd && before[start] === after[start]) start++;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  return { start, end, newLength: nextEnd - start };
}

/** Verify actual text edits, skip already accepted batches, then map only their remaining tail. */
function recordedEdits(record: BufferFile["rangeChanges"], before: string, after: string) {
  if (!record) return undefined;
  if (typeof record.beforeContent !== "string" || !Array.isArray(record.transactions)) throw conflict("Invalid source transaction record.");
  let content = record.beforeContent;
  let found = content === before;
  const remaining: { start: number; end: number; newLength: number }[][] = [];
  for (const batch of record.transactions) {
    if (!Array.isArray(batch)) throw conflict("Invalid source transaction batch.");
    const sorted = [...batch].sort((a, b) => a.from - b.from);
    let cursor = 0, next = "";
    for (const change of sorted) {
      if (!change || !Number.isSafeInteger(change.from) || !Number.isSafeInteger(change.to) || change.from < cursor || change.to < change.from || change.to > content.length || typeof change.insertedText !== "string") throw conflict("Invalid source edit.");
      next += content.slice(cursor, change.from) + change.insertedText;
      cursor = change.to;
    }
    next += content.slice(cursor);
    if (found) remaining.push(sorted.map(change => ({ start: change.from, end: change.to, newLength: change.insertedText.length })));
    content = next;
    // The snapshot may have returned to an already seen text through undo/redo.
    if (content === before) { found = true; remaining.length = 0; }
  }
  if (!found || content !== after) throw conflict("Source transactions do not match the current and proposed document versions.");
  return remaining;
}

/** Roll back only discarded files; unrelated pending block semantics and relations remain in the view. */
function restoreSavedFiles(working: BlockGraphManager, saved: BlockGraphManager, paths: Set<string>): BlockGraphManager {
  const current = working.toSnapshot(), baseline = saved.toSnapshot();
  const restoredIds = new Set([...current.blocks, ...baseline.blocks].filter(block => block.fileId && paths.has(block.fileId)).map(block => block.id));
  const blocks = [...current.blocks.filter(block => !restoredIds.has(block.id)), ...baseline.blocks.filter(block => restoredIds.has(block.id))];
  const ids = new Set(blocks.map(block => block.id));
  const restoredRelations = (baseline.relations ?? []).filter(relation => restoredIds.has(relation.sourceId) || restoredIds.has(relation.targetId));
  const restoredRelationIds = new Set(restoredRelations.map(relation => relation.id));
  const relations = [...(current.relations ?? []).filter(relation => !restoredRelationIds.has(relation.id) && !restoredIds.has(relation.sourceId) && !restoredIds.has(relation.targetId)), ...restoredRelations]
    .filter(relation => ids.has(relation.sourceId) && ids.has(relation.targetId));
  const structuralParents = [...current.structuralParents.filter(edge => !restoredIds.has(edge.child)), ...baseline.structuralParents.filter(edge => restoredIds.has(edge.child))]
    .filter(edge => ids.has(edge.child) && ids.has(edge.parent));
  const graph = new BlockGraphManager({ version: 2, blocks, structuralParents, relations, relationSchemaVersion: 1,
    dependencies: relations.map(relation => ({ from: relation.sourceId, to: relation.targetId })) });
  const old = working.getDocumentStructure(), base = saved.getDocumentStructure();
  if (old) {
    const documentBlocks = { ...old.blocks };
    for (const [id, block] of Object.entries(documentBlocks)) if (paths.has(block.source.fileId)) delete documentBlocks[id];
    for (const [id, block] of Object.entries(base?.blocks ?? {})) if (paths.has(block.source.fileId)) documentBlocks[id] = block;
    graph.setDocumentStructure({ ...old, blocks: documentBlocks, indexDirty: true, structureRevision: old.structureRevision + 1 });
  }
  return graph;
}
