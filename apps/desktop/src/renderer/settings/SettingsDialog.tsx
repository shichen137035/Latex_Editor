import { useEffect, useRef, useState, type ReactNode } from "react";
import { preferenceDefaults, projectPreferenceKeys, type AIProjectSkill, type DictionaryPackage, type HistoryPreferences, type ImagePreferences, type LatexToolchain, type PreferenceKey, type StyleResource, type TablePreferences, type TableStylePreset, type ThemeDefinition, type WheelAccelerationPreferences } from "@latex-editor/contracts";
import type { SpellCheckStatus } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { EnvironmentManager } from "../preview/EnvironmentManager.js";
import { DEFAULT_ENVIRONMENTS, includeNewBuiltInEnvironments } from "../preview/environments.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { useSettings } from "./service.js";
import { bindings, commandContexts, commandLabels, defaultBindings, displayBinding, eventBinding, validBinding, type CommandId } from "./commands.js";
import "./settings.css";

const sectionGroups = [
  { label: "settings.group.general", sections: ["general", "appearance"] },
  { label: "settings.group.editor", sections: ["editor", "tools", "filter"] },
  { label: "settings.group.projectBuild", sections: ["projectBuild"] },
  { label: "settings.group.ai", sections: ["ai"] }
] as const;
export type SettingsCategory = typeof sectionGroups[number]["sections"][number];
export type SettingsSection = SettingsCategory | "language" | "searchFilter" | "preview" | "project" | "build" | "shortcuts" | "history" | "environment" | "compiler" | "spellcheck" | "aiSkills" | "environments" | "styleResources" | "images" | "tables";
type SettingsLevel = "basic" | "advanced";
type ManagerId = "themes" | "dictionaries" | "shortcuts" | "blockEnvironments" | "styleResources" | "toolchain" | "aiSkills";
type Section = SettingsSection;

const managerDefinitions: Record<ManagerId, { category: SettingsCategory; title: string; description: string; keywords: string[] }> = {
  themes: { category: "appearance", title: "settings.manager.themes", description: "settings.manager.themesHint", keywords: ["theme", "css", "color", "appearance"] },
  dictionaries: { category: "editor", title: "settings.manager.dictionaries", description: "settings.manager.dictionariesHint", keywords: ["spellcheck", "dictionary", "language", "words"] },
  shortcuts: { category: "editor", title: "settings.manager.shortcuts", description: "settings.manager.shortcutsHint", keywords: ["keyboard", "keybinding", "hotkey", "shortcut"] },
  blockEnvironments: { category: "projectBuild", title: "settings.manager.blockEnvironments", description: "settings.manager.blockEnvironmentsHint", keywords: ["block", "environment", "preview", "semantic"] },
  styleResources: { category: "projectBuild", title: "settings.manager.styleResources", description: "settings.manager.styleResourcesHint", keywords: ["style", "resource", "sty", "cls", "latex"] },
  toolchain: { category: "projectBuild", title: "settings.manager.toolchain", description: "settings.manager.toolchainHint", keywords: ["latex", "engine", "compiler", "pdflatex", "xelatex", "lualatex", "bibtex", "biber", "makeindex"] },
  aiSkills: { category: "ai", title: "settings.manager.aiSkills", description: "settings.manager.aiSkillsHint", keywords: ["ai", "skill", "instruction", "workflow"] }
};

const categoryPreferences: Record<SettingsCategory, PreferenceKey[]> = {
  general: ["autoSave", "hideBuildArtifacts", "restoreProject", "maximize", "sidePanelDisplay", "locale", "wheelAcceleration"],
  appearance: ["theme", "themeDirectory", "fontSize", "tabSize"],
  editor: ["wordWrap", "autoPairSymbols", "mathPreviewOnHover", "documentWordCompletion", "autoEnvironmentLabels", "confirmPreviewEdits", "warnIncompatibleEnvironmentConversion", "spellCheckMode", "spellCheckLanguage", "spellCheckActiveLanguages", "keybindings", "referenceLinkModifier"],
  filter: ["visibleFilterGroups"],
  tools: ["images", "tables"],
  projectBuild: ["history", "environments", "engine"],
  ai: ["aiDefaultMode", "aiPermissionMode", "aiReasoningEffort", "aiCopilotReasoningEffort"]
};

