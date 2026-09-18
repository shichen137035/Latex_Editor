import {
  AppError,
  type BlockGraphSnapshot,
  type BlockId,
  type CreateSemanticBlockInput,
  type DependencyCycle,
  type GraphDiagnostic,
  type GraphTraversalOptions,
  type GraphTraversalResult,
  type LogicalRelation,
  type SemanticBlock,
  type StructuralDependencyOverlap,
  type UpdateSemanticBlockInput
} from "@latex-editor/contracts";
import type { IdGenerator } from "@latex-editor/domain";
import { BlockGraphManager } from "@latex-editor/editor-core";

const graphMetadataPath = ".texweave/block-graph.json";

export interface BlockGraphFilePort {
  readText(projectId: string, relativePath: string): Promise<{ content: string }>;
  writeText(projectId: string, relativePath: string, content: string): Promise<unknown>;
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

  constructor(files: BlockGraphFilePort, ids: IdGenerator) {
    this.#files = files;
    this.#ids = ids;
  }

  async snapshot(projectId: string): Promise<BlockGraphSnapshot> {
    return (await this.#load(projectId)).toSnapshot();
  }

  async createBlock(projectId: string, input: CreateSemanticBlockInput): Promise<SemanticBlock> {
    return this.#mutate(projectId, (graph) => {
      const block: SemanticBlock = { ...input, id: this.#ids.next() };
      graph.addBlock(block);
      return block;
    });
  }

  async addBlock(projectId: string, block: SemanticBlock): Promise<void> {
    await this.#mutate(projectId, (graph) => graph.addBlock(block));
  }

  async updateBlock(projectId: string, blockId: BlockId, patch: UpdateSemanticBlockInput): Promise<SemanticBlock> {
    return this.#mutate(projectId, (graph) => graph.updateBlock(blockId, patch));
  }

  async removeBlock(projectId: string, blockId: BlockId): Promise<void> {
    await this.#mutate(projectId, (graph) => graph.removeBlock(blockId));
  }

  async addDependency(projectId: string, prerequisite: BlockId, consequence: BlockId): Promise<void> {
    await this.#mutate(projectId, (graph) => graph.addDependency(prerequisite, consequence));
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

  async validate(projectId: string): Promise<GraphDiagnostic[]> {
    return (await this.#load(projectId)).validateGraph();
  }

  async #load(projectId: string): Promise<BlockGraphManager> {
    try {
      const file = await this.#files.readText(projectId, graphMetadataPath);
      let value: unknown;
      try {
        value = JSON.parse(file.content);
      } catch (error: unknown) {
        throw new AppError("GRAPH_SNAPSHOT_INVALID", "Block graph metadata is not valid JSON", { cause: error });
      }
      return BlockGraphManager.fromUnknown(value);
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === "FILE_NOT_FOUND") return BlockGraphManager.empty();
      throw error;
    }
  }

  async #save(projectId: string, graph: BlockGraphManager): Promise<void> {
    await this.#files.writeText(projectId, graphMetadataPath, `${JSON.stringify(graph.toSnapshot(), null, 2)}\n`);
  }

  async #mutate<T>(projectId: string, action: (graph: BlockGraphManager) => T | Promise<T>): Promise<T> {
    const previous = this.#mutationQueues.get(projectId) ?? Promise.resolve();
    let resolveQueue!: () => void;
    const current = new Promise<void>((resolve) => { resolveQueue = resolve; });
    this.#mutationQueues.set(projectId, current);
    await previous;
    try {
      const graph = await this.#load(projectId);
      const result = await action(graph);
      await this.#save(projectId, graph);
      return result;
    } finally {
      resolveQueue();
      if (this.#mutationQueues.get(projectId) === current) this.#mutationQueues.delete(projectId);
    }
  }
}
