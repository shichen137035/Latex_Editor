import { validThemeColorProfiles, type ThemeColorProfiles } from "./theme-colors.js";
import { defaultHistoryPreferences, type HistoryPreferences } from "./history.js";
import type { SettingsPresetKind } from "./settings-presets.js";

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
  labels?: Record<string, string>;
  display: "divider" | "placeholder" | "spacer";
  color: string;
  colorMode?: "adaptive" | "fixed";
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
  locale: "en" | "ja" | "zh-CN" | "zh-TW" | "ko" | "fr" | "kk";
  fixedBlockNameLanguage: boolean;
  blockNameLanguage: PreferenceValues["locale"];
  /** Built-in ids are light/dark; custom ids are provided by the theme catalog. */
  theme: string;
  /** Empty means the application-local themes directory. */
  themeDirectory: string;
  themeColorProfiles: ThemeColorProfiles;
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
  aiShowTokenUsage: boolean;
  fontSize: number;
  tabSize: number;
  wordWrap: boolean;
  sourceMinimap: boolean;
  pdfFollowActiveTex: boolean;
  autoSave: "off" | "afterDelay";
  autoSaveDelaySeconds: number;
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
  companionEnabled: boolean;
  companionProvider: "chat" | "codex";
  maximize: boolean;
  restoreProject: boolean;
  sidePanelDisplay: "overlay" | "push";
  wheelAcceleration: WheelAccelerationPreferences;
  lastProject: string;
  defaultProjectDirectory: string;
  engine: "pdflatex" | "xelatex" | "lualatex";
  texLiveAutoInstall: boolean;
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
  fixedBlockNameLanguage: true, blockNameLanguage: "en", pdfFollowActiveTex: true,
  companionEnabled: true, companionProvider: "chat", locale: "en", theme: "light", themeDirectory: "", themeColorProfiles: {}, aiCodexExecutable: "", aiModel: "", aiCopilotModel: "", aiReasoningEffort: "", aiCopilotReasoningEffort: "", aiDefaultMode: "chat", aiPermissionMode: "auto", aiIncludeCurrentFile: false, aiShowTokenUsage: true, fontSize: 15, tabSize: 2, wordWrap: true, sourceMinimap: true,
  autoSave: "off", autoSaveDelaySeconds: 3, hideBuildArtifacts: true, documentWordCompletion: true, autoPairSymbols: true, mathPreviewOnHover: false, showPreviewMetrics: false, autoEnvironmentLabels: true, confirmPreviewEdits: true, warnIncompatibleEnvironmentConversion: true, visibleFilterGroups: ["blockType", "location", "file", "properties"], referenceLinkModifier: "ctrl", spellCheckMode: "auto", spellCheckLanguage: "en-US", spellCheckActiveLanguages: ["en-US"], maximize: true, restoreProject: false,
  texLiveAutoInstall: true, lastProject: "", defaultProjectDirectory: "", engine: "pdflatex", keybindings: {}, environments: [], previewDirectives: defaultPreviewDirectives, layout: {}, sidePanelDisplay: "overlay", wheelAcceleration: defaultWheelAccelerationPreferences, images: defaultImagePreferences, tables: defaultTablePreferences, history: defaultHistoryPreferences
};
// Project overrides inherit from global preferences; machine-wide paths and workspace UI stay global.
export const projectPreferenceKeys: PreferenceKey[] = ["fontSize", "tabSize", "wordWrap", "sourceMinimap", "pdfFollowActiveTex", "autoSave", "autoSaveDelaySeconds", "autoPairSymbols", "mathPreviewOnHover", "confirmPreviewEdits", "engine", "environments", "previewDirectives", "layout", "images", "tables", "history", "keybindings"];
export interface SettingsSnapshot { global: Partial<PreferenceValues>; project: Partial<PreferenceValues>; toolchain?: LatexToolchain }
export interface SettingsPreset { id: string; name: string; updatedAt: string; kind: SettingsPresetKind }
export function validLocalizedNames(value: unknown): boolean {
  return value === undefined || !!value && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).every(([locale, name]) => !!locale.trim() && typeof name === "string");
}