const searchEntries: Array<{ id: string; category: SettingsCategory; level: SettingsLevel | "manager"; titleKey?: string; title?: string; keywords?: string[]; manager?: ManagerId }> = [
  ...(["autoSave", "hideBuildArtifacts", "restore", "maximize", "sidePanelDisplay", "language", "wheelAccelerationEnabled"] as const).map((key) => ({ id: key, category: "general" as const, level: "basic" as const, titleKey: key === "restore" ? "settings.restore" : key === "language" ? "settings.language" : key === "wheelAccelerationEnabled" ? "settings.wheelAccelerationEnabled" : `settings.${key}`, keywords: ["startup", "save", "scroll"] })),
  ...(["wheelStrength", "wheelMaximum", "wheelDecay"] as const).map((key) => ({ id: key, category: "general" as const, level: "advanced" as const, titleKey: `settings.${key}`, keywords: ["scroll", "acceleration", "speed"] })),
  ...(["fontSize", "tabSize"] as const).map((key) => ({ id: key, category: "appearance" as const, level: "basic" as const, titleKey: `settings.${key}`, keywords: ["font", "text", "tab", "indent", "appearance"] })),
  { id: "theme", category: "appearance", level: "basic", titleKey: "settings.activeTheme", keywords: ["colors", "appearance"] },
  { id: "themes", category: "appearance", level: "manager", manager: "themes", titleKey: managerDefinitions.themes.title, keywords: managerDefinitions.themes.keywords },
  ...(["wordWrap", "autoPairSymbols", "mathPreviewOnHover", "documentWordCompletion", "confirmPreviewEdits"] as const).map((key) => ({ id: key, category: "editor" as const, level: "basic" as const, titleKey: `settings.${key}`, keywords: ["typing", "completion", "math", "preview"] })),
  ...(["autoEnvironmentLabels", "warnIncompatibleEnvironmentConversion"] as const).map((key) => ({ id: key, category: "editor" as const, level: "advanced" as const, titleKey: `settings.${key}`, keywords: ["label", "environment", "conversion"] })),
  { id: "spellCheckMode", category: "editor", level: "basic", titleKey: "settings.spellcheckMode", keywords: ["spelling", "language"] },
  { id: "spellCheckLanguage", category: "editor", level: "basic", titleKey: "settings.spellcheckLanguage", keywords: ["spelling", "dictionary"] },
  { id: "dictionaries", category: "editor", level: "manager", manager: "dictionaries", titleKey: managerDefinitions.dictionaries.title, keywords: managerDefinitions.dictionaries.keywords },
  { id: "shortcuts", category: "editor", level: "manager", manager: "shortcuts", titleKey: managerDefinitions.shortcuts.title, keywords: managerDefinitions.shortcuts.keywords },
  ...(["blockType", "location", "file", "properties"] as const).map((key) => ({ id: `filter-${key}`, category: "filter" as const, level: "basic" as const, titleKey: `filter.${key}`, keywords: ["search", "filter", "structure"] })),
  { id: "blockEnvironments", category: "projectBuild", level: "manager", manager: "blockEnvironments", titleKey: managerDefinitions.blockEnvironments.title, keywords: managerDefinitions.blockEnvironments.keywords },
  ...(["imageInsertion", "imageWidth"] as const).map((key) => ({ id: key, category: "tools" as const, level: "basic" as const, title: key.replace("image", "Image "), keywords: ["figure", "graphic", "picture"] })),
  ...(["imageDirectory", "imageAlignment", "imageCaption", "imageLabel", "imagePlacement", "imageLabelPrefix", "imageEditor", "multipleImages"] as const).map((key) => ({ id: key, category: "tools" as const, level: "advanced" as const, title: key.replace(/([A-Z])/g, " $1"), keywords: ["figure", "graphic", "latex"] })),
  { id: "tableStyle", category: "tools", level: "basic", title: "Table style", keywords: ["tabular", "grid"] },
  ...(["tableAlignment", "tableHeader", "tableCaption", "tableLabel", "tableEditor", "tablePlacement", "tableLabelPrefix", "tableWidthConversion", "tableAddRow"] as const).map((key) => ({ id: key, category: "tools" as const, level: "advanced" as const, title: key.replace(/([A-Z])/g, " $1"), keywords: ["tabular", "latex"] })),
  ...(["autoSnapshot", "beforeRestore", "beforeLargeDelete"] as const).map((key) => ({ id: key, category: "projectBuild" as const, level: "basic" as const, titleKey: `history.${key}`, keywords: ["history", "version", "backup"] })),
  ...(["snapshotInterval", "maxSnapshots", "retentionDays"] as const).map((key) => ({ id: key, category: "projectBuild" as const, level: "advanced" as const, titleKey: `history.${key === "snapshotInterval" ? "intervalMinutes" : key}`, keywords: ["history", "version", "retention", "cleanup"] })),
  { id: "styleResources", category: "projectBuild", level: "manager", manager: "styleResources", titleKey: managerDefinitions.styleResources.title, keywords: managerDefinitions.styleResources.keywords },
  { id: "engine", category: "projectBuild", level: "basic", titleKey: "settings.engine", keywords: ["compiler", "pdflatex", "xelatex", "lualatex"] },
  { id: "toolchain", category: "projectBuild", level: "manager", manager: "toolchain", titleKey: managerDefinitions.toolchain.title, keywords: managerDefinitions.toolchain.keywords },
  { id: "aiDefaultMode", category: "ai", level: "basic", titleKey: "settings.aiDefaultMode", keywords: ["copilot", "codex"] },
  { id: "aiPermissionMode", category: "ai", level: "basic", titleKey: "settings.aiPermissionMode", keywords: ["permission", "access"] },
  { id: "aiSkills", category: "ai", level: "manager", manager: "aiSkills", titleKey: managerDefinitions.aiSkills.title, keywords: managerDefinitions.aiSkills.keywords }
];

const projectSettingsByCategory: Partial<Record<SettingsCategory, PreferenceKey[]>> = {
  general: ["autoSave"],
  appearance: ["fontSize", "tabSize"],
  editor: ["wordWrap", "autoPairSymbols", "mathPreviewOnHover", "confirmPreviewEdits"],
  tools: ["images", "tables"],
  projectBuild: ["history", "environments", "engine"]
};

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

