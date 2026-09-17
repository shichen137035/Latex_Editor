import { useSyncExternalStore } from "react";
import { preferenceDefaults, validPreference, type PreferenceKey, type PreferenceValues, type SettingsSnapshot } from "@latex-editor/contracts";
import { setLocale } from "../i18n/index.js";

let snapshot: SettingsSnapshot = { global: {}, project: {} };
let projectId: string | undefined;
let revision = 0;
let error = "";
const listeners = new Set<() => void>();
function publish() {
  setLocale(snapshot.global.locale ?? "en");
  document.documentElement.dataset.theme = snapshot.global.theme ?? "light";
  document.documentElement.lang = snapshot.global.locale ?? "en";
  revision += 1; listeners.forEach((listener) => listener());
}
export const settings = {
  get<K extends PreferenceKey>(key: K): PreferenceValues[K] { return (snapshot.project[key] ?? snapshot.global[key] ?? preferenceDefaults[key]) as PreferenceValues[K]; },
  global<K extends PreferenceKey>(key: K): PreferenceValues[K] { return (snapshot.global[key] ?? preferenceDefaults[key]) as PreferenceValues[K]; },
  snapshot: () => snapshot,
  error: () => error,
  projectId: () => projectId,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async load(id?: string) {
    const next = await window.latexEditor!.settings.get(id);
    // Legacy localStorage is read once for migration; all future writes use IPC.
    const legacy: Array<[PreferenceKey, string]> = id ? [["environments", `texweave.environments.project.${id}`], ["layout", `texweave.layout.${id}`]] : [["environments", "texweave.environments.global.v1"], ["hideBuildArtifacts", "texweave.settings.hideBuildArtifacts"]];
    for (const [key, oldKey] of legacy) {
      const scope = id ? next.project : next.global;
      if (scope[key] !== undefined) continue;
      try {
        const raw = localStorage.getItem(oldKey);
        if (raw !== null) {
          const value: unknown = JSON.parse(raw);
          if (validPreference(key, value)) { Object.assign(next, await window.latexEditor!.settings.set(key, value, id)); localStorage.removeItem(oldKey); }
        }
      } catch { /* Keep readable legacy data if migration could not be persisted. */ }
    }
    projectId = id; snapshot = next; publish();
  },
  async set<K extends PreferenceKey>(key: K, value: PreferenceValues[K] | undefined, scope: "global" | "project" = "global") {
    try {
      const id = scope === "project" ? projectId : undefined;
      if (scope === "project" && !id) throw new Error("No active project");
      const next = await window.latexEditor!.settings.set(key, value, id);
      snapshot = id ? next : { ...snapshot, global: next.global, ...(next.toolchain ? { toolchain: next.toolchain } : {}) };
      error = ""; publish();
    } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); publish(); }
  },
  reset(key: PreferenceKey, scope: "global" | "project" = "global") { return settings.set(key, undefined, scope); },
  async detect(manual?: "directory" | "executable") {
    try {
      const toolchain = await window.latexEditor!.settings.detectToolchain(manual);
      if (toolchain) snapshot = { ...snapshot, toolchain };
      error = "";
    } catch (reason) { error = String(reason); }
    publish();
  }
};
export function useSettings() {
  useSyncExternalStore(settings.subscribe, () => revision);
  return settings;
}
