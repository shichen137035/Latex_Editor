import {
  AppError,
  type AddSemanticBlockInput,
  inferBlockKind,
  type BlockGraphSnapshot,
  type DocumentStructure,
  type BlockReconciliationResult,
  type BlockRangeMappingResult,
  type BlockCreationValidation,
  type BlockId,
  type CreateUserBlockInput,
  type CreateSemanticBlockInput,
  type DependencyCycle,
  type GraphDiagnostic,
  type GraphTraversalOptions,
  type GraphTraversalResult,
  type LogicalRelation,
  type MapUserBlockRangesInput,
  type ReconcileParsedBlocksInput,
  type RelationDirection,
  type RelationMutationResult,
  type RelationNeighborhood,
  type RelationValidation,
  type SemanticBlock,
  type StructuralHistoryState,
  type StructuralDependencyOverlap,
  type StructureWarning,
  type UpdateSemanticBlockInput
} from "@latex-editor/contracts";
import type { IdGenerator } from "@latex-editor/domain";
import { BlockGraphManager } from "@latex-editor/editor-core";
import type { ProjectCacheReclamationManager, ProjectCacheReclamationReason } from "./project-cache-reclamation.js";

const graphMetadataPath = ".texweave/structure.json";

interface HistoryEntry {
  before: BlockGraphSnapshot;
  after: BlockGraphSnapshot;
  beforeStructure?: DocumentStructure;
  afterStructure?: DocumentStructure;
}

export interface BlockGraphFilePort {
  readText(projectId: string, relativePath: string): Promise<{ content: string }>;
  writeText(projectId: string, relativePath: string, content: string): Promise<unknown>;
  assertSavedSource?(projectId: string, relativePath: string): void;
}

/**
 * Project-scoped persistence and use-case boundary for the block graph.
 * Mutations are serialized per project so two IPC calls cannot overwrite one
 * another after reading the same metadata snapshot.
 */
export class ProjectBlockGraphService {
  readonly #files: BlockGraphFilePort;
  readonly #ids: IdGenerator;
  readonly #mutationQueues = new Map<string, Promise<void>>();
  readonly #histories = new Map<string, { undo: HistoryEntry[]; redo: HistoryEntry[] }>();
  readonly #listeners = new Set<(projectId: string) => void>();

  constructor(files: BlockGraphFilePort, ids: IdGenerator, readonly cacheReclamation?: ProjectCacheReclamationManager) {
    this.#files = files;
    this.#ids = ids;
  }

  async snapshot(projectId: string): Promise<BlockGraphSnapshot> {
    return (await this.#load(projectId)).toSnapshot();
  }

  onChange(listener: (projectId: string) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  /** Releasing a view must succeed even when saved metadata has become unreadable. */
  async releaseSourceView(projectId: string, release: () => boolean): Promise<void> {
    await this.#withMutationLock(projectId, async () => { if (release()) this.#histories.delete(projectId); });
  }
  /** Source snapshots and graph writes use the same lock; a discard may replace the working graph. */
  async withSourceUpdate<T>(projectId: string, action: (graph: BlockGraphManager) => Promise<{ graph: BlockGraphManager; result: T; changed: boolean; resetHistory?: boolean; rollback?(): void }>): Promise<T> {
    return this.#withMutationLock(projectId, async () => {
      const update = await action(await this.#load(projectId));
      try { if (update.changed) await this.#save(projectId, update.graph); }
      catch (error) { update.rollback?.(); throw error; }
      if (update.resetHistory) this.#histories.delete(projectId);
      return update.result;
    });
  }
  /** All relation and block writes share this project transaction and undo history. */
  withGraphMutation<T>(projectId: string, action: (graph: BlockGraphManager) => T | Promise<T>): Promise<T> { return this.#mutate(projectId, action); }

  /** Shared serialization boundary for source-aware APIs and existing graph operations. */
  async withDocumentGraph<T>(projectId: string, action: (graph: BlockGraphManager) => Promise<T>): Promise<T> {
    return this.#withMutationLock(projectId, async () => {
      const graph = await this.#load(projectId);
      const before = graph.getDocumentStructure();
      const revision = before?.structureRevision;
      const result = await action(graph);
      const after = graph.getDocumentStructure();
      // Structure API refreshes replace the index or advance its revision.
      // Pure reads should not serialize and compare thousands of nodes twice.
      if (after !== before || after?.structureRevision !== revision) await this.#save(projectId, graph);
      return result;
    });
  }

  async createBlock(projectId: string, input: CreateSemanticBlockInput): Promise<SemanticBlock> {
    return this.#mutate(projectId, (graph) => {
      const block: SemanticBlock = { ...input, id: this.#ids.next(), kind: input.kind ?? inferBlockKind(input.role ?? input.type) };
      graph.addBlock(block);
      return block;
    });
  }

