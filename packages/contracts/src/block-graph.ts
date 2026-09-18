/** Stable identity for a semantic document block. It must not encode source offsets. */
export type BlockId = string;

export interface BlockSourceRange {
  relativePath: string;
  startLine: number;
  startColumn: number;
  endLine?: number;
  endColumn?: number;
}

/**
 * Persisted semantic block metadata. Source coordinates may change while the id
 * remains stable, allowing relationships to survive ordinary document edits.
 */
export interface SemanticBlock {
  id: BlockId;
  type: string;
  title?: string;
  source?: BlockSourceRange;
  ordinal?: number;
  metadata?: Record<string, unknown>;
}

export type CreateSemanticBlockInput = Omit<SemanticBlock, "id">;
export type UpdateSemanticBlockInput = Partial<Omit<SemanticBlock, "id">>;

/** `from` is the prerequisite and `to` is the consequence. */
export interface DependencyEdge {
  from: BlockId;
  to: BlockId;
}

export interface StructuralParentEdge {
  parent: BlockId;
  child: BlockId;
}

export interface BlockGraphSnapshot {
  version: 1;
  blocks: SemanticBlock[];
  dependencies: DependencyEdge[];
  structuralParents: StructuralParentEdge[];
}

/** Serializable traversal result used by both IPC and non-UI callers. */
export interface GraphTraversalResult {
  start: BlockId;
  direct: BlockId[];
  indirect: BlockId[];
  all: BlockId[];
  /** Minimum edge distance from `start`, keyed by block id. */
  distances: Record<BlockId, number>;
}

export interface DependencyCycle {
  blockIds: BlockId[];
}

export interface StructuralDependencyOverlap {
  ancestor: BlockId;
  descendant: BlockId;
  ancestorDirect: boolean;
  descendantDirect: boolean;
}

export interface LogicalRelation {
  from: BlockId;
  to: BlockId;
  direct: boolean;
}

export type GraphDiagnosticType =
  | "duplicate-block"
  | "dangling-dependency"
  | "self-dependency"
  | "duplicate-dependency"
  | "dangling-structural-relation"
  | "multiple-structural-parents"
  | "structural-cycle"
  | "dependency-cycle"
  | "prerequisite-structural-overlap"
  | "consequence-structural-overlap"
  | "prerequisite-logical-relation";

export interface GraphDiagnostic {
  type: GraphDiagnosticType;
  severity: "info" | "warning" | "error";
  blockIds: BlockId[];
  message: string;
}

export interface GraphTraversalOptions {
  maxDepth?: number;
}
