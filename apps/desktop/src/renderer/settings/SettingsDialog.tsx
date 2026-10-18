import type { SettingsPresetKind } from "@latex-editor/contracts";
import { SettingsPresetDialog } from "./SettingsPresets.js";
import { CodexEnvironmentSettings } from "./CodexEnvironmentSettings.js";
import { LatexToolchainSettingsPanel } from "./LatexToolchainSettingsPanel.js";
import { ThemeColorSettings } from "../themes/ThemeColorSettings.js";
import { themeName, languageName } from "../i18n/displayNames.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { includeNewBuiltInDirectives, isEnglishSpellDictionary, preferenceDefaults, projectPreferenceKeys, type AIProjectSkill, type DictionaryPackage, type HistoryPreferences, type ImagePreferences, type PreferenceKey, type PreviewDirectiveDefinition, type TablePreferences, type TableStylePreset, type ThemeDefinition, type WheelAccelerationPreferences } from "@latex-editor/contracts";
import type { SpellCheckStatus } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { LanguageSelect } from "../i18n/LanguageSelect.js";
import { EnvironmentManager } from "../preview/EnvironmentManager.js";
import { DirectiveManager } from "../preview/DirectiveManager.js";
import { StyleResourcesManager } from "./StyleResourcesManager.js";
import { DEFAULT_ENVIRONMENTS, includeNewBuiltInEnvironments } from "../preview/environments.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { useSettings } from "./service.js";
import { ShortcutManager } from "./ShortcutManager.js";
import "./settings.css";

const sectionGroups = [
  { label: "settings.group.general", sections: ["general", "appearance"] },
  { label: "settings.group.editor", sections: ["editor", "tools", "filter"] },
  { label: "settings.group.projectBuild", sections: ["projectBuild", "applicationBuild"] },
  { label: "settings.group.ai", sections: ["ai"] }
] as const;
export type SettingsCategory = typeof sectionGroups[number]["sections"][number];
export type SettingsSection = SettingsCategory | "language" | "searchFilter" | "preview" | "project" | "build" | "shortcuts" | "history" | "environment" | "compiler" | "spellcheck" | "aiSkills" | "environments" | "previewCommands" | "styleResources" | "images" | "tables";
type SettingsLevel = "basic" | "advanced";
type ManagerId = "themes" | "dictionaries" | "shortcuts" | "blockEnvironments" | "previewCommands" | "styleResources" | "toolchain" | "aiSkills";
type Section = SettingsSection;

const managerDefinitions: Record<ManagerId, { category: SettingsCategory; title: string; description: string; keywords: string[] }> = {
  themes: { category: "appearance", title: "settings.manager.themes", description: "settings.manager.themesHint", keywords: ["theme", "css", "color", "appearance"] },
  dictionaries: { category: "editor", title: "settings.manager.dictionaries", description: "settings.manager.dictionariesHint", keywords: ["spellcheck", "dictionary", "language", "words"] },
  shortcuts: { category: "editor", title: "settings.manager.shortcuts", description: "settings.manager.shortcutsHint", keywords: ["keyboard", "keybinding", "hotkey", "shortcut"] },
  blockEnvironments: { category: "projectBuild", title: "settings.manager.blockEnvironments", description: "settings.manager.blockEnvironmentsHint", keywords: ["block", "environment", "preview", "semantic"] },
  previewCommands: { category: "projectBuild", title: "settings.manager.previewCommands", description: "settings.manager.previewCommandsHint", keywords: ["command", "directive", "page break", "appendix", "bibliography", "vertical space"] },
  styleResources: { category: "projectBuild", title: "settings.manager.styleResources", description: "settings.manager.styleResourcesHint", keywords: ["style", "resource", "sty", "cls", "latex"] },
  toolchain: { category: "applicationBuild", title: "settings.manager.toolchain", description: "settings.manager.toolchainHint", keywords: ["latex", "engine", "compiler", "pdflatex", "xelatex", "lualatex", "bibtex", "biber", "makeindex"] },
  aiSkills: { category: "ai", title: "settings.manager.aiSkills", description: "settings.manager.aiSkillsHint", keywords: ["ai", "skill", "instruction", "workflow"] }
};

const categoryPreferences: Record<SettingsCategory, PreferenceKey[]> = {
  general: ["autoSave", "autoSaveDelaySeconds", "hideBuildArtifacts", "restoreProject", "maximize", "sidePanelDisplay", "locale", "fixedBlockNameLanguage", "blockNameLanguage", "wheelAcceleration"],
  appearance: ["theme", "themeDirectory", "themeColorProfiles", "fontSize", "tabSize"],
  editor: ["wordWrap", "sourceMinimap", "autoPairSymbols", "mathPreviewOnHover", "showPreviewMetrics", "documentWordCompletion", "autoEnvironmentLabels", "confirmPreviewEdits", "warnIncompatibleEnvironmentConversion", "spellCheckMode", "spellCheckLanguage", "spellCheckActiveLanguages", "keybindings", "referenceLinkModifier"],
  filter: ["visibleFilterGroups"],
  tools: ["images", "tables"],
  projectBuild: ["history", "environments", "previewDirectives", "pdfFollowActiveTex"],
  applicationBuild: ["engine", "defaultProjectDirectory"],
  ai: ["aiShowTokenUsage", "aiDefaultMode", "aiPermissionMode", "aiReasoningEffort", "aiCopilotReasoningEffort"]
};

