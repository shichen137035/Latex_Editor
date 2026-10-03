import {
  isRelationCapableBlock, RelationError,
  type BlockRelation, type DependencyEdge, type DisplayScope, type DisplayScopeOptions, type RelationCreator,
  type RelationGraph, type RelationImpact, type RelationIssue, type RelationScope, type RelationScopeEntry,
  type RelationScopeOptions, type RelationStoreData, type RelationTraversalResult, type RelationValidationResult, type SemanticBlock
} from "@latex-editor/contracts";

export interface RelationBlockPort {
  getBlock(id: string): SemanticBlock | undefined;
  getContainedBlocks(id: string): string[];
  getStructuralParents(id: string): string[];
}
const pair = (a: string, b: string) => JSON.stringify([a, b]);
const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort();

/** Deterministic migration; old endpoints are preserved even when invalid. */
export function migrateRelationData(data: unknown, legacy: DependencyEdge[] = []): RelationStoreData {
  if (data === undefined) return { version: 1, relations: legacy.map((edge, index) => ({
    id: `legacy:${pair(edge.from, edge.to)}:${index}`, sourceId: edge.from, targetId: edge.to, createdBy: "user", createdAt: 0, updatedAt: 0
  })) };
  const value = data as Partial<RelationStoreData> | null;
  if (!value || value.version !== 1 || !Array.isArray(value.relations)) throw new RelationError("INVALID_GRAPH_STATE", "Unsupported relation metadata schema.");
  for (const item of value.relations) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || typeof item.sourceId !== "string" || !item.sourceId.trim() || typeof item.targetId !== "string" || !item.targetId.trim()
      || !["user", "ai"].includes(item.createdBy) || !Number.isFinite(item.createdAt) || item.createdAt < 0 || !Number.isFinite(item.updatedAt) || item.updatedAt < item.createdAt) {
      throw new RelationError("INVALID_GRAPH_STATE", "Invalid relation metadata record.");
    }
  }
  return structuredClone(value as RelationStoreData);
}

