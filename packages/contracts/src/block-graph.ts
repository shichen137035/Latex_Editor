import type { BlockRelation } from "./relations.js";

/** Stable identity for a semantic document block. It must not encode source offsets. */
export type BlockId = string;
export type BlockOrigin = "environment" | "virtual" | "user";
export type BlockRole = string;
export type BlockKind = "structural" | "content";

/** One Block System capability rule, shared by backend validation and the UI. */
export function isRelationCapableBlock(block: { type: string; kind?: BlockKind; state?: string; placeholder?: boolean; capabilities?: Partial<BlockCapabilities>; capabilityOverrides?: Partial<BlockCapabilities> }): boolean {
  return (block.kind ?? inferBlockKind(block.type)) === "structural" && inferBlockKind(block.type) !== "content" && !block.placeholder
    && (!block.state || block.state === "active") && !["itemize", "enumerate", "description", "list"].includes(block.type)
    && block.capabilities?.connectable !== false && block.capabilityOverrides?.connectable !== false;
}

const defaultBlockKinds: Record<string, BlockKind> = {
  abstract: "structural", chapter: "structural", section: "structural", subsection: "structural", subsubsection: "structural",
  theorem: "structural", lemma: "structural", proposition: "structural", corollary: "structural", definition: "structural",
  assumption: "structural", remark: "structural", example: "structural", proof: "structural", enumerate: "structural",
  itemize: "structural", description: "structural", algorithm: "structural", algorithmic: "structural", quote: "structural",
  quotation: "structural", custom: "structural", placeholder: "structural",
  paragraph: "content", equation: "content", "equation-star": "content", "display-math": "content", align: "content", "align-star": "content", gather: "content", multline: "content",
  aligned: "content", split: "content", cases: "content", image: "content", "inline-image": "content", figure: "content",
  table: "content", "table-star": "content", tabular: "content", "tabular-star": "content", tabularx: "content", longtable: "content",
  "figure-star": "content", verbatim: "content", lstlisting: "content"
};

function normalizedBlockType(type: string): string {
  return type.trim().toLocaleLowerCase().replace(/^custom:/, "").replace(/\*$/, "");
}

/** Unknown types remain usable as containers and can be reported by validation. */
export function inferBlockKind(type: string): BlockKind {
  return defaultBlockKinds[normalizedBlockType(type)] ?? "structural";
}

export function isKnownBlockType(type: string): boolean {
  return Object.hasOwn(defaultBlockKinds, normalizedBlockType(type));
}

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
  kind: BlockKind;
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

export type CreateSemanticBlockInput = Omit<SemanticBlock, "id" | "kind"> & { kind?: BlockKind };
export type AddSemanticBlockInput = CreateSemanticBlockInput & { id: BlockId };
export type UpdateSemanticBlockInput = Partial<Omit<SemanticBlock, "id">>;

export interface CreateUserBlockInput {
  fileId: string;
  range: BlockTextRange;
  role: BlockRole;
  kind?: BlockKind;
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
  kind: BlockKind;
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
  | { status: "invalid"; reason: "missing-endpoint" | "self-loop" | "virtual-endpoint" | "bidirectional" | "descendant-prerequisite" | "duplicate" | "cycle"; message: string };

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
  version: 2;
  blocks: SemanticBlock[];
  dependencies: DependencyEdge[];
  structuralParents: StructuralParentEdge[];
  /** Canonical v0.5.6 relations; dependencies is its legacy endpoint projection. */
  relations?: BlockRelation[];
  relationSchemaVersion?: 1;
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
  | "invalid-relation-endpoint"
  | "self-dependency"
  | "duplicate-dependency"
  | "dangling-structural-relation"
  | "multiple-structural-parents"
  | "structural-cycle"
  | "dependency-cycle"
  | "prerequisite-structural-overlap"
  | "consequence-structural-overlap"
  | "prerequisite-logical-relation"
  | "content-block-has-children"
  | "unknown-block-kind";

export type StructureWarningCode = "CONTENT_BLOCK_HAS_CHILDREN" | "UNKNOWN_BLOCK_KIND";

export interface StructureWarning {
  code: StructureWarningCode;
  severity: "info" | "warning" | "error";
  blockId: BlockId;
  message: string;
  details?: { childIds?: BlockId[]; childCount?: number; type?: string };
}

export interface GraphDiagnostic {
  type: GraphDiagnosticType;
  severity: "info" | "warning" | "error";
  blockIds: BlockId[];
  message: string;
  code?: StructureWarningCode;
  blockId?: BlockId;
  details?: StructureWarning["details"];
}

export interface GraphTraversalOptions {
  maxDepth?: number;
}