const searchEntries: Array<{ id: string; category: SettingsCategory; level: SettingsLevel | "manager"; titleKey?: string; title?: string; keywords?: string[]; manager?: ManagerId }> = [
  { id: "settingsPresets", category: "general", level: "advanced", titleKey: "settingsPresets.title", keywords: ["preset", "profile", "save", "load", "mode"] },
  ...(["autoSave", "autoSaveDelaySeconds", "hideBuildArtifacts", "restore", "maximize", "sidePanelDisplay", "language", "fixedBlockNameLanguage", "blockNameLanguage", "wheelAccelerationEnabled"] as const).map((key) => ({ id: key, category: "general" as const, level: "basic" as const, titleKey: key === "restore" ? "settings.restore" : key === "language" ? "settings.language" : key === "wheelAccelerationEnabled" ? "settings.wheelAccelerationEnabled" : `settings.${key}`, keywords: ["startup", "save", "scroll"] })),
  ...(["wheelStrength", "wheelMaximum", "wheelDecay"] as const).map((key) => ({ id: key, category: "general" as const, level: "advanced" as const, titleKey: `settings.${key}`, keywords: ["scroll", "acceleration", "speed"] })),
  ...(["fontSize", "tabSize"] as const).map((key) => ({ id: key, category: "appearance" as const, level: "basic" as const, titleKey: `settings.${key}`, keywords: ["font", "text", "tab", "indent", "appearance"] })),
  { id: "theme", category: "appearance", level: "basic", titleKey: "settings.activeTheme", keywords: ["colors", "appearance"] },
  { id: "themeColorProfiles", category: "appearance", level: "manager", manager: "themes", titleKey: "colors.themeSettings", keywords: ["color", "contrast", "adaptive", "block", "command"] },
  { id: "themes", category: "appearance", level: "manager", manager: "themes", titleKey: managerDefinitions.themes.title, keywords: managerDefinitions.themes.keywords },
  ...(["wordWrap", "sourceMinimap", "autoPairSymbols", "mathPreviewOnHover", "documentWordCompletion", "confirmPreviewEdits"] as const).map((key) => ({ id: key, category: "editor" as const, level: "basic" as const, titleKey: `settings.${key}`, keywords: ["typing", "completion", "math", "preview"] })),
  ...(["autoEnvironmentLabels", "warnIncompatibleEnvironmentConversion"] as const).map((key) => ({ id: key, category: "editor" as const, level: "advanced" as const, titleKey: `settings.${key}`, keywords: ["label", "environment", "conversion"] })),
  { id: "showPreviewMetrics", category: "editor", level: "advanced", titleKey: "settings.showPreviewMetrics", keywords: ["preview", "debug", "metrics", "cache", "performance"] },
  { id: "spellCheckMode", category: "editor", level: "basic", titleKey: "settings.spellcheckMode", keywords: ["spelling", "language"] },
  { id: "spellCheckLanguage", category: "editor", level: "basic", titleKey: "settings.spellcheckLanguage", keywords: ["spelling", "dictionary"] },
  { id: "dictionaries", category: "editor", level: "manager", manager: "dictionaries", titleKey: managerDefinitions.dictionaries.title, keywords: managerDefinitions.dictionaries.keywords },
  { id: "shortcuts", category: "editor", level: "manager", manager: "shortcuts", titleKey: managerDefinitions.shortcuts.title, keywords: managerDefinitions.shortcuts.keywords },
  ...(["blockType", "location", "file", "properties"] as const).map((key) => ({ id: `filter-${key}`, category: "filter" as const, level: "basic" as const, titleKey: `filter.${key}`, keywords: ["search", "filter", "structure"] })),
  { id: "blockEnvironments", category: "projectBuild", level: "manager", manager: "blockEnvironments", titleKey: managerDefinitions.blockEnvironments.title, keywords: managerDefinitions.blockEnvironments.keywords },
  { id: "previewCommands", category: "projectBuild", level: "manager", manager: "previewCommands", titleKey: managerDefinitions.previewCommands.title, keywords: managerDefinitions.previewCommands.keywords },
  ...(["imageInsertion", "imageWidth"] as const).map((key) => ({ id: key, category: "tools" as const, level: "basic" as const, title: key.replace("image", "Image "), keywords: ["figure", "graphic", "picture"] })),
  ...(["imageDirectory", "imageAlignment", "imageCaption", "imageLabel", "imagePlacement", "imageLabelPrefix", "imageEditor", "multipleImages"] as const).map((key) => ({ id: key, category: "tools" as const, level: "advanced" as const, title: key.replace(/([A-Z])/g, " $1"), keywords: ["figure", "graphic", "latex"] })),
  { id: "tableStyle", category: "tools", level: "basic", get title() { return t("ui.SettingsDialog.table_style"); }, keywords: ["tabular", "grid"] },
  ...(["tableAlignment", "tableHeader", "tableCaption", "tableLabel", "tableEditor", "tablePlacement", "tableLabelPrefix", "tableWidthConversion", "tableAddRow"] as const).map((key) => ({ id: key, category: "tools" as const, level: "advanced" as const, title: key.replace(/([A-Z])/g, " $1"), keywords: ["tabular", "latex"] })),
  ...(["autoSnapshot", "beforeRestore", "beforeLargeDelete"] as const).map((key) => ({ id: key, category: "projectBuild" as const, level: "basic" as const, titleKey: `history.${key}`, keywords: ["history", "version", "backup"] })),
  ...(["snapshotInterval", "maxSnapshots", "retentionDays"] as const).map((key) => ({ id: key, category: "projectBuild" as const, level: "advanced" as const, titleKey: `history.${key === "snapshotInterval" ? "intervalMinutes" : key}`, keywords: ["history", "version", "retention", "cleanup"] })),
  { id: "styleResources", category: "projectBuild", level: "manager", manager: "styleResources", titleKey: managerDefinitions.styleResources.title, keywords: managerDefinitions.styleResources.keywords },
  { id: "defaultProjectDirectory", category: "applicationBuild", level: "basic", titleKey: "settings.defaultProjectDirectory", keywords: ["folder", "directory", "create", "project"] },
  { id: "engine", category: "applicationBuild", level: "basic", titleKey: "settings.engine", keywords: ["compiler", "pdflatex", "xelatex", "lualatex"] },
  { id: "pdfFollowActiveTex", category: "projectBuild", level: "basic", titleKey: "settings.pdfFollowActiveTex", keywords: ["pdf", "preview", "switch", "document"] },
  { id: "toolchain", category: "applicationBuild", level: "manager", manager: "toolchain", titleKey: managerDefinitions.toolchain.title, keywords: managerDefinitions.toolchain.keywords },
  { id: "projectCache", category: "applicationBuild", level: "advanced", titleKey: "settings.projectCacheClear", keywords: ["cache", "clear", "registry", "cleanup", "build"] },
  { id: "aiShowTokenUsage", category: "ai", level: "basic", titleKey: "settings.aiShowTokenUsage", keywords: ["tokens", "usage", "display"] },
  { id: "aiDefaultMode", category: "ai", level: "basic", titleKey: "settings.aiDefaultMode", keywords: ["copilot", "codex"] },
  { id: "aiPermissionMode", category: "ai", level: "basic", titleKey: "settings.aiPermissionMode", keywords: ["permission", "access"] },
  { id: "aiSkills", category: "ai", level: "manager", manager: "aiSkills", titleKey: managerDefinitions.aiSkills.title, keywords: managerDefinitions.aiSkills.keywords }
];

const projectSettingsByCategory: Partial<Record<SettingsCategory, PreferenceKey[]>> = {
  general: ["autoSave", "autoSaveDelaySeconds"],
  appearance: ["fontSize", "tabSize"],
  editor: ["wordWrap", "sourceMinimap", "autoPairSymbols", "mathPreviewOnHover", "confirmPreviewEdits", "keybindings"],
  tools: ["images", "tables"],
  projectBuild: ["history", "environments", "previewDirectives", "pdfFollowActiveTex"],
  applicationBuild: ["engine"]
};

function ProjectCacheSettingsPanel() {
  const store = useSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clearedCount, setClearedCount] = useState<number>();
  const clear = async () => {
    setBusy(true); setError(""); setClearedCount(undefined);
    try {
      const result = await window.latexEditor!.settings.clearProjectCaches();
      if (result.cleared) { setClearedCount(result.projectCount); await store.load(); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <SettingGroup title={t("settings.projectCacheTitle")}>
    <p>{t("settings.projectCacheHint")}</p>
    <div className="preference-row" data-setting="projectCache"><span><strong>{t("settings.projectCacheClear")}</strong><small>{t("settings.projectCacheIdle")}</small></span><button className="project-cache-clear-button" type="button" disabled={busy || Boolean(store.projectId())} onClick={() => void clear()}>{t(busy ? "settings.projectCacheClearing" : "settings.projectCacheClear")}</button></div>
    {error && <p role="alert" className="project-cache-error">{error}</p>}
    {clearedCount !== undefined && <p role="status">{t("settings.projectCacheDone", { count: clearedCount })}</p>}
  </SettingGroup>;
}

function HistorySettingsPanel({ store, scope, level }: { store: ReturnType<typeof useSettings>; scope: "global" | "project"; level: SettingsLevel }) {
  const value = (scope === "global" ? store.global("history") : store.get("history")) as HistoryPreferences;
  const update = (patch: Partial<HistoryPreferences>) => void store.set("history", { ...value, ...patch }, scope);
  const toggles = ["autoSnapshot", "beforeRestore", "beforeLargeDelete"] as const;
  const numbers = [["intervalMinutes", 1, 1440], ["maxSnapshots", 1, 1000], ["retentionDays", 1, 3650]] as const;
  return <><SettingGroup title={t(level === "basic" ? "settings.group.historyBasics" : "settings.group.historyAdvanced")}>{(level === "basic" ? toggles : []).map((key) => <label className="preference-row" key={key}><span><strong>{t(`history.${key}`)}</strong></span><input data-setting={`history.${key}`} type="checkbox" checked={value[key]} onChange={(event) => update({ [key]: event.target.checked })}/></label>)}{(level === "advanced" ? numbers : []).map(([key, min, max]) => <label className="preference-row" key={key}><span><strong>{t(`history.${key}`)}</strong></span><input data-setting={`history.${key}`} type="number" min={min} max={max} value={value[key]} onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= min && next <= max) update({ [key]: next }); }}/></label>)}</SettingGroup></>;
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="settings-content-group"><h3>{title}</h3>{children}</section>;
}

