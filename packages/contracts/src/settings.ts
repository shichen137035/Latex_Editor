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
export interface ImagePreferences {
  defaultDirectory: string;
  defaultInsert: {
    type: "figure" | "inline";
    width: string;
    alignment: "left" | "center" | "right";
    placement: string;
    addCaption: boolean;
    addLabel: boolean;
    labelPrefix: string;
  };
  editor: { defaultMode: "gui" | "source" };
  multiFigure: {
    defaultColumns: "auto" | 1 | 2 | 3;
    subfigureWidth: string;
    imageWidth: string;
    horizontalGap: string;
    verticalGap: string;
  };
}
export const defaultImagePreferences: ImagePreferences = {
  defaultDirectory: "figures",
  defaultInsert: { type: "figure", width: "0.8\\textwidth", alignment: "center", placement: "htbp", addCaption: true, addLabel: true, labelPrefix: "fig" },
  editor: { defaultMode: "gui" },
  multiFigure: { defaultColumns: "auto", subfigureWidth: "auto", imageWidth: "\\linewidth", horizontalGap: "\\hfill", verticalGap: "1em" }
};
export type TableStylePreset = "booktabs-three-line" | "grid" | "horizontal" | "plain" | "header-bottom";
export interface TablePreferences {
  defaultStyle: TableStylePreset;
  defaultInsert: { alignment: "left" | "center" | "right"; placement: string; headerRow: boolean; addCaption: boolean; addLabel: boolean };
  labelPrefix: string;
  editor: { defaultMode: "gui" | "source" };
  editing: { allowAutomaticColumnConversion: boolean; autoAddRowOnTab: boolean };
}
export const defaultTablePreferences: TablePreferences = {
  defaultStyle: "booktabs-three-line",
  defaultInsert: { alignment: "center", placement: "htbp", headerRow: true, addCaption: true, addLabel: true },
  labelPrefix: "tab",
  editor: { defaultMode: "gui" },
  editing: { allowAutomaticColumnConversion: false, autoAddRowOnTab: false }
};
export interface PreferenceValues {
  locale: "en" | "ja" | "zh-CN" | "zh-TW" | "ko" | "fr";
  /** Built-in ids are light/dark; custom ids are provided by the theme catalog. */
  theme: string;
  /** Empty means the application-local themes directory. */
  themeDirectory: string;
  /** Optional absolute path to codex.exe; empty means resolve `codex` from PATH. */
  aiCodexExecutable: string;
  /** Empty delegates model selection to the installed Codex account's default. */
  aiModel: string;
  /** Empty delegates model selection to Copilot's default model. */
  aiCopilotModel: string;
  /** Empty uses the current model's advertised default reasoning effort. */
  aiReasoningEffort: string;
  aiCopilotReasoningEffort: string;
  aiDefaultMode: "chat" | "codex";
  aiIncludeCurrentFile: boolean;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  autoSave: "off" | "afterDelay";
  hideBuildArtifacts: boolean;
  documentWordCompletion: boolean;
  autoPairSymbols: boolean;
  autoEnvironmentLabels: boolean;
  confirmPreviewEdits: boolean;
  warnIncompatibleEnvironmentConversion: boolean;
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
  images: ImagePreferences;
  tables: TablePreferences;
}
export type PreferenceKey = keyof PreferenceValues;
export const preferenceDefaults: PreferenceValues = {
  locale: "en", theme: "light", themeDirectory: "", aiCodexExecutable: "", aiModel: "", aiCopilotModel: "", aiReasoningEffort: "", aiCopilotReasoningEffort: "", aiDefaultMode: "chat", aiIncludeCurrentFile: false, fontSize: 15, tabSize: 2, wordWrap: true,
  autoSave: "off", hideBuildArtifacts: true, documentWordCompletion: true, autoPairSymbols: true, autoEnvironmentLabels: true, confirmPreviewEdits: true, warnIncompatibleEnvironmentConversion: true, visibleFilterGroups: ["blockType", "location", "file", "properties"], referenceLinkModifier: "ctrl", spellCheckMode: "auto", spellCheckLanguage: "en-US", spellCheckActiveLanguages: ["en-US"], maximize: true, restoreProject: false,
  lastProject: "", engine: "pdflatex", keybindings: {}, environments: [], layout: {}, images: defaultImagePreferences, tables: defaultTablePreferences
};
// Project-scoped preferences are kept separate from machine-wide tree and editor settings.
// The project settings UI is reserved for a later release; build-artifact visibility is global.
export const projectPreferenceKeys: PreferenceKey[] = ["fontSize", "tabSize", "wordWrap", "autoSave", "autoPairSymbols", "confirmPreviewEdits", "engine", "environments", "layout", "images", "tables"];
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
    case "wordWrap": case "hideBuildArtifacts": case "documentWordCompletion": case "autoPairSymbols": case "autoEnvironmentLabels": case "confirmPreviewEdits": case "warnIncompatibleEnvironmentConversion": case "maximize": case "restoreProject": case "aiIncludeCurrentFile": return typeof value === "boolean";
    case "aiDefaultMode": return value === "chat" || value === "codex";
    case "referenceLinkModifier": return value === "ctrl" || value === "alt" || value === "shift" || value === "meta";
    case "spellCheckActiveLanguages": return Array.isArray(value) && value.every((item) => typeof item === "string" && /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/.test(item));
    case "themeDirectory": case "aiCodexExecutable": case "lastProject": return typeof value === "string";
    case "aiModel": case "aiCopilotModel": return typeof value === "string" && value.length <= 160;
    case "aiReasoningEffort": case "aiCopilotReasoningEffort": return typeof value === "string" && (value === "" || /^[a-z][a-z0-9_-]{0,31}$/.test(value));
    case "visibleFilterGroups": return Array.isArray(value) && value.every((item) => ["blockType", "location", "file", "properties"].includes(String(item)));
    case "keybindings": return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string");
    case "environments": return Array.isArray(value) && value.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const e = entry as Record<string, unknown>;
      return typeof e.id === "string" && typeof e.enabled === "boolean" && typeof e.labelKey === "string" && typeof e.family === "string" && !!e.match && !!e.style && !!e.behavior;
    });
    case "layout": return !!value && typeof value === "object" && !Array.isArray(value);
    case "images": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const images = value as Partial<ImagePreferences>;
      const insert = images.defaultInsert;
      const editor = images.editor;
      const multi = images.multiFigure;
      return typeof images.defaultDirectory === "string" && !images.defaultDirectory.includes("..")
        && !!insert && (insert.type === "figure" || insert.type === "inline") && typeof insert.width === "string"
        && ["left", "center", "right"].includes(String(insert.alignment)) && typeof insert.placement === "string"
        && typeof insert.addCaption === "boolean" && typeof insert.addLabel === "boolean" && typeof insert.labelPrefix === "string"
        && !!editor && (editor.defaultMode === "gui" || editor.defaultMode === "source")
        && !!multi && (multi.defaultColumns === "auto" || [1, 2, 3].includes(Number(multi.defaultColumns)))
        && [multi.subfigureWidth, multi.imageWidth, multi.horizontalGap, multi.verticalGap].every((item) => typeof item === "string");
    }
    case "tables": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const tables = value as Partial<TablePreferences>;
      const insert = tables.defaultInsert;
      const editor = tables.editor;
      const editing = tables.editing;
      return ["booktabs-three-line", "grid", "horizontal", "plain", "header-bottom"].includes(String(tables.defaultStyle))
        && !!insert && ["left", "center", "right"].includes(String(insert.alignment)) && typeof insert.placement === "string"
        && typeof insert.headerRow === "boolean" && typeof insert.addCaption === "boolean" && typeof insert.addLabel === "boolean"
        && typeof tables.labelPrefix === "string" && !!editor && (editor.defaultMode === "gui" || editor.defaultMode === "source")
        && !!editing && typeof editing.allowAutomaticColumnConversion === "boolean" && typeof editing.autoAddRowOnTab === "boolean";
    }
    default: return false;
  }
}
export function sanitizePreferences(raw: unknown, project = false): Partial<PreferenceValues> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([key, value]) => validPreference(key, value) && (!project || projectPreferenceKeys.includes(key as PreferenceKey))));
}