export const environmentFamilies = ["section", "theorem", "definition", "proof", "equation", "remark", "example", "figure", "table", "list", "quote", "code", "virtual", "generic"] as const;
export type EnvironmentFamily = typeof environmentFamilies[number];
const environmentRenderers = ["auto", "content", "math", "code", "list", "figure", "table"] as const;
const environmentColorProperties = ["accentToken", "fillToken", "borderToken", "selectedBorderToken", "labelBackgroundToken", "labelTextToken"] as const;
const environmentColorModeValues = ["adaptive", "fixed"] as const;
const environmentTitleRanges = {
  titleFontSize: [10, 72], titleFontWeight: [100, 900], titleLineHeight: [1, 2.5], titleLetterSpacing: [-0.05, 0.15]
} as const;
const environmentPreviewRanges = {
  captionFontSize: [10, 36], imageMaxHeightVh: [10, 100], imageGridMinWidth: [60, 800], imageGridGap: [0, 80],
  tableCellMaxHeightEm: [2, 40], tableEditorMaxHeight: [48, 800], tableExpandedFontSize: [10, 36]
} as const;
const environmentLocales = new Set(["en", "ja", "zh-CN", "zh-TW", "ko", "fr", "kk"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasUnsafeStyleCharacters(value: string): boolean {
  for (const character of value) {
    if (character.charCodeAt(0) < 32) return true;
  }
  return /[;{}<>]/.test(value);
}

function validEnvironmentColor(value: unknown, depth = 0): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || hasUnsafeStyleCharacters(value) || /(?:url|expression)\s*\(/i.test(value)) return false;
  const color = value.trim();
  if (/^--[\w-]+$/.test(color) || /^#[\da-f]{3,8}$/i.test(color) || /^[a-z]+$/i.test(color)) return true;
  const variable = /^var\((--[\w-]+)(?:\s*,\s*(.+))?\)$/i.exec(color);
  if (variable) return depth < 2 && (!variable[2] || validEnvironmentColor(variable[2], depth + 1));
  return /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\([\w.%\s,#()+/-]+\)$/i.test(color);
}

function validEnvironmentPattern(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 256 || value.includes("\0")) return false;
  // Avoid common catastrophic-backtracking expressions before these patterns
  // are run against a full document in the preview parser.
  if (/\((?:\\.|[^()])*(?:[*+{])(?:\\.|[^()])*\)\s*(?:[*+{])/.test(value)) return false;
  try { new RegExp(value, "gm"); return true; } catch { return false; }
}

/** Shared deep validator for environment records received from settings, presets, or XML. */
export function validEnvironmentDefinition(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const item = value;
  if (typeof item.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(item.id)
    || typeof item.enabled !== "boolean" || typeof item.builtIn !== "boolean"
    || typeof item.labelKey !== "string" || item.labelKey.length > 160 || item.labelKey !== "" && !/^[A-Za-z0-9._-]+$/.test(item.labelKey)
    || item.label !== undefined && (typeof item.label !== "string" || item.label.length > 500)
    || !environmentFamilies.includes(item.family as typeof environmentFamilies[number])) return false;
  if (item.labels !== undefined) {
    if (!validLocalizedNames(item.labels)) return false;
    const labels = item.labels as Record<string, string>;
    if (Object.keys(labels).some(locale => !environmentLocales.has(locale)) || Object.values(labels).some(name => name.length > 500)) return false;
  }

  if (!isRecord(item.match)) return false;
  const match = item.match;
  switch (match.kind) {
    case "latex-environment":
      if (typeof match.name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9*@:_-]{0,127}$/.test(match.name)) return false;
      break;
    case "command":
      if (typeof match.command !== "string" || !/^[A-Za-z@]+\*?$/.test(match.command)) return false;
      break;
    case "display-math":
      break;
    case "virtual-block":
      if (typeof match.type !== "string" || !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(match.type)) return false;
      break;
    case "custom-pattern":
      if (!validEnvironmentPattern(match.pattern)) return false;
      break;
    default:
      return false;
  }

  if (!isRecord(item.style) || !environmentColorModeValues.includes((item.style.colorMode ?? "adaptive") as typeof environmentColorModeValues[number])) return false;
  const style = item.style;
  if (!environmentColorProperties.every(key => validEnvironmentColor(style[key]))
    || style.baseColor !== undefined && !validEnvironmentColor(style.baseColor)
    || style.titleFontFamily !== undefined && (typeof style.titleFontFamily !== "string" || !style.titleFontFamily.trim() || style.titleFontFamily.length > 256 || hasUnsafeStyleCharacters(style.titleFontFamily))) return false;
  for (const [field, [min, max]] of Object.entries(environmentTitleRanges)) {
    const number = style[field];
    if (number !== undefined && (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max)) return false;
  }
  for (const [field, [min, max]] of Object.entries(environmentPreviewRanges)) {
    const number = style[field];
    if (number !== undefined && (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max)) return false;
  }

  if (!isRecord(item.behavior)) return false;
  const behavior = item.behavior;
  if (!["inlineEditable", "allowChildren", "showHeader", "showLabel"].every(key => typeof behavior[key] === "boolean")) return false;
  for (const key of ["showOptionBrackets", "showCaption", "captionEditable", "allowExpandedEditor", "expandedToolbar", "listItemEditing", "listShowCount"]) {
    if (behavior[key] !== undefined && typeof behavior[key] !== "boolean") return false;
  }
  if (behavior.renderer !== undefined && !environmentRenderers.includes(behavior.renderer as typeof environmentRenderers[number])) return false;
  if (behavior.imageClickAction !== undefined && !["settings", "replace", "source", "inspect"].includes(String(behavior.imageClickAction))) return false;
  if (behavior.tableToolbar !== undefined && !["selected", "always", "hidden"].includes(String(behavior.tableToolbar))) return false;
  if (behavior.blockHandler !== undefined && (typeof behavior.blockHandler !== "string" || behavior.blockHandler !== "" && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(behavior.blockHandler))) return false;
  if (behavior.listStyle !== undefined && !["ordered", "unordered", "description"].includes(String(behavior.listStyle))) return false;
  if (behavior.listItemCommand !== undefined && (typeof behavior.listItemCommand !== "string" || !/^[A-Za-z@]+$/.test(behavior.listItemCommand))) return false;
  if (behavior.listMarker !== undefined && !["decimal", "lower-alpha", "lower-roman", "disc", "circle", "square", "none"].includes(String(behavior.listMarker))) return false;
  return true;
}

export function validEnvironmentDefinitions(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 512 || !value.every(validEnvironmentDefinition)) return false;
  const ids = value.map(item => (item as { id: string }).id);
  return new Set(ids).size === ids.length;
}

/** Shared GUI/automation schema for primitive settings; complex resources retain their validators. */
export function primitivePreferenceSchema(key: string): Record<string, unknown> | undefined {
  if (!Object.hasOwn(preferenceDefaults, key)) return undefined;
  if (typeof preferenceDefaults[key as PreferenceKey] === "boolean") return { type: "boolean" };
  switch (key) {
    case "engine": return { type: "string", enum: ["pdflatex", "xelatex", "lualatex"] };
    case "fontSize": return { type: "integer", minimum: 10, maximum: 32 };
    case "tabSize": return { type: "integer", enum: [2, 4, 8] };
    case "autoSave": return { type: "string", enum: ["off", "afterDelay"] };
    case "autoSaveDelaySeconds": return { type: "integer", minimum: 1, maximum: 3600 };
    default: return undefined;
  }
}
export function validPreference(key: string, value: unknown): boolean {
  const primitive = primitivePreferenceSchema(key);
  if (primitive) return (primitive.type === "boolean" ? typeof value === "boolean" : primitive.type === "string" ? typeof value === "string" : typeof value === "number" && Number.isInteger(value))
    && (!Array.isArray(primitive.enum) || primitive.enum.includes(value))
    && (typeof primitive.minimum !== "number" || typeof value === "number" && value >= primitive.minimum)
    && (typeof primitive.maximum !== "number" || typeof value === "number" && value <= primitive.maximum);
  switch (key) {
    case "locale": case "blockNameLanguage": return ["en", "ja", "zh-CN", "zh-TW", "ko", "fr", "kk"].includes(String(value));
    case "fixedBlockNameLanguage": return typeof value === "boolean";
    case "themeColorProfiles": return validThemeColorProfiles(value);
    case "theme": return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
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
    case "companionEnabled": case "texLiveAutoInstall": case "pdfFollowActiveTex": case "wordWrap": case "sourceMinimap": case "hideBuildArtifacts": case "documentWordCompletion": case "autoPairSymbols": case "mathPreviewOnHover": case "showPreviewMetrics": case "autoEnvironmentLabels": case "confirmPreviewEdits": case "warnIncompatibleEnvironmentConversion": case "maximize": case "restoreProject": case "aiIncludeCurrentFile": case "aiShowTokenUsage": return typeof value === "boolean";
    case "aiDefaultMode": case "companionProvider": return value === "chat" || value === "codex";
    case "aiPermissionMode": return value === "ask" || value === "auto" || value === "full";
    case "referenceLinkModifier": return value === "ctrl" || value === "alt" || value === "shift" || value === "meta";
    case "spellCheckActiveLanguages": return Array.isArray(value) && value.every((item) => typeof item === "string" && /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/.test(item));
    case "defaultProjectDirectory": return typeof value === "string" && value.length <= 4096 && !value.includes("\0");
    case "themeDirectory": case "aiCodexExecutable": case "lastProject": return typeof value === "string";
    case "aiModel": case "aiCopilotModel": return typeof value === "string" && value.length <= 160;
    case "aiReasoningEffort": case "aiCopilotReasoningEffort": return typeof value === "string" && (value === "" || /^[a-z][a-z0-9_-]{0,31}$/.test(value));
    case "visibleFilterGroups": return Array.isArray(value) && value.every((item) => ["blockType", "location", "file", "properties"].includes(String(item)));
    case "keybindings": return !!value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((v) => typeof v === "string");
    case "environments": return validEnvironmentDefinitions(value);
    case "previewDirectives": return Array.isArray(value) && value.length <= 256 && value.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Partial<PreviewDirectiveDefinition>;
      return typeof item.id === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(item.id)
        && typeof item.builtIn === "boolean" && typeof item.enabled === "boolean"
        && typeof item.label === "string" && item.label.length <= 100
        && validLocalizedNames(item.labels)
        && ["divider", "placeholder", "spacer"].includes(String(item.display))
        && (item.placement === undefined || ["nested", "trailing", "independent"].includes(item.placement))
        && (item.colorMode === undefined || item.colorMode === "adaptive" || item.colorMode === "fixed")
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
