/** Stable identity for a semantic document block. It must not encode source offsets. */
export type BlockId = string;
export type BlockOrigin = "environment" | "virtual" | "user";
export type BlockRole = string;

/** Absolute UTF-16 offsets in one source file. Ranges are half-open: [start, end). */
export interface BlockTextRange {
  start: number;
  end: number;
}

export interface BlockCapabilities {
  connectable: boolean;
  deletable: boolean;
  renameable: boolean | "limited";
  retypable: boolean;
}

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
  /** Legacy semantic name retained for v0.3.0 snapshots. Prefer `role`. */
  type: string;
  origin?: BlockOrigin;
  role?: BlockRole;
  fileId?: string;
  range?: BlockTextRange;
  label?: string;
  name?: string;
  capabilities?: BlockCapabilities;
  state?: "active" | "conflicted" | "orphaned";
  title?: string;
  source?: BlockSourceRange;
  ordinal?: number;
  metadata?: Record<string, unknown>;
}

export type CreateSemanticBlockInput = Omit<SemanticBlock, "id">;
export type UpdateSemanticBlockInput = Partial<Omit<SemanticBlock, "id">>;

export interface CreateUserBlockInput {
  fileId: string;
  range: BlockTextRange;
  role: BlockRole;
  name?: string;
  label?: string;
  source?: BlockSourceRange;
}

/**
 * One parser-owned block before it is reconciled with a persisted semantic
 * identity. `transientId` is valid only for the current parse; it must never be
 * stored as a BlockId or used as a relation endpoint.
 */
export interface ParsedBlockDescriptor {
  transientId: string;
  parentTransientId?: string;
  origin: Exclude<BlockOrigin, "user">;
  role: BlockRole;
  fileId: string;
  range: BlockTextRange;
  source?: BlockSourceRange;
  label?: string;
  name?: string;
  fingerprint: string;
  /** Optional identity emitted by an explicit TeXWeave source marker. */
  bindingId?: string;
}

export interface ReconcileParsedBlocksInput {
  fileId: string;
  blocks: ParsedBlockDescriptor[];
}

export interface BlockReconciliationResult {
  snapshot: BlockGraphSnapshot;
  matched: BlockId[];
  created: BlockId[];
  orphaned: BlockId[];
  conflicted: BlockId[];
  transientToBlockId: Record<string, BlockId>;
}

/** One replacement in coordinates of the document before its transaction. */
export interface BlockTextEdit {
  start: number;
  end: number;
  newLength: number;
}

export interface MapUserBlockRangesInput {
  fileId: string;
  /** Transactions are ordered; edits inside one transaction share old coordinates. */
  transactions: BlockTextEdit[][];
}

export interface BlockRangeMappingResult {
  snapshot: BlockGraphSnapshot;
  updated: BlockId[];
  conflicted: BlockId[];
}

export type BlockCreationValidation =
  | { status: "valid"; parentId: BlockId | null }
  | { status: "invalid"; reason: "invalid-range" | "duplicate-range" | "partial-overlap"; conflictingBlockId?: BlockId };

/** `from` is the prerequisite and `to` is the consequence. */
export interface DependencyEdge {
  from: BlockId;
  to: BlockId;
}

export type RelationValidation =
  | { status: "valid" }
  | { status: "warning"; reason: "cycle"; message: string }
  | { status: "invalid"; reason: "missing-endpoint" | "self-loop" | "virtual-endpoint" | "bidirectional" | "descendant-prerequisite"; message: string };

export interface RelationMutationResult {
  outcome: "created" | "duplicate";
  validation: RelationValidation;
}

export type RelationDirection = "prerequisite" | "consequence" | "both";

/** Display-only projection. It never mutates or replaces the semantic graph. */
export interface RelationNeighborhood {
  focusId: BlockId | null;
  direction: RelationDirection;
  depth: number | "all";
  blockIds: BlockId[];
  edges: DependencyEdge[];
}

export interface StructuralHistoryState {
  canUndo: boolean;
  canRedo: boolean;
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
