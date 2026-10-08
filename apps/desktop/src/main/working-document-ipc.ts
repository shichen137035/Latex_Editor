import { desktopInvoke } from "@latex-editor/contracts/desktop-ipc";
import type { ProjectWorkingDocumentService } from "@latex-editor/application" with { "resolution-mode": "import" };
import { handleIpc } from "./ipc.js";

/** A working document session belongs to its renderer, including cleanup on crash. */
export function registerWorkingDocumentIpc(getService: () => ProjectWorkingDocumentService): void {
  const owners = new Map<string, { senderId: number; sessionId: string; dispose(): void }>();
  handleIpc(desktopInvoke.documents.sync, async (event, projectId, input) => {
    const owner = owners.get(projectId);
    if (owner && (owner.senderId !== event.sender.id || owner.sessionId !== input.sessionId)) throw new Error("This project is being edited in another document session.");
    if (!owner) {
      const ownership = { senderId: event.sender.id, sessionId: input.sessionId, dispose: () => event.sender.removeListener("destroyed", destroyed) };
      const destroyed = () => {
        if (owners.get(projectId) !== ownership) return;
        owners.delete(projectId);
        void getService().close(projectId, ownership.sessionId).catch(error => console.warn("Unable to release editor documents", error));
      };
      owners.set(projectId, ownership);
      event.sender.once("destroyed", destroyed);
    }
    return getService().sync(projectId, input);
  });
  handleIpc(desktopInvoke.documents.close, async (event, projectId, sessionId) => {
    const owner = owners.get(projectId);
    if (!owner || owner.senderId !== event.sender.id || owner.sessionId !== sessionId) return;
    // Keep ownership until the serialized close is finished.
    await getService().close(projectId, sessionId);
    if (owners.get(projectId) === owner) { owner.dispose(); owners.delete(projectId); }
  });
}
