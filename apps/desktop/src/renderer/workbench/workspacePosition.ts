import { releaseCollapseStateCache } from "../collapseState.js";

export function clearProjectViewCaches(projectIds: string[]): void {
  const ids = new Set(projectIds);
  const prefixes = projectIds.flatMap(id => [`texweave.collapsed.preview.v1:${encodeURIComponent(id)}:`, `texweave.collapsed.outline.v1:${encodeURIComponent(id)}:`]);
  for (const id of projectIds) releaseCollapseStateCache(id);
  try {
    for (const storageKey of Object.keys(localStorage)) {
      let remove = prefixes.some(prefix => storageKey.startsWith(prefix)) || projectIds.some(id => storageKey === `texweave.expanded.file-tree.v1:${encodeURIComponent(id)}`);
      if (storageKey.startsWith("texweave.workspacePosition:")) {
        try { remove ||= ids.has((JSON.parse(storageKey.slice("texweave.workspacePosition:".length)) as unknown[])[0] as string); }
        catch { /* Ignore unrelated malformed state. */ }
      }
      if (remove) localStorage.removeItem(storageKey);
    }
  } catch { /* Restricted storage does not prevent registry cleanup. */ }
}

export interface FilePosition { offset: number; scrollTop: number }
export interface WorkspacePosition { activePath?: string; source: Array<[string, FilePosition]>; preview: Array<[string, FilePosition]> }
const key = (projectId: string, root: string) => `texweave.workspacePosition:${JSON.stringify([projectId, root])}`;
const safePath = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096
  && !/^(?:[A-Za-z]:|[/\\])/.test(value) && !value.includes("\0") && !value.replaceAll("\\", "/").split("/").some(part => !part || part === "." || part === "..");
function positions(value: unknown): Array<[string, FilePosition]> {
  if (!Array.isArray(value)) return [];
  return value.slice(-32).flatMap(entry => {
    if (!Array.isArray(entry) || !safePath(entry[0]) || !entry[1] || typeof entry[1] !== "object") return [];
    const { offset, scrollTop } = entry[1] as FilePosition;
    return Number.isSafeInteger(offset) && offset >= 0 && Number.isFinite(scrollTop) && scrollTop >= 0
      ? [[entry[0], { offset, scrollTop }] as [string, FilePosition]] : [];
  });
}
/** Local view state stays outside document metadata and snapshot history. */
export function readWorkspacePosition(projectId: string, root: string): WorkspacePosition {
  try {
    const raw = JSON.parse(localStorage.getItem(key(projectId, root)) ?? "null") as Partial<WorkspacePosition> | null;
    return { ...(safePath(raw?.activePath) ? { activePath: raw!.activePath } : {}), source: positions(raw?.source), preview: positions(raw?.preview) };
  } catch { return { source: [], preview: [] }; }
}
export function writeWorkspacePosition(projectId: string, root: string, state: WorkspacePosition): void {
  try {
    const prioritize = (entries: WorkspacePosition["source"]) => positions([...entries.filter(([path]) => path !== state.activePath), ...entries.filter(([path]) => path === state.activePath)]);
    const encoded = JSON.stringify({ ...(safePath(state.activePath) ? { activePath: state.activePath } : {}), source: prioritize(state.source), preview: prioritize(state.preview) });
    const storageKey = key(projectId, root);
    if (localStorage.getItem(storageKey) !== encoded) localStorage.setItem(storageKey, encoded);
  } catch { /* A full or unavailable local store must not interfere with editing/closing. */ }
}
