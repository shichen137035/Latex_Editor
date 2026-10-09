import { defaultHistoryPreferences, type HistoryPreferences } from "./history.js";

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
export interface WheelAccelerationPreferences {
  enabled: boolean;
  /** Boost strength after sustained, large same-direction scrolling (1-10). */
  strength: number;
  /** Maximum scroll multiplier, including the native base speed (2-8). */
  maxMultiplier: number;
  /** Time constant used to decay accumulated acceleration (150-1500 ms). */
  decayMs: number;
}
export const defaultWheelAccelerationPreferences: WheelAccelerationPreferences = {
  enabled: true,
  strength: 4,
  maxMultiplier: 6,
  decayMs: 250
};
export const defaultTablePreferences: TablePreferences = {
  defaultStyle: "booktabs-three-line",
  defaultInsert: { alignment: "center", placement: "htbp", headerRow: true, addCaption: true, addLabel: true },
  labelPrefix: "tab",
  editor: { defaultMode: "gui" },
  editing: { allowAutomaticColumnConversion: false, autoAddRowOnTab: false }
};
export interface PreviewDirectiveDefinition {
  id: string;
  builtIn: boolean;
  enabled: boolean;
  match: { kind: "command"; name: string } | { kind: "blank-line" };
  label: string;
  display: "divider" | "placeholder" | "spacer";
  color: string;
  /** Ownership within implicit chapter/section scopes; paired environments retain their source wrappers. */
  placement?: "nested" | "trailing" | "independent";
}

const directive = (id: string, name: string, label: string, display: PreviewDirectiveDefinition["display"], color: string, placement: PreviewDirectiveDefinition["placement"] = "trailing"): PreviewDirectiveDefinition =>
  ({ id, builtIn: true, enabled: true, match: { kind: "command", name }, label, display, color, placement });

export const defaultPreviewDirectives: PreviewDirectiveDefinition[] = [
  directive("appendix", "appendix", "Appendix begins", "divider", "#7c5cb8", "independent"),
  directive("newpage", "newpage", "Page break", "divider", "#5b84a6"),
  directive("clearpage", "clearpage", "Clear page", "divider", "#5b84a6"),
  directive("cleardoublepage", "cleardoublepage", "Clear double page", "divider", "#5b84a6"),
  directive("pagebreak", "pagebreak", "Page break", "divider", "#5b84a6"),
  directive("frontmatter", "frontmatter", "Front matter begins", "divider", "#7c5cb8", "independent"),
  directive("mainmatter", "mainmatter", "Main matter begins", "divider", "#7c5cb8", "independent"),
  directive("backmatter", "backmatter", "Back matter begins", "divider", "#7c5cb8", "independent"),
  directive("bibliography", "bibliography", "Bibliography", "placeholder", "#2d8b76", "independent"),
  directive("printbibliography", "printbibliography", "Bibliography", "placeholder", "#2d8b76", "independent"),
  directive("bibliographystyle", "bibliographystyle", "Bibliography style", "divider", "#2d8b76"),
  directive("addbibresource", "addbibresource", "Bibliography resource", "divider", "#2d8b76"),
  directive("nocite", "nocite", "Include citations", "divider", "#2d8b76"),
  directive("tableofcontents", "tableofcontents", "Table of contents", "placeholder", "#3d79b5", "independent"),
  directive("listoffigures", "listoffigures", "List of figures", "placeholder", "#3d79b5", "independent"),
  directive("listoftables", "listoftables", "List of tables", "placeholder", "#3d79b5", "independent"),
  directive("printindex", "printindex", "Index", "placeholder", "#3d79b5", "independent"),
  directive("input", "input", "Included file", "placeholder", "#647f9e", "nested"),
  directive("include", "include", "Included file", "placeholder", "#647f9e", "nested"),
  directive("par", "par", "Paragraph break", "spacer", "#a0afbc"),
  directive("newline", "newline", "Line break", "spacer", "#a0afbc"),
  directive("linebreak", "linebreak", "Line break", "spacer", "#a0afbc"),
  directive("vspace", "vspace", "Vertical space", "spacer", "#a0afbc"),
  directive("smallskip", "smallskip", "Small vertical space", "spacer", "#a0afbc"),
  directive("medskip", "medskip", "Medium vertical space", "spacer", "#a0afbc"),
  directive("bigskip", "bigskip", "Large vertical space", "spacer", "#a0afbc"),
  directive("vfill", "vfill", "Flexible vertical space", "spacer", "#a0afbc")
];

