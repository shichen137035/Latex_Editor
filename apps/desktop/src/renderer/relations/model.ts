import { isRelationCapableBlock, type BlockGraphSnapshot, type BlockId, type BlockOrigin, type DependencyEdge, type RelationDirection, type RelationScope, type SemanticBlock } from "@latex-editor/contracts";
import { BlockGraphManager } from "@latex-editor/editor-core";
const graphCache = new WeakMap<BlockGraphSnapshot, BlockGraphManager>();

export type HierarchyScope = "all" | "same-parent" | "ancestors" | "descendants" | "same-section";

export interface RelationFilters {
  hierarchyScope: HierarchyScope;
  role: string;
  origin: BlockOrigin | "all";
  label: string;
  textQuery: string;
}

export interface RelationTreeNode {
  block: SemanticBlock;
  children: RelationTreeNode[];
}

export interface RelationCandidateProjection {
  roots: RelationTreeNode[];
  matchIds: Set<BlockId>;
  contextIds: Set<BlockId>;
  autoExpandedIds: Set<BlockId>;
}

export interface CandidateRelationState {
  existing?: DependencyEdge;
  existingDirection?: Exclude<RelationDirection, "both">;
  disabledReason?: "focus-required" | "self-loop" | "virtual-endpoint" | "bidirectional" | "orphaned" | "descendant-prerequisite" | "cycle";
}

export function blockRole(block: SemanticBlock): string {
  return block.role ?? block.type;
}

export function blockName(block: SemanticBlock): string {
  return block.name || block.title || block.label || blockRole(block) || "Block";
}

function documentOrder(a: SemanticBlock, b: SemanticBlock): number {
  const file = (a.fileId ?? a.source?.relativePath ?? "").localeCompare(b.fileId ?? b.source?.relativePath ?? "");
  if (file) return file;
  const range = (a.range?.start ?? Number.MAX_SAFE_INTEGER) - (b.range?.start ?? Number.MAX_SAFE_INTEGER);
  if (range) return range;
  const ordinal = (a.ordinal ?? Number.MAX_SAFE_INTEGER) - (b.ordinal ?? Number.MAX_SAFE_INTEGER);
  return ordinal || a.id.localeCompare(b.id);
}

export function orderedBlocks(snapshot: BlockGraphSnapshot): SemanticBlock[] {
  return [...snapshot.blocks].sort(documentOrder);
}

export function relationTree(snapshot: BlockGraphSnapshot): RelationTreeNode[] {
  const nodes = new Map(snapshot.blocks.map((block) => [block.id, { block, children: [] as RelationTreeNode[] }]));
  const childIds = new Set<BlockId>();
  for (const edge of snapshot.structuralParents) {
    const parent = nodes.get(edge.parent);
    const child = nodes.get(edge.child);
    if (!parent || !child || edge.parent === edge.child) continue;
    parent.children.push(child);
    childIds.add(edge.child);
  }
  const sortTree = (items: RelationTreeNode[]) => {
    items.sort((a, b) => documentOrder(a.block, b.block));
    for (const item of items) sortTree(item.children);
  };
  const roots = [...nodes.values()].filter((node) => !childIds.has(node.block.id));
  sortTree(roots);
  return roots;
}

function parentMap(snapshot: BlockGraphSnapshot): Map<BlockId, BlockId> {
  return new Map(snapshot.structuralParents.map((edge) => [edge.child, edge.parent]));
}

function childrenMap(snapshot: BlockGraphSnapshot): Map<BlockId, BlockId[]> {
  const result = new Map<BlockId, BlockId[]>();
  for (const edge of snapshot.structuralParents) result.set(edge.parent, [...(result.get(edge.parent) ?? []), edge.child]);
  return result;
}

function ancestorsOf(id: BlockId, parents: Map<BlockId, BlockId>): BlockId[] {
  const result: BlockId[] = [];
  const seen = new Set<BlockId>([id]);
  let current = parents.get(id);
  while (current && !seen.has(current)) {
    result.push(current);
    seen.add(current);
    current = parents.get(current);
  }
  return result;
}

function descendantsOf(id: BlockId, children: Map<BlockId, BlockId[]>): BlockId[] {
  const result: BlockId[] = [];
  const seen = new Set<BlockId>([id]);
  const pending = [...(children.get(id) ?? [])];
  while (pending.length) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    result.push(current);
    pending.push(...(children.get(current) ?? []));
  }
  return result;
}

function scopeIds(snapshot: BlockGraphSnapshot, focusId: BlockId | null, scope: HierarchyScope): Set<BlockId> {
  const all = new Set(snapshot.blocks.map((block) => block.id));
  if (!focusId || scope === "all") return all;
  const parents = parentMap(snapshot);
  const children = childrenMap(snapshot);
  if (scope === "ancestors") return new Set(ancestorsOf(focusId, parents));
  if (scope === "descendants") return new Set(descendantsOf(focusId, children));
  if (scope === "same-parent") {
    const parent = parents.get(focusId);
    return new Set(parent ? children.get(parent) ?? [] : relationTree(snapshot).map((node) => node.block.id));
  }
  const blocks = new Map(snapshot.blocks.map((block) => [block.id, block]));
  const section = [focusId, ...ancestorsOf(focusId, parents)].find((id) => /^section$/i.test(blockRole(blocks.get(id)!)));
  return section ? new Set([section, ...descendantsOf(section, children)]) : all;
}

/**
 * Computes candidate matches without changing document order. Ancestors of a
 * match remain visible as muted context and are auto-expanded separately from
 * the user's manual expansion state.
 */
