import type { EditorTab } from "./fileActions.js";

export type ExternalFileConflict = { path: string; missing: boolean };
interface Options {
  tabs(): EditorTab[];
  baseline(path: string): string | undefined;
  setBaseline(path: string, content: string): void;
  versions(paths: string[]): Promise<Record<string, string | null>>;
  read(path: string): Promise<{ content: string }>;
  hasDraft(): boolean;
  update(tabs: EditorTab[]): void;
  onReload(path: string, content: string): void;
  onConflicts(conflicts: ExternalFileConflict[]): void;
}

/** Poll cheap versions, reread only changes, and never overwrite local or in-flight edits. */
export function createExternalFileSync(options: Options) {
  const tokens = new Map<string, string | null>();
  const conflicts = new Map<string, ExternalFileConflict>();
  let closed = false, running: Promise<void> | undefined, again = false, forceNext = false;
  const conflict = (path: string, missing?: boolean) => {
    const previous = conflicts.get(path);
    if (missing === undefined) { if (!previous) return; conflicts.delete(path); }
    else { if (previous?.missing === missing) return; conflicts.set(path, { path, missing }); }
    options.onConflicts([...conflicts.values()]);
  };
  const reload = (tab: EditorTab, content: string) => {
    options.setBaseline(tab.path, content);
    options.update(options.tabs().map(value => value === tab ? { ...value, content, dirty: false } : value));
    options.onReload(tab.path, content); conflict(tab.path);
  };
  const readStable = async (path: string, token: string) => {
    const file = await options.read(path);
    if (closed || (await options.versions([path]))[path] !== token) return;
    return file;
  };
  const pass = async (force: boolean) => {
    const paths = options.tabs().map(tab => tab.path);
    for (const path of tokens.keys()) if (!paths.includes(path)) { tokens.delete(path); conflict(path); }
    for (const path of conflicts.keys()) if (!paths.includes(path)) conflict(path);
    for (let start = 0; start < paths.length; start += 128) {
      const batch = paths.slice(start, start + 128), versions = await options.versions(batch);
      for (const path of batch) {
        if (closed) return;
        const token = versions[path];
        const local = options.tabs().find(tab => tab.path === path);
        const canRetryConflict = conflicts.has(path) && local && !local.dirty && !options.hasDraft();
        if (token === undefined || (!force && tokens.has(path) && tokens.get(path) === token && !canRetryConflict)) continue;
        if (token === null) { tokens.set(path, token); conflict(path, true); continue; }
        const tab = options.tabs().find(value => value.path === path), before = options.baseline(path);
        if (!tab) continue;
        let file: { content: string } | undefined;
        try { file = await readStable(path, token); }
        catch { conflict(path, false); continue; } // Preserve edits and block saves until a stable read succeeds.
        if (!file || closed) continue;
        const current = options.tabs().find(value => value.path === path);
        if (current !== tab || options.baseline(path) !== before) continue;
        if (file.content === before) { tokens.set(path, token); conflict(path); continue; }
        if (file.content === tab.content && !options.hasDraft()) {
          // A save may reach disk just before its IPC reply updates the baseline.
          // Acknowledge it without treating it as an external edit or clearing Undo.
          tokens.set(path, token); options.setBaseline(path, file.content);
          if (tab.dirty) options.update(options.tabs().map(value => value === tab ? { ...value, dirty: false } : value));
          conflict(path); continue;
        }
        if (options.hasDraft() || (file.content !== tab.content && (tab.dirty || before === undefined || tab.content !== before))) {
          tokens.set(path, token); conflict(path, false); continue;
        }
        tokens.set(path, token); reload(tab, file.content);
      }
    }
  };
  const sync = (force = false): Promise<void> => {
    if (closed) return Promise.resolve();
    forceNext ||= force;
    if (running) { again = true; return running; }
    running = (async () => {
      do { const forced = forceNext; forceNext = false; again = false; await pass(forced); } while (again && !closed);
    })().finally(() => { running = undefined; });
    return running;
  };
  const resolve = async (path: string, keepLocal: boolean) => {
    if (closed) return;
    const tab = options.tabs().find(value => value.path === path), baseline = options.baseline(path);
    if (!tab || options.hasDraft()) return;
    const token = (await options.versions([path]))[path];
    if (token == null) return;
    const file = await readStable(path, token);
    if (!file || closed || options.tabs().find(value => value.path === path) !== tab || options.baseline(path) !== baseline) return;
    tokens.set(path, token);
    if (keepLocal) {
      options.setBaseline(path, file.content);
      options.update(options.tabs().map(value => value === tab ? { ...value, dirty: value.content !== file.content } : value));
      conflict(path);
    } else reload(tab, file.content);
  };
  return { sync, resolve, conflicts: () => [...conflicts.values()], close() { closed = true; tokens.clear(); conflicts.clear(); } };
}
