/** Shared settings contract. Machine paths and keyboard preferences are global only. */
export interface LatexToolchain {
  distribution: "miktex" | "texlive" | "unknown";
  binDirectory?: string;
  latexmk?: string;
  pdflatex?: string;
  xelatex?: string;
  lualatex?: string;
  bibtex?: string;
  biber?: string;
  available: boolean;
  detectedAt: string;
}
export interface PreferenceValues {
  locale: "en" | "ja";
  theme: "light" | "dark";
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  autoSave: "off" | "afterDelay";
  hideBuildArtifacts: boolean;
  maximize: boolean;
  restoreProject: boolean;
  lastProject: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
  keybindings: Record<string, string>;
  environments: unknown[];
  layout: Record<string, unknown>;
}
export type PreferenceKey = keyof PreferenceValues;
export const preferenceDefaults: PreferenceValues = {
  locale: "en", theme: "light", fontSize: 15, tabSize: 2, wordWrap: true,
  autoSave: "off", hideBuildArtifacts: true, maximize: true, restoreProject: false,
  lastProject: "", engine: "pdflatex", keybindings: {}, environments: [], layout: {}
};
export const projectPreferenceKeys: PreferenceKey[] = ["fontSize", "tabSize", "wordWrap", "autoSave", "hideBuildArtifacts", "engine", "environments", "layout"];
export interface SettingsSnapshot { global: Partial<PreferenceValues>; project: Partial<PreferenceValues>; toolchain?: LatexToolchain }
export function validPreference(key: string, value: unknown): boolean {
  switch (key) {
    case "locale": return value === "en" || value === "ja";
    case "theme": return value === "light" || value === "dark";
    case "engine": return ["pdflatex", "xelatex", "lualatex"].includes(String(value));
    case "fontSize": return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 32;
    case "tabSize": return typeof value === "number" && [2, 4, 8].includes(value);
    case "autoSave": return value === "off" || value === "afterDelay";
    case "wordWrap": case "hideBuildArtifacts": case "maximize": case "restoreProject": return typeof value === "boolean";
    case "lastProject": return typeof value === "string";
    case "keybindings": return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string");
    case "environments": return Array.isArray(value) && value.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const e = entry as Record<string, unknown>;
      return typeof e.id === "string" && typeof e.enabled === "boolean" && typeof e.labelKey === "string" && typeof e.family === "string" && !!e.match && !!e.style && !!e.behavior;
    });
    case "layout": return !!value && typeof value === "object" && !Array.isArray(value);
    default: return false;
  }
}
export function sanitizePreferences(raw: unknown, project = false): Partial<PreferenceValues> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key, value]) => validPreference(key, value) && (!project || projectPreferenceKeys.includes(key as PreferenceKey))));
}
