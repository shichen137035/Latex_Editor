import { desktopInvoke, desktopEvents } from "@latex-editor/contracts/desktop-ipc";
import type { DesktopApi } from "@latex-editor/contracts/desktop-ipc";
import { handleIpc, onIpc, sendIpc } from "../../apps/desktop/src/main/ipc.js";
import type { WebContents } from "electron";

// This fixture is compiled, never executed. Invalid transport changes must fail.
function checkContract(api: DesktopApi, target: WebContents) {
  api.structure.list_blocks("project");
  api.blockGraph.getPrerequisiteClosure("project", "block", { maxDepth: 2 });
  // @ts-expect-error projectId is required
  api.structure.snapshot();
  // @ts-expect-error revision must be numeric
  api.structure.replace_block_content("project", { blockId: "block", expectedRevision: "1", content: "text" });
  // @ts-expect-error request arguments must match the contract
  handleIpc(desktopInvoke.projects.open, (_event, projectId: number) => Promise.reject(projectId));
  // @ts-expect-error handler results must match the contract
  handleIpc(desktopInvoke.projects.open, () => 123);
  // @ts-expect-error graph snapshot cannot silently return undefined
  handleIpc(desktopInvoke.blockGraph.snapshot, () => undefined);
  // @ts-expect-error event payloads must match the contract
  sendIpc(target, desktopEvents.toRenderer.closeRequested, false);
  // @ts-expect-error listener arguments must match the contract
  onIpc(desktopEvents.toMain.closeResponse, (_event, requestId: number) => { void requestId; });
}
void checkContract;