  async validateUserBlock(projectId: string, input: CreateUserBlockInput): Promise<BlockCreationValidation> {
    return (await this.#load(projectId)).validateUserBlock(input);
  }

  async createUserBlock(projectId: string, input: CreateUserBlockInput): Promise<SemanticBlock> {
    return this.#mutate(projectId, (graph) => {
      const block: SemanticBlock = {
        id: this.#ids.next(),
        type: input.role,
        kind: input.kind ?? "structural",
        role: input.role,
        origin: "user",
        fileId: input.fileId,
        range: { ...input.range },
        capabilities: { connectable: true, deletable: true, renameable: true, retypable: true },
        state: "active",
        ...(input.name === undefined ? {} : { name: input.name, title: input.name }),
        ...(input.label === undefined ? {} : { label: input.label }),
        ...(input.source === undefined ? {} : { source: { ...input.source } })
      };
      graph.addUserBlock(block);
      return block;
    });
  }

  async deleteUserBlock(projectId: string, blockId: BlockId): Promise<void> {
    await this.#mutate(projectId, (graph) => graph.deleteUserBlock(blockId));
  }

  async reconcileParsedBlocks(projectId: string, input: ReconcileParsedBlocksInput): Promise<BlockReconciliationResult> {
    return this.#mutate(
      projectId,
      (graph) => {
        this.#files.assertSavedSource?.(projectId, input.fileId);
        return graph.reconcileParsedBlocks(input.fileId, input.blocks, () => this.#ids.next());
      },
      { recordHistory: false }
    );
  }

  async mapUserBlockRanges(projectId: string, input: MapUserBlockRangesInput): Promise<BlockRangeMappingResult> {
    return this.#mutate(
      projectId,
      (graph) => {
        this.#files.assertSavedSource?.(projectId, input.fileId);
        return graph.mapUserBlockRanges(input.fileId, input.transactions);
      },
      { recordHistory: false }
    );
  }

  async addBlock(projectId: string, block: AddSemanticBlockInput): Promise<void> {
    await this.#mutate(projectId, (graph) => graph.addBlock(block));
  }

  async updateBlock(projectId: string, blockId: BlockId, patch: UpdateSemanticBlockInput): Promise<SemanticBlock> {
    return this.#mutate(projectId, (graph) => graph.updateBlock(blockId, patch));
  }

  async removeBlock(projectId: string, blockId: BlockId): Promise<void> {
    await this.#mutate(projectId, (graph) => graph.removeBlock(blockId));
  }

  async validateDependency(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<RelationValidation> {
    return (await this.#load(projectId)).validateDependency(prerequisite, consequence);
  }

  async addDependency(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<RelationMutationResult> {
    return this.#mutate(projectId, (graph) => graph.addDependency(prerequisite, consequence));
  }

  async removeDependency(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<void> {
    await this.#mutate(projectId, (graph) => graph.removeDependency(prerequisite, consequence));
  }

  async setStructuralParent(projectId: string, child: BlockId, parent: BlockId | null): Promise<void> {
    await this.#mutate(projectId, (graph) => graph.setStructuralParent(child, parent));
  }

  async getDirectPrerequisites(projectId: string, blockId: BlockId): Promise<BlockId[]> {
    return (await this.#load(projectId)).getDirectPrerequisites(blockId);
  }

  async getDirectConsequences(projectId: string, blockId: BlockId): Promise<BlockId[]> {
    return (await this.#load(projectId)).getDirectConsequences(blockId);
  }

  async hasDirectDependency(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<boolean> {
    return (await this.#load(projectId)).hasDirectDependency(prerequisite, consequence);
  }

  async getPrerequisiteClosure(projectId: string, blockId: BlockId, options?: GraphTraversalOptions): Promise<GraphTraversalResult> {
    return (await this.#load(projectId)).getPrerequisiteClosure(blockId, options);
  }

  async getConsequenceClosure(projectId: string, blockId: BlockId, options?: GraphTraversalOptions): Promise<GraphTraversalResult> {
    return (await this.#load(projectId)).getConsequenceClosure(blockId, options);
  }

  async isPrerequisiteOf(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<boolean> {
    return (await this.#load(projectId)).isPrerequisiteOf(prerequisite, consequence);
  }

  async getStructuralParent(projectId: string, blockId: BlockId): Promise<BlockId | null> {
    return (await this.#load(projectId)).getStructuralParent(blockId);
  }

  async getStructuralChildren(projectId: string, blockId: BlockId): Promise<BlockId[]> {
    return (await this.#load(projectId)).getStructuralChildren(blockId);
  }

  async getStructuralAncestors(projectId: string, blockId: BlockId): Promise<BlockId[]> {
    return (await this.#load(projectId)).getStructuralAncestors(blockId);
  }

  async getStructuralDescendants(projectId: string, blockId: BlockId): Promise<BlockId[]> {
    return (await this.#load(projectId)).getStructuralDescendants(blockId);
  }

  async isStructuralAncestor(projectId: string, ancestor: BlockId, descendant: BlockId): Promise<boolean> {
    return (await this.#load(projectId)).isStructuralAncestor(ancestor, descendant);
  }

  async getStronglyConnectedComponents(projectId: string): Promise<BlockId[][]> {
    return (await this.#load(projectId)).getStronglyConnectedComponents();
  }

  async detectDependencyCycles(projectId: string): Promise<DependencyCycle[]> {
    return (await this.#load(projectId)).detectDependencyCycles();
  }

  async findStructuralOverlapsInPrerequisites(projectId: string, blockId: BlockId): Promise<StructuralDependencyOverlap[]> {
    return (await this.#load(projectId)).findStructuralOverlapsInPrerequisites(blockId);
  }

  async findStructuralOverlapsInConsequences(projectId: string, blockId: BlockId): Promise<StructuralDependencyOverlap[]> {
    return (await this.#load(projectId)).findStructuralOverlapsInConsequences(blockId);
  }

  async findLogicalRelationsWithinPrerequisites(projectId: string, blockId: BlockId): Promise<LogicalRelation[]> {
    return (await this.#load(projectId)).findLogicalRelationsWithinPrerequisites(blockId);
  }

  async getBlocksBetween(projectId: string, start: BlockId, end: BlockId): Promise<BlockId[]> {
    return (await this.#load(projectId)).getBlocksBetween(start, end);
  }

  async getRelationNeighborhood(projectId: string, focusId: BlockId | null, direction: RelationDirection, depth: number | "all"): Promise<RelationNeighborhood> {
    return (await this.#load(projectId)).getRelationNeighborhood(focusId, direction, depth);
  }

  historyState(projectId: string): StructuralHistoryState {
    const history = this.#histories.get(projectId);
    return { canUndo: Boolean(history?.undo.length), canRedo: Boolean(history?.redo.length) };
  }

  async undo(projectId: string): Promise<BlockGraphSnapshot> {
    return this.#withMutationLock(projectId, async () => {
      const history = this.#history(projectId);
      const entry = history.undo.at(-1);
      if (!entry) return (await this.#load(projectId)).toSnapshot();
      const graph = new BlockGraphManager(entry.before);
      if (entry.beforeStructure) graph.setDocumentStructure(structuredClone(entry.beforeStructure));
      await this.#save(projectId, graph);
      history.undo.pop();
      history.redo.push(entry);
      return graph.toSnapshot();
    });
  }

  async redo(projectId: string): Promise<BlockGraphSnapshot> {
    return this.#withMutationLock(projectId, async () => {
      const history = this.#history(projectId);
      const entry = history.redo.at(-1);
      if (!entry) return (await this.#load(projectId)).toSnapshot();
      const graph = new BlockGraphManager(entry.after);
      if (entry.afterStructure) graph.setDocumentStructure(structuredClone(entry.afterStructure));
      await this.#save(projectId, graph);
      history.redo.pop();
      history.undo.push(entry);
      return graph.toSnapshot();
    });
  }

  async validate(projectId: string): Promise<GraphDiagnostic[]> {
    return (await this.#load(projectId)).validateGraph();
  }

  async validateStructure(projectId: string): Promise<StructureWarning[]> {
    return (await this.#load(projectId)).validateStructure();
  }

  async #load(projectId: string): Promise<BlockGraphManager> {
    this.cacheReclamation?.track(projectId);
    const readSnapshot = async (path: string) => {
      const file = await this.#files.readText(projectId, path);
      let value: unknown;
      try {
        value = JSON.parse(file.content);
      } catch (error: unknown) {
        throw new AppError("GRAPH_SNAPSHOT_INVALID", "Block graph metadata is not valid JSON", { cause: error });
      }
      return BlockGraphManager.fromUnknown(value);
    };
    try {
      return await readSnapshot(graphMetadataPath);
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === "FILE_NOT_FOUND") return BlockGraphManager.empty();
      throw error;
    }
  }

  async #save(projectId: string, graph: BlockGraphManager): Promise<void> {
    await this.#files.writeText(projectId, graphMetadataPath, `${JSON.stringify(graph.toPersistenceSnapshot(), null, 2)}\n`);
    for (const listener of this.#listeners) { try { listener(projectId); } catch { /* Subscribers cannot invalidate a completed write. */ } }
  }

  /** Clears retained undo history; active mutation queues drain themselves. */
  releaseProjectCache(projectId: string): void { this.#histories.delete(projectId); }

  /** Reclaims the registered project caches under the same lock as graph reads and writes. */
  reclaimProjectCaches(projectId: string, reason: ProjectCacheReclamationReason): Promise<boolean> {
    return this.#withMutationLock(projectId, async () => this.cacheReclamation?.reclaimProject(projectId, reason) ?? false);
  }

  async reclaimAllProjectCaches(reason: ProjectCacheReclamationReason): Promise<number> {
    const projectIds = this.cacheReclamation?.trackedProjectIds ?? [];
    const results = await Promise.all(projectIds.map(projectId => this.reclaimProjectCaches(projectId, reason)));
    return results.filter(Boolean).length;
  }

  async #mutate<T>(projectId: string, action: (graph: BlockGraphManager) => T | Promise<T>, options: { recordHistory?: boolean } = {}): Promise<T> {
    return this.#withMutationLock(projectId, async () => {
      const graph = await this.#load(projectId);
      const before = graph.toSnapshot();
      const beforeStructure = graph.getDocumentStructure();
      const result = await action(graph);
      const after = graph.toSnapshot();
      const changed = JSON.stringify(before) !== JSON.stringify(after);
      if (changed) await this.#save(projectId, graph);
      if (options.recordHistory !== false && changed) {
        const history = this.#history(projectId);
        const afterStructure = graph.getDocumentStructure();
        history.undo.push({ before, after, ...(beforeStructure ? { beforeStructure: structuredClone(beforeStructure) } : {}), ...(afterStructure ? { afterStructure: structuredClone(afterStructure) } : {}) });
        history.redo.length = 0;
        if (history.undo.length > 100) history.undo.shift();
      }
      return result;
    });
  }

  #history(projectId: string): { undo: HistoryEntry[]; redo: HistoryEntry[] } {
    let history = this.#histories.get(projectId);
    if (!history) {
      history = { undo: [], redo: [] };
      this.#histories.set(projectId, history);
    }
    return history;
  }

  async #withMutationLock<T>(projectId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.#mutationQueues.get(projectId) ?? Promise.resolve();
    let resolveQueue!: () => void;
    const current = new Promise<void>((resolve) => { resolveQueue = resolve; });
    this.#mutationQueues.set(projectId, current);
    await previous;
    try {
      return await action();
    } finally {
      resolveQueue();
      if (this.#mutationQueues.get(projectId) === current) this.#mutationQueues.delete(projectId);
    }
  }
}