/** UI-free graph engine. All mutation routes use canCreateRelation. */
export class RelationGraphManager {
  readonly #blocks: RelationBlockPort;
  #relations: BlockRelation[];
  readonly #byId = new Map<string, BlockRelation>();
  readonly #pairs = new Map<string, BlockRelation>();
  readonly #outgoing = new Map<string, Set<string>>();
  readonly #incoming = new Map<string, Set<string>>();
  constructor(blocks: RelationBlockPort, relations: BlockRelation[] = []) {
    this.#blocks = blocks; this.#relations = structuredClone(relations); this.#index();
  }
  snapshot(): RelationStoreData { return { version: 1, relations: structuredClone(this.#relations) }; }
  #index(): void {
    this.#byId.clear(); this.#pairs.clear(); this.#outgoing.clear(); this.#incoming.clear();
    for (const r of this.#relations) {
      this.#byId.set(r.id, r); this.#pairs.set(pair(r.sourceId, r.targetId), r);
      if (!this.#outgoing.has(r.sourceId)) this.#outgoing.set(r.sourceId, new Set());
      if (!this.#incoming.has(r.targetId)) this.#incoming.set(r.targetId, new Set());
      this.#outgoing.get(r.sourceId)!.add(r.targetId); this.#incoming.get(r.targetId)!.add(r.sourceId);
    }
  }
  #require(id: string): SemanticBlock {
    const block = this.#blocks.getBlock(id);
    if (!block) throw new RelationError("BLOCK_NOT_FOUND", `Block not found: ${id}`, { blockId: id });
    return block;
  }
  #endpoint(sourceId: string, targetId: string): RelationValidationResult {
    const source = this.#blocks.getBlock(sourceId), target = this.#blocks.getBlock(targetId);
    if (!source) return { valid: false, reason: "SOURCE_NOT_FOUND" };
    if (!target) return { valid: false, reason: "TARGET_NOT_FOUND" };
    if (!isRelationCapableBlock(source)) return { valid: false, reason: "INVALID_SOURCE" };
    if (!isRelationCapableBlock(target)) return { valid: false, reason: "INVALID_TARGET" };
    if (sourceId === targetId) return { valid: false, reason: "SELF_RELATION" };
    return { valid: true };
  }
  canCreateRelation(sourceId: string, targetId: string, excludeRelationId?: string): RelationValidationResult {
    const endpoint = this.#endpoint(sourceId, targetId);
    if (!endpoint.valid) return endpoint;
    const existing = this.#pairs.get(pair(sourceId, targetId));
    if (existing && existing.id !== excludeRelationId) return { valid: false, reason: "DUPLICATE_RELATION" };
    if (this.#path(targetId, sourceId, excludeRelationId)) return { valid: false, reason: "CYCLE" };
    return { valid: true };
  }
  assertValidation(result: RelationValidationResult): void {
    if (result.valid) return;
    const reason = result.reason!;
    const code = reason === "CYCLE" ? "CYCLE_DETECTED" : reason === "DUPLICATE_RELATION" ? "RELATION_EXISTS" : reason === "SELF_RELATION" ? "SELF_RELATION" : reason.endsWith("NOT_FOUND") ? "BLOCK_NOT_FOUND" : "INVALID_ENDPOINT";
    throw new RelationError(code, `Relation rejected: ${reason}`, { reason });
  }
  createRelation(sourceId: string, targetId: string, options: { id: string; createdBy?: RelationCreator; now?: number }): BlockRelation {
    this.assertValidation(this.canCreateRelation(sourceId, targetId));
    if (!options.id || this.#byId.has(options.id)) throw new RelationError("RELATION_EXISTS", "Relation ID already exists.");
    const now = options.now ?? Date.now();
    if (!["user", "ai"].includes(options.createdBy ?? "user") || !Number.isFinite(now) || now < 0) throw new RelationError("INVALID_GRAPH_STATE", "Invalid relation creation metadata.");
    const relation: BlockRelation = { id: options.id, sourceId, targetId, createdBy: options.createdBy ?? "user", createdAt: now, updatedAt: now };
    this.#relations.push(relation); this.#index(); return structuredClone(relation);
  }
  getRelation(id: string): BlockRelation | null { return structuredClone(this.#byId.get(id) ?? null); }
  #requireRelation(id: string): BlockRelation {
    const relation = this.#byId.get(id);
    if (!relation) throw new RelationError("RELATION_NOT_FOUND", `Relation not found: ${id}`);
    return relation;
  }
  deleteRelation(id: string): void { this.#requireRelation(id); this.#relations = this.#relations.filter(r => r.id !== id); this.#index(); }
  reverseRelation(id: string, now = Date.now()): BlockRelation {
    const r = this.#requireRelation(id);
    this.assertValidation(this.canCreateRelation(r.targetId, r.sourceId, id));
    const result = { ...r, sourceId: r.targetId, targetId: r.sourceId, updatedAt: Math.max(now, r.updatedAt) };
    this.#relations = this.#relations.map(item => item.id === id ? result : item); this.#index(); return structuredClone(result);
  }
  removeBlockRelations(id: string): void { this.#relations = this.#relations.filter(r => r.sourceId !== id && r.targetId !== id); this.#index(); }
  getRelations(id: string): { incoming: BlockRelation[]; outgoing: BlockRelation[] } {
    this.#require(id);
    return { incoming: this.#relations.filter(r => r.targetId === id).map(r => ({ ...r })), outgoing: this.#relations.filter(r => r.sourceId === id).map(r => ({ ...r })) };
  }
  getPrerequisites(id: string): string[] { this.#require(id); return sorted(this.#incoming.get(id) ?? []); }
  getDependents(id: string): string[] { this.#require(id); return sorted(this.#outgoing.get(id) ?? []); }
  #depth(depth: number | "all"): number {
    if (depth === "all") return Infinity;
    if (!Number.isInteger(depth) || depth < 0) throw new RelationError("INVALID_GRAPH_STATE", "Depth must be a non-negative integer or 'all'.");
    return depth;
  }
  #traverse(focusIds: string[], direction: "prerequisites" | "dependents", depth: number | "all"): Map<string, number> {
    const limit = this.#depth(depth), index = direction === "prerequisites" ? this.#incoming : this.#outgoing;
    const distances = new Map(focusIds.map(id => [id, 0]));
    const queue = [...focusIds];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor]!, distance = distances.get(id)!;
      if (distance >= limit) continue;
      for (const next of index.get(id) ?? []) {
        if (distances.has(next) || !isRelationCapableBlock(this.#blocks.getBlock(next) ?? { type: "paragraph" })) continue;
        distances.set(next, distance + 1); queue.push(next);
      }
    }
    return distances;
  }
  getAncestors(id: string, options: { maxDepth?: number } = {}): RelationTraversalResult { return this.#traversal(id, "prerequisites", options.maxDepth ?? "all"); }
  getDescendants(id: string, options: { maxDepth?: number } = {}): RelationTraversalResult { return this.#traversal(id, "dependents", options.maxDepth ?? "all"); }
  #traversal(id: string, direction: "prerequisites" | "dependents", depth: number | "all"): RelationTraversalResult {
    this.#require(id);
    const distances = this.#traverse([id], direction, depth); distances.delete(id);
    return { focusId: id, entries: [...distances].map(([blockId, distance]) => ({ blockId, distance })).sort((a, b) => a.distance - b.distance || a.blockId.localeCompare(b.blockId)) };
  }
  dependsOn(id: string, prerequisiteId: string): boolean { this.#require(id); this.#require(prerequisiteId); return id !== prerequisiteId && this.#path(prerequisiteId, id) !== null; }
  #path(source: string, target: string, excludeId?: string): string[] | null {
    const parents = new Map<string, string | null>([[source, null]]), queue = [source];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor]!;
      if (id === target) {
        const path = [id]; let current = parents.get(id);
        while (current) { path.push(current); current = parents.get(current); }
        return path.reverse();
      }
      for (const next of this.#outgoing.get(id) ?? []) {
        if (excludeId && this.#pairs.get(pair(id, next))?.id === excludeId) continue;
        if (!parents.has(next)) { parents.set(next, id); queue.push(next); }
      }
    }
    return null;
  }
  findRelationPath(sourceId: string, targetId: string): string[] | null { this.#require(sourceId); this.#require(targetId); return this.#path(sourceId, targetId); }
  getRelationScope(options: RelationScopeOptions): RelationScope {
    if (!options || !Array.isArray(options.focusIds) || !["prerequisites", "dependents", "both"].includes(options.direction)) throw new RelationError("INVALID_GRAPH_STATE", "Invalid relation scope options.");
    this.#depth(options.depth);
    const focusIds = sorted(options.focusIds);
    for (const id of focusIds) if (!isRelationCapableBlock(this.#require(id))) throw new RelationError("INVALID_ENDPOINT", `Focus block is not relation-capable: ${id}`);
    const entries = new Map<string, RelationScopeEntry>(focusIds.map(blockId => [blockId, { blockId, distance: 0, direction: "focus" }]));
    for (const direction of ["prerequisites", "dependents"] as const) {
      if (options.direction !== direction && options.direction !== "both") continue;
      for (const [blockId, distance] of this.#traverse(focusIds, direction, options.depth)) {
        const old = entries.get(blockId);
        if (!old || distance < old.distance) entries.set(blockId, { blockId, distance, direction: direction === "prerequisites" ? "prerequisite" : "dependent" });
      }
    }
    if (options.includeFocus === false) for (const id of focusIds) entries.delete(id);
    const ordered = [...entries.values()].sort((a, b) => a.distance - b.distance || a.blockId.localeCompare(b.blockId));
    const ids = new Set(entries.keys());
    return { focusIds, entries: ordered, blockIds: ordered.map(entry => entry.blockId), relations: this.#relations.filter(r => ids.has(r.sourceId) && ids.has(r.targetId)).map(r => ({ ...r })) };
  }
  getRelationSubgraph(scope: RelationScope): RelationGraph { return { nodes: structuredClone(scope.entries), edges: structuredClone(scope.relations) }; }
  getDisplayScope(scope: RelationScope, options: DisplayScopeOptions): DisplayScope {
    const content = new Set<string>(), parents = new Set<string>(), related = new Set(scope.blockIds);
    for (const id of related) {
      this.#require(id);
      if (options.includeContent) for (const child of this.#blocks.getContainedBlocks(id)) {
        const block = this.#blocks.getBlock(child);
        if (block && block.state !== "orphaned" && !related.has(child)) content.add(child);
      }
      if (options.includeStructuralParents) for (const parent of this.#blocks.getStructuralParents(id)) if (!related.has(parent) && !content.has(parent)) parents.add(parent);
    }
    for (const id of content) parents.delete(id);
    return { relationBlockIds: [...scope.blockIds], contentBlockIds: sorted(content), structuralParentIds: sorted(parents), allBlockIds: sorted([...related, ...content, ...parents]) };
  }
  getRelationImpact(id: string): RelationImpact {
    const relations = this.getRelations(id);
    return { incomingRelations: relations.incoming.map(r => r.id), outgoingRelations: relations.outgoing.map(r => r.id), directPrerequisites: this.getPrerequisites(id), directDependents: this.getDependents(id), downstreamDependents: this.getDescendants(id).entries.map(e => e.blockId) };
  }
  validateRelationGraph(): RelationIssue[] {
    const issues: RelationIssue[] = [], pairs = new Map<string, BlockRelation[]>(), ids = new Map<string, BlockRelation[]>();
    for (const r of this.#relations) {
      const endpoint = this.#endpoint(r.sourceId, r.targetId);
      if (!endpoint.valid) issues.push({ type: endpoint.reason?.endsWith("NOT_FOUND") ? "DANGLING_RELATION" : "INVALID_ENDPOINT", severity: "error", blockIds: [r.sourceId, r.targetId], relationIds: [r.id], details: { reason: endpoint.reason } });
      const key = pair(r.sourceId, r.targetId); pairs.set(key, [...(pairs.get(key) ?? []), r]); ids.set(r.id, [...(ids.get(r.id) ?? []), r]);
    }
    for (const group of [...pairs.values(), ...ids.values()]) if (group.length > 1) issues.push({ type: "DUPLICATE_RELATION", severity: "error", blockIds: sorted(group.flatMap(r => [r.sourceId, r.targetId])), relationIds: group.map(r => r.id) });
    // Iterative Kosaraju avoids stack overflow on deep dependency chains.
    const vertices = sorted(this.#relations.flatMap(r => [r.sourceId, r.targetId])), seen = new Set<string>(), finish: string[] = [];
    for (const root of vertices) {
      if (seen.has(root)) continue;
      const stack: Array<[string, boolean]> = [[root, false]];
      while (stack.length) {
        const [id, done] = stack.pop()!;
        if (done) { finish.push(id); continue; }
        if (seen.has(id)) continue;
        seen.add(id); stack.push([id, true]);
        for (const next of this.#outgoing.get(id) ?? []) if (!seen.has(next)) stack.push([next, false]);
      }
    }
    seen.clear();
    for (const root of finish.reverse()) {
      if (seen.has(root)) continue;
      const component: string[] = [], queue = [root]; seen.add(root);
      for (let cursor = 0; cursor < queue.length; cursor++) { const id = queue[cursor]!; component.push(id); for (const next of this.#incoming.get(id) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); } }
      const members = new Set(component);
      if (component.length > 1 || this.#outgoing.get(root)?.has(root)) issues.push({ type: "CYCLE", severity: "error", blockIds: sorted(component), relationIds: this.#relations.filter(r => members.has(r.sourceId) && members.has(r.targetId)).map(r => r.id) });
    }
    return issues;
  }
}
