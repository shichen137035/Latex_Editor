import {
  RelationError, type BlockRelation, type DisplayScopeOptions, type LogicContext, type RelationAIAPI,
  type RelationCreator, type RelationEvent, type RelationProposal, type RelationScope, type RelationScopeOptions
} from "@latex-editor/contracts";
import type { IdGenerator } from "@latex-editor/domain";
import type { BlockGraphManager, RelationGraphManager } from "@latex-editor/editor-core";
import type { ProjectBlockGraphService } from "./block-graph-service.js";

type PendingProposal = { proposal: RelationProposal; previous?: BlockRelation };

/** Reuses the Block System's project transaction, persistence and hierarchy. */
export class ProjectRelationService {
  readonly #graph: ProjectBlockGraphService;
  readonly #ids: IdGenerator;
  readonly #now: () => number;
  readonly #proposals = new Map<string, Map<string, PendingProposal>>();
  readonly #committing = new Set<string>();
  readonly #listeners = new Set<(projectId: string, event: RelationEvent) => void>();
  readonly #unsubscribe: () => void;
  constructor(graph: ProjectBlockGraphService, ids: IdGenerator, now: () => number = Date.now) {
    this.#graph = graph; this.#ids = ids; this.#now = now;
    this.#unsubscribe = graph.onChange(id => this.#emit(id, { type: "graph-invalidated" }));
  }
  dispose(): void { this.#unsubscribe(); this.#listeners.clear(); this.#proposals.clear(); }
  onEvent(listener: (projectId: string, event: RelationEvent) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #emit(projectId: string, event: RelationEvent): void { for (const listener of this.#listeners) { try { listener(projectId, structuredClone(event)); } catch { /* An observer cannot roll back persisted state. */ } } }
  #query<T>(projectId: string, action: (relations: RelationGraphManager, blocks: BlockGraphManager) => T): Promise<T> { return this.#graph.withDocumentGraph(projectId, async graph => action(graph.relations(), graph)); }
  async #mutate<T>(projectId: string, action: (relations: RelationGraphManager) => { result: T; event: RelationEvent }): Promise<T> {
    let committed: { result: T; event: RelationEvent };
    try { committed = await this.#graph.withGraphMutation(projectId, graph => action(graph.relations())); }
    catch (error) {
      if (error instanceof RelationError) throw error;
      throw new RelationError("PERSISTENCE_ERROR", "Relation change could not be persisted.", undefined, { cause: error });
    }
    this.#emit(projectId, committed.event); return committed.result;
  }
  canCreateRelation(projectId: string, sourceId: string, targetId: string) { return this.#query(projectId, r => r.canCreateRelation(sourceId, targetId)); }
  createRelation(projectId: string, sourceId: string, targetId: string, options: { createdBy?: RelationCreator } = {}) {
    return this.#mutate(projectId, r => { const relation = r.createRelation(sourceId, targetId, { id: this.#ids.next(), createdBy: options.createdBy ?? "user", now: this.#now() }); return { result: relation, event: { type: "relation-created", relation } }; });
  }
  deleteRelation(projectId: string, relationId: string) {
    return this.#mutate(projectId, r => { r.deleteRelation(relationId); return { result: undefined, event: { type: "relation-deleted", relationId } }; });
  }
  reverseRelation(projectId: string, relationId: string) {
    return this.#mutate(projectId, r => { const previous = r.getRelation(relationId); if (!previous) throw new RelationError("RELATION_NOT_FOUND", "Relation was removed."); const current = r.reverseRelation(relationId, this.#now()); return { result: current, event: { type: "relation-reversed", previous, current } }; });
  }
  getRelation(projectId: string, relationId: string) { return this.#query(projectId, r => r.getRelation(relationId)); }
  getRelations(projectId: string, blockId: string) { return this.#query(projectId, r => r.getRelations(blockId)); }
  getPrerequisites(projectId: string, blockId: string) { return this.#query(projectId, r => r.getPrerequisites(blockId)); }
  getDependents(projectId: string, blockId: string) { return this.#query(projectId, r => r.getDependents(blockId)); }
  getAncestors(projectId: string, blockId: string, options?: { maxDepth?: number }) { return this.#query(projectId, r => r.getAncestors(blockId, options)); }
  getDescendants(projectId: string, blockId: string, options?: { maxDepth?: number }) { return this.#query(projectId, r => r.getDescendants(blockId, options)); }
  dependsOn(projectId: string, blockId: string, prerequisiteId: string) { return this.#query(projectId, r => r.dependsOn(blockId, prerequisiteId)); }
  findRelationPath(projectId: string, sourceId: string, targetId: string) { return this.#query(projectId, r => r.findRelationPath(sourceId, targetId)); }
  getRelationScope(projectId: string, options: RelationScopeOptions) { return this.#query(projectId, r => r.getRelationScope(options)); }
  getRelationSubgraph(projectId: string, options: RelationScopeOptions) { return this.#query(projectId, r => r.getRelationSubgraph(r.getRelationScope(options))); }
  getDisplayScope(projectId: string, scope: RelationScope, options: DisplayScopeOptions) { return this.#query(projectId, r => r.getDisplayScope(scope, options)); }
  getRelationImpact(projectId: string, blockId: string) { return this.#query(projectId, r => r.getRelationImpact(blockId)); }
  validateRelationGraph(projectId: string) { return this.#query(projectId, r => r.validateRelationGraph()); }
  getLogicContext(projectId: string, blockId: string, options: { direction?: RelationScopeOptions["direction"]; depth?: number | "all" } = {}): Promise<LogicContext> {
    return this.#query(projectId, (r, graph) => {
      const scope = r.getRelationScope({ focusIds: [blockId], direction: options.direction ?? "prerequisites", depth: options.depth ?? "all" });
      const structure = graph.getDocumentStructure();
      const blocks = scope.blockIds.map(id => {
        const block = graph.getBlock(id)!, indexed = structure?.blocks[id];
        const stale = indexed?.semantic?.summary?.blockRevision !== indexed?.revision;
        return { id, type: block.type, kind: block.kind, childCount: graph.getStructuralChildren(id).length,
          ...(block.title ? { title: block.title } : {}), ...(block.label ? { label: block.label } : {}),
          ...(indexed?.numbering?.display ? { number: indexed.numbering.display } : {}),
          ...(indexed?.semantic?.summary && !stale ? { summary: indexed.semantic.summary.text } : {}),
          ...(stale && indexed?.semantic?.summary ? { semanticStale: true } : {}) };
      });
      return { focusId: blockId, scope, blocks };
    });
  }
  async #propose(projectId: string, operation: RelationProposal["operation"], input: { sourceId?: string; targetId?: string; relationId?: string; reason?: string }): Promise<RelationProposal> {
    const pending = await this.#query(projectId, (r, blocks) => {
      const previous = input.relationId ? r.getRelation(input.relationId) : null;
      if (operation !== "create" && !previous) throw new RelationError("RELATION_NOT_FOUND", "Relation was removed.");
      const sourceId = operation === "create" ? input.sourceId! : operation === "reverse" ? previous!.targetId : previous!.sourceId;
      const targetId = operation === "create" ? input.targetId! : operation === "reverse" ? previous!.sourceId : previous!.targetId;
      const validation = operation === "delete" ? { valid: true } : r.canCreateRelation(sourceId, targetId, previous?.id);
      r.assertValidation(validation);
      const name = (id: string) => { const block = blocks.getBlock(id), number = blocks.getDocumentStructure()?.blocks[id]?.numbering?.display; return block ? `${block.type}${number ? ` ${number}` : ""}${block.title || block.name || block.label ? `: ${block.title || block.name || block.label}` : ` (${id})`}` : id; };
      return { proposal: { id: this.#ids.next(), operation, sourceId, targetId, sourceName: name(sourceId), targetName: name(targetId), ...(input.relationId ? { relationId: input.relationId } : {}), ...(input.reason ? { reason: input.reason } : {}), validation }, ...(previous ? { previous } : {}) };
    });
    if (!this.#proposals.has(projectId)) this.#proposals.set(projectId, new Map());
    this.#proposals.get(projectId)!.set(pending.proposal.id, pending); return structuredClone(pending.proposal);
  }
  proposeRelationCreate(projectId: string, sourceId: string, targetId: string, reason?: string) { return this.#propose(projectId, "create", { sourceId, targetId, ...(reason ? { reason } : {}) }); }
  proposeRelationDelete(projectId: string, relationId: string, reason?: string) { return this.#propose(projectId, "delete", { relationId, ...(reason ? { reason } : {}) }); }
  proposeRelationReverse(projectId: string, relationId: string, reason?: string) { return this.#propose(projectId, "reverse", { relationId, ...(reason ? { reason } : {}) }); }
  async listProposals(projectId: string): Promise<RelationProposal[]> { return [...(this.#proposals.get(projectId)?.values() ?? [])].map(p => structuredClone(p.proposal)); }
  async rejectProposal(projectId: string, proposalId: string): Promise<void> { if (!this.#proposals.get(projectId)?.delete(proposalId)) throw new RelationError("PROPOSAL_NOT_FOUND", "Proposal is no longer available."); }
  async commitRelationProposal(projectId: string, proposalId: string): Promise<BlockRelation | void> {
    const key = JSON.stringify([projectId, proposalId]);
    if (this.#committing.has(key)) throw new RelationError("STALE_PROPOSAL", "Proposal is already being committed.");
    this.#committing.add(key);
    try {
      const result = await this.#mutate(projectId, r => {
        const pending = this.#proposals.get(projectId)?.get(proposalId);
        if (!pending) throw new RelationError("PROPOSAL_NOT_FOUND", "Proposal is no longer available.");
        const { proposal, previous } = pending;
        if (previous && JSON.stringify(r.getRelation(previous.id)) !== JSON.stringify(previous)) throw new RelationError("STALE_PROPOSAL", "The proposed relation changed; request a new proposal.");
        if (proposal.operation === "create") {
          const relation = r.createRelation(proposal.sourceId!, proposal.targetId!, { id: this.#ids.next(), createdBy: "ai", now: this.#now() });
          return { result: relation, event: { type: "relation-created", relation } };
        }
        if (proposal.operation === "delete") { r.deleteRelation(proposal.relationId!); return { result: undefined, event: { type: "relation-deleted", relationId: proposal.relationId! } }; }
        const current = r.reverseRelation(proposal.relationId!, this.#now());
        return { result: current, event: { type: "relation-reversed", previous: previous!, current } };
      });
      this.#proposals.get(projectId)?.delete(proposalId); return result;
    } finally { this.#committing.delete(key); }
  }
  aiAPI(projectId: string): RelationAIAPI {
    return {
      get_prerequisites: input => this.getPrerequisites(projectId, input.blockId), get_dependents: input => this.getDependents(projectId, input.blockId),
      get_scope: input => this.getRelationScope(projectId, input), find_path: input => this.findRelationPath(projectId, input.sourceId, input.targetId),
      get_subgraph: input => this.getRelationSubgraph(projectId, input),
      get_display_scope: input => this.#query(projectId, r => r.getDisplayScope(r.getRelationScope(input), input)),
      get_logic_context: input => this.getLogicContext(projectId, input.blockId, input), validate: () => this.validateRelationGraph(projectId),
      propose_create: input => this.proposeRelationCreate(projectId, input.sourceId, input.targetId, input.reason),
      propose_delete: input => this.proposeRelationDelete(projectId, input.relationId, input.reason), propose_reverse: input => this.proposeRelationReverse(projectId, input.relationId, input.reason)
    };
  }
}
