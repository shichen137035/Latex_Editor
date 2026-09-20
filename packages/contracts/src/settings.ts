/** Shared settings contract. Machine paths and keyboard preferences are global only. */
export type DependencyStatus = "unknown" | "checking" | "ready" | "limited" | "missing" | "broken" | "installing" | "restart-required";
export type LatexDistributionType = "miktex" | "texlive" | "unknown";
export interface ToolStatus {
  status: DependencyStatus;
  executablePath?: string;
  version?: string;
  source: "user-configured" | "detected" | "system-path" | "unknown";
  error?: string;
}
export interface LatexDistributionInfo {
  type: LatexDistributionType;
  version?: string;
  rootPath?: string;
}
export interface LatexEnvironmentStatus {
  distribution: LatexDistributionInfo | null;
  pdflatex: ToolStatus;
  xelatex: ToolStatus;
  lualatex: ToolStatus;
  latexmk: ToolStatus;
  bibtex: ToolStatus;
  biber: ToolStatus;
  makeindex: ToolStatus;
  overallStatus: "ready" | "limited" | "unavailable";
}
export interface LatexToolchain {
  distribution: "miktex" | "texlive" | "unknown";
  version?: string;
  rootPath?: string;
  binDirectory?: string;
  latexmk?: string;
  pdflatex?: string;
  xelatex?: string;
  lualatex?: string;
  bibtex?: string;
  biber?: string;
  makeindex?: string;
  available: boolean;
  overallStatus?: "ready" | "limited" | "unavailable";
  environment?: LatexEnvironmentStatus;
  detectedAt: string;
}
export interface PreferenceValues {
  locale: "en" | "ja" | "zh-CN" | "zh-TW" | "ko" | "fr";
  /** Built-in ids are light/dark; custom ids are provided by the theme catalog. */
  theme: string;
  /** Empty means the application-local themes directory. */
  themeDirectory: string;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  autoSave: "off" | "afterDelay";
  hideBuildArtifacts: boolean;
  documentWordCompletion: boolean;
  autoPairSymbols: boolean;
  confirmPreviewEdits: boolean;
  visibleFilterGroups: string[];
  referenceLinkModifier: "ctrl" | "alt" | "shift" | "meta";
  spellCheckMode: "auto" | "manual" | "disabled";
  spellCheckLanguage: string;
  spellCheckActiveLanguages: string[];
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
  locale: "en", theme: "light", themeDirectory: "", fontSize: 15, tabSize: 2, wordWrap: true,
  autoSave: "off", hideBuildArtifacts: true, documentWordCompletion: true, autoPairSymbols: true, confirmPreviewEdits: true, visibleFilterGroups: ["blockType", "location", "file", "properties"], referenceLinkModifier: "ctrl", spellCheckMode: "auto", spellCheckLanguage: "en-US", spellCheckActiveLanguages: ["en-US"], maximize: true, restoreProject: false,
  lastProject: "", engine: "pdflatex", keybindings: {}, environments: [], layout: {}
};
// Project-scoped preferences are kept separate from machine-wide tree and editor settings.
// The project settings UI is reserved for a later release; build-artifact visibility is global.
export const projectPreferenceKeys: PreferenceKey[] = ["fontSize", "tabSize", "wordWrap", "autoSave", "autoPairSymbols", "confirmPreviewEdits", "engine", "environments", "layout"];
export interface SettingsSnapshot { global: Partial<PreferenceValues>; project: Partial<PreferenceValues>; toolchain?: LatexToolchain }
export function validPreference(key: string, value: unknown): boolean {
  switch (key) {
    case "locale": return ["en", "ja", "zh-CN", "zh-TW", "ko", "fr"].includes(String(value));
    case "theme": return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
    case "engine": return ["pdflatex", "xelatex", "lualatex"].includes(String(value));
    case "spellCheckMode": return value === "auto" || value === "manual" || value === "disabled";
    case "spellCheckLanguage": return typeof value === "string" && /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/.test(value);
    case "fontSize": return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 32;
    case "tabSize": return typeof value === "number" && [2, 4, 8].includes(value);
    case "autoSave": return value === "off" || value === "afterDelay";
    case "wordWrap": case "hideBuildArtifacts": case "documentWordCompletion": case "autoPairSymbols": case "confirmPreviewEdits": case "maximize": case "restoreProject": return typeof value === "boolean";
    case "referenceLinkModifier": return value === "ctrl" || value === "alt" || value === "shift" || value === "meta";
    case "spellCheckActiveLanguages": return Array.isArray(value) && value.every((item) => typeof item === "string" && /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/.test(item));
    case "themeDirectory": case "lastProject": return typeof value === "string";
    case "visibleFilterGroups": return Array.isArray(value) && value.every((item) => ["blockType", "location", "file", "properties"].includes(String(item)));
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
