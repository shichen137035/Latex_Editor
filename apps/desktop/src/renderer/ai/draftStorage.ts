const DRAFT_KEY_PREFIX = "texweave.ai-composer-draft.v1:";

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): DraftStorage | undefined {
  try { return globalThis.localStorage; }
  catch { return undefined; }
}

function draftKey(projectId: string): string {
  return `${DRAFT_KEY_PREFIX}${encodeURIComponent(projectId)}`;
}

export function readAIDraft(projectId: string, storage: DraftStorage | undefined = browserStorage()): string {
  try { return storage?.getItem(draftKey(projectId)) ?? ""; }
  catch { return ""; }
}

export function writeAIDraft(projectId: string, value: string, storage: DraftStorage | undefined = browserStorage()): void {
  try {
    if (!storage) return;
    if (value) storage.setItem(draftKey(projectId), value);
    else storage.removeItem(draftKey(projectId));
  } catch { /* Draft recovery is best-effort when browser storage is unavailable. */ }
}
