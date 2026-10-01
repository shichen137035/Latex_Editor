import { desktopInvoke } from "@latex-editor/contracts/desktop-ipc";
import type { ProjectDocumentStructureService } from "@latex-editor/application" with { "resolution-mode": "import" };
import { handleIpc } from "./ipc.js";

/** Source operations delegate to the same service used by AI working copies. */
export function registerStructureIpc(getService: () => ProjectDocumentStructureService): void {
  const endpoints = desktopInvoke.structure;
  handleIpc(endpoints.snapshot, (_event, projectId) => getService().snapshot(projectId));
  handleIpc(endpoints.list_blocks, (_event, projectId, input) => getService().api(projectId).list_blocks(input));
  handleIpc(endpoints.find_blocks, (_event, projectId, input) => getService().api(projectId).find_blocks(input));
  handleIpc(endpoints.get_block, (_event, projectId, input) => getService().api(projectId).get_block(input));
  handleIpc(endpoints.get_blocks, (_event, projectId, input) => getService().api(projectId).get_blocks(input));
  handleIpc(endpoints.get_block_source, (_event, projectId, input) => getService().api(projectId).get_block_source(input));
  handleIpc(endpoints.replace_block_content, (_event, projectId, input) => getService().api(projectId).replace_block_content(input));
  handleIpc(endpoints.insert_block, (_event, projectId, input) => getService().api(projectId).insert_block(input));
  handleIpc(endpoints.delete_block, (_event, projectId, input) => getService().api(projectId).delete_block(input));
  handleIpc(endpoints.set_block_semantic, (_event, projectId, input) => getService().api(projectId).set_block_semantic(input));
}