function ManagerGlyph({ manager }: { manager: ManagerId }) {
  const drawings: Record<ManagerId, ReactNode> = {
    themes: <><path d="M12 3.5a8.5 8.5 0 1 0 0 17h1.2a2.1 2.1 0 0 0 1.5-3.6 1.7 1.7 0 0 1 1.2-2.9h1.2A3.4 3.4 0 0 0 20.5 11C20.5 6.9 16.7 3.5 12 3.5Z"/><circle cx="7.7" cy="10" r=".8"/><circle cx="11" cy="7.2" r=".8"/><circle cx="15.1" cy="8.2" r=".8"/></>,
    dictionaries: <><path d="M4.5 5.2A2.2 2.2 0 0 1 6.7 3h12.8v16.5H6.7a2.2 2.2 0 0 1-2.2-2.2z"/><path d="M4.5 6h12M8 8.5h7M8 11.5h7M8 14.5h5"/></>,
    shortcuts: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M6.5 9h1m3 0h1m3 0h1m3 0h.5M6.5 12h1m3 0h1m3 0h1m3 0h.5M8 15h8"/></>,
    blockEnvironments: <><path d="M8.5 5H7a2 2 0 0 0-2 2v2a3 3 0 0 1-2 3 3 3 0 0 1 2 3v2a2 2 0 0 0 2 2h1.5M15.5 5H17a2 2 0 0 1 2 2v2a3 3 0 0 0 2 3 3 3 0 0 0-2 3v2a2 2 0 0 1-2 2h-1.5"/><path d="M10 9h4v6h-4z"/></>,
    previewCommands: <><path d="M4 8h16M4 16h16M9 12h6"/><path d="m7 4-3 4 3 4m10 0 3 4-3 4"/></>,
    styleResources: <><path d="M6 3.5h8l4 4v13H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z"/><path d="M14 3.5v5h4M8 12l-2 2 2 2m8-4 2 2-2 2m-3-5-2 6"/></>,
    toolchain: <><path d="M14.3 6.1a4.2 4.2 0 0 0-5.6 5.6l-5 5a2 2 0 0 0 2.8 2.8l5-5a4.2 4.2 0 0 0 5.6-5.6l-2.5 2.5-2.8-2.8z"/><path d="m16 4 4 4"/></>,
    aiSkills: <><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{drawings[manager]}</svg>;
}

function ManagerEntry({ manager, title, description, onOpen }: { manager: ManagerId; title: string; description: string; onOpen(): void }) {
  return <div className="settings-manager-entry"><div className="settings-manager-entry-copy"><strong>{title}</strong><small>{description}</small></div><button className="settings-manager-entry-open" type="button" data-manager={manager} aria-label={title} title={title} onClick={onOpen}><ManagerGlyph manager={manager}/></button></div>;
}

function WheelAccelerationSettingsPanel({ store, scope, level }: { store: ReturnType<typeof useSettings>; scope: "global" | "project"; level: SettingsLevel }) {
  const value = store.global("wheelAcceleration");
  const [draft, setDraft] = useState<WheelAccelerationPreferences>(value);
  const globalOnly = scope !== "global";
  useEffect(() => setDraft(value), [value.enabled, value.strength, value.maxMultiplier, value.decayMs]);
  const updateDraft = (patch: Partial<WheelAccelerationPreferences>) => setDraft((current) => ({ ...current, ...patch }));
  const saveDraft = () => { if (!globalOnly) void store.set("wheelAcceleration", draft, "global"); };
  return <section className="wheel-acceleration-settings">
    <h3>{t("settings.wheelAcceleration")}</h3>
    <p>{t("settings.wheelAccelerationHint")}</p>
    {globalOnly && <p className="wheel-global-hint">{t("settings.globalOnly")}</p>}
    <label className="preference-row"><span><strong>{t("settings.wheelAccelerationEnabled")}</strong></span><input type="checkbox" disabled={globalOnly} checked={draft.enabled} onChange={(event) => { const next = { ...draft, enabled: event.target.checked }; setDraft(next); void store.set("wheelAcceleration", next, "global"); }}/></label>
    {level === "advanced" && <><label className="preference-row"><span><strong>{t("settings.wheelStrength")}</strong></span><span className="wheel-range-control"><input aria-label={t("settings.wheelStrength")} type="range" min={1} max={10} step={1} disabled={globalOnly} value={draft.strength} onChange={(event) => updateDraft({ strength: Number(event.target.value) })} onPointerUp={saveDraft} onKeyUp={saveDraft} onBlur={saveDraft}/><output>{draft.strength}</output></span></label>
    <label className="preference-row"><span><strong>{t("settings.wheelMaximum")}</strong></span><span className="wheel-range-control"><input aria-label={t("settings.wheelMaximum")} type="range" min={2} max={8} step={0.5} disabled={globalOnly} value={draft.maxMultiplier} onChange={(event) => updateDraft({ maxMultiplier: Number(event.target.value) })} onPointerUp={saveDraft} onKeyUp={saveDraft} onBlur={saveDraft}/><output>{draft.maxMultiplier}×</output></span></label>
    <label className="preference-row"><span><strong>{t("settings.wheelDecay")}</strong></span><span className="wheel-range-control"><input aria-label={t("settings.wheelDecay")} type="range" min={150} max={1500} step={50} disabled={globalOnly} value={draft.decayMs} onChange={(event) => updateDraft({ decayMs: Number(event.target.value) })} onPointerUp={saveDraft} onKeyUp={saveDraft} onBlur={saveDraft}/><output>{draft.decayMs} ms</output></span></label></>}
  </section>;
}

function ImageSettingsPanel({ store, scope, level }: { store: ReturnType<typeof useSettings>; scope: "global" | "project"; level: SettingsLevel }) {
  const value = (scope === "global" ? store.global("images") : store.get("images")) as ImagePreferences;
  const save = (next: ImagePreferences) => void store.set("images", next, scope);
  const insert = (patch: Partial<ImagePreferences["defaultInsert"]>) => save({ ...value, defaultInsert: { ...value.defaultInsert, ...patch } });
  const multi = (patch: Partial<ImagePreferences["multiFigure"]>) => save({ ...value, multiFigure: { ...value.multiFigure, ...patch } });
  return <div className="image-settings"><h2>{t("settings.images")}</h2>
    {level === "basic" ? <SettingGroup title={t("settings.group.imageBasics")}>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.default_insertion")}</strong></span><select value={value.defaultInsert.type} onChange={(event) => insert({ type: event.target.value as "figure" | "inline" })}><option value="figure">{t("ui.SettingsDialog.figure_environment")}</option><option value="inline">{t("ui.SettingsDialog.inline_image")}</option></select></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.default_width")}</strong></span><input value={value.defaultInsert.width} onChange={(event) => insert({ width: event.target.value })}/></label>
    </SettingGroup> : <SettingGroup title={t("settings.group.imageAdvanced")}>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.project_image_directory")}</strong><small>{t("ui.SettingsDialog.imported_files_are_copied_here_existing_files")}</small></span><input value={value.defaultDirectory} onChange={(event) => save({ ...value, defaultDirectory: event.target.value })}/></label>
      <label className="preference-row"><span><strong>{t("ui.FigureInspector.alignment")}</strong></span><select value={value.defaultInsert.alignment} onChange={(event) => insert({ alignment: event.target.value as "left" | "center" | "right" })}><option value="left">{t("ui.FigureInspector.left")}</option><option value="center">{t("ui.FigureInspector.center")}</option><option value="right">{t("ui.FigureInspector.right")}</option></select></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.add_caption")}</strong></span><input type="checkbox" checked={value.defaultInsert.addCaption} onChange={(event) => insert({ addCaption: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>{t("preview.addLabel")}</strong></span><input type="checkbox" checked={value.defaultInsert.addLabel} onChange={(event) => insert({ addLabel: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>{t("ui.FigureInspector.placement")}</strong></span><input value={value.defaultInsert.placement} onChange={(event) => insert({ placement: event.target.value })}/></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.label_prefix")}</strong></span><input value={value.defaultInsert.labelPrefix} onChange={(event) => insert({ labelPrefix: event.target.value })}/></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.figure_editor")}</strong></span><select value={value.editor.defaultMode} onChange={(event) => save({ ...value, editor: { defaultMode: event.target.value as "gui" | "source" } })}><option value="gui">{t("ui.SettingsDialog.properties_gui")}</option><option value="source">{t("ui.SettingsDialog.latex_source")}</option></select></label>
      <h4>{t("ui.ImageInsertDialog.multiple_images")}</h4>
      <label className="preference-row"><span><strong>{t("ui.ImageInsertDialog.columns")}</strong></span><select value={String(value.multiFigure.defaultColumns)} onChange={(event) => multi({ defaultColumns: event.target.value === "auto" ? "auto" : Number(event.target.value) as 1 | 2 | 3 })}><option value="auto">{t("ui.SettingsDialog.auto")}</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.subfigure_width")}</strong></span><input value={value.multiFigure.subfigureWidth} onChange={(event) => multi({ subfigureWidth: event.target.value })}/></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.image_width")}</strong></span><input value={value.multiFigure.imageWidth} onChange={(event) => multi({ imageWidth: event.target.value })}/></label>
    </SettingGroup>}
  </div>;
}

