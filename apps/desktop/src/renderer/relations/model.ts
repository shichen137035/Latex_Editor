import type { BlockGraphSnapshot, BlockId, BlockOrigin, DependencyEdge, RelationDirection, SemanticBlock } from "@latex-editor/contracts";

export type HierarchyScope = "all" | "same-parent" | "ancestors" | "descendants" | "same-section";
export type UnmatchedBehavior = "dim" | "hide";

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
  disabledReason?: "focus-required" | "self-loop" | "virtual-endpoint" | "bidirectional" | "orphaned" | "descendant-prerequisite";
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
export function projectRelationCandidates(snapshot: BlockGraphSnapshot, focusId: BlockId | null, filters: RelationFilters): RelationCandidateProjection {
  const parents = parentMap(snapshot);
  const allowedByScope = scopeIds(snapshot, focusId, filters.hierarchyScope);
  const query = filters.textQuery.trim().toLocaleLowerCase();
  const matchIds = new Set<BlockId>();
  for (const block of snapshot.blocks) {
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
  const filterActive = filters.hierarchyScope !== "all" || filters.role !== "all" || filters.origin !== "all" || filters.label !== "all" || query.length > 0;
  for (const id of matchIds) {
    for (const ancestor of ancestorsOf(id, parents)) {
      contextIds.add(ancestor);
      if (filterActive) autoExpandedIds.add(ancestor);
    }
  }
  return { roots: relationTree(snapshot), matchIds, contextIds, autoExpandedIds };
}

export function candidateRelationState(snapshot: BlockGraphSnapshot, focusId: BlockId | null, candidateId: BlockId, direction: RelationDirection): CandidateRelationState {
  if (!focusId) return { disabledReason: "focus-required" };
  if (focusId === candidateId) return { disabledReason: "self-loop" };
  const focus = snapshot.blocks.find((block) => block.id === focusId);
  const candidate = snapshot.blocks.find((block) => block.id === candidateId);
  if (!focus || !candidate || focus.state === "orphaned" || candidate.state === "orphaned") return { disabledReason: "orphaned" };
  if (focus.origin === "virtual" || candidate.origin === "virtual" || focus.capabilities?.connectable === false || candidate.capabilities?.connectable === false) return { disabledReason: "virtual-endpoint" };
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
  if (direction === "prerequisite") {
    const parents = parentMap(snapshot);
    if (ancestorsOf(candidateId, parents).includes(focusId)) return { disabledReason: "descendant-prerequisite" };
  }
  return {};
}

export function relationEndpoints(focusId: BlockId, candidateId: BlockId, direction: Exclude<RelationDirection, "both">): DependencyEdge {
  return direction === "prerequisite" ? { from: candidateId, to: focusId } : { from: focusId, to: candidateId };
}
