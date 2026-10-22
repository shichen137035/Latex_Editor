import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { EditorTab } from "./fileActions.js";
import { createExternalFileSync, type ExternalFileConflict } from "./externalFileSync.js";

type Options = {
  api: Window["latexEditor"]; projectId: string; tabs: EditorTab[];
  tabsRef: MutableRefObject<EditorTab[]>; savedContents: MutableRefObject<Map<string, string>>;
  setTabs(tabs: EditorTab[]): void; hasDraft(): boolean;
  onReload(path: string, content: string): void; onError(message: string): void;
  onBaselineChange(path: string): void;
};
export function useExternalFiles(options: Options) {
  const latest = useRef(options); latest.current = options;
  const controller = useRef<ReturnType<typeof createExternalFileSync> | undefined>(undefined);
  const [conflicts, setConflicts] = useState<ExternalFileConflict[]>([]);
  const client = useMemo(() => ({
    sync: (force = false) => controller.current?.sync(force) ?? Promise.resolve(),
    resolve: (path: string, keepLocal: boolean) => controller.current?.resolve(path, keepLocal) ?? Promise.resolve(),
    conflicts: () => controller.current?.conflicts() ?? []
  }), []);
  useEffect(() => {
    if (!options.api) return;
    setConflicts([]);
    const api = options.api, projectId = options.projectId;
    const sync = createExternalFileSync({
      tabs: () => latest.current.tabsRef.current,
      baseline: path => latest.current.savedContents.current.get(path),
      setBaseline: (path, content) => { latest.current.savedContents.current.set(path, content); latest.current.onBaselineChange(path); },
      versions: paths => api.files.versions(projectId, paths),
      read: path => api.files.read(projectId, path), hasDraft: () => latest.current.hasDraft(),
      update: tabs => { latest.current.tabsRef.current = tabs; latest.current.setTabs(tabs); },
      onReload: (path, content) => latest.current.onReload(path, content), onConflicts: setConflicts
    });
    controller.current = sync;
    let active = true, lastError = "";
    const refresh = (force = false) => { void sync.sync(force).then(() => { lastError = ""; }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (active && message !== lastError) { lastError = message; latest.current.onError(message); }
    }); };
    const focus = () => refresh(true);
    const visible = () => { if (!document.hidden) refresh(); };
    const timer = window.setInterval(() => { if (!document.hidden) refresh(); }, 2000);
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visible);
    refresh();
    return () => { active = false; sync.close(); if (controller.current === sync) controller.current = undefined; window.clearInterval(timer); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visible); };
  }, [options.api, options.projectId]);
  const paths = options.tabs.map(tab => tab.path).join("\0");
  useEffect(() => { void client.sync().catch(() => undefined); }, [client, paths]);
  return { ...client, pending: conflicts };
}
