import {
  AppError,
  type BlockGraphSnapshot,
  type BlockId,
  type DependencyCycle,
  type DependencyEdge,
  type GraphDiagnostic,
  type GraphTraversalOptions,
  type GraphTraversalResult,
  type LogicalRelation,
  type SemanticBlock,
  type StructuralDependencyOverlap,
  type StructuralParentEdge,
  type UpdateSemanticBlockInput
} from "@latex-editor/contracts";

type GraphDirection = "incoming" | "outgoing";

export interface IBlockGraphManager {
  addBlock(block: SemanticBlock): void;
  updateBlock(blockId: BlockId, patch: UpdateSemanticBlockInput): SemanticBlock;
  removeBlock(blockId: BlockId): void;
  addDependency(prerequisite: BlockId, consequence: BlockId): void;
  removeDependency(prerequisite: BlockId, consequence: BlockId): void;
  hasDirectDependency(prerequisite: BlockId, consequence: BlockId): boolean;
  getDirectPrerequisites(blockId: BlockId): BlockId[];
  getDirectConsequences(blockId: BlockId): BlockId[];
  getPrerequisiteClosure(blockId: BlockId, options?: GraphTraversalOptions): GraphTraversalResult;
  getConsequenceClosure(blockId: BlockId, options?: GraphTraversalOptions): GraphTraversalResult;
  isPrerequisiteOf(prerequisite: BlockId, consequence: BlockId): boolean;
  setStructuralParent(child: BlockId, parent: BlockId | null): void;
  getStructuralParent(blockId: BlockId): BlockId | null;
  getStructuralChildren(blockId: BlockId): BlockId[];
  getStructuralAncestors(blockId: BlockId): BlockId[];
  getStructuralDescendants(blockId: BlockId): BlockId[];
  isStructuralAncestor(ancestor: BlockId, descendant: BlockId): boolean;
  detectDependencyCycles(): DependencyCycle[];
  findStructuralOverlapsInPrerequisites(blockId: BlockId): StructuralDependencyOverlap[];
  findLogicalRelationsWithinPrerequisites(blockId: BlockId): LogicalRelation[];
  validateGraph(): GraphDiagnostic[];
}

