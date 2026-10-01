import { AppError, type BlockCapabilities, type BlockGraphSnapshot, type DocumentBlock, type DocumentStructure, type SemanticBlock } from "@latex-editor/contracts";

export function assertDocumentStructure(structure: DocumentStructure): void {
  const fail = (message: string): never => { throw new AppError("GRAPH_SNAPSHOT_INVALID", message); };
  if (!Number.isInteger(structure.structureRevision) || structure.structureRevision < 0) fail("Invalid document structure revision.");
  const rangeValid = (range: DocumentBlock["source"]["range"]) => range && Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end >= range.start && [range.startLine, range.endLine, range.startColumn, range.endColumn].every((position) => Number.isInteger(position) && position >= 1);
  for (const [id, block] of Object.entries(structure.blocks)) {
    if (!block || block.id !== id || typeof block.type !== "string" || !["structural", "content"].includes(block.kind) || !["environment", "virtual", "user"].includes(block.origin)
      || !["active", "orphaned", "conflicted"].includes(block.state) || !Number.isInteger(block.revision) || block.revision < 1 || !block.source || typeof block.source.fileId !== "string"
      || !rangeValid(block.source.range) || !Array.isArray(block.childIds) || !block.childIds.every((child) => typeof child === "string") || (block.parentId !== null && typeof block.parentId !== "string")) fail(`Invalid canonical block: ${id}`);
    if (block.source.bodyRange && (!rangeValid(block.source.bodyRange) || block.source.bodyRange.start < block.source.range.start || block.source.bodyRange.end > block.source.range.end)) fail(`Invalid body range: ${id}`);
    if (block.parentId && !structure.blocks[block.parentId]) fail(`Missing block parent: ${id}`);
    if (block.childIds.some((child) => !structure.blocks[child] || structure.blocks[child]!.parentId !== id)) fail(`Inconsistent block children: ${id}`);
  }
  const complete = new Set<string>();
  for (const id of Object.keys(structure.blocks)) {
    const path = new Set<string>();
    let current: string | null = id;
    while (current && !complete.has(current)) {
      if (path.has(current)) fail("Document structure contains a structural cycle.");
      path.add(current);
      current = structure.blocks[current]!.parentId;
    }
    for (const entry of path) complete.add(entry);
  }
  if (structure.roots.some((id) => !structure.blocks[id] || structure.blocks[id]!.parentId !== null)) fail("Invalid document roots.");
}

/** Capabilities are derived, rather than repeated on every persisted node. */
export function getBlockCapabilities(block: Pick<DocumentBlock, "type" | "kind" | "origin" | "placeholder" | "capabilityOverrides">): BlockCapabilities {
  const virtual = block.origin === "virtual";
  return {
    connectable: !virtual && block.type !== "paragraph",
    deletable: !block.placeholder,
    renameable: virtual ? false : block.origin === "user" ? true : "limited",
    retypable: !virtual,
    ...block.capabilityOverrides
  };
}

/** Adapter only: old graph consumers continue receiving the existing array DTO. */
export function structureToGraph(structure: DocumentStructure): BlockGraphSnapshot {
  const nodes = Object.values(structure.blocks).filter((block) => !block.placeholder && block.source.range.end > block.source.range.start);
  const ids = new Set(nodes.map((block) => block.id));
  return {
    version: 2,
    blocks: [...nodes.map((block): SemanticBlock => ({
      id: block.id, type: block.type, role: block.type, kind: block.kind, origin: block.origin, state: block.state,
      fileId: block.source.fileId, range: { start: block.source.range.start, end: block.source.range.end },
      source: { relativePath: block.source.fileId, startLine: block.source.range.startLine, startColumn: block.source.range.startColumn, endLine: block.source.range.endLine, endColumn: block.source.range.endColumn },
      ...(block.title === undefined ? {} : { title: block.title, name: block.title }),
      ...(block.label === undefined ? {} : { label: block.label }),
      ...(block.numbering?.ordinal === undefined ? {} : { ordinal: block.numbering.ordinal }),
      ...(block.metadata === undefined ? {} : { metadata: structuredClone(block.metadata) }),
      ...(block.capabilityOverrides === undefined ? {} : { capabilities: { ...getBlockCapabilities(block), ...block.capabilityOverrides } })
    })), ...(structure.unboundBlocks ?? [])],
    structuralParents: nodes.filter((block) => block.parentId && ids.has(block.parentId)).map((block) => ({ parent: block.parentId!, child: block.id })),
    dependencies: structure.dependencies ?? []
  };
}

/** Preserve the canonical index when a legacy relation/Inspector operation saves. */
export function mergeGraphStructure(graph: BlockGraphSnapshot, previous: DocumentStructure): DocumentStructure {
  const blocks: Record<string, DocumentBlock> = {};
  const parents = new Map(graph.structuralParents.map((edge) => [edge.child, edge.parent]));
  for (const node of graph.blocks) {
    if (!node.fileId || !node.range) continue;
    const old = previous.blocks[node.id];
    const range = { ...node.range, startLine: node.source?.startLine ?? 1, startColumn: node.source?.startColumn ?? 1, endLine: node.source?.endLine ?? 1, endColumn: node.source?.endColumn ?? 1 };
    blocks[node.id] = {
      ...old, id: node.id, type: node.type, kind: node.kind, origin: node.origin ?? "user", state: node.state ?? "active",
      parentId: parents.get(node.id) ?? null, childIds: [], revision: old?.revision ?? 1,
      source: { fileId: node.fileId, range, ...(old?.source.bodyRange && old.source.range.start === range.start && old.source.range.end === range.end ? { bodyRange: old.source.bodyRange } : {}) },
      ...(node.metadata === undefined ? {} : { metadata: structuredClone(node.metadata) })
    };
    const block = blocks[node.id]!;
    if (node.title ?? node.name) block.title = node.title ?? node.name!; else delete block.title;
    if (node.label) block.label = node.label; else delete block.label;
  }
  const populated = new Set(Object.values(blocks).filter((block) => block.state === "active" && block.parentId).map((block) => block.parentId));
  for (const old of Object.values(previous.blocks)) {
    if (old.placeholder && old.parentId && blocks[old.parentId]?.state === "active" && !populated.has(old.parentId)) blocks[old.id] = structuredClone(old);
  }
  const roots: string[] = [];
  for (const block of Object.values(blocks)) {
    if (block.state !== "active") continue;
    if (block.parentId && blocks[block.parentId]?.state === "active") blocks[block.parentId]!.childIds.push(block.id);
    else { block.parentId = null; roots.push(block.id); }
  }
  const unboundBlocks = graph.blocks.filter((block) => !block.fileId || !block.range);
  const result = { ...previous, blocks, roots, dependencies: graph.dependencies, ...(unboundBlocks.length ? { unboundBlocks } : {}) };
  return JSON.stringify(result) === JSON.stringify(previous) ? previous : { ...result, indexDirty: true };
}
