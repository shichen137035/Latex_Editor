import { desktopInvoke } from "@latex-editor/contracts/desktop-ipc";
import type { ProjectRelationService } from "@latex-editor/application" with { "resolution-mode": "import" };
import { handleIpc } from "./ipc.js";

export function registerRelationIpc(getService: () => ProjectRelationService): void {
  handleIpc(desktopInvoke.relations.canCreateRelation, (_event, projectId, sourceId, targetId) => getService().canCreateRelation(projectId, sourceId, targetId));
  handleIpc(desktopInvoke.relations.createRelation, (_event, projectId, sourceId, targetId, options) => getService().createRelation(projectId, sourceId, targetId, options));
  handleIpc(desktopInvoke.relations.deleteRelation, (_event, projectId, id) => getService().deleteRelation(projectId, id));
  handleIpc(desktopInvoke.relations.reverseRelation, (_event, projectId, id) => getService().reverseRelation(projectId, id));
  handleIpc(desktopInvoke.relations.getRelation, (_event, projectId, id) => getService().getRelation(projectId, id));
  handleIpc(desktopInvoke.relations.getRelations, (_event, projectId, id) => getService().getRelations(projectId, id));
  handleIpc(desktopInvoke.relations.getPrerequisites, (_event, projectId, id) => getService().getPrerequisites(projectId, id));
  handleIpc(desktopInvoke.relations.getDependents, (_event, projectId, id) => getService().getDependents(projectId, id));
  handleIpc(desktopInvoke.relations.getAncestors, (_event, projectId, id, options) => getService().getAncestors(projectId, id, options));
  handleIpc(desktopInvoke.relations.getDescendants, (_event, projectId, id, options) => getService().getDescendants(projectId, id, options));
  handleIpc(desktopInvoke.relations.dependsOn, (_event, projectId, id, prerequisiteId) => getService().dependsOn(projectId, id, prerequisiteId));
  handleIpc(desktopInvoke.relations.findRelationPath, (_event, projectId, sourceId, targetId) => getService().findRelationPath(projectId, sourceId, targetId));
  handleIpc(desktopInvoke.relations.getRelationScope, (_event, projectId, options) => getService().getRelationScope(projectId, options));
  handleIpc(desktopInvoke.relations.getRelationSubgraph, (_event, projectId, options) => getService().getRelationSubgraph(projectId, options));
  handleIpc(desktopInvoke.relations.getDisplayScope, (_event, projectId, scope, options) => getService().getDisplayScope(projectId, scope, options));
  handleIpc(desktopInvoke.relations.getRelationImpact, (_event, projectId, id) => getService().getRelationImpact(projectId, id));
  handleIpc(desktopInvoke.relations.validateRelationGraph, (_event, projectId) => getService().validateRelationGraph(projectId));
  handleIpc(desktopInvoke.relations.getLogicContext, (_event, projectId, id, options) => getService().getLogicContext(projectId, id, options));
  handleIpc(desktopInvoke.relations.proposeRelationCreate, (_event, projectId, sourceId, targetId, reason) => getService().proposeRelationCreate(projectId, sourceId, targetId, reason));
  handleIpc(desktopInvoke.relations.proposeRelationDelete, (_event, projectId, id, reason) => getService().proposeRelationDelete(projectId, id, reason));
  handleIpc(desktopInvoke.relations.proposeRelationReverse, (_event, projectId, id, reason) => getService().proposeRelationReverse(projectId, id, reason));
  handleIpc(desktopInvoke.relations.listProposals, (_event, projectId) => getService().listProposals(projectId));
  handleIpc(desktopInvoke.relations.rejectProposal, (_event, projectId, id) => getService().rejectProposal(projectId, id));
  handleIpc(desktopInvoke.relations.commitRelationProposal, (_event, projectId, id) => getService().commitRelationProposal(projectId, id));
}
