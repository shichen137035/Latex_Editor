import { desktopInvoke } from "@latex-editor/contracts/desktop-ipc";
import type { ProjectBlockGraphService } from "@latex-editor/application" with { "resolution-mode": "import" };
import { handleIpc } from "./ipc.js";

/** Relationship operations and legacy editor methods share the graph service. */
export function registerBlockGraphIpc(getService: () => ProjectBlockGraphService): void {
  handleIpc(desktopInvoke.blockGraph.snapshot, (_event, projectId) => getService().snapshot(projectId));
  handleIpc(desktopInvoke.blockGraph.createBlock, (_event, projectId, input) => getService().createBlock(projectId, input));
  handleIpc(desktopInvoke.blockGraph.validateUserBlock, (_event, projectId, input) => getService().validateUserBlock(projectId, input));
  handleIpc(desktopInvoke.blockGraph.createUserBlock, (_event, projectId, input) => getService().createUserBlock(projectId, input));
  handleIpc(desktopInvoke.blockGraph.deleteUserBlock, (_event, projectId, blockId) => getService().deleteUserBlock(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.reconcileParsedBlocks, (_event, projectId, input) => getService().reconcileParsedBlocks(projectId, input));
  handleIpc(desktopInvoke.blockGraph.mapUserBlockRanges, (_event, projectId, input) => getService().mapUserBlockRanges(projectId, input));
  handleIpc(desktopInvoke.blockGraph.addBlock, (_event, projectId, block) => getService().addBlock(projectId, block));
  handleIpc(desktopInvoke.blockGraph.updateBlock, (_event, projectId, blockId, patch) => getService().updateBlock(projectId, blockId, patch));
  handleIpc(desktopInvoke.blockGraph.removeBlock, (_event, projectId, blockId) => getService().removeBlock(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.addDependency, (_event, projectId, prerequisite, consequence) => getService().addDependency(projectId, prerequisite, consequence));
  handleIpc(desktopInvoke.blockGraph.validateDependency, (_event, projectId, prerequisite, consequence) => getService().validateDependency(projectId, prerequisite, consequence));
  handleIpc(desktopInvoke.blockGraph.removeDependency, (_event, projectId, prerequisite, consequence) => getService().removeDependency(projectId, prerequisite, consequence));
  handleIpc(desktopInvoke.blockGraph.hasDirectDependency, (_event, projectId, prerequisite, consequence) => getService().hasDirectDependency(projectId, prerequisite, consequence));
  handleIpc(desktopInvoke.blockGraph.setStructuralParent, (_event, projectId, child, parent) => getService().setStructuralParent(projectId, child, parent));
  handleIpc(desktopInvoke.blockGraph.getDirectPrerequisites, (_event, projectId, blockId) => getService().getDirectPrerequisites(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.getDirectConsequences, (_event, projectId, blockId) => getService().getDirectConsequences(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.getPrerequisiteClosure, (_event, projectId, blockId, options) => getService().getPrerequisiteClosure(projectId, blockId, options));
  handleIpc(desktopInvoke.blockGraph.getConsequenceClosure, (_event, projectId, blockId, options) => getService().getConsequenceClosure(projectId, blockId, options));
  handleIpc(desktopInvoke.blockGraph.isPrerequisiteOf, (_event, projectId, prerequisite, consequence) => getService().isPrerequisiteOf(projectId, prerequisite, consequence));
  handleIpc(desktopInvoke.blockGraph.getStructuralParent, (_event, projectId, blockId) => getService().getStructuralParent(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.getStructuralChildren, (_event, projectId, blockId) => getService().getStructuralChildren(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.getStructuralAncestors, (_event, projectId, blockId) => getService().getStructuralAncestors(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.getStructuralDescendants, (_event, projectId, blockId) => getService().getStructuralDescendants(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.isStructuralAncestor, (_event, projectId, ancestor, descendant) => getService().isStructuralAncestor(projectId, ancestor, descendant));
  handleIpc(desktopInvoke.blockGraph.getStronglyConnectedComponents, (_event, projectId) => getService().getStronglyConnectedComponents(projectId));
  handleIpc(desktopInvoke.blockGraph.detectDependencyCycles, (_event, projectId) => getService().detectDependencyCycles(projectId));
  handleIpc(desktopInvoke.blockGraph.findStructuralOverlapsInPrerequisites, (_event, projectId, blockId) => getService().findStructuralOverlapsInPrerequisites(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.findStructuralOverlapsInConsequences, (_event, projectId, blockId) => getService().findStructuralOverlapsInConsequences(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.findLogicalRelationsWithinPrerequisites, (_event, projectId, blockId) => getService().findLogicalRelationsWithinPrerequisites(projectId, blockId));
  handleIpc(desktopInvoke.blockGraph.getBlocksBetween, (_event, projectId, start, end) => getService().getBlocksBetween(projectId, start, end));
  handleIpc(desktopInvoke.blockGraph.getRelationNeighborhood, (_event, projectId, focusId, direction, depth) => getService().getRelationNeighborhood(projectId, focusId, direction, depth));
  handleIpc(desktopInvoke.blockGraph.historyState, (_event, projectId) => getService().historyState(projectId));
  handleIpc(desktopInvoke.blockGraph.undo, (_event, projectId) => getService().undo(projectId));
  handleIpc(desktopInvoke.blockGraph.redo, (_event, projectId) => getService().redo(projectId));
  handleIpc(desktopInvoke.blockGraph.validate, (_event, projectId) => getService().validate(projectId));
  handleIpc(desktopInvoke.blockGraph.validateStructure, (_event, projectId) => getService().validateStructure(projectId));
}