function ManagerEntry({ title, description, onOpen }: { title: string; description: string; onOpen(): void }) {
  return <div className="settings-manager-entry"><div><strong>{title}</strong><small>{description}</small></div><button type="button" onClick={onOpen}>{t("settings.manage")}</button></div>;
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
  return <div className="image-settings"><h2>{t("settings.images")}</h2><p>Defaults for imported images and generated LaTeX. Project values can override these settings.</p>
    {level === "basic" ? <SettingGroup title={t("settings.group.imageBasics")}>
      <label className="preference-row"><span><strong>Default insertion</strong></span><select value={value.defaultInsert.type} onChange={(event) => insert({ type: event.target.value as "figure" | "inline" })}><option value="figure">Figure environment</option><option value="inline">Inline image</option></select></label>
      <label className="preference-row"><span><strong>Default width</strong></span><input value={value.defaultInsert.width} onChange={(event) => insert({ width: event.target.value })}/></label>
    </SettingGroup> : <SettingGroup title={t("settings.group.imageAdvanced")}>
      <label className="preference-row"><span><strong>Project image directory</strong><small>Imported files are copied here; existing files are never overwritten.</small></span><input value={value.defaultDirectory} onChange={(event) => save({ ...value, defaultDirectory: event.target.value })}/></label>
      <label className="preference-row"><span><strong>Alignment</strong></span><select value={value.defaultInsert.alignment} onChange={(event) => insert({ alignment: event.target.value as "left" | "center" | "right" })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label className="preference-row"><span><strong>Add caption</strong></span><input type="checkbox" checked={value.defaultInsert.addCaption} onChange={(event) => insert({ addCaption: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>Add label</strong></span><input type="checkbox" checked={value.defaultInsert.addLabel} onChange={(event) => insert({ addLabel: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>Placement</strong></span><input value={value.defaultInsert.placement} onChange={(event) => insert({ placement: event.target.value })}/></label>
      <label className="preference-row"><span><strong>Label prefix</strong></span><input value={value.defaultInsert.labelPrefix} onChange={(event) => insert({ labelPrefix: event.target.value })}/></label>
      <label className="preference-row"><span><strong>Figure editor</strong></span><select value={value.editor.defaultMode} onChange={(event) => save({ ...value, editor: { defaultMode: event.target.value as "gui" | "source" } })}><option value="gui">Properties (GUI)</option><option value="source">LaTeX source</option></select></label>
      <h4>Multiple images</h4>
      <label className="preference-row"><span><strong>Columns</strong></span><select value={String(value.multiFigure.defaultColumns)} onChange={(event) => multi({ defaultColumns: event.target.value === "auto" ? "auto" : Number(event.target.value) as 1 | 2 | 3 })}><option value="auto">Auto</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
      <label className="preference-row"><span><strong>Subfigure width</strong></span><input value={value.multiFigure.subfigureWidth} onChange={(event) => multi({ subfigureWidth: event.target.value })}/></label>
      <label className="preference-row"><span><strong>Image width</strong></span><input value={value.multiFigure.imageWidth} onChange={(event) => multi({ imageWidth: event.target.value })}/></label>
    </SettingGroup>}
  </div>;
}

function TableSettingsPanel({ store, scope, level }: { store: ReturnType<typeof useSettings>; scope: "global" | "project"; level: SettingsLevel }) {
  const value = (scope === "global" ? store.global("tables") : store.get("tables")) as TablePreferences;
  const save = (next: TablePreferences) => void store.set("tables", next, scope);
  const insert = (patch: Partial<TablePreferences["defaultInsert"]>) => save({ ...value, defaultInsert: { ...value.defaultInsert, ...patch } });
  const editing = (patch: Partial<TablePreferences["editing"]>) => save({ ...value, editing: { ...value.editing, ...patch } });
  return <div className="image-settings"><h2>{t("settings.tables")}</h2><p>Defaults for structured LaTeX table insertion and Preview editing.</p>
    {level === "basic" ? <SettingGroup title={t("settings.group.tableBasics")}>
      <label className="preference-row"><span><strong>Default style</strong></span><select value={value.defaultStyle} onChange={(event) => save({ ...value, defaultStyle: event.target.value as TableStylePreset })}><option value="booktabs-three-line">Academic three-line</option><option value="grid">Simple grid</option><option value="horizontal">Horizontal lines</option><option value="plain">No borders</option><option value="header-bottom">Header + bottom</option></select></label>
    </SettingGroup> : <SettingGroup title={t("settings.group.tableAdvanced")}>
      <label className="preference-row"><span><strong>Alignment</strong></span><select value={value.defaultInsert.alignment} onChange={(event) => insert({ alignment: event.target.value as "left" | "center" | "right" })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
      <label className="preference-row"><span><strong>First row is header</strong></span><input type="checkbox" checked={value.defaultInsert.headerRow} onChange={(event) => insert({ headerRow: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>Add caption</strong></span><input type="checkbox" checked={value.defaultInsert.addCaption} onChange={(event) => insert({ addCaption: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>Add label</strong></span><input type="checkbox" checked={value.defaultInsert.addLabel} onChange={(event) => insert({ addLabel: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>Table editor</strong></span><select value={value.editor.defaultMode} onChange={(event) => save({ ...value, editor: { defaultMode: event.target.value as "gui" | "source" } })}><option value="gui">Properties (GUI)</option><option value="source">LaTeX source</option></select></label>
      <label className="preference-row"><span><strong>Float placement</strong></span><input value={value.defaultInsert.placement} onChange={(event) => insert({ placement: event.target.value })}/></label>
      <label className="preference-row"><span><strong>Label prefix</strong></span><input value={value.labelPrefix} onChange={(event) => save({ ...value, labelPrefix: event.target.value })}/></label>
      <label className="preference-row"><span><strong>Automatic fixed-width conversion</strong><small>Allow column width edits to convert l/c/r columns to fixed-width columns.</small></span><input type="checkbox" checked={value.editing.allowAutomaticColumnConversion} onChange={(event) => editing({ allowAutomaticColumnConversion: event.target.checked })}/></label>
      <label className="preference-row"><span><strong>Add row after final Tab</strong></span><input type="checkbox" checked={value.editing.autoAddRowOnTab} onChange={(event) => editing({ autoAddRowOnTab: event.target.checked })}/></label>
    </SettingGroup>}
  </div>;
}

function LatexToolchainSettingsPanel({ store }: { store: ReturnType<typeof useSettings> }) {
  const [detecting, setDetecting] = useState(false);
  const toolchain = store.snapshot().toolchain as LatexToolchain | undefined;
  const status = toolchain?.overallStatus ?? (toolchain?.available ? "ready" : toolchain ? "unavailable" : "unknown");
  const tools = [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"], ["latexmk", "latexmk"], ["bibtex", "BibTeX"], ["biber", "Biber"], ["makeindex", "MakeIndex"]] as const;
  const detect = async (manual?: "directory" | "executable") => { setDetecting(true); await store.detect(manual); setDetecting(false); };
  return <div className="environment-settings">
    <div className="environment-settings-header"><div><h2>{t("settings.localToolchain")}</h2><p>{t("settings.environmentDescription")}</p></div><button disabled={detecting} onClick={() => void detect()}>{t("settings.recheck")}</button></div>
    <section className={`environment-status-card ${status}`}><div><strong>{t("settings.environmentStatus")}</strong><b>{t(`settings.environmentStatus.${status}`)}</b></div><div><strong>{t("settings.distribution")}</strong><span>{toolchain?.distribution ?? t("settings.notChecked")}{toolchain?.version ? ` · ${toolchain.version}` : ""}</span></div><div><strong>{t("settings.installation")}</strong><code>{toolchain?.binDirectory ?? t("settings.notConfigured")}</code></div></section>
    <div className="environment-actions"><button disabled={detecting} onClick={() => void detect("directory")}>{t("settings.locate")}</button><button disabled={detecting} onClick={() => void detect("executable")}>{t("settings.executable")}</button></div>
    <section className="environment-tool-grid"><h3>{t("settings.latexTools")}</h3>{tools.map(([id, label]) => <div className="environment-tool-row" key={id}><strong>{label}</strong><span className={toolchain?.[id] ? "status-ok" : "status-warning"}>{toolchain?.[id] ? t("settings.found") : t("settings.notFound")}</span><code>{toolchain?.[id] ?? "—"}</code></div>)}</section>
    {status === "limited" && <p className="spellcheck-settings-note">{t("settings.limitedToolchain")}</p>}
    {status === "unavailable" && <p className="spellcheck-settings-note">{t("settings.missingToolchain")}</p>}
  </div>;
}

function StyleResourcesPanel() {
  const [resources, setResources] = useState<StyleResource[]>([]);
  const [selectedId, setSelectedId] = useState("default");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = async () => { setResources(await window.latexEditor!.styleResources.list()); };
  useEffect(() => { void reload(); }, []);
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { const result = await action(); if (result && typeof result === "object" && "id" in result) setSelectedId(String(result.id)); await reload(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } };
  const selected = resources.find((resource) => resource.id === selectedId);
  return <div className="style-resources-page"><div className="style-resources-intro"><div><h2>{t("resource.title")}</h2><p>{t("resource.description")}</p></div><div className="style-resource-actions"><button disabled={busy} onClick={() => void run(() => window.latexEditor!.styleResources.create(t("resource.newDefaultName")))}>＋ {t("resource.new")}</button><button disabled={busy} onClick={() => void run(async () => { const paths = await window.latexEditor!.dialogs.pickFiles(); return paths.length ? window.latexEditor!.styleResources.importFiles(paths) : undefined; })}>{t("resource.importFiles")}</button><button disabled={busy} onClick={() => void run(async () => { const path = await window.latexEditor!.dialogs.pickFolder(); return path ? window.latexEditor!.styleResources.importFolder(path) : undefined; })}>{t("resource.importFolder")}</button></div></div>
    <div className="style-resource-layout"><aside className="style-resource-list"><h3>{t("resource.builtIn")}</h3>{resources.filter((resource) => resource.source === "built-in").map((resource) => <button className={selectedId === resource.id ? "active" : ""} key={resource.id} onClick={() => setSelectedId(resource.id)}><strong>{resource.name}</strong><small>{resource.files.length} {t("resource.files")}</small></button>)}<h3>{t("resource.myResources")}</h3>{resources.filter((resource) => resource.source === "user").map((resource) => <button className={selectedId === resource.id ? "active" : ""} key={resource.id} onClick={() => setSelectedId(resource.id)}><strong>{resource.name}</strong><small>{resource.files.length} {t("resource.files")}</small></button>)}{!resources.some((resource) => resource.source === "user") && <p className="style-resource-empty">{t("resource.none")}</p>}</aside><main className="style-resource-detail">{selected ? <><div className="style-resource-detail-head"><div><span className="resource-source">{selected.source === "built-in" ? t("resource.builtIn") : t("resource.custom")}</span><h2>{selected.name}</h2><p>{selected.description ?? t("resource.noDescription")}</p></div><div className="style-resource-detail-actions">{selected.source === "user" && <><button onClick={() => void run(async () => { const paths = await window.latexEditor!.dialogs.pickFiles(); return paths.length ? window.latexEditor!.styleResources.addFiles(selected.id, paths) : undefined; })}>{t("resource.addFiles")}</button><button onClick={() => { const name = window.prompt(t("resource.renamePrompt"), selected.name); if (name) void run(() => window.latexEditor!.styleResources.rename(selected.id, name)); }}>{t("resource.rename")}</button><button onClick={() => void run(() => window.latexEditor!.styleResources.duplicate(selected.id))}>{t("resource.duplicate")}</button><button className="danger" onClick={() => { if (window.confirm(t("resource.deleteConfirm", { name: selected.name }))) void run(() => window.latexEditor!.styleResources.remove(selected.id)); }}>{t("resource.delete")}</button></>}</div></div><h3>{t("resource.filesTitle")}</h3><div className="style-resource-files">{selected.files.length ? selected.files.map((file) => <div key={file.targetPath}><code>{file.targetPath}</code><small>{file.kind}</small></div>) : <p>{t("resource.emptyFiles")}</p>}</div>{selected.mainStyle && <p className="style-resource-note">{t("resource.importHint", { name: selected.mainStyle.name })}</p>}</> : <p>{t("resource.selectHint")}</p>}</main></div><section className="online-resource-placeholder"><h3>{t("resource.onlineTitle")}</h3><p>{t("resource.onlineHint")}</p><span>{t("resource.comingLater")}</span></section>{error && <p role="alert" className="inline-error">{error}</p>}</div>;
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
    {mode === "manual" && <label className="preference-row"><span><strong>{t("settings.spellcheckLanguage")}</strong><small>{t("settings.spellcheckLanguageHint")}</small></span><select disabled={scope === "project"} value={language} onChange={(event) => void store.set("spellCheckLanguage", event.target.value)}>{languages.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
  </SettingGroup>;
}

function SpellCheckSettingsPanel({ store }: { store: ReturnType<typeof useSettings> }) {
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
      const [nextStatus, nextCatalog] = await Promise.all([api.status(), refresh ? api.refreshDictionaries() : api.listDictionaries(query)]);
      setStatus(nextStatus); setCatalog(nextCatalog);
    } catch (error) { setLoadError(String(error)); } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, [query]);
  const install = async (item: DictionaryPackage) => {
    setInstalling(item.id);
    try { await window.latexEditor!.spellcheck.installDictionary(item.id); await store.set("spellCheckLanguage", item.languageCode); await reload(); }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
    finally { setInstalling(undefined); }
  };
  const remove = async (item: DictionaryPackage) => {
    if (!window.confirm(t("settings.spellcheckRemoveConfirm", { name: item.displayName }))) return;
    try { await window.latexEditor!.spellcheck.removeDictionary(item.id); if (language === item.languageCode) await store.reset("spellCheckLanguage"); await reload(); }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };
  const installed = catalog.filter((item) => item.installed);
  const available = catalog.filter((item) => !item.installed && item.id !== "zh-CN" && item.id !== "ja-JP");
  return <div className="spellcheck-settings">
    <div className="spellcheck-settings-header"><div><h2>{t("settings.spellcheck")}</h2><p>{t("settings.spellcheckDescription")}</p></div><button disabled={loading || Boolean(installing)} onClick={() => void reload(true)}>{t("settings.spellcheckRefresh")}</button></div>
    <div className="spellcheck-status-card"><div><strong>{t("settings.spellcheckProvider")}</strong><span>{status?.provider === "hunspell" ? "Hunspell (nspell)" : status?.provider ?? "—"}</span></div><div><strong>{t("settings.spellcheckPlatform")}</strong><span>{status?.platform ?? "—"}</span></div><div><strong>{t("settings.spellcheckAvailability")}</strong><span className={status?.available ? "status-ok" : "status-warning"}>{status ? (status.available ? t("settings.spellcheckAvailable") : t("settings.spellcheckUnavailable")) : t("settings.spellcheckChecking")}</span></div></div>
    <p className="spellcheck-settings-note">{t("settings.spellcheckElectronHint")}</p>
    <section className="spellcheck-settings-note">
      <strong>{t("settings.chineseRulesTitle")}</strong>
      <p>{t("settings.chineseRulesHint")}</p>
      <p>{status?.availableLanguages.includes("zh-CN") ? t("settings.spellcheckInstalledBadge") : t("settings.spellcheckUnavailable")} · Apache-2.0 · pycorrector</p>
      <button disabled={Boolean(installing)} onClick={() => void install({ id: "zh-CN", languageCode: "zh-CN", displayName: "Chinese", installed: false, license: { name: "Apache-2.0" } })}>
        {installing === "zh-CN" ? t("settings.spellcheckInstalling") : t("settings.chineseRulesDownload")}
      </button>
    </section>
    <section className="spellcheck-settings-note">
      <strong>{t("settings.japaneseRulesTitle")}</strong>
      <p>{t("settings.japaneseRulesHint")}</p>
      <p>{status?.availableLanguages.includes("ja-JP") ? t("settings.spellcheckInstalledBadge") : t("settings.spellcheckUnavailable")} · MIT · textlint-rule-ja-no-abusage</p>
      <button disabled={Boolean(installing)} onClick={() => void install({ id: "ja-JP", languageCode: "ja-JP", displayName: "Japanese", installed: false, license: { name: "MIT" } })}>
        {installing === "ja-JP" ? t("settings.spellcheckInstalling") : t("settings.japaneseRulesDownload")}
      </button>
    </section>
    {loadError && <p role="alert" className="inline-error">{loadError}</p>}
    <section className="dictionary-section"><div className="dictionary-section-head"><h3>{t("settings.spellcheckInstalled")}</h3><span>{installed.length}</span></div>{installed.map((item) => <div className="dictionary-row" key={item.id}><span><strong>{item.displayName}</strong><small>{item.region ? `${item.languageCode} · ${item.region}` : item.languageCode}</small></span><em>{t("settings.spellcheckInstalledBadge")}</em>{item.id !== "en-US" && item.id !== "en-GB" && <button className="danger" onClick={() => void remove(item)}>{t("settings.spellcheckRemove")}</button>}</div>)}</section>
    <section className="dictionary-section"><div className="dictionary-section-head"><h3>{t("settings.spellcheckAdd")}</h3><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("settings.spellcheckSearch")}/></div>{available.map((item) => <div className="dictionary-row" key={item.id}><span><strong>{item.displayName}</strong><small>{item.region ? `${item.languageCode} · ${item.region}` : item.languageCode}</small></span><button disabled={Boolean(installing)} onClick={() => void install(item)}>{installing === item.id ? t("settings.spellcheckInstalling") : t("settings.spellcheckInstall")}</button></div>)}{!available.length && <p>{t("settings.spellcheckNoLanguages")}</p>}</section>
    {status?.dictionaryPath && <p>{t("settings.spellcheckPersonalDictionary")}: <code>{status.dictionaryPath}</code></p>}
    {status?.error && <p role="alert" className="inline-error">{status.error}</p>}
  </div>;
}

function ThemeBasicSettingsPanel({ store, scope, children }: { store: ReturnType<typeof useSettings>; scope: "global" | "project"; children: ReactNode }) {
  const [themes, setThemes] = useState<ThemeDefinition[]>([]);
  useEffect(() => { void window.latexEditor!.themes.list().then(setThemes).catch(() => setThemes([])); }, []);
  return <SettingGroup title={t("settings.group.appearanceBasics")}>
    {children}
    <label className="preference-row"><span><strong>{t("settings.activeTheme")}</strong><small>{t(scope === "project" ? "settings.globalOnly" : "settings.activeThemeHint")}</small></span><select disabled={scope === "project"} data-setting="theme" value={store.global("theme")} onChange={(event) => void store.set("theme", event.currentTarget.value, "global")}>{themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>
  </SettingGroup>;
}

function ThemeSettingsPanel({ store, showActiveTheme = true }: { store: ReturnType<typeof useSettings>; showActiveTheme?: boolean }) {
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
  return <div className="theme-settings-panel">
    <div className="theme-settings-header"><div><h2>{t("settings.theme")}</h2><p>{t("settings.themeHint")}</p></div><button disabled={busy} onClick={() => void reload()}>{t("settings.themeRefresh")}</button></div>
    {showActiveTheme && <label className="preference-row"><span><strong>{t("settings.activeTheme")}</strong><small>{t("settings.activeThemeHint")}</small></span><select data-setting="theme" value={store.global("theme")} onChange={(event) => void store.set("theme", event.currentTarget.value, "global")}>{[...builtIns, ...userThemes].map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select></label>}
    <div className="theme-import-actions"><button disabled={busy} onClick={importFiles}>＋ {t("settings.themeImport")}</button><button disabled={busy} onClick={importFolder}>{t("settings.themeImportFolder")}</button></div>
    <div className="theme-directory"><strong>{t("settings.themeDirectory")}</strong><code>{directory || "—"}</code><div><button disabled={busy} onClick={chooseDirectory}>{t("settings.themeChooseDirectory")}</button><button disabled={busy || !store.global("themeDirectory")} onClick={resetDirectory}>{t("settings.themeResetDirectory")}</button></div></div>
    <section className="theme-catalog"><h3>{t("settings.themeBuiltIn")}</h3>{builtIns.map((theme) => <div className="theme-catalog-row" key={theme.id}><span><strong>{theme.name}</strong><small>{theme.id}</small></span><em>{t("settings.themeBuiltInBadge")}</em></div>)}<h3>{t("settings.themeCustom")}</h3>{userThemes.length ? userThemes.map((theme) => <div className="theme-catalog-row" key={theme.id}><span><strong>{theme.name}</strong><small>{theme.filePath ?? theme.id}</small></span><button className="danger" disabled={busy} onClick={() => remove(theme)}>{t("settings.themeDelete")}</button></div>) : <p>{t("settings.themeNone")}</p>}</section>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}

function AISkillsSettingsPanel({ onEditingChange }: { onEditingChange(editing: boolean): void }) {
  const [skills, setSkills] = useState<AIProjectSkill[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = skills.find((skill) => skill.name === selectedName);
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
  return <div className="ai-skills-settings">
    <div className="ai-skills-header"><div><h2>{t("settings.aiSkillsTitle")}</h2><p>{t("settings.aiSkillsDescription")}</p></div><button type="button" disabled={busy} onClick={startCreate}>＋ {t("settings.aiSkillsNew")}</button></div>
    <div className="ai-skills-layout">
      <nav className="ai-skills-list" aria-label={t("settings.aiSkillsTitle")}>
        {skills.map((skill) => <button type="button" key={skill.name} className={selectedName === skill.name ? "active" : ""} onClick={() => { setSelectedName(skill.name); setEditing(false); setError(""); }}><strong>{skill.name}</strong><small>{t(`settings.aiSkillSource.${skill.source}`)}</small></button>)}
        {!skills.length && <p>{t("settings.aiSkillsEmpty")}</p>}
      </nav>
      <section className="ai-skills-editor">
        {editing ? <>
          <label><span>{t("settings.aiSkillsName")}</span><input value={name} disabled={!creating} onChange={(event) => setName(event.target.value)} spellCheck={false}/></label>
          <p className="ai-skills-hint">{t("settings.aiSkillsFormatHint")}</p>
          <textarea aria-label={t("settings.aiSkillsContent")} value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false}/>
          <div className="ai-skills-actions"><button type="button" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>{t("settings.aiSkillsCancel")}</button><button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? t("settings.aiSkillsSaving") : t("settings.aiSkillsSave")}</button></div>
        </> : selected ? <>
          <div className="ai-skills-detail-head"><div><span>{t(`settings.aiSkillSource.${selected.source}`)}</span><h3>{selected.name}</h3></div><button type="button" onClick={startEdit}>{t("settings.aiSkillsEdit")}</button></div>
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
  if (["history", "styleResources", "environments", "project", "build", "compiler", "environment"].includes(section)) return "projectBuild";
  if (section === "aiSkills") return "ai";
  return "general";
}

function managerForInitial(section: Section): ManagerId | undefined {
  if (section === "spellcheck") return "dictionaries";
  if (section === "shortcuts") return "shortcuts";
  if (section === "environments") return "blockEnvironments";
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
  const [managerDirty, setManagerDirty] = useState(false);
  const [capture, setCapture] = useState<CommandId>();
  const [pending, setPending] = useState("");
  const [conflict, setConflict] = useState<string>();
  const [invalid, setInvalid] = useState(false);
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
  const row = (key: PreferenceKey, label: string, options?: Array<[string, string]>, numeric = false) => {
    const allowed = scope === "global" || projectPreferenceKeys.includes(key);
    const value = read(key);
    const hint = key === "hideBuildArtifacts" ? t("settings.hideBuildArtifactsHint") : key === "documentWordCompletion" ? t("settings.documentWordCompletionHint") : key === "autoPairSymbols" ? t("settings.autoPairSymbolsHint") : key === "mathPreviewOnHover" ? t("settings.mathPreviewOnHoverHint") : key === "autoEnvironmentLabels" ? t("settings.autoEnvironmentLabelsHint") : key === "confirmPreviewEdits" ? t("settings.confirmPreviewEditsHint") : key === "warnIncompatibleEnvironmentConversion" ? t("settings.warnIncompatibleEnvironmentConversionHint") : undefined;
    return <label className="preference-row" data-setting={key} key={key}><span><strong>{t(label)}</strong>{hint && <small>{hint}</small>}{scope === "project" && !(key in snapshot.project) && <small>{t(allowed ? "settings.inherited" : "settings.globalOnly")}</small>}</span>
      {options ? <select disabled={!allowed} value={String(value)} onChange={(event) => void store.set(key, numeric ? Number(event.target.value) : event.target.value as never, scope)}>{options.map(([id, labelKey]) => <option key={id} value={id}>{t(labelKey)}</option>)}</select> : numeric ? <input disabled={!allowed} type="number" min={10} max={32} value={Number(value)} onChange={(event) => { const next = Number(event.target.value); if (next >= 10 && next <= 32) void store.set(key, next, scope); }}/> : <input disabled={!allowed} type="checkbox" checked={Boolean(value)} onChange={(event) => void store.set(key, event.target.checked, scope)}/>}
      {resetButton(key, allowed)}</label>;
  };
  const configured = read("environments") as EnvironmentDefinition[];
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
    setManager(undefined); setManagerDirty(false); setSearch(""); setCategory(next); setCapture(undefined);
  };
  const applyBinding = (value: string, replace?: string) => {
    if (!capture) return;
    const next = { ...store.global("keybindings"), [capture]: value, ...(replace ? { [replace]: "" } : {}) };
    void store.set("keybindings", next); setCapture(undefined); setConflict(undefined);
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

  const renderShortcutManager = () => <div className="settings-shortcut-manager"><h2>{t("settings.manager.shortcuts")}</h2><p>{t("settings.globalOnly")}</p><SettingGroup title={t("settings.group.keyboard")}>
    {row("referenceLinkModifier", "settings.referenceLinkModifier", [["ctrl", "settings.modifierCtrl"], ["alt", "settings.modifierAlt"], ["shift", "settings.modifierShift"], ["meta", "settings.modifierMeta"]])}
    {(Object.keys(defaultBindings) as CommandId[]).map((id) => {
      const current = bindings()[id] ?? "";
      const customized = current !== (defaultBindings[id] ?? "");
      return <div className="preference-row" key={id}><span><strong>{t(commandLabels[id])}</strong><small>{t(commandContexts[id])}</small></span><button data-command={id} onClick={() => { setCapture(id); setConflict(undefined); setInvalid(false); }}>{displayBinding(current) || t("settings.off")}</button>{customized && <button className="preference-reset" onClick={() => { const next = { ...store.global("keybindings") }; delete next[id]; const duplicate = (Object.entries(bindings()) as Array<[CommandId, string]>).find(([other, value]) => other !== id && commandContexts[other] === commandContexts[id] && value === defaultBindings[id]); if (duplicate) next[duplicate[0]] = ""; void store.set("keybindings", next); }}>{t("settings.reset")}</button>}</div>;
    })}
  </SettingGroup>{capture && <div className="shortcut-capture"><p>{t(commandLabels[capture])} - {t(commandContexts[capture])}</p><input data-shortcut-capture autoFocus readOnly placeholder={t("shortcut.capture")} value={displayBinding(pending)} onKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); if (event.key === "Escape") { setCapture(undefined); return; } if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return; const value = eventBinding(event.nativeEvent); setPending(value); if (!validBinding(value)) { setInvalid(true); return; } setInvalid(false); const duplicate = (Object.entries(bindings()) as Array<[CommandId, string]>).find(([id, binding]) => id !== capture && commandContexts[id] === commandContexts[capture] && binding === value); if (duplicate) setConflict(duplicate[0]); else applyBinding(value); }}/>{invalid && <p role="alert">{t("shortcut.invalid")}</p>}{conflict && <><p role="alert">{t("shortcut.conflict")} {t(commandLabels[conflict as CommandId])}</p><button onClick={() => applyBinding(pending, conflict)}>{t("shortcut.replace")}</button></>}<button onClick={() => setCapture(undefined)}>{t("project.cancel")}</button></div>}</div>;

  const renderCategory = () => {
    if (category === "general") return <div className="settings-page"><h2>{t("settings.category.general")}</h2>
      {level === "basic" && <SettingGroup title={t("settings.group.generalBasics")}>
        {row("autoSave", "settings.autoSave", [["off", "settings.off"], ["afterDelay", "settings.afterDelay"]])}{row("hideBuildArtifacts", "settings.hideBuildArtifacts")}{row("restoreProject", "settings.restore")}{row("maximize", "settings.maximize")}
        {row("sidePanelDisplay", "settings.sidePanelDisplay", [["overlay", "settings.sidePanelOverlay"], ["push", "settings.sidePanelPush"]])}{row("locale", "settings.language", [["en", "settings.localeEnglish"], ["ja", "settings.localeJapanese"], ["zh-CN", "settings.localeSimplifiedChinese"], ["zh-TW", "settings.localeTraditionalChinese"], ["ko", "settings.localeKorean"], ["fr", "settings.localeFrench"]])}
      </SettingGroup>}
      <WheelAccelerationSettingsPanel store={store} scope={scope} level={level}/>
    </div>;
    if (category === "appearance") return <div className="settings-page"><h2>{t("settings.category.appearance")}</h2>{level === "basic" ? <ThemeBasicSettingsPanel store={store} scope={scope}>{row("fontSize", "settings.fontSize", undefined, true)}{row("tabSize", "settings.tabSize", [["2", "2"], ["4", "4"], ["8", "8"]], true)}</ThemeBasicSettingsPanel> : <ManagerEntry title={t(managerDefinitions.themes.title)} description={t(managerDefinitions.themes.description)} onOpen={() => openManager("themes")}/>}</div>;
    if (category === "editor") return <div className="settings-page"><h2>{t("settings.category.editor")}</h2>{level === "basic" ? <><SettingGroup title={t("settings.group.editorBasics")}>{row("wordWrap", "settings.wordWrap")}{row("autoPairSymbols", "settings.autoPairSymbols")}{row("documentWordCompletion", "settings.documentWordCompletion")}{row("mathPreviewOnHover", "settings.mathPreviewOnHover")}{row("confirmPreviewEdits", "settings.confirmPreviewEdits")}</SettingGroup><SpellCheckPreferencesPanel store={store} scope={scope}/><ManagerEntry title={t(managerDefinitions.shortcuts.title)} description={t(managerDefinitions.shortcuts.description)} onOpen={() => openManager("shortcuts")}/><ManagerEntry title={t(managerDefinitions.dictionaries.title)} description={t(managerDefinitions.dictionaries.description)} onOpen={() => openManager("dictionaries")}/></> : <SettingGroup title={t("settings.group.editorAdvanced")}>{row("autoEnvironmentLabels", "settings.autoEnvironmentLabels")}{row("warnIncompatibleEnvironmentConversion", "settings.warnIncompatibleEnvironmentConversion")}</SettingGroup>}</div>;
    if (category === "tools") return <div className="settings-page"><h2>{t("settings.category.tools")}</h2><ImageSettingsPanel store={store} scope={scope} level={level}/><TableSettingsPanel store={store} scope={scope} level={level}/></div>;
    if (category === "filter") return <div className="settings-page"><h2>{t("settings.category.filter")}</h2>{level === "basic" && <SettingGroup title={t("settings.group.filterBasics")}><p>{t("settings.filterGroupsHint")}</p>{scope === "project" && <p>{t("settings.globalOnly")}</p>}{(["blockType", "location", "file", "properties"] as const).map((group) => { const visible = store.global("visibleFilterGroups"); return <label className="preference-row" key={group}><span><strong>{t(`filter.${group}`)}</strong></span><input type="checkbox" disabled={scope === "project"} checked={visible.includes(group)} onChange={(event) => void store.set("visibleFilterGroups", event.target.checked ? [...visible, group] : visible.filter((item) => item !== group))}/></label>; })}</SettingGroup>}</div>;
    if (category === "projectBuild") return <div className="settings-page"><h2>{t("settings.category.projectBuild")}</h2>{level === "basic" ? <><HistorySettingsPanel store={store} scope={scope} level={level}/><SettingGroup title={t("settings.group.buildBasics")}>{row("engine", "settings.engine", [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"]])}<p>{t("settings.mainFileHint")}</p><p>{t("settings.buildUnavailable")}</p></SettingGroup></> : <><HistorySettingsPanel store={store} scope={scope} level={level}/><ManagerEntry title={t(managerDefinitions.blockEnvironments.title)} description={t(managerDefinitions.blockEnvironments.description)} onOpen={() => openManager("blockEnvironments")}/><ManagerEntry title={t(managerDefinitions.styleResources.title)} description={t(managerDefinitions.styleResources.description)} onOpen={() => openManager("styleResources")}/><ManagerEntry title={t(managerDefinitions.toolchain.title)} description={t(managerDefinitions.toolchain.description)} onOpen={() => openManager("toolchain")}/></>}</div>;
    return <div className="settings-page"><h2>{t("settings.category.ai")}</h2>{level === "basic" ? <SettingGroup title={t("settings.group.aiBasics")}><p>{t("settings.aiPrivacyHint")}</p>{row("aiDefaultMode", "settings.aiDefaultMode", [["chat", "ai.copilot"], ["codex", "ai.codex"]])}{row("aiPermissionMode", "settings.aiPermissionMode", [["ask", "ai.permission.ask"], ["auto", "ai.permission.auto"], ["full", "ai.permission.full"]])}<div className="ai-phase-card"><strong>{t("settings.aiChangeReview")}</strong><p>{t("settings.aiChangeReviewDetails")}</p></div></SettingGroup> : <ManagerEntry title={t(managerDefinitions.aiSkills.title)} description={t(managerDefinitions.aiSkills.description)} onOpen={() => openManager("aiSkills")}/>}</div>;
  };

  const renderManager = () => {
    if (!manager) return null;
    if (manager === "themes") return <ThemeSettingsPanel store={store} showActiveTheme={false}/>;
    if (manager === "dictionaries") return <SpellCheckSettingsPanel store={store}/>;
    if (manager === "shortcuts") return renderShortcutManager();
    if (manager === "blockEnvironments") return <div className="settings-environments"><EnvironmentManager definitions={configured.length ? includeNewBuiltInEnvironments(configured) : DEFAULT_ENVIRONMENTS} onChange={(next) => void store.set("environments", next, scope)}/></div>;
    if (manager === "styleResources") return <StyleResourcesPanel/>;
    if (manager === "toolchain") return <LatexToolchainSettingsPanel store={store}/>;
    return <AISkillsSettingsPanel onEditingChange={setManagerDirty}/>;
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (capture) setCapture(undefined);
      else if (overflowOpen) setOverflowOpen(false);
      else if (manager) backToSettings();
      else requestClose();
    };
    const onPointerDown = (event: PointerEvent) => { if (overflowOpen && !overflowRef.current?.contains(event.target as Node)) setOverflowOpen(false); };
    window.addEventListener("keydown", onKeyDown); window.addEventListener("pointerdown", onPointerDown);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("pointerdown", onPointerDown); };
  }, [capture, overflowOpen, manager, managerDirty, onClose]);


  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}><section className="preferences-dialog" role="dialog" aria-modal="true" aria-label={t("activity.settings")}>
    <header className="settings-dialog-header"><h1>{t("activity.settings")}</h1>
      <label className="settings-search"><span className="visually-hidden">{t("settings.searchPlaceholder")}</span><input value={search} disabled={Boolean(manager)} onChange={(event) => setSearch(event.target.value)} placeholder={t("settings.searchPlaceholder")}/>{search && <button type="button" aria-label={t("settings.clearSearch")} onClick={() => setSearch("")}>X</button>}</label>
      {projectScopeAvailable && (!manager || manager === "blockEnvironments") && <select aria-label={t("settings.scope")} value={scope} onChange={(event) => setScope(event.target.value as "global" | "project")}><option value="global">{t("settings.global")}</option><option value="project">{t("settings.project")}</option></select>}
      {!manager && <div className="settings-level-switch" role="group" aria-label={t("settings.settingLevel")}><button type="button" className={level === "basic" ? "active" : ""} onClick={() => setLevel("basic")}>{t("settings.basic")}</button><button type="button" className={level === "advanced" ? "active" : ""} onClick={() => setLevel("advanced")}>{t("settings.advanced")}</button></div>}
      <div className="settings-header-actions">
        <div className="settings-overflow" ref={overflowRef}>
          {!manager && <>
            <button type="button" className="settings-overflow-trigger" aria-label={t("settings.moreActions")} aria-expanded={overflowOpen} onClick={() => setOverflowOpen((open) => !open)}>...</button>
            {overflowOpen && <div className="settings-overflow-menu">
              <button type="button" onClick={() => { setOverflowOpen(false); void resetKeys(categoryPreferences[category]); }}>{t("settings.resetSection")}</button>
              <button type="button" onClick={() => { setOverflowOpen(false); if (window.confirm(t("settings.restoreDefaultsConfirm"))) void resetKeys(scope === "project" ? projectPreferenceKeys : Object.keys(preferenceDefaults) as PreferenceKey[]); }}>{t("settings.resetAll")}</button>
            </div>}
          </>}
        </div>
        <button className="settings-close" aria-label={t("common.close")} onClick={requestClose}>X</button>
      </div>
    </header>
    <div className="preferences-body"><nav aria-label={t("activity.settings")}>{sectionGroups.map((group) => <div className="settings-nav-group" key={group.label}><span>{t(group.label)}</span>{group.sections.map((item) => <button type="button" data-section={item} aria-current={category === item ? "page" : undefined} className={category === item ? "active" : ""} key={item} onClick={() => navigateCategory(item)}>{t(`settings.category.${item}`)}</button>)}</div>)}</nav>
      <main ref={mainRef}>
        {manager ? (
          <div className="settings-manager-page">
            <button type="button" className="settings-back-button" onClick={backToSettings}>{t("settings.backToSettings")}</button>
            {manager !== "blockEnvironments" && projectScopeAvailable && <p className="settings-manager-scope-note">{t("settings.globalOnly")}</p>}
            {renderManager()}
          </div>
        ) : search.trim() ? (
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
    </main></div><footer>{t("settings.saved")}{scope === "project" && <span>{t("settings.projectResetHint")}</span>}</footer>
  </section></div>;
}