function sorted(values: Iterable<BlockId>): BlockId[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function cloneBlock(block: SemanticBlock): SemanticBlock {
  return {
    ...block,
    ...(block.source === undefined ? {} : { source: { ...block.source } }),
    ...(block.metadata === undefined ? {} : { metadata: structuredClone(block.metadata) })
  };
}

function assertBlockId(id: string): void {
  if (id.trim().length === 0 || id.includes("\0") || id.length > 256) {
    throw new AppError("INVALID_BLOCK_ID", "Block ids must be non-empty stable identifiers of at most 256 characters");
  }
}

function assertBlock(block: SemanticBlock): void {
  assertBlockId(block.id);
  if (block.type.trim().length === 0) throw new AppError("INVALID_BLOCK_ID", `Block ${block.id} has no semantic type`);
  if (block.title !== undefined && typeof block.title !== "string") throw new AppError("GRAPH_SNAPSHOT_INVALID", `Block ${block.id} has an invalid title`);
  if (block.ordinal !== undefined && (!Number.isInteger(block.ordinal) || block.ordinal < 0)) {
    throw new AppError("GRAPH_SNAPSHOT_INVALID", `Block ${block.id} has an invalid ordinal`);
  }
  if (block.metadata !== undefined && asRecord(block.metadata) === undefined) {
    throw new AppError("GRAPH_SNAPSHOT_INVALID", `Block ${block.id} has invalid metadata`);
  }
  if (block.source !== undefined) {
    const source = asRecord(block.source);
    const positions = source === undefined ? [] : [source.startLine, source.startColumn, source.endLine, source.endColumn].filter((value) => value !== undefined);
    if (source === undefined || typeof source.relativePath !== "string" || source.relativePath.trim().length === 0
      || typeof source.startLine !== "number" || typeof source.startColumn !== "number"
      || positions.some((value) => typeof value !== "number" || !Number.isInteger(value) || value < 1)) {
      throw new AppError("INVALID_BLOCK_ID", `Block ${block.id} has an invalid source range`);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseSnapshot(value: unknown): BlockGraphSnapshot {
  const record = asRecord(value);
  if (record?.version !== 1 || !Array.isArray(record.blocks) || !Array.isArray(record.dependencies) || !Array.isArray(record.structuralParents)) {
    throw new AppError("GRAPH_SNAPSHOT_INVALID", "Block graph metadata has an unsupported or invalid shape");
  }

  const blocks = record.blocks.map((item): SemanticBlock => {
    const block = asRecord(item);
    if (block === undefined || typeof block.id !== "string" || typeof block.type !== "string") {
      throw new AppError("GRAPH_SNAPSHOT_INVALID", "Block graph contains an invalid block record");
    }
    const parsed = structuredClone(block) as unknown as SemanticBlock;
    assertBlock(parsed);
    return parsed;
  });
  const dependencies = record.dependencies.map((item): DependencyEdge => {
    const edge = asRecord(item);
    if (edge === undefined || typeof edge.from !== "string" || typeof edge.to !== "string") {
      throw new AppError("GRAPH_SNAPSHOT_INVALID", "Block graph contains an invalid dependency edge");
    }
    assertBlockId(edge.from);
    assertBlockId(edge.to);
    return { from: edge.from, to: edge.to };
  });
  const structuralParents = record.structuralParents.map((item): StructuralParentEdge => {
    const edge = asRecord(item);
    if (edge === undefined || typeof edge.parent !== "string" || typeof edge.child !== "string") {
      throw new AppError("GRAPH_SNAPSHOT_INVALID", "Block graph contains an invalid structural relation");
    }
    assertBlockId(edge.parent);
    assertBlockId(edge.child);
    return { parent: edge.parent, child: edge.child };
  });
  return { version: 1, blocks, dependencies, structuralParents };
}

/**
 * UI-independent relationship engine for semantic document blocks.
 *
 * Structural containment and logical dependency deliberately remain separate:
 * changing one graph never infers or rewrites edges in the other graph.
 */
export class BlockGraphManager implements IBlockGraphManager {
  readonly #blocks = new Map<BlockId, SemanticBlock>();
  readonly #blockEntries: SemanticBlock[] = [];
  #dependencies: DependencyEdge[] = [];
  #structuralParents: StructuralParentEdge[] = [];

  constructor(snapshot?: BlockGraphSnapshot) {
    for (const block of snapshot?.blocks ?? []) {
      this.#blockEntries.push(cloneBlock(block));
      if (!this.#blocks.has(block.id)) this.#blocks.set(block.id, cloneBlock(block));
    }
    this.#dependencies = (snapshot?.dependencies ?? []).map((edge) => ({ ...edge }));
    this.#structuralParents = (snapshot?.structuralParents ?? []).map((edge) => ({ ...edge }));
  }

  static empty(): BlockGraphManager {
    return new BlockGraphManager();
  }

  static fromUnknown(value: unknown): BlockGraphManager {
    return new BlockGraphManager(parseSnapshot(value));
  }

  toSnapshot(): BlockGraphSnapshot {
    return {
      version: 1,
      blocks: this.#blockEntries.map(cloneBlock),
      dependencies: this.#dependencies.map((edge) => ({ ...edge })),
      structuralParents: this.#structuralParents.map((edge) => ({ ...edge }))
    };
  }

  listBlocks(): SemanticBlock[] {
    return this.#blockEntries.map(cloneBlock);
  }

  getBlock(blockId: BlockId): SemanticBlock | undefined {
    return this.#blocks.has(blockId) ? cloneBlock(this.#blocks.get(blockId)!) : undefined;
  }

  addBlock(block: SemanticBlock): void {
    assertBlock(block);
    if (this.#blocks.has(block.id)) throw new AppError("BLOCK_ALREADY_EXISTS", `Block already exists: ${block.id}`);
    const copy = cloneBlock(block);
    this.#blocks.set(block.id, copy);
    this.#blockEntries.push(copy);
  }

  updateBlock(blockId: BlockId, patch: UpdateSemanticBlockInput): SemanticBlock {
    const existing = this.#requireBlock(blockId);
    const next: SemanticBlock = {
      ...existing,
      ...patch,
      id: blockId,
      ...(patch.source === undefined ? {} : { source: { ...patch.source } }),
      ...(patch.metadata === undefined ? {} : { metadata: structuredClone(patch.metadata) })
    };
    assertBlock(next);
    this.#blocks.set(blockId, next);
    const index = this.#blockEntries.findIndex((block) => block.id === blockId);
    if (index >= 0) this.#blockEntries[index] = next;
    return cloneBlock(next);
  }

  removeBlock(blockId: BlockId): void {
    this.#requireBlock(blockId);
    this.#blocks.delete(blockId);
    for (let index = this.#blockEntries.length - 1; index >= 0; index -= 1) {
      if (this.#blockEntries[index]?.id === blockId) this.#blockEntries.splice(index, 1);
    }
    this.#dependencies = this.#dependencies.filter((edge) => edge.from !== blockId && edge.to !== blockId);
    // Children become roots. Structural lifecycle decisions beyond that belong to the parser/block store.
    this.#structuralParents = this.#structuralParents.filter((edge) => edge.parent !== blockId && edge.child !== blockId);
  }

  addDependency(prerequisite: BlockId, consequence: BlockId): void {
    this.#requireBlock(prerequisite);
    this.#requireBlock(consequence);
    if (prerequisite === consequence) {
      throw new AppError("DEPENDENCY_SELF_REFERENCE", `A block cannot directly depend on itself: ${prerequisite}`);
    }
    if (!this.hasDirectDependency(prerequisite, consequence)) this.#dependencies.push({ from: prerequisite, to: consequence });
  }

  removeDependency(prerequisite: BlockId, consequence: BlockId): void {
    this.#dependencies = this.#dependencies.filter((edge) => edge.from !== prerequisite || edge.to !== consequence);
  }

  hasDirectDependency(prerequisite: BlockId, consequence: BlockId): boolean {
    return this.#dependencies.some((edge) => edge.from === prerequisite && edge.to === consequence);
  }

  getDirectPrerequisites(blockId: BlockId): BlockId[] {
    this.#requireBlock(blockId);
    return sorted(this.#dependencies.filter((edge) => edge.to === blockId && edge.from !== blockId).map((edge) => edge.from));
  }

  getDirectConsequences(blockId: BlockId): BlockId[] {
    this.#requireBlock(blockId);
    return sorted(this.#dependencies.filter((edge) => edge.from === blockId && edge.to !== blockId).map((edge) => edge.to));
  }

  getAllPrerequisites(blockId: BlockId, options?: GraphTraversalOptions): BlockId[] {
    return this.getPrerequisiteClosure(blockId, options).all;
  }

  getAllConsequences(blockId: BlockId, options?: GraphTraversalOptions): BlockId[] {
    return this.getConsequenceClosure(blockId, options).all;
  }

  getPrerequisiteClosure(blockId: BlockId, options?: GraphTraversalOptions): GraphTraversalResult {
    return this.#traverseDependencyGraph(blockId, "incoming", options);
  }

  getConsequenceClosure(blockId: BlockId, options?: GraphTraversalOptions): GraphTraversalResult {
    return this.#traverseDependencyGraph(blockId, "outgoing", options);
  }

  getPrerequisiteDistances(blockId: BlockId, options?: GraphTraversalOptions): Record<BlockId, number> {
    return this.getPrerequisiteClosure(blockId, options).distances;
  }

  getConsequenceDistances(blockId: BlockId, options?: GraphTraversalOptions): Record<BlockId, number> {
    return this.getConsequenceClosure(blockId, options).distances;
  }

  isPrerequisiteOf(prerequisite: BlockId, consequence: BlockId): boolean {
    this.#requireBlock(prerequisite);
    return this.getPrerequisiteClosure(consequence).all.includes(prerequisite);
  }

  isConsequenceOf(consequence: BlockId, prerequisite: BlockId): boolean {
    return this.isPrerequisiteOf(prerequisite, consequence);
  }

  setStructuralParent(child: BlockId, parent: BlockId | null): void {
    this.#requireBlock(child);
    if (parent !== null) this.#requireBlock(parent);
    const withoutChild = this.#structuralParents.filter((edge) => edge.child !== child);
    if (parent !== null) {
      if (parent === child || this.#isStructuralAncestorIn(child, parent, withoutChild)) {
        throw new AppError("STRUCTURAL_CYCLE", `Structural parent ${parent} would create a cycle for ${child}`);
      }
      withoutChild.push({ parent, child });
    }
    this.#structuralParents = withoutChild;
  }

  getStructuralParent(blockId: BlockId): BlockId | null {
    this.#requireBlock(blockId);
    return this.#structuralParents.find((edge) => edge.child === blockId)?.parent ?? null;
  }

  getStructuralChildren(blockId: BlockId): BlockId[] {
    this.#requireBlock(blockId);
    return sorted(this.#structuralParents.filter((edge) => edge.parent === blockId).map((edge) => edge.child));
  }

  getStructuralAncestors(blockId: BlockId): BlockId[] {
    this.#requireBlock(blockId);
    return this.#traverseStructural(blockId, "incoming");
  }

  getStructuralDescendants(blockId: BlockId): BlockId[] {
    this.#requireBlock(blockId);
    return this.#traverseStructural(blockId, "outgoing");
  }

  isStructuralAncestor(ancestor: BlockId, descendant: BlockId): boolean {
    this.#requireBlock(ancestor);
    this.#requireBlock(descendant);
    return this.#isStructuralAncestorIn(ancestor, descendant, this.#structuralParents);
  }

  getStronglyConnectedComponents(): BlockId[][] {
    return this.#stronglyConnectedComponents(
      this.#blocks.keys(),
      (blockId) => this.#dependencies.filter((edge) => edge.from === blockId && this.#blocks.has(edge.to)).map((edge) => edge.to)
    );
  }

  detectDependencyCycles(): DependencyCycle[] {
    return this.getStronglyConnectedComponents()
      .filter((component) => component.length > 1)
      .map((blockIds) => ({ blockIds }));
  }

  findStructuralOverlaps(blockIds: Iterable<BlockId>): Array<{ ancestor: BlockId; descendant: BlockId }> {
    const ids = sorted(blockIds);
    for (const id of ids) this.#requireBlock(id);
    const overlaps: Array<{ ancestor: BlockId; descendant: BlockId }> = [];
    for (let leftIndex = 0; leftIndex < ids.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < ids.length; rightIndex += 1) {
        const left = ids[leftIndex]!;
        const right = ids[rightIndex]!;
        if (this.isStructuralAncestor(left, right)) overlaps.push({ ancestor: left, descendant: right });
        else if (this.isStructuralAncestor(right, left)) overlaps.push({ ancestor: right, descendant: left });
      }
    }
    return overlaps;
  }

  findStructuralOverlapsInPrerequisites(blockId: BlockId): StructuralDependencyOverlap[] {
    const closure = this.getPrerequisiteClosure(blockId);
    const direct = new Set(closure.direct);
    return this.findStructuralOverlaps(closure.all.filter((id) => this.#blocks.has(id))).map((overlap) => ({
      ...overlap,
      ancestorDirect: direct.has(overlap.ancestor),
      descendantDirect: direct.has(overlap.descendant)
    }));
  }

  findStructuralOverlapsInConsequences(blockId: BlockId): StructuralDependencyOverlap[] {
    const closure = this.getConsequenceClosure(blockId);
    const direct = new Set(closure.direct);
    return this.findStructuralOverlaps(closure.all.filter((id) => this.#blocks.has(id))).map((overlap) => ({
      ...overlap,
      ancestorDirect: direct.has(overlap.ancestor),
      descendantDirect: direct.has(overlap.descendant)
    }));
  }

  findLogicalRelationsWithinSet(blockIds: Iterable<BlockId>): LogicalRelation[] {
    const ids = sorted(blockIds);
    for (const id of ids) this.#requireBlock(id);
    const relations: LogicalRelation[] = [];
    for (const from of ids) {
      const reachable = new Set(this.getAllConsequences(from));
      for (const to of ids) {
        if (from === to || !reachable.has(to)) continue;
        relations.push({ from, to, direct: this.hasDirectDependency(from, to) });
      }
    }
    return relations;
  }

  findLogicalRelationsWithinPrerequisites(blockId: BlockId): LogicalRelation[] {
    return this.findLogicalRelationsWithinSet(this.getAllPrerequisites(blockId).filter((id) => this.#blocks.has(id)));
  }

  getBlocksBetween(start: BlockId, end: BlockId): BlockId[] {
    this.#requireBlock(start);
    this.#requireBlock(end);
    if (start === end) return [start];
    if (!this.isPrerequisiteOf(start, end)) return [];
    const fromStart = new Set(this.getAllConsequences(start));
    const toEnd = new Set(this.getAllPrerequisites(end));
    return [start, ...sorted([...fromStart].filter((id) => toEnd.has(id) && id !== start && id !== end)), end];
  }

  validateGraph(): GraphDiagnostic[] {
    const diagnostics: GraphDiagnostic[] = [];
    const blockCounts = new Map<BlockId, number>();
    for (const block of this.#blockEntries) blockCounts.set(block.id, (blockCounts.get(block.id) ?? 0) + 1);
    for (const [id, count] of blockCounts) {
      if (count > 1) diagnostics.push({ type: "duplicate-block", severity: "error", blockIds: [id], message: `Block ${id} is declared ${count} times.` });
    }

    const dependencyCounts = new Map<string, number>();
    for (const edge of this.#dependencies) {
      if (!this.#blocks.has(edge.from) || !this.#blocks.has(edge.to)) {
        diagnostics.push({ type: "dangling-dependency", severity: "error", blockIds: [edge.from, edge.to], message: `Dependency ${edge.from} → ${edge.to} references a missing block.` });
      }
      if (edge.from === edge.to) {
        diagnostics.push({ type: "self-dependency", severity: "error", blockIds: [edge.from], message: `Block ${edge.from} directly depends on itself.` });
      }
      const key = `${edge.from}\0${edge.to}`;
      dependencyCounts.set(key, (dependencyCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of dependencyCounts) {
      if (count <= 1) continue;
      const [from = "", to = ""] = key.split("\0");
      diagnostics.push({ type: "duplicate-dependency", severity: "warning", blockIds: [from, to], message: `Dependency ${from} → ${to} is declared ${count} times.` });
    }

    const parentCounts = new Map<BlockId, number>();
    for (const edge of this.#structuralParents) {
      if (!this.#blocks.has(edge.parent) || !this.#blocks.has(edge.child)) {
        diagnostics.push({ type: "dangling-structural-relation", severity: "error", blockIds: [edge.parent, edge.child], message: `Structural relation ${edge.parent} contains ${edge.child} but references a missing block.` });
      }
      parentCounts.set(edge.child, (parentCounts.get(edge.child) ?? 0) + 1);
    }
    for (const [child, count] of parentCounts) {
      if (count > 1) diagnostics.push({ type: "multiple-structural-parents", severity: "error", blockIds: [child], message: `Block ${child} has ${count} structural parents.` });
    }
    for (const blockIds of this.#detectStructuralCycles()) {
      diagnostics.push({ type: "structural-cycle", severity: "error", blockIds, message: `Blocks ${blockIds.join(", ")} form a structural containment cycle.` });
    }
    for (const cycle of this.detectDependencyCycles()) {
      diagnostics.push({ type: "dependency-cycle", severity: "warning", blockIds: cycle.blockIds, message: `Blocks ${cycle.blockIds.join(", ")} form a logical dependency cycle.` });
    }

    for (const blockId of sorted(this.#blocks.keys())) {
      for (const overlap of this.findStructuralOverlapsInPrerequisites(blockId)) {
        diagnostics.push({
          type: "prerequisite-structural-overlap", severity: "info", blockIds: [blockId, overlap.ancestor, overlap.descendant],
          message: `Prerequisites ${overlap.ancestor} and ${overlap.descendant} of ${blockId} overlap structurally.`
        });
      }
      for (const overlap of this.findStructuralOverlapsInConsequences(blockId)) {
        diagnostics.push({
          type: "consequence-structural-overlap", severity: "info", blockIds: [blockId, overlap.ancestor, overlap.descendant],
          message: `Consequences ${overlap.ancestor} and ${overlap.descendant} of ${blockId} overlap structurally.`
        });
      }
      for (const relation of this.findLogicalRelationsWithinPrerequisites(blockId)) {
        diagnostics.push({
          type: "prerequisite-logical-relation", severity: "info", blockIds: [blockId, relation.from, relation.to],
          message: `Prerequisites ${relation.from} and ${relation.to} of ${blockId} are themselves logically related.`
        });
      }
    }
    return diagnostics;
  }

  #requireBlock(blockId: BlockId): SemanticBlock {
    assertBlockId(blockId);
    const block = this.#blocks.get(blockId);
    if (block === undefined) throw new AppError("BLOCK_NOT_FOUND", `Block not found: ${blockId}`);
    return block;
  }

  #traverseDependencyGraph(start: BlockId, direction: GraphDirection, options?: GraphTraversalOptions): GraphTraversalResult {
    this.#requireBlock(start);
    const maxDepth = options?.maxDepth ?? Number.POSITIVE_INFINITY;
    if ((maxDepth !== Number.POSITIVE_INFINITY && !Number.isInteger(maxDepth)) || maxDepth < 0) {
      throw new AppError("INVALID_GRAPH_QUERY", "Graph traversal maxDepth must be a non-negative integer");
    }
    const neighbors = (id: BlockId): BlockId[] => direction === "incoming"
      ? this.#dependencies.filter((edge) => edge.to === id).map((edge) => edge.from)
      : this.#dependencies.filter((edge) => edge.from === id).map((edge) => edge.to);
    const distances = new Map<BlockId, number>([[start, 0]]);
    const queue: BlockId[] = [start];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      const depth = distances.get(current)!;
      if (depth >= maxDepth) continue;
      for (const next of neighbors(current)) {
        if (distances.has(next)) continue;
        distances.set(next, depth + 1);
        queue.push(next);
      }
    }
    distances.delete(start);
    const all = sorted(distances.keys());
    const direct = all.filter((id) => distances.get(id) === 1);
    const indirect = all.filter((id) => (distances.get(id) ?? 0) > 1);
    return {
      start,
      direct,
      indirect,
      all,
      distances: Object.fromEntries(all.map((id) => [id, distances.get(id)!]))
    };
  }

  #traverseStructural(start: BlockId, direction: GraphDirection): BlockId[] {
    const visited = new Set<BlockId>([start]);
    const queue = [start];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      const neighbors = direction === "incoming"
        ? this.#structuralParents.filter((edge) => edge.child === current).map((edge) => edge.parent)
        : this.#structuralParents.filter((edge) => edge.parent === current).map((edge) => edge.child);
      for (const next of neighbors) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    visited.delete(start);
    return sorted(visited);
  }

  #isStructuralAncestorIn(ancestor: BlockId, descendant: BlockId, edges: StructuralParentEdge[]): boolean {
    const visited = new Set<BlockId>([descendant]);
    const queue = [descendant];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]!;
      for (const edge of edges) {
        if (edge.child !== current) continue;
        if (edge.parent === ancestor) return true;
        if (!visited.has(edge.parent)) {
          visited.add(edge.parent);
          queue.push(edge.parent);
        }
      }
    }
    return false;
  }

  #detectStructuralCycles(): BlockId[][] {
    const components = this.#stronglyConnectedComponents(
      this.#blocks.keys(),
      (blockId) => this.#structuralParents.filter((edge) => edge.parent === blockId && this.#blocks.has(edge.child)).map((edge) => edge.child)
    );
    return components.filter((component) => component.length > 1 || this.#structuralParents.some((edge) => edge.parent === component[0] && edge.child === component[0]));
  }

  #stronglyConnectedComponents(nodes: Iterable<BlockId>, neighbors: (id: BlockId) => Iterable<BlockId>): BlockId[][] {
    let nextIndex = 0;
    const indices = new Map<BlockId, number>();
    const lowLinks = new Map<BlockId, number>();
    const stack: BlockId[] = [];
    const onStack = new Set<BlockId>();
    const components: BlockId[][] = [];

    const visit = (node: BlockId): void => {
      indices.set(node, nextIndex);
      lowLinks.set(node, nextIndex);
      nextIndex += 1;
      stack.push(node);
      onStack.add(node);
      for (const neighbor of new Set(neighbors(node))) {
        if (!indices.has(neighbor)) {
          visit(neighbor);
          lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(neighbor)!));
        } else if (onStack.has(neighbor)) {
          lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(neighbor)!));
        }
      }
      if (lowLinks.get(node) !== indices.get(node)) return;
      const component: BlockId[] = [];
      while (stack.length > 0) {
        const member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      components.push(component.sort((left, right) => left.localeCompare(right)));
    };

    for (const node of sorted(nodes)) if (!indices.has(node)) visit(node);
    return components.sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? ""));
  }
}