export function includeNewBuiltInDirectives(saved: PreviewDirectiveDefinition[]): PreviewDirectiveDefinition[] {
  return [...defaultPreviewDirectives.map((builtIn) => ({ ...builtIn, ...saved.find((item) => item.id === builtIn.id) })),
    ...saved.filter((item) => !item.builtIn && item.match.kind === "command" && !defaultPreviewDirectives.some((builtIn) => builtIn.id === item.id))];
}
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
  aiPermissionMode: "ask" | "auto" | "full";
  aiIncludeCurrentFile: boolean;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  autoSave: "off" | "afterDelay";
  hideBuildArtifacts: boolean;
  documentWordCompletion: boolean;
  autoPairSymbols: boolean;
  mathPreviewOnHover: boolean;
  showPreviewMetrics: boolean;
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
  sidePanelDisplay: "overlay" | "push";
  wheelAcceleration: WheelAccelerationPreferences;
  lastProject: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
  keybindings: Record<string, string>;
  environments: unknown[];
  previewDirectives: PreviewDirectiveDefinition[];
  layout: Record<string, unknown>;
  images: ImagePreferences;
  tables: TablePreferences;
  history: HistoryPreferences;
}
export type PreferenceKey = keyof PreferenceValues;
export const preferenceDefaults: PreferenceValues = {
  locale: "en", theme: "light", themeDirectory: "", aiCodexExecutable: "", aiModel: "", aiCopilotModel: "", aiReasoningEffort: "", aiCopilotReasoningEffort: "", aiDefaultMode: "chat", aiPermissionMode: "auto", aiIncludeCurrentFile: false, fontSize: 15, tabSize: 2, wordWrap: true,
  autoSave: "off", hideBuildArtifacts: true, documentWordCompletion: true, autoPairSymbols: true, mathPreviewOnHover: false, showPreviewMetrics: false, autoEnvironmentLabels: true, confirmPreviewEdits: true, warnIncompatibleEnvironmentConversion: true, visibleFilterGroups: ["blockType", "location", "file", "properties"], referenceLinkModifier: "ctrl", spellCheckMode: "auto", spellCheckLanguage: "en-US", spellCheckActiveLanguages: ["en-US"], maximize: true, restoreProject: false,
  lastProject: "", engine: "pdflatex", keybindings: {}, environments: [], previewDirectives: defaultPreviewDirectives, layout: {}, sidePanelDisplay: "overlay", wheelAcceleration: defaultWheelAccelerationPreferences, images: defaultImagePreferences, tables: defaultTablePreferences, history: defaultHistoryPreferences
};
// Project overrides inherit from global preferences; machine-wide paths and workspace UI stay global.
export const projectPreferenceKeys: PreferenceKey[] = ["fontSize", "tabSize", "wordWrap", "autoSave", "autoPairSymbols", "mathPreviewOnHover", "confirmPreviewEdits", "engine", "environments", "previewDirectives", "layout", "images", "tables", "history", "keybindings"];
export interface SettingsSnapshot { global: Partial<PreferenceValues>; project: Partial<PreferenceValues>; toolchain?: LatexToolchain }
export function validPreference(key: string, value: unknown): boolean {
  switch (key) {
    case "locale": return ["en", "ja", "zh-CN", "zh-TW", "ko", "fr"].includes(String(value));
    case "theme": return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
    case "engine": return ["pdflatex", "xelatex", "lualatex"].includes(String(value));
    case "spellCheckMode": return value === "auto" || value === "manual" || value === "disabled";
    case "sidePanelDisplay": return value === "overlay" || value === "push";
    case "wheelAcceleration": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const wheel = value as Partial<WheelAccelerationPreferences>;
      return typeof wheel.enabled === "boolean"
        && Number.isInteger(wheel.strength) && Number(wheel.strength) >= 1 && Number(wheel.strength) <= 10
        && typeof wheel.maxMultiplier === "number" && Number.isFinite(wheel.maxMultiplier) && wheel.maxMultiplier >= 2 && wheel.maxMultiplier <= 8
        && Number.isInteger(wheel.decayMs) && Number(wheel.decayMs) >= 150 && Number(wheel.decayMs) <= 1500;
    }
    case "spellCheckLanguage": return typeof value === "string" && /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/.test(value);
    case "fontSize": return typeof value === "number" && Number.isInteger(value) && value >= 10 && value <= 32;
    case "tabSize": return typeof value === "number" && [2, 4, 8].includes(value);
    case "autoSave": return value === "off" || value === "afterDelay";
    case "wordWrap": case "hideBuildArtifacts": case "documentWordCompletion": case "autoPairSymbols": case "mathPreviewOnHover": case "showPreviewMetrics": case "autoEnvironmentLabels": case "confirmPreviewEdits": case "warnIncompatibleEnvironmentConversion": case "maximize": case "restoreProject": case "aiIncludeCurrentFile": return typeof value === "boolean";
    case "aiDefaultMode": return value === "chat" || value === "codex";
    case "aiPermissionMode": return value === "ask" || value === "auto" || value === "full";
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
    case "previewDirectives": return Array.isArray(value) && value.length <= 256 && value.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Partial<PreviewDirectiveDefinition>;
      return typeof item.id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(item.id)
        && typeof item.builtIn === "boolean" && typeof item.enabled === "boolean"
        && typeof item.label === "string" && item.label.length <= 100
        && ["divider", "placeholder", "spacer"].includes(String(item.display))
        && (item.placement === undefined || ["nested", "trailing", "independent"].includes(item.placement))
        && typeof item.color === "string" && /^#[0-9a-fA-F]{6}$/.test(item.color)
        && !!item.match && (item.match.kind === "blank-line" || item.match.kind === "command" && /^[A-Za-z@]+$/.test(item.match.name));
    }) && new Set((value as PreviewDirectiveDefinition[]).map((entry) => entry.id)).size === value.length;
    case "layout": return !!value && typeof value === "object" && !Array.isArray(value);
    case "history": {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const history = value as Partial<HistoryPreferences>;
      return [history.autoSnapshot, history.beforeRestore, history.beforeLargeDelete].every((item) => typeof item === "boolean")
        && Number.isInteger(history.intervalMinutes) && Number(history.intervalMinutes) >= 1 && Number(history.intervalMinutes) <= 1440
        && Number.isInteger(history.maxSnapshots) && Number(history.maxSnapshots) >= 1 && Number(history.maxSnapshots) <= 1000
        && Number.isInteger(history.retentionDays) && Number(history.retentionDays) >= 1 && Number(history.retentionDays) <= 3650;
    }
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