function TableSettingsPanel({ store, scope, level }: { store: ReturnType<typeof useSettings>; scope: "global" | "project"; level: SettingsLevel }) {
  const value = (scope === "global" ? store.global("tables") : store.get("tables")) as TablePreferences;
  const save = (next: TablePreferences) => void store.set("tables", next, scope);
  const insert = (patch: Partial<TablePreferences["defaultInsert"]>) => save({ ...value, defaultInsert: { ...value.defaultInsert, ...patch } });
  const editing = (patch: Partial<TablePreferences["editing"]>) => save({ ...value, editing: { ...value.editing, ...patch } });
  return <div className="image-settings"><h2>{t("settings.tables")}</h2>
    {level === "basic" ? <SettingGroup title={t("settings.group.tableBasics")}>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.default_style")}</strong></span><select value={value.defaultStyle} onChange={(event) => save({ ...value, defaultStyle: event.target.value as TableStylePreset })}><option value="booktabs-three-line">{t("ui.SettingsDialog.academic_three_line")}</option><option value="grid">{t("ui.SettingsDialog.simple_grid")}</option><option value="horizontal">{t("ui.SettingsDialog.horizontal_lines")}</option><option value="plain">{t("ui.SettingsDialog.no_borders")}</option><option value="header-bottom">{t("ui.SettingsDialog.header_bottom")}</option></select></label>
    </SettingGroup> : <SettingGroup title={t("settings.group.tableAdvanced")}>
      <label className="preference-row"><span><strong>{t("ui.FigureInspector.alignment")}</strong></span><select value={value.defaultInsert.alignment} onChange={(event) => insert({ alignment: event.target.value as "left" | "center" | "right" })}><option value="left">{t("ui.FigureInspector.left")}</option><option value="center">{t("ui.FigureInspector.center")}</option><option value="right">{t("ui.FigureInspector.right")}</option></select></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.first_row_is_header")}</strong></span><input type="checkbox" checked={value.defaultInsert.headerRow} onChange={(event) => insert({ headerRow: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.add_caption")}</strong></span><input type="checkbox" checked={value.defaultInsert.addCaption} onChange={(event) => insert({ addCaption: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>{t("preview.addLabel")}</strong></span><input type="checkbox" checked={value.defaultInsert.addLabel} onChange={(event) => insert({ addLabel: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>{t("table.expandedEditor")}</strong></span><select value={value.editor.defaultMode} onChange={(event) => save({ ...value, editor: { defaultMode: event.target.value as "gui" | "source" } })}><option value="gui">{t("ui.SettingsDialog.properties_gui")}</option><option value="source">{t("ui.SettingsDialog.latex_source")}</option></select></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.float_placement")}</strong></span><input value={value.defaultInsert.placement} onChange={(event) => insert({ placement: event.target.value })}/></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.label_prefix")}</strong></span><input value={value.labelPrefix} onChange={(event) => save({ ...value, labelPrefix: event.target.value })}/></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.automatic_fixed_width_conversion")}</strong><small>{t("ui.SettingsDialog.allow_column_width_edits_to_convert_l")}</small></span><input type="checkbox" checked={value.editing.allowAutomaticColumnConversion} onChange={(event) => editing({ allowAutomaticColumnConversion: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>{t("ui.SettingsDialog.add_row_after_final_tab")}</strong></span><input type="checkbox" checked={value.editing.autoAddRowOnTab} onChange={(event) => editing({ autoAddRowOnTab: event.target.checked })}/></label>
    </SettingGroup>}
  </div>;
}

function SpellCheckPreferencesPanel({ store, scope }: { store: ReturnType<typeof useSettings>; scope: "global" | "project" }) {
  const [status, setStatus] = useState<SpellCheckStatus>();
  const mode = store.global("spellCheckMode");
  const language = store.global("spellCheckLanguage");
  useEffect(() => { void window.latexEditor!.spellcheck.status().then(setStatus).catch(() => setStatus(undefined)); }, []);
  const languages = [...new Set(["en-US", ...(status?.availableLanguages ?? []), language])].sort((a, b) => a.localeCompare(b));
  return <SettingGroup title={t("settings.group.spellcheckBasics")}>
    {scope === "project" && <p>{t("settings.globalOnly")}</p>}
    <label className="preference-row"><span><strong>{t("settings.spellcheckMode")}</strong><small>{t("settings.spellcheckModeHint")}</small></span><select disabled={scope === "project"} value={mode} onChange={(event) => void store.set("spellCheckMode", event.target.value as "auto" | "manual" | "disabled") }><option value="auto">{t("settings.spellcheckAuto")}</option><option value="manual">{t("settings.spellcheckManual")}</option><option value="disabled">{t("settings.spellcheckDisabled")}</option></select></label>
    {mode === "manual" && <label className="preference-row"><span><strong>{t("settings.spellcheckLanguage")}</strong><small>{t("settings.spellcheckLanguageHint")}</small></span><LanguageSelect disabled={scope === "project"} aria-label={t("settings.spellcheckLanguage")} value={language} languages={languages} onValueChange={value => void store.set("spellCheckLanguage", value)}/></label>}
  </SettingGroup>;
}

function SpellCheckSettingsPanel({ store, toolbarTarget }: { store: ReturnType<typeof useSettings>; toolbarTarget?: HTMLElement | null }) {
  const [status, setStatus] = useState<SpellCheckStatus>();
  const [catalog, setCatalog] = useState<DictionaryPackage[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string>();
  const [loadError, setLoadError] = useState("");
  const language = store.global("spellCheckLanguage");
  const reload = async (refresh = false) => {
    setLoading(true);
    setLoadError("");
    try {
      const api = window.latexEditor!.spellcheck;
      const [nextStatus, nextCatalog] = await Promise.all([api.status(), refresh ? api.refreshDictionaries() : api.listDictionaries()]);
      setStatus(nextStatus); setCatalog(nextCatalog);
    } catch (error) { setLoadError(String(error)); } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, []);
  const install = async (item: DictionaryPackage) => {
    setInstalling(item.id);
    try { await window.latexEditor!.spellcheck.installDictionary(item.id); await store.set("spellCheckLanguage", item.languageCode); await reload(); }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
    finally { setInstalling(undefined); }
  };
  const remove = async (item: DictionaryPackage) => {
    if (!window.confirm(t("settings.spellcheckRemoveConfirm", { name: item.displayName }))) return;
    setInstalling(item.id);
    try { await window.latexEditor!.spellcheck.removeDictionary(item.id); if (language === item.languageCode) await store.reset("spellCheckLanguage"); await reload(); }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
    finally { setInstalling(undefined); }
  };
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const otherLanguageNames: Record<string, string> = { "zh-CN": t("settings.spellcheckChinese"), "ja-JP": t("settings.spellcheckJapanese") };
  const matchesQuery = (item: DictionaryPackage, extraLabel = "") => !normalizedQuery || [extraLabel, item.id, item.languageCode, item.displayName, item.region ?? ""].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  const installed = catalog.filter((item) => item.installed && item.id !== "zh-CN" && item.id !== "ja-JP" && matchesQuery(item));
  const available = catalog.filter((item) => !item.installed && item.id !== "zh-CN" && item.id !== "ja-JP" && matchesQuery(item));
  const otherLanguageRules = catalog.filter((item) => (item.id === "zh-CN" || item.id === "ja-JP") && matchesQuery(item, otherLanguageNames[item.id]));
  const toolbar = <div className="manager-toolbar-actions"><button disabled={loading || Boolean(installing)} onClick={() => void reload(true)}>{t("settings.spellcheckRefresh")}</button></div>;
  return <div className="spellcheck-settings">
    {toolbarTarget !== undefined ? toolbarTarget && createPortal(toolbar, toolbarTarget) : <div className="spellcheck-settings-header">{toolbar}</div>}
    <div className="spellcheck-status-card"><div><strong>{t("settings.spellcheckProvider")}</strong><span>{status?.provider === "hunspell" ? "Hunspell (nspell)" : status?.provider ?? "—"}</span></div><div><strong>{t("settings.spellcheckPlatform")}</strong><span>{status?.platform ?? "—"}</span></div><div><strong>{t("settings.spellcheckAvailability")}</strong><span className={status?.available ? "status-ok" : "status-warning"}>{status ? (status.available ? t("settings.spellcheckAvailable") : t("settings.spellcheckUnavailable")) : t("settings.spellcheckChecking")}</span></div></div>
    <p className="spellcheck-settings-note">{t("settings.spellcheckElectronHint")}</p>
    {loadError && <p role="alert" className="inline-error">{loadError}</p>}
    <label className="spellcheck-language-search"><span className="visually-hidden">{t("settings.spellcheckSearch")}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("settings.spellcheckSearch")}/></label>
    {normalizedQuery && installed.length + available.length + otherLanguageRules.length === 0 && <p className="dictionary-no-results">{t("settings.spellcheckNoLanguages")}</p>}
    <details className="dictionary-section dictionary-section-other" open><summary className="dictionary-section-head"><h3>{t("settings.spellcheckOther")}</h3><span>{otherLanguageRules.length}</span></summary>{otherLanguageRules.map((item) => <div className="dictionary-row" key={item.id}><span><strong>{otherLanguageNames[item.id] ?? item.languageCode}</strong><small>{item.languageCode}</small></span>{item.installed && <em>{t("settings.spellcheckInstalledBadge")}</em>}<button disabled={loading || Boolean(installing)} onClick={() => void install(item)}>{installing === item.id ? t("settings.spellcheckInstalling") : item.installed ? t("settings.spellcheckRepair") : t("settings.spellcheckInstall")}</button>{item.installed && !isEnglishSpellDictionary(item.id, item.languageCode) && <button className="danger" disabled={loading || Boolean(installing)} onClick={() => void remove(item)}>{t("settings.spellcheckRemove")}</button>}</div>)}</details>
    <details className="dictionary-section" open><summary className="dictionary-section-head"><h3>{t("settings.spellcheckInstalled")}</h3><span>{installed.length}</span></summary>{installed.map((item) => <div className="dictionary-row" key={item.id}><span><strong>{languageName(item.languageCode, item.displayName)}</strong><small>{item.region ? `${item.languageCode} · ${item.region}` : item.languageCode}</small></span><em>{t("settings.spellcheckInstalledBadge")}</em>{!isEnglishSpellDictionary(item.id, item.languageCode) && <button className="danger" disabled={loading || Boolean(installing)} onClick={() => void remove(item)}>{t("settings.spellcheckRemove")}</button>}</div>)}</details>
    <details className="dictionary-section" open><summary className="dictionary-section-head"><h3>{t("settings.spellcheckAdd")}</h3><span>{available.length}</span></summary>{available.map((item) => <div className="dictionary-row" key={item.id}><span><strong>{languageName(item.languageCode, item.displayName)}</strong><small>{item.region ? `${item.languageCode} · ${item.region}` : item.languageCode}</small></span><button disabled={Boolean(installing)} onClick={() => void install(item)}>{installing === item.id ? t("settings.spellcheckInstalling") : t("settings.spellcheckInstall")}</button></div>)}{!available.length && !normalizedQuery && <p>{t("settings.spellcheckNoLanguages")}</p>}</details>
    {status?.dictionaryPath && <p>{t("settings.spellcheckPersonalDictionary")}: <code>{status.dictionaryPath}</code></p>}
    {status?.error && <p role="alert" className="inline-error">{status.error}</p>}
  </div>;
}

function ThemeBasicSettingsPanel({ store, scope, children }: { store: ReturnType<typeof useSettings>; scope: "global" | "project"; children: ReactNode }) {
  const [themes, setThemes] = useState<ThemeDefinition[]>([]);
  useEffect(() => { void window.latexEditor!.themes.list().then(setThemes).catch(() => setThemes([])); }, []);
  return <SettingGroup title={t("settings.group.appearanceBasics")}>
    {children}
    <label className="preference-row"><span><strong>{t("settings.activeTheme")}</strong><small>{t(scope === "project" ? "settings.globalOnly" : "settings.activeThemeHint")}</small></span><select disabled={scope === "project"} data-setting="theme" value={store.global("theme")} onChange={(event) => void store.set("theme", event.currentTarget.value, "global")}>{themes.map((theme) => <option key={theme.id} value={theme.id}>{themeName(theme)}</option>)}</select></label>
  </SettingGroup>;
}

function ThemeSettingsPanel({ store, showActiveTheme = true, toolbarTarget }: { store: ReturnType<typeof useSettings>; showActiveTheme?: boolean; toolbarTarget?: HTMLElement | null }) {
  const [themes, setThemes] = useState<ThemeDefinition[]>([]);
  const [directory, setDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reload = async () => {
    const api = window.latexEditor;
    if (!api) return;
    setThemes(await api.themes.list());
    setDirectory(await api.themes.directory());
  };
  useEffect(() => { void reload(); }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); await reload(); window.dispatchEvent(new Event("texweave-themes-changed")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const importFiles = () => void run(async () => {
    const paths = await window.latexEditor!.dialogs.pickThemeFiles();
    if (!paths.length) return;
    const imported = await window.latexEditor!.themes.importFiles(paths);
    const first = imported[0];
    if (first) await store.set("theme", first.id);
  });
  const importFolder = () => void run(async () => {
    const path = await window.latexEditor!.dialogs.pickFolder();
    if (!path) return;
    const imported = await window.latexEditor!.themes.importFolder(path);
    const first = imported[0];
    if (first) await store.set("theme", first.id);
  });
  const chooseDirectory = () => void run(async () => {
    const path = await window.latexEditor!.dialogs.pickFolder();
    if (path) await store.set("themeDirectory", path);
  });
  const resetDirectory = () => void run(async () => { await store.reset("themeDirectory"); });
  const remove = (theme: ThemeDefinition) => void run(async () => {
    if (!window.confirm(t("settings.themeDeleteConfirm", { name: theme.name }))) return;
    if (store.global("theme") === theme.id) await store.set("theme", "light");
    await window.latexEditor!.themes.remove(theme.id);
  });
  const builtIns = themes.filter((theme) => theme.source === "built-in");
  const userThemes = themes.filter((theme) => theme.source === "user");
  const themeRow = (theme: ThemeDefinition) => {
    const current = store.global("theme") === theme.id;
    return <div className="theme-catalog-row" key={theme.id}><span><strong>{themeName(theme)}</strong><small>{theme.filePath ?? theme.id}</small></span><button type="button" className={`theme-use-button${current ? " current" : ""}`} aria-pressed={current} disabled={current} onClick={() => void store.set("theme", theme.id)}>{current ? t("settings.themeCurrent") : t("settings.themeUse")}</button>{theme.source === "built-in" ? <em>{t("settings.themeBuiltInBadge")}</em> : <button className="danger" disabled={busy} onClick={() => remove(theme)}>{t("settings.themeDelete")}</button>}</div>;
  };
  const toolbar = <div className="manager-toolbar-actions"><button disabled={busy} onClick={() => void reload()}>{t("settings.themeRefresh")}</button><button disabled={busy} onClick={importFiles}>＋ {t("settings.themeImport")}</button><button disabled={busy} onClick={importFolder}>{t("settings.themeImportFolder")}</button></div>;
  return <div className="theme-settings-panel">
    {toolbarTarget !== undefined ? toolbarTarget && createPortal(toolbar, toolbarTarget) : <div className="theme-settings-header">{toolbar}</div>}
    {showActiveTheme && <label className="preference-row"><span><strong>{t("settings.activeTheme")}</strong><small>{t("settings.activeThemeHint")}</small></span><select data-setting="theme" value={store.global("theme")} onChange={(event) => void store.set("theme", event.currentTarget.value, "global")}>{[...builtIns, ...userThemes].map((theme) => <option key={theme.id} value={theme.id}>{themeName(theme)}</option>)}</select></label>}
    <div className="theme-directory"><strong>{t("settings.themeDirectory")}</strong><code>{directory || "—"}</code><div><button disabled={busy} onClick={chooseDirectory}>{t("settings.themeChooseDirectory")}</button><button disabled={busy || !store.global("themeDirectory")} onClick={resetDirectory}>{t("settings.themeResetDirectory")}</button></div></div>
    <section className="theme-catalog"><h3>{t("settings.themeBuiltIn")}</h3>{builtIns.map(themeRow)}<h3>{t("settings.themeCustom")}</h3>{userThemes.length ? userThemes.map(themeRow) : <p>{t("settings.themeNone")}</p>}</section>
    <ThemeColorSettings store={store}/>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}

function AISkillsSettingsPanel({ onEditingChange, toolbarTarget }: { onEditingChange(editing: boolean): void; toolbarTarget?: HTMLElement | null }) {
  const [skills, setSkills] = useState<AIProjectSkill[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = skills.find((skill) => skill.name === selectedName);
  const displayName = (skill: AIProjectSkill) => skill.name === "academic-writing" ? t("settings.aiSkillName.academicWriting") : skill.name;
  useEffect(() => { onEditingChange(editing); }, [editing, onEditingChange]);
  const reload = async () => {
    const next = await window.latexEditor!.ai.skills() ?? [];
    setSkills(next);
    setSelectedName((current) => next.some((skill) => skill.name === current) ? current : next[0]?.name ?? "");
  };
  useEffect(() => { void reload().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))); }, []);
  const startEdit = () => {
    if (!selected) return;
    setName(selected.name); setDraft(selected.content); setCreating(false); setEditing(true); setError("");
  };
  const startCreate = () => {
    setSelectedName("");
    setName("my-skill");
    setDraft("---\nname: my-skill\ndescription: Instructions for a TeXWeave project workflow.\n---\n\n# My skill\n\n- Add focused guidance for this workflow.\n");
    setCreating(true); setEditing(true); setError("");
  };
  const save = async () => {
    setBusy(true); setError("");
    try {
      const next = await window.latexEditor!.ai.saveSkill({ name, content: draft, create: creating }) ?? [];
      setSkills(next); setSelectedName(name); setEditing(false); setCreating(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const setSkillEnabled = async (skill: AIProjectSkill, enabled: boolean) => {
    setBusy(true); setError("");
    try {
      const next = await window.latexEditor!.ai.setSkillEnabled({ name: skill.name, enabled }) ?? [];
      setSkills(next);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const toolbar = <div className="manager-toolbar-actions"><button type="button" disabled={busy} onClick={startCreate}>＋ {t("settings.aiSkillsNew")}</button></div>;
  return <div className="ai-skills-settings">
    {toolbarTarget !== undefined ? toolbarTarget && createPortal(toolbar, toolbarTarget) : <div className="ai-skills-header">{toolbar}</div>}
    <div className="ai-skills-layout">
      <nav className="ai-skills-list" aria-label={t("settings.aiSkillsTitle")}>
        {skills.map((skill) => <div className={`ai-skill-row${selectedName === skill.name ? " active" : ""}`} key={skill.name}>
          <button type="button" className="ai-skill-select" aria-current={selectedName === skill.name ? "true" : undefined} onClick={() => { setSelectedName(skill.name); setEditing(false); setError(""); }}><strong>{displayName(skill)}</strong><small>{t(`settings.aiSkillSource.${skill.source}`)} · <span className={skill.enabled ? "enabled" : "disabled"}>{t(skill.enabled ? "settings.aiSkillsEnabled" : "settings.aiSkillsDisabled")}</span></small></button>
          <label className="ai-skill-toggle" title={`${displayName(skill)}: ${t(skill.enabled ? "settings.aiSkillsEnabled" : "settings.aiSkillsDisabled")}`}><input type="checkbox" aria-label={displayName(skill)} checked={skill.enabled} disabled={busy} onChange={(event) => void setSkillEnabled(skill, event.target.checked)}/><span aria-hidden="true"/></label>
        </div>)}
        {!skills.length && <p>{t("settings.aiSkillsEmpty")}</p>}
      </nav>
      <section className="ai-skills-editor">
        {editing ? <>
          <label><span>{t("settings.aiSkillsName")}</span><input value={name} disabled={!creating} onChange={(event) => setName(event.target.value)} spellCheck={false}/></label>
          <p className="ai-skills-hint">{t("settings.aiSkillsFormatHint")}</p>
          <textarea aria-label={t("settings.aiSkillsContent")} value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false}/>
          <div className="ai-skills-actions"><button type="button" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>{t("settings.aiSkillsCancel")}</button><button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? t("settings.aiSkillsSaving") : t("settings.aiSkillsSave")}</button></div>
        </> : selected ? <>
          <div className="ai-skills-detail-head"><div><span>{t(`settings.aiSkillSource.${selected.source}`)}</span><h3>{displayName(selected)}</h3></div><button type="button" onClick={startEdit}>{t("settings.aiSkillsEdit")}</button></div>
          <pre>{selected.content}</pre>
        </> : <p>{t("settings.aiSkillsSelect")}</p>}
      </section>
    </div>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}

function categoryForInitial(section: Section): SettingsCategory {
  const categories = new Set<string>(sectionGroups.flatMap((group) => [...group.sections]));
  if (categories.has(section)) return section as SettingsCategory;
  if (section === "language") return "general";
  if (["editor", "spellcheck", "shortcuts"].includes(section)) return "editor";
  if (["searchFilter", "preview"].includes(section)) return "filter";
  if (["images", "tables"].includes(section)) return "tools";
  if (["history", "styleResources", "environments", "previewCommands", "project"].includes(section)) return "projectBuild";
  if (["build", "compiler", "environment"].includes(section)) return "applicationBuild";
  if (section === "aiSkills") return "ai";
  return "general";
}

function managerForInitial(section: Section): ManagerId | undefined {
  if (section === "spellcheck") return "dictionaries";
  if (section === "shortcuts") return "shortcuts";
  if (section === "environments") return "blockEnvironments";
  if (section === "previewCommands") return "previewCommands";
  if (section === "styleResources") return "styleResources";
  if (section === "compiler" || section === "environment") return "toolchain";
  if (section === "aiSkills") return "aiSkills";
  return undefined;
}

interface SettingsReturnContext {
  category: SettingsCategory;
  level: SettingsLevel;
  scope: "global" | "project";
  scrollPosition: number;
}

export function SettingsDialog({ onClose, initial = "general" }: { onClose(): void; initial?: Section }) {
  const store = useSettings();
  const initialCategory = categoryForInitial(initial);
  const [category, setCategory] = useState<SettingsCategory>(initialCategory);
  const [level, setLevel] = useState<SettingsLevel>("basic");
  const [manager, setManager] = useState<ManagerId | undefined>(() => managerForInitial(initial));
  const [scope, setScope] = useState<"global" | "project">("global");
  const [search, setSearch] = useState("");
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [presetKind, setPresetKind] = useState<SettingsPresetKind>();
  const [managerRevision, setManagerRevision] = useState(0);
  const [managerDirty, setManagerDirty] = useState(false);
  const [environmentToolbarTarget, setEnvironmentToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [directiveToolbarTarget, setDirectiveToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [toolchainToolbarTarget, setToolchainToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [themeToolbarTarget, setThemeToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [dictionaryToolbarTarget, setDictionaryToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [aiSkillsToolbarTarget, setAiSkillsToolbarTarget] = useState<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const returnContextRef = useRef<SettingsReturnContext>({ category: initialCategory, level: "basic", scope: "global", scrollPosition: 0 });
  const pendingScrollRef = useRef<number | undefined>(undefined);
  const projectScopeAvailable = Boolean(store.projectId() && (projectSettingsByCategory[category]?.length ?? 0) > 0);
  const snapshot = store.snapshot();
  useEffect(() => { if (!projectScopeAvailable && scope === "project") setScope("global"); }, [projectScopeAvailable, scope]);
  useEffect(() => {
    if (manager) return;
    if (pendingScrollRef.current !== undefined) {
      mainRef.current?.scrollTo(0, pendingScrollRef.current);
      pendingScrollRef.current = undefined;
    } else {
      mainRef.current?.scrollTo(0, 0);
    }
  }, [manager, category, level]);

  const read = (key: PreferenceKey) => scope === "global" ? store.global(key) : store.get(key);
  const isModified = (key: PreferenceKey) => scope === "project"
    ? Object.prototype.hasOwnProperty.call(snapshot.project, key)
    : JSON.stringify(store.global(key)) !== JSON.stringify(preferenceDefaults[key]);
  const resetButton = (key: PreferenceKey, allowed = true) => isModified(key) && allowed
    ? <button type="button" className="preference-reset" aria-label={`${t("settings.reset")} ${t(`settings.${key}`)}`} onClick={() => void store.reset(key, scope)}>{t("settings.reset")}</button>
    : null;
  const row = (key: PreferenceKey, label: string, options?: Array<[string, string]>, numeric = false, limits = { min: 10, max: 32 }) => {
    const allowed = scope === "global" || projectPreferenceKeys.includes(key);
    const value = read(key);
    const hint = key === "hideBuildArtifacts" ? t("settings.hideBuildArtifactsHint") : key === "documentWordCompletion" ? t("settings.documentWordCompletionHint") : key === "autoPairSymbols" ? t("settings.autoPairSymbolsHint") : key === "mathPreviewOnHover" ? t("settings.mathPreviewOnHoverHint") : key === "showPreviewMetrics" ? t("settings.showPreviewMetricsHint") : key === "autoEnvironmentLabels" ? t("settings.autoEnvironmentLabelsHint") : key === "confirmPreviewEdits" ? t("settings.confirmPreviewEditsHint") : key === "warnIncompatibleEnvironmentConversion" ? t("settings.warnIncompatibleEnvironmentConversionHint") : undefined;
    return <label className="preference-row" data-setting={key} key={key}><span><strong>{t(label)}</strong>{hint && <small>{hint}</small>}{scope === "project" && allowed && !(key in snapshot.project) && <small>{t("settings.inherited")}</small>}</span>
      {key === "locale" || key === "blockNameLanguage" ? <LanguageSelect disabled={!allowed} aria-label={t(label)} value={String(value)} onValueChange={value => void store.set(key, value as typeof preferenceDefaults.locale, scope)}/> : options ? <select disabled={!allowed} value={String(value)} onChange={(event) => void store.set(key, numeric ? Number(event.target.value) : event.target.value as never, scope)}>{options.map(([id, labelKey]) => <option key={id} value={id}>{t(labelKey)}</option>)}</select> : numeric ? <input disabled={!allowed} type="number" min={limits.min} max={limits.max} step={1} value={Number(value)} onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= limits.min && next <= limits.max) void store.set(key, next, scope); }}/> : <input disabled={!allowed} type="checkbox" checked={Boolean(value)} onChange={(event) => void store.set(key, event.target.checked, scope)}/>}
      {resetButton(key, allowed)}</label>;
  };
  const configured = read("environments") as EnvironmentDefinition[];
  const configuredDirectives = read("previewDirectives") as PreviewDirectiveDefinition[];
  const resetKeys = async (keys: PreferenceKey[]) => {
    for (const key of keys) if (scope === "global" || projectPreferenceKeys.includes(key)) await store.reset(key, scope);
  };
  const requestClose = () => {
    if (managerDirty && !window.confirm(t("settings.managerUnsavedConfirm"))) return;
    setManagerDirty(false);
    onClose();
  };
  const openManager = (id: ManagerId, fromCategory = category) => {
    returnContextRef.current = { category: fromCategory, level, scope, scrollPosition: mainRef.current?.scrollTop ?? 0 };
    setSearch(""); setManagerDirty(false); setManager(id);
  };
  const backToSettings = () => {
    if (managerDirty && !window.confirm(t("settings.managerUnsavedConfirm"))) return;
    const context = returnContextRef.current;
    pendingScrollRef.current = context.scrollPosition;
    setManagerDirty(false); setManager(undefined); setCategory(context.category); setLevel(context.level); setScope(context.scope); setSearch("");
  };
  const navigateCategory = (next: SettingsCategory) => {
    if (manager && managerDirty && !window.confirm(t("settings.managerUnsavedConfirm"))) return;
    setManager(undefined); setManagerDirty(false); setSearch(""); setCategory(next);
  };
  const filteredSearchEntries = search.trim() ? searchEntries.filter((entry) => {
    const title = entry.titleKey ? t(entry.titleKey) : entry.title ?? entry.id;
    const haystack = `${title} ${t(`settings.category.${entry.category}`)} ${entry.keywords?.join(" ") ?? ""}`.toLocaleLowerCase();
    return haystack.includes(search.trim().toLocaleLowerCase());
  }) : [];
  const selectSearchEntry = (entry: typeof searchEntries[number]) => {
    if (entry.manager) openManager(entry.manager, entry.category);
    else { setManager(undefined); setCategory(entry.category); setLevel(entry.level === "advanced" ? "advanced" : "basic"); setSearch(""); }
  };

  const renderCategory = () => {
    if (category === "general") return <div className="settings-page"><h2>{t("settings.category.general")}</h2>
            {level === "basic" && <SettingGroup title={t("settings.group.generalBasics")}>
        {row("autoSave", "settings.autoSave", [["off", "settings.off"], ["afterDelay", "settings.afterDelay"]])}{row("autoSaveDelaySeconds", "settings.autoSaveDelaySeconds", undefined, true, { min: 1, max: 3600 })}{row("hideBuildArtifacts", "settings.hideBuildArtifacts")}{row("restoreProject", "settings.restore")}{row("maximize", "settings.maximize")}
        {row("sidePanelDisplay", "settings.sidePanelDisplay", [["overlay", "settings.sidePanelOverlay"], ["push", "settings.sidePanelPush"]])}{row("locale", "settings.language")}
      </SettingGroup>}
      {level === "basic" && <SettingGroup title={t("settings.blockNames")}><p>{t("settings.blockNamesHint")}</p>{row("fixedBlockNameLanguage", "settings.fixedBlockNameLanguage")}{row("blockNameLanguage", "settings.blockNameLanguage")}</SettingGroup>}
      <WheelAccelerationSettingsPanel store={store} scope={scope} level={level}/>
      {level === "advanced" && <button type="button" className="settings-presets-entry" onClick={() => setPresetKind("settings")}><strong>{t("settingsPresets.title")}</strong><span>›</span></button>}
    </div>;
    if (category === "appearance") return <div className="settings-page"><h2>{t("settings.category.appearance")}</h2>{level === "basic" ? <ThemeBasicSettingsPanel store={store} scope={scope}>{row("fontSize", "settings.fontSize", undefined, true)}{row("tabSize", "settings.tabSize", [["2", "2"], ["4", "4"], ["8", "8"]], true)}</ThemeBasicSettingsPanel> : <ManagerEntry manager="themes" title={t(managerDefinitions.themes.title)} description={t(managerDefinitions.themes.description)} onOpen={() => openManager("themes")}/>}</div>;
    if (category === "editor") return <div className="settings-page"><h2>{t("settings.category.editor")}</h2>{level === "basic" ? <><SettingGroup title={t("settings.group.editorBasics")}>{row("wordWrap", "settings.wordWrap")}{row("sourceMinimap", "settings.sourceMinimap")}{row("autoPairSymbols", "settings.autoPairSymbols")}{row("documentWordCompletion", "settings.documentWordCompletion")}{row("mathPreviewOnHover", "settings.mathPreviewOnHover")}{row("confirmPreviewEdits", "settings.confirmPreviewEdits")}</SettingGroup><SpellCheckPreferencesPanel store={store} scope={scope}/><ManagerEntry manager="shortcuts" title={t(managerDefinitions.shortcuts.title)} description={t(managerDefinitions.shortcuts.description)} onOpen={() => openManager("shortcuts")}/><ManagerEntry manager="dictionaries" title={t(managerDefinitions.dictionaries.title)} description={t(managerDefinitions.dictionaries.description)} onOpen={() => openManager("dictionaries")}/></> : <SettingGroup title={t("settings.group.editorAdvanced")}>{row("autoEnvironmentLabels", "settings.autoEnvironmentLabels")}{row("warnIncompatibleEnvironmentConversion", "settings.warnIncompatibleEnvironmentConversion")}{row("showPreviewMetrics", "settings.showPreviewMetrics")}</SettingGroup>}</div>;
    if (category === "tools") return <div className="settings-page"><h2>{t("settings.category.tools")}</h2><ImageSettingsPanel store={store} scope={scope} level={level}/><TableSettingsPanel store={store} scope={scope} level={level}/></div>;
    if (category === "filter") return <div className="settings-page"><h2>{t("settings.category.filter")}</h2>{level === "basic" && <SettingGroup title={t("settings.group.filterBasics")}><p>{t("settings.filterGroupsHint")}</p>{scope === "project" && <p>{t("settings.globalOnly")}</p>}{(["blockType", "location", "file", "properties"] as const).map((group) => { const visible = store.global("visibleFilterGroups"); return <label className="preference-row" key={group}><span><strong>{t(`filter.${group}`)}</strong></span><input type="checkbox" disabled={scope === "project"} checked={visible.includes(group)} onChange={(event) => void store.set("visibleFilterGroups", event.target.checked ? [...visible, group] : visible.filter((item) => item !== group))}/></label>; })}</SettingGroup>}</div>;
    if (category === "projectBuild") return <div className="settings-page"><h2>{t("settings.category.projectBuild")}</h2><HistorySettingsPanel store={store} scope={scope} level={level}/>{level === "basic" ? <SettingGroup title={t("settings.group.projectBuild")}>{row("pdfFollowActiveTex", "settings.pdfFollowActiveTex")}<p>{t("settings.mainFileHint")}</p></SettingGroup> : <>{(["blockEnvironments", "previewCommands", "styleResources"] as const).map(id => <ManagerEntry key={id} manager={id} title={t(managerDefinitions[id].title)} description={t(managerDefinitions[id].description)} onOpen={() => openManager(id)}/>)}</>}</div>;
    if (category === "applicationBuild") return <div className="settings-page"><h2>{t("settings.category.applicationBuild")}</h2>{level === "basic" ? <><SettingGroup title={t("settings.group.buildBasics")}><div className="preference-row"><span><strong>{t("settings.defaultProjectDirectory")}</strong><small>{t(scope === "project" ? "settings.globalOnly" : "settings.defaultProjectDirectoryHint")}</small></span><div className="default-project-directory-control"><input aria-label={t("settings.defaultProjectDirectory")} disabled={scope !== "global"} value={store.global("defaultProjectDirectory")} onChange={(event) => void store.set("defaultProjectDirectory", event.target.value)}/><button type="button" disabled={scope !== "global"} onClick={() => { void window.latexEditor?.dialogs.pickFolder().then(folder => { if (folder) void store.set("defaultProjectDirectory", folder); }); }}>{t("project.browse")}</button>{resetButton("defaultProjectDirectory", scope === "global")}</div></div>{row("engine", "settings.engine", [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"]])}</SettingGroup><ManagerEntry manager="toolchain" title={t(managerDefinitions.toolchain.title)} description={t(managerDefinitions.toolchain.description)} onOpen={() => openManager("toolchain")}/></> : <ProjectCacheSettingsPanel/>}</div>;
    return <div className="settings-page"><h2>{t("settings.category.ai")}</h2>{level === "basic" ? <SettingGroup title={t("settings.group.aiBasics")}><CodexEnvironmentSettings/><p>{t("settings.aiPrivacyHint")}</p>{row("aiDefaultMode", "settings.aiDefaultMode", [["chat", "ai.copilot"], ["codex", "ai.codex"]])}{row("aiShowTokenUsage", "settings.aiShowTokenUsage")}{row("aiPermissionMode", "settings.aiPermissionMode", [["ask", "ai.permission.ask"], ["auto", "ai.permission.auto"], ["full", "ai.permission.full"]])}<div className="ai-phase-card"><strong>{t("settings.aiChangeReview")}</strong><p>{t("settings.aiChangeReviewDetails")}</p></div></SettingGroup> : <ManagerEntry manager="aiSkills" title={t(managerDefinitions.aiSkills.title)} description={t(managerDefinitions.aiSkills.description)} onOpen={() => openManager("aiSkills")}/>}</div>;
  };

  const renderManager = () => {
    if (!manager) return null;
    if (manager === "themes") return <ThemeSettingsPanel store={store} showActiveTheme={false} toolbarTarget={themeToolbarTarget}/>;
    if (manager === "dictionaries") return <SpellCheckSettingsPanel store={store} toolbarTarget={dictionaryToolbarTarget}/>;
    if (manager === "shortcuts") return <ShortcutManager store={store} scope={scope}/>;
    if (manager === "blockEnvironments") return <div className="settings-environments"><EnvironmentManager definitions={configured.length ? includeNewBuiltInEnvironments(configured) : DEFAULT_ENVIRONMENTS} onChange={(next) => void store.set("environments", next, scope)} toolbarTarget={environmentToolbarTarget}/></div>;
    if (manager === "previewCommands") return <DirectiveManager definitions={includeNewBuiltInDirectives(configuredDirectives)} onChange={(next) => void store.set("previewDirectives", next, scope)} toolbarTarget={directiveToolbarTarget}/>;
    if (manager === "styleResources") return <StyleResourcesManager toolbarTarget={null}/>;
    if (manager === "toolchain") return <LatexToolchainSettingsPanel store={store} toolbarTarget={toolchainToolbarTarget}/>;
    return <AISkillsSettingsPanel onEditingChange={setManagerDirty} toolbarTarget={aiSkillsToolbarTarget}/>;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (overflowOpen) setOverflowOpen(false);
      else if (manager) backToSettings();
      else requestClose();
    };
    const onPointerDown = (event: PointerEvent) => { if (overflowOpen && !overflowRef.current?.contains(event.target as Node)) setOverflowOpen(false); };
    window.addEventListener("keydown", onKeyDown); window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("pointerdown", onPointerDown); };
  }, [overflowOpen, manager, managerDirty, onClose]);


  return <>{presetKind && <SettingsPresetDialog kind={presetKind} scope={presetKind !== "settings" && ["shortcuts", "blockEnvironments", "previewCommands"].includes(presetKind) ? scope : "global"} title={`${t("settingsPresets.title")}${presetKind === "settings" ? "" : ` · ${t(managerDefinitions[presetKind].title)}`}`} onClose={() => setPresetKind(undefined)} onApplied={() => { setManagerDirty(false); setManagerRevision(value => value + 1); }}/>}<div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}><section className={`preferences-dialog${manager ? " preferences-dialog-manager" : ""}`} role="dialog" aria-modal="true" aria-label={t("activity.settings")}>
    {manager ? <>
      <header className={`settings-manager-dialog-header${manager === "styleResources" ? " settings-manager-style-resources-header" : manager === "blockEnvironments" || manager === "previewCommands" ? " settings-manager-block-environments-header" : manager === "toolchain" ? " settings-manager-toolchain-header" : ["themes", "dictionaries", "shortcuts", "aiSkills"].includes(manager) ? " settings-manager-simple-header" : ""}`}>
        <button type="button" className="settings-manager-return" aria-label={t("settings.backToSettings")} title={t("settings.backToSettings")} onClick={backToSettings}><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 12H5m7 7-7-7 7-7"/></svg></button>
        {manager === "styleResources" && <h1 className="settings-manager-dialog-title">{t("resource.title")}</h1>}
        {manager === "themes" && <h1 className="settings-manager-dialog-title">{t("settings.theme")}</h1>}
        {manager === "dictionaries" && <h1 className="settings-manager-dialog-title">{t("settings.spellcheck")}</h1>}
        {manager === "shortcuts" && <h1 className="settings-manager-dialog-title">{t("settings.manager.shortcuts")}</h1>}
        {manager === "aiSkills" && <h1 className="settings-manager-dialog-title">{t("settings.aiSkillsTitle")}</h1>}
        {manager === "blockEnvironments" && <h1 className="settings-manager-dialog-title">{t("environment.manager")}</h1>}
        {manager === "previewCommands" && <h1 className="settings-manager-dialog-title">{t("settings.manager.previewCommands")}</h1>}
        {manager === "toolchain" && <h1 className="settings-manager-dialog-title">{t("settings.localToolchain")}</h1>}
        {manager === "blockEnvironments" && <div className="settings-manager-header-tools"><div className="environment-manager-toolbar-portal" ref={setEnvironmentToolbarTarget}/>{projectScopeAvailable && <select aria-label={t("settings.scope")} value={scope} onChange={(event) => setScope(event.target.value as "global" | "project")}><option value="global">{t("settings.global")}</option><option value="project">{t("settings.project")}</option></select>}</div>}
        {manager === "previewCommands" && <div className="settings-manager-header-tools"><div className="manager-toolbar-portal" ref={setDirectiveToolbarTarget}/>{projectScopeAvailable && <select aria-label={t("settings.scope")} value={scope} onChange={(event) => setScope(event.target.value as "global" | "project")}><option value="global">{t("settings.global")}</option><option value="project">{t("settings.project")}</option></select>}</div>}
        {manager === "toolchain" && <div className="settings-manager-header-tools"><div className="toolchain-manager-toolbar-portal" ref={setToolchainToolbarTarget}/></div>}
        {manager === "themes" && <div className="settings-manager-header-tools"><div className="manager-toolbar-portal" ref={setThemeToolbarTarget}/></div>}
        {manager === "dictionaries" && <div className="settings-manager-header-tools"><div className="manager-toolbar-portal" ref={setDictionaryToolbarTarget}/></div>}
        {manager === "shortcuts" && <div className="settings-manager-header-tools">{projectScopeAvailable && <select aria-label={t("settings.scope")} value={scope} onChange={(event) => setScope(event.target.value as "global" | "project")}><option value="global">{t("settings.global")}</option><option value="project">{t("settings.project")}</option></select>}</div>}
        {manager === "aiSkills" && <div className="settings-manager-header-tools"><div className="manager-toolbar-portal" ref={setAiSkillsToolbarTarget}/></div>}
        {manager !== "styleResources" && manager !== "toolchain" && <button type="button" className="manager-presets-button" title={t("settingsPresets.title")} onClick={() => { if (!managerDirty || window.confirm(t("settings.managerUnsavedConfirm"))) setPresetKind(manager); }}>{t("settingsPresets.title")}</button>}
      </header>
      <main className={`settings-manager-dialog-main${manager === "blockEnvironments" ? " settings-manager-environments" : manager === "previewCommands" ? " settings-manager-directives" : manager === "styleResources" ? " settings-manager-style-resources" : manager === "shortcuts" ? " settings-manager-shortcuts" : ""}`} ref={mainRef}>
        <div className="settings-manager-page" key={managerRevision}>
          {manager !== "blockEnvironments" && manager !== "previewCommands" && manager !== "shortcuts" && projectScopeAvailable && <p className="settings-manager-scope-note">{t("settings.globalOnly")}</p>}
          {renderManager()}
        </div>
      </main>
    </> : <>
      <header className="settings-dialog-header"><h1>{t("activity.settings")}</h1>
        <label className="settings-search"><span className="visually-hidden">{t("settings.searchPlaceholder")}</span><span className="settings-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.2 4.2"/></svg></span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("settings.searchPlaceholder")}/>{search && <button type="button" aria-label={t("settings.clearSearch")} onClick={() => setSearch("")}>X</button>}</label>
        {projectScopeAvailable && <select aria-label={t("settings.scope")} value={scope} onChange={(event) => setScope(event.target.value as "global" | "project")}><option value="global">{t("settings.global")}</option><option value="project">{t("settings.project")}</option></select>}
        <div className="settings-level-switch" role="group" aria-label={t("settings.settingLevel")}><button type="button" className={level === "basic" ? "active" : ""} onClick={() => setLevel("basic")}>{t("settings.basic")}</button><button type="button" className={level === "advanced" ? "active" : ""} onClick={() => setLevel("advanced")}>{t("settings.advanced")}</button></div>
        <div className="settings-header-actions">
          <div className="settings-overflow" ref={overflowRef}>
            <button type="button" className="settings-overflow-trigger" aria-label={t("settings.moreActions")} aria-expanded={overflowOpen} onClick={() => setOverflowOpen((open) => !open)}>...</button>
            {overflowOpen && <div className="settings-overflow-menu">
              <button type="button" onClick={() => { setOverflowOpen(false); void resetKeys(categoryPreferences[category]); }}>{t("settings.resetSection")}</button>
              <button type="button" onClick={() => { setOverflowOpen(false); if (window.confirm(t("settings.restoreDefaultsConfirm"))) void resetKeys(scope === "project" ? projectPreferenceKeys : Object.keys(preferenceDefaults) as PreferenceKey[]); }}>{t("settings.resetAll")}</button>
            </div>}
          </div>
          <button className="settings-close" aria-label={t("common.close")} onClick={requestClose}>X</button>
        </div>
      </header>
      <div className="preferences-body"><nav aria-label={t("activity.settings")}>{sectionGroups.map((group) => <div className="settings-nav-group" key={group.label}><span>{t(group.label)}</span>{group.sections.map((item) => <button type="button" data-section={item} aria-current={category === item ? "page" : undefined} className={category === item ? "active" : ""} key={item} onClick={() => navigateCategory(item)}>{t(`settings.category.${item}`)}</button>)}</div>)}</nav>
        <main ref={mainRef}>
        {search.trim() ? (
          <div className="settings-search-results">
            <h2>{t("settings.searchResults")}</h2>
            {filteredSearchEntries.length ? filteredSearchEntries.map((entry) => {
              const title = entry.titleKey ? t(entry.titleKey) : entry.title ?? entry.id;
              return <button type="button" className="settings-search-result" key={entry.id} onClick={() => selectSearchEntry(entry)}>
                <span><strong>{title}</strong><small>{t(`settings.category.${entry.category}`)}</small></span>
                {entry.level === "advanced" && <em>{t("settings.advanced")}</em>}
                {entry.level === "manager" && <em>{t("settings.manager")}</em>}
              </button>;
            }) : <p>{t("settings.noSearchResults")}</p>}
          </div>
        ) : (
          <>
            {renderCategory()}
            {level === "advanced" && !searchEntries.some((entry) => entry.category === category && entry.level !== "basic") && <p className="settings-level-hint">{t("settings.noAdvancedInCategory")}</p>}
          </>
        )}
        {store.error() && <p role="alert">{t("settings.saveFailed")} {store.error()}</p>}
        </main>
      </div>
      <footer><span className="settings-save-status"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m4 10.5 4 4 8-9"/></svg>{t("settings.saved")}</span>{scope === "project" && <span>{t("settings.projectResetHint")}</span>}</footer>
    </>}
  </section></div></>;
}
