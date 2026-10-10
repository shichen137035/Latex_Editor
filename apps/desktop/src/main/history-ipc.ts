import { desktopInvoke } from "@latex-editor/contracts/desktop-ipc";
import { handleIpc } from "./ipc.js";
import type { ProjectHistoryService } from "./project-history.js";

export function registerHistoryIpc(service: () => ProjectHistoryService): void {
  handleIpc(desktopInvoke.history.list, (_event, id) => service().list(id));
  handleIpc(desktopInvoke.history.createVersion, (_event, id, input) => service().createVersion(id, input));
  handleIpc(desktopInvoke.history.createTemporary, (_event, id, input) => service().createTemporary(id, input));
  handleIpc(desktopInvoke.history.snapshot, (_event, id, reason, description, overrides) => service().snapshot(id, reason, description, overrides));
  handleIpc(desktopInvoke.history.details, (_event, id, entryId) => service().details(id, entryId));
  handleIpc(desktopInvoke.history.readText, (_event, id, entryId, path) => service().readText(id, entryId, path));
  handleIpc(desktopInvoke.history.restore, (_event, id, entryId, paths) => service().restore(id, entryId, paths));
  handleIpc(desktopInvoke.history.promote, (_event, id, entryId, input) => service().promote(id, entryId, input));
  handleIpc(desktopInvoke.history.editVersion, (_event, id, entryId, input) => service().editVersion(id, entryId, input));
  handleIpc(desktopInvoke.history.remove, (_event, id, entryId) => service().remove(id, entryId));
  handleIpc(desktopInvoke.history.clearSnapshots, (_event, id) => service().clearSnapshots(id));
  handleIpc(desktopInvoke.history.storage, (_event, id) => service().storage(id));
  handleIpc(desktopInvoke.history.optimize, (_event, id) => service().optimize(id));
}