export function projectRelationCandidates(snapshot: BlockGraphSnapshot, focusId: BlockId | null, filters: RelationFilters, allowedIds?: ReadonlySet<BlockId>): RelationCandidateProjection {
  const parents = parentMap(snapshot);
  const allowedByScope = scopeIds(snapshot, focusId, filters.hierarchyScope);
  const query = filters.textQuery.trim().toLocaleLowerCase();
  const matchIds = new Set<BlockId>();
  for (const block of snapshot.blocks) {
    if (allowedIds && !allowedIds.has(block.id)) continue;
    const origin = block.origin ?? "environment";
    const haystack = `${blockName(block)} ${blockRole(block)} ${block.label ?? ""} ${block.fileId ?? block.source?.relativePath ?? ""}`.toLocaleLowerCase();
    if (!allowedByScope.has(block.id)) continue;
    if (filters.role !== "all" && blockRole(block) !== filters.role) continue;
    if (filters.origin !== "all" && origin !== filters.origin) continue;
    if (filters.label !== "all" && block.label !== filters.label) continue;
    if (query && !haystack.includes(query)) continue;
    matchIds.add(block.id);
  }
  const contextIds = new Set<BlockId>();
  const autoExpandedIds = new Set<BlockId>();
  const filterActive = !!allowedIds || filters.hierarchyScope !== "all" || filters.role !== "all" || filters.origin !== "all" || filters.label !== "all" || query.length > 0;
  for (const id of matchIds) {
    for (const ancestor of ancestorsOf(id, parents)) {
      contextIds.add(ancestor);
      if (filterActive) autoExpandedIds.add(ancestor);
    }
  }
  return { roots: relationTree(snapshot), matchIds, contextIds, autoExpandedIds };
}

function cachedGraph(snapshot: BlockGraphSnapshot): BlockGraphManager {
  let graph = graphCache.get(snapshot);
  if (!graph) { graph = new BlockGraphManager(snapshot); graphCache.set(snapshot, graph); }
  return graph;
}

/** Frontend scopes use the same traversal and containment rules as the application service. */
export function relationScope(snapshot: BlockGraphSnapshot, focusId: BlockId | null, direction: RelationDirection, depth: number | "all"): RelationScope {
  const focus = focusableRelationBlock(snapshot, focusId);
  if (!focus) return { focusIds: [], entries: [], blockIds: [], relations: [] };
  return cachedGraph(snapshot).relations().getRelationScope({ focusIds: [focus.id], direction: direction === "prerequisite" ? "prerequisites" : direction === "consequence" ? "dependents" : "both", depth });
}

/** Return a block only when it is a valid relation focus target. */
export function focusableRelationBlock(snapshot: BlockGraphSnapshot, blockId: BlockId | null | undefined): SemanticBlock | undefined {
  if (!blockId) return undefined;
  const block = snapshot.blocks.find(candidate => candidate.id === blockId);
  return block && isRelationCapableBlock(block) ? block : undefined;
}

export function relationDocumentIds(snapshot: BlockGraphSnapshot, scope: RelationScope): Set<BlockId> {
  return new Set(cachedGraph(snapshot).relations().getDisplayScope(scope, { includeContent: true, includeStructuralParents: false }).allBlockIds);
}

export function blockSection(snapshot: BlockGraphSnapshot, id: BlockId): SemanticBlock | undefined {
  const blocks = new Map(snapshot.blocks.map(block => [block.id, block]));
  return [id, ...ancestorsOf(id, parentMap(snapshot))].map(key => blocks.get(key)).find(block => block && /^(chapter|section|subsection|subsubsection)$/i.test(blockRole(block)));
}

export function candidateRelationState(snapshot: BlockGraphSnapshot, focusId: BlockId | null, candidateId: BlockId, direction: RelationDirection): CandidateRelationState {
  if (!focusId) return { disabledReason: "focus-required" };
  if (focusId === candidateId) return { disabledReason: "self-loop" };
  const focus = snapshot.blocks.find((block) => block.id === focusId);
  const candidate = snapshot.blocks.find((block) => block.id === candidateId);
  if (!focus || !candidate || focus.state === "orphaned" || candidate.state === "orphaned") return { disabledReason: "orphaned" };
  if (!focusableRelationBlock(snapshot, focusId) || !focusableRelationBlock(snapshot, candidateId)) return { disabledReason: "virtual-endpoint" };
  const prerequisite = snapshot.dependencies.find((edge) => edge.from === candidateId && edge.to === focusId);
  const consequence = snapshot.dependencies.find((edge) => edge.from === focusId && edge.to === candidateId);
  if (direction === "prerequisite" && prerequisite) return { existing: prerequisite, existingDirection: "prerequisite" };
  if (direction === "consequence" && consequence) return { existing: consequence, existingDirection: "consequence" };
  if (direction === "both") {
    if (prerequisite) return { existing: prerequisite, existingDirection: "prerequisite" };
    if (consequence) return { existing: consequence, existingDirection: "consequence" };
  }
  if (direction === "prerequisite" && consequence) return { disabledReason: "bidirectional" };
  if (direction === "consequence" && prerequisite) return { disabledReason: "bidirectional" };
  const graph = cachedGraph(snapshot);
  const prerequisiteAllowed = graph.relations().canCreateRelation(candidateId, focusId).valid;
  const dependentAllowed = graph.relations().canCreateRelation(focusId, candidateId).valid;
  if ((direction === "prerequisite" && !prerequisiteAllowed) || (direction === "consequence" && !dependentAllowed) || (direction === "both" && !prerequisiteAllowed && !dependentAllowed)) return { disabledReason: "cycle" };
  return {};
}

export function relationEndpoints(focusId: BlockId, candidateId: BlockId, direction: Exclude<RelationDirection, "both">): DependencyEdge {
  return direction === "prerequisite" ? { from: candidateId, to: focusId } : { from: focusId, to: candidateId };
}
