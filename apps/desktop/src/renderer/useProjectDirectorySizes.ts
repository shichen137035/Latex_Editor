import { useEffect, useRef, useState } from "react";
import type { Project } from "@latex-editor/contracts";
import type { DesktopApi, ProjectDirectorySize } from "@latex-editor/contracts/desktop-ipc";
const emptySizes: Record<string, ProjectDirectorySize | null> = {};

export function formatProjectBytes(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = bytes > 0 ? Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024))) : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${units[unit]}`;
}

/** Refresh once per directory visit/path change, with three bounded background scans. */
export function useProjectDirectorySizes(projects: Project[], api: DesktopApi | undefined) {
  const key = JSON.stringify(projects.filter(project => !project.missing).map(project => [project.id, project.canonicalPath]).sort());
  const [state, setState] = useState<{ key: string; sizes: Record<string, ProjectDirectorySize | null> }>({ key: "", sizes: {} });
  const cache = useRef(new Map<string, ProjectDirectorySize | null>());
  useEffect(() => {
    if (!api) return;
    let cancelled = false, cursor = 0;
    const entries = projects.filter(project => !project.missing).map(project => ({ id: project.id, cacheKey: JSON.stringify([project.id, project.canonicalPath]) }));
    const sizes: Record<string, ProjectDirectorySize | null> = {};
    for (const entry of entries) if (cache.current.has(entry.cacheKey)) sizes[entry.id] = cache.current.get(entry.cacheKey)!;
    const pending = entries.filter(entry => !cache.current.has(entry.cacheKey));
    setState({ key, sizes });
    const worker = async () => {
      while (!cancelled && cursor < pending.length) {
        const { id, cacheKey } = pending[cursor++]!;
        const size = await api.projects.size(id).catch(() => null);
        cache.current.set(cacheKey, size);
        if (cache.current.size > 128) cache.current.delete(cache.current.keys().next().value!);
        if (!cancelled) setState(current => ({ key, sizes: { ...current.sizes, [id]: size } }));
      }
    };
    void Promise.resolve().then(() => cancelled ? undefined : Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker)));
    return () => { cancelled = true; };
  }, [key, api]);
  return state.key === key ? state.sizes : emptySizes;
}
