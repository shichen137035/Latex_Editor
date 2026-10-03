import type { BlockId } from "./block-graph.js";
import type { BlockCard } from "./document-structure.js";

export type RelationId = string;
export type RelationCreator = "user" | "ai";
/** sourceId → targetId means targetId logically depends on sourceId. */
export interface BlockRelation {
  id: RelationId; sourceId: BlockId; targetId: BlockId;
  createdBy: RelationCreator; createdAt: number; updatedAt: number;
}
export interface RelationStoreData { version: 1; relations: BlockRelation[] }
export type RelationValidationReason = "SOURCE_NOT_FOUND" | "TARGET_NOT_FOUND" | "INVALID_SOURCE" | "INVALID_TARGET" | "SELF_RELATION" | "DUPLICATE_RELATION" | "CYCLE";
export interface RelationValidationResult { valid: boolean; reason?: RelationValidationReason }
export interface RelationTraversalEntry { blockId: BlockId; distance: number }
export interface RelationTraversalResult { focusId: BlockId; entries: RelationTraversalEntry[] }
export interface RelationScopeOptions {
  focusIds: BlockId[]; direction: "prerequisites" | "dependents" | "both";
  depth: number | "all"; includeFocus?: boolean;
}
export interface RelationScopeEntry extends RelationTraversalEntry { direction: "focus" | "prerequisite" | "dependent" }
export interface RelationScope { focusIds: BlockId[]; entries: RelationScopeEntry[]; blockIds: BlockId[]; relations: BlockRelation[] }
export interface RelationGraph { nodes: RelationScopeEntry[]; edges: BlockRelation[] }
export interface DisplayScopeOptions { includeContent: boolean; includeStructuralParents: boolean }
export interface DisplayScope { relationBlockIds: BlockId[]; contentBlockIds: BlockId[]; structuralParentIds: BlockId[]; allBlockIds: BlockId[] }
export interface RelationIssue {
  type: "CYCLE" | "INVALID_ENDPOINT" | "DUPLICATE_RELATION" | "DANGLING_RELATION";
  severity: "error" | "warning"; blockIds: BlockId[]; relationIds?: RelationId[]; details?: Record<string, unknown>;
}
export interface RelationImpact { incomingRelations: RelationId[]; outgoingRelations: RelationId[]; directPrerequisites: BlockId[]; directDependents: BlockId[]; downstreamDependents: BlockId[] }
export type RelationEvent =
  | { type: "relation-created"; relation: BlockRelation }
  | { type: "relation-deleted"; relationId: RelationId }
  | { type: "relation-reversed"; previous: BlockRelation; current: BlockRelation }
  | { type: "graph-invalidated" };
export interface LogicContext { focusId: BlockId; scope: RelationScope; blocks: BlockCard[] }
export interface RelationProposal {
  id: string; operation: "create" | "delete" | "reverse";
  sourceId?: BlockId; targetId?: BlockId; relationId?: RelationId; reason?: string;
  sourceName?: string; targetName?: string;
  validation: RelationValidationResult;
}
export type RelationErrorCode = "BLOCK_NOT_FOUND" | "INVALID_ENDPOINT" | "SELF_RELATION" | "RELATION_EXISTS" | "RELATION_NOT_FOUND" | "CYCLE_DETECTED" | "INVALID_GRAPH_STATE" | "PERSISTENCE_ERROR" | "PROPOSAL_NOT_FOUND" | "STALE_PROPOSAL";
export class RelationError extends Error {
  constructor(readonly code: RelationErrorCode, message: string, readonly details?: Record<string, unknown>, options?: ErrorOptions) { super(message, options); this.name = "RelationError"; }
}
/** AI writes only propose operations; committing belongs to the user adapter. */
export interface RelationAIAPI {
  get_prerequisites(input: { blockId: string }): Promise<string[]>;
  get_dependents(input: { blockId: string }): Promise<string[]>;
  get_scope(input: RelationScopeOptions): Promise<RelationScope>;
  find_path(input: { sourceId: string; targetId: string }): Promise<string[] | null>;
  get_subgraph(input: RelationScopeOptions): Promise<RelationGraph>;
  get_display_scope(input: RelationScopeOptions & DisplayScopeOptions): Promise<DisplayScope>;
  get_logic_context(input: { blockId: string; direction?: RelationScopeOptions["direction"]; depth?: number | "all" }): Promise<LogicContext>;
  validate(input?: Record<string, never>): Promise<RelationIssue[]>;
  propose_create(input: { sourceId: string; targetId: string; reason?: string }): Promise<RelationProposal>;
  propose_delete(input: { relationId: string; reason?: string }): Promise<RelationProposal>;
  propose_reverse(input: { relationId: string; reason?: string }): Promise<RelationProposal>;
}

/** Application API without any transport- or presentation-specific fields. */
export interface RelationAPI {
  canCreateRelation(sourceId: string, targetId: string): Promise<RelationValidationResult>;
  createRelation(sourceId: string, targetId: string, options?: { createdBy?: RelationCreator }): Promise<BlockRelation>;
  deleteRelation(relationId: string): Promise<void>;
  reverseRelation(relationId: string): Promise<BlockRelation>;
  getRelation(relationId: string): Promise<BlockRelation | null>;
  getRelations(blockId: string): Promise<{ incoming: BlockRelation[]; outgoing: BlockRelation[] }>;
  getPrerequisites(blockId: string): Promise<string[]>;
  getDependents(blockId: string): Promise<string[]>;
  getAncestors(blockId: string, options?: { maxDepth?: number }): Promise<RelationTraversalResult>;
  getDescendants(blockId: string, options?: { maxDepth?: number }): Promise<RelationTraversalResult>;
  dependsOn(blockId: string, prerequisiteId: string): Promise<boolean>;
  findRelationPath(sourceId: string, targetId: string): Promise<string[] | null>;
  getRelationScope(options: RelationScopeOptions): Promise<RelationScope>;
  getRelationSubgraph(options: RelationScopeOptions): Promise<RelationGraph>;
  getDisplayScope(scope: RelationScope, options: DisplayScopeOptions): Promise<DisplayScope>;
  getRelationImpact(blockId: string): Promise<RelationImpact>;
  validateRelationGraph(): Promise<RelationIssue[]>;
  getLogicContext(blockId: string, options?: { direction?: RelationScopeOptions["direction"]; depth?: number | "all" }): Promise<LogicContext>;
  proposeRelationCreate(sourceId: string, targetId: string, reason?: string): Promise<RelationProposal>;
  proposeRelationDelete(relationId: string, reason?: string): Promise<RelationProposal>;
  proposeRelationReverse(relationId: string, reason?: string): Promise<RelationProposal>;
  listProposals(): Promise<RelationProposal[]>;
  rejectProposal(proposalId: string): Promise<void>;
  commitRelationProposal(proposalId: string): Promise<BlockRelation | void>;
}
