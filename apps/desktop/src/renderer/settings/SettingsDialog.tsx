import { useEffect, useState } from "react";
import { preferenceDefaults, projectPreferenceKeys, type AIProjectSkill, type DictionaryPackage, type HistoryPreferences, type ImagePreferences, type LatexToolchain, type PreferenceKey, type StyleResource, type TablePreferences, type TableStylePreset, type ThemeDefinition } from "@latex-editor/contracts";
import type { SpellCheckStatus } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { EnvironmentManager } from "../preview/EnvironmentManager.js";
import { DEFAULT_ENVIRONMENTS, includeNewBuiltInEnvironments } from "../preview/environments.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { useSettings } from "./service.js";
import { bindings, commandContexts, commandLabels, defaultBindings, displayBinding, eventBinding, validBinding, type CommandId } from "./commands.js";
import "./settings.css";

const sections = ["general", "appearance", "editor", "images", "tables", "searchFilter", "language", "shortcuts", "history", "environment", "compiler", "spellcheck", "ai", "aiSkills", "environments", "styleResources"] as const;
export type SettingsSection = typeof sections[number];
type Section = SettingsSection;

const projectSettingsBySection: Partial<Record<Section, PreferenceKey[]>> = {
  general: ["autoSave"],
  editor: ["fontSize", "tabSize", "wordWrap", "autoPairSymbols", "mathPreviewOnHover", "confirmPreviewEdits"],
  images: ["images"],
  tables: ["tables"],
  history: ["history"],
  compiler: ["engine"],
  environments: ["environments"]
};

function HistorySettingsPanel({ store, scope }: { store: ReturnType<typeof useSettings>; scope: "global" | "project" }) {
  const value = (scope === "global" ? store.global("history") : store.get("history")) as HistoryPreferences;
  const update = (patch: Partial<HistoryPreferences>) => void store.set("history", { ...value, ...patch }, scope);
  const toggles = ["autoSnapshot", "beforeRestore", "beforeLargeDelete", "beforeAiChange"] as const;
  const numbers = [["intervalMinutes", 1, 1440], ["maxSnapshots", 1, 1000], ["retentionDays", 1, 3650]] as const;
  return <><h2>{t("settings.history")}</h2>{toggles.map((key) => <label className="preference-row" key={key}><span><strong>{t(`history.${key}`)}</strong></span><input data-setting={`history.${key}`} type="checkbox" checked={value[key]} onChange={(event) => update({ [key]: event.target.checked })}/></label>)}{numbers.map(([key, min, max]) => <label className="preference-row" key={key}><span><strong>{t(`history.${key}`)}</strong></span><input data-setting={`history.${key}`} type="number" min={min} max={max} value={value[key]} onChange={(event) => { const next = Number(event.target.value); if (Number.isInteger(next) && next >= min && next <= max) update({ [key]: next }); }}/></label>)}</>;
}

function ImageSettingsPanel({ store, scope }: { store: ReturnType<typeof useSettings>; scope: "global" | "project" }) {
  const value = (scope === "global" ? store.global("images") : store.get("images")) as ImagePreferences;
  const save = (next: ImagePreferences) => void store.set("images", next, scope);
  const insert = (patch: Partial<ImagePreferences["defaultInsert"]>) => save({ ...value, defaultInsert: { ...value.defaultInsert, ...patch } });
  const multi = (patch: Partial<ImagePreferences["multiFigure"]>) => save({ ...value, multiFigure: { ...value.multiFigure, ...patch } });
  return <div className="image-settings"><h2>Images</h2><p>Defaults for imported images and generated LaTeX. Project values can override these settings.</p>
    <label className="preference-row"><span><strong>Project image directory</strong><small>Imported files are copied here; existing files are never overwritten.</small></span><input value={value.defaultDirectory} onChange={(event) => save({ ...value, defaultDirectory: event.target.value })}/></label>
    <label className="preference-row"><span><strong>Default insertion</strong></span><select value={value.defaultInsert.type} onChange={(event) => insert({ type: event.target.value as "figure" | "inline" })}><option value="figure">Figure environment</option><option value="inline">Inline image</option></select></label>
    <label className="preference-row"><span><strong>Default width</strong></span><input value={value.defaultInsert.width} onChange={(event) => insert({ width: event.target.value })}/></label>
    <label className="preference-row"><span><strong>Alignment</strong></span><select value={value.defaultInsert.alignment} onChange={(event) => insert({ alignment: event.target.value as "left" | "center" | "right" })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
    <label className="preference-row"><span><strong>Placement</strong></span><input value={value.defaultInsert.placement} onChange={(event) => insert({ placement: event.target.value })}/></label>
    <label className="preference-row"><span><strong>Add caption</strong></span><input type="checkbox" checked={value.defaultInsert.addCaption} onChange={(event) => insert({ addCaption: event.target.checked })}/></label>
    <label className="preference-row"><span><strong>Add label</strong></span><input type="checkbox" checked={value.defaultInsert.addLabel} onChange={(event) => insert({ addLabel: event.target.checked })}/></label>
    <label className="preference-row"><span><strong>Label prefix</strong></span><input value={value.defaultInsert.labelPrefix} onChange={(event) => insert({ labelPrefix: event.target.value })}/></label>
    <label className="preference-row"><span><strong>Figure editor</strong></span><select value={value.editor.defaultMode} onChange={(event) => save({ ...value, editor: { defaultMode: event.target.value as "gui" | "source" } })}><option value="gui">Properties (GUI)</option><option value="source">LaTeX source</option></select></label>
    <h3>Multiple images</h3>
    <label className="preference-row"><span><strong>Columns</strong></span><select value={String(value.multiFigure.defaultColumns)} onChange={(event) => multi({ defaultColumns: event.target.value === "auto" ? "auto" : Number(event.target.value) as 1 | 2 | 3 })}><option value="auto">Auto</option><option value="1">1</option><option value="2">2</option><option value="3">3</option></select></label>
    <label className="preference-row"><span><strong>Subfigure width</strong></span><input value={value.multiFigure.subfigureWidth} onChange={(event) => multi({ subfigureWidth: event.target.value })}/></label>
    <label className="preference-row"><span><strong>Image width</strong></span><input value={value.multiFigure.imageWidth} onChange={(event) => multi({ imageWidth: event.target.value })}/></label>
    <button onClick={() => void store.reset("images", scope)}>Reset image defaults</button>
  </div>;
}

function TableSettingsPanel({ store, scope }: { store: ReturnType<typeof useSettings>; scope: "global" | "project" }) {
  const value = (scope === "global" ? store.global("tables") : store.get("tables")) as TablePreferences;
  const save = (next: TablePreferences) => void store.set("tables", next, scope);
  const insert = (patch: Partial<TablePreferences["defaultInsert"]>) => save({ ...value, defaultInsert: { ...value.defaultInsert, ...patch } });
  const editing = (patch: Partial<TablePreferences["editing"]>) => save({ ...value, editing: { ...value.editing, ...patch } });
  return <div className="image-settings"><h2>Tables</h2><p>Defaults for structured LaTeX table insertion and Preview editing.</p>
    <label className="preference-row"><span><strong>Default style</strong></span><select value={value.defaultStyle} onChange={(event) => save({ ...value, defaultStyle: event.target.value as TableStylePreset })}><option value="booktabs-three-line">Academic three-line</option><option value="grid">Simple grid</option><option value="horizontal">Horizontal lines</option><option value="plain">No borders</option><option value="header-bottom">Header + bottom</option></select></label>
    <label className="preference-row"><span><strong>Alignment</strong></span><select value={value.defaultInsert.alignment} onChange={(event) => insert({ alignment: event.target.value as "left" | "center" | "right" })}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
    <label className="preference-row"><span><strong>Float placement</strong></span><input value={value.defaultInsert.placement} onChange={(event) => insert({ placement: event.target.value })}/></label>
    <label className="preference-row"><span><strong>First row is header</strong></span><input type="checkbox" checked={value.defaultInsert.headerRow} onChange={(event) => insert({ headerRow: event.target.checked })}/></label>
    <label className="preference-row"><span><strong>Add caption</strong></span><input type="checkbox" checked={value.defaultInsert.addCaption} onChange={(event) => insert({ addCaption: event.target.checked })}/></label>
    <label className="preference-row"><span><strong>Add label</strong></span><input type="checkbox" checked={value.defaultInsert.addLabel} onChange={(event) => insert({ addLabel: event.target.checked })}/></label>
    <label className="preference-row"><span><strong>Label prefix</strong></span><input value={value.labelPrefix} onChange={(event) => save({ ...value, labelPrefix: event.target.value })}/></label>
    <label className="preference-row"><span><strong>Table editor</strong></span><select value={value.editor.defaultMode} onChange={(event) => save({ ...value, editor: { defaultMode: event.target.value as "gui" | "source" } })}><option value="gui">Properties (GUI)</option><option value="source">LaTeX source</option></select></label>
    <label className="preference-row"><span><strong>Automatic fixed-width conversion</strong><small>Allow column width edits to convert l/c/r columns to fixed-width columns.</small></span><input type="checkbox" checked={value.editing.allowAutomaticColumnConversion} onChange={(event) => editing({ allowAutomaticColumnConversion: event.target.checked })}/></label>
    <label className="preference-row"><span><strong>Add row after final Tab</strong></span><input type="checkbox" checked={value.editing.autoAddRowOnTab} onChange={(event) => editing({ autoAddRowOnTab: event.target.checked })}/></label>
    <button onClick={() => void store.reset("tables", scope)}>Reset table defaults</button>
  </div>;
}

function EnvironmentSettingsPanel({ store }: { store: ReturnType<typeof useSettings> }) {
  const [detecting, setDetecting] = useState(false);
  const toolchain = store.snapshot().toolchain as LatexToolchain | undefined;
  const status = toolchain?.overallStatus ?? (toolchain?.available ? "ready" : toolchain ? "unavailable" : "unknown");
  const tools = [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"], ["latexmk", "latexmk"], ["bibtex", "BibTeX"], ["biber", "Biber"], ["makeindex", "MakeIndex"]] as const;
  const detect = async (manual?: "directory" | "executable") => { setDetecting(true); await store.detect(manual); setDetecting(false); };
  return <div className="environment-settings">
    <div className="environment-settings-header"><div><h2>{t("settings.environment")}</h2><p>{t("settings.environmentDescription")}</p></div><button disabled={detecting} onClick={() => void detect()}>{t("settings.recheck")}</button></div>
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

function SpellCheckSettingsPanel({ store }: { store: ReturnType<typeof useSettings> }) {
  const [status, setStatus] = useState<SpellCheckStatus>();
  const [catalog, setCatalog] = useState<DictionaryPackage[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState<string>();
  const [loadError, setLoadError] = useState("");
  const mode = store.global("spellCheckMode");
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
  const languages = [...new Set(["en-US", ...(status?.availableLanguages ?? [])])].sort((a, b) => a.localeCompare(b));
  const setMode = (next: "auto" | "manual" | "disabled") => { void store.set("spellCheckMode", next); };
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
    <label className="preference-row"><span><strong>{t("settings.spellcheckMode")}</strong><small>{t("settings.spellcheckModeHint")}</small></span><select value={mode} onChange={(event) => setMode(event.target.value as "auto" | "manual" | "disabled")}><option value="auto">{t("settings.spellcheckAuto")}</option><option value="manual">{t("settings.spellcheckManual")}</option><option value="disabled">{t("settings.spellcheckDisabled")}</option></select><button type="button" onClick={() => void store.reset("spellCheckMode")}>{t("settings.reset")}</button></label>
    {mode === "manual" && <label className="preference-row"><span><strong>{t("settings.spellcheckLanguage")}</strong><small>{t("settings.spellcheckLanguageHint")}</small></span><select value={language} onChange={(event) => void store.set("spellCheckLanguage", event.target.value)}>{languages.map((item) => <option key={item} value={item}>{item}</option>)}</select><button type="button" onClick={() => void store.reset("spellCheckLanguage")}>{t("settings.reset")}</button></label>}
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

function ThemeSettingsPanel({ store }: { store: ReturnType<typeof useSettings> }) {
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
    <label className="preference-row"><span><strong>{t("settings.activeTheme")}</strong><small>{t("settings.activeThemeHint")}</small></span><select data-setting="theme" value={store.global("theme")} onChange={(event) => void store.set("theme", event.currentTarget.value, "global")}>{[...builtIns, ...userThemes].map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select><button type="button" onClick={() => void store.reset("theme", "global")}>{t("settings.reset")}</button></label>
    <div className="theme-import-actions"><button disabled={busy} onClick={importFiles}>＋ {t("settings.themeImport")}</button><button disabled={busy} onClick={importFolder}>{t("settings.themeImportFolder")}</button></div>
    <div className="theme-directory"><strong>{t("settings.themeDirectory")}</strong><code>{directory || "—"}</code><div><button disabled={busy} onClick={chooseDirectory}>{t("settings.themeChooseDirectory")}</button><button disabled={busy || !store.global("themeDirectory")} onClick={resetDirectory}>{t("settings.themeResetDirectory")}</button></div></div>
    <section className="theme-catalog"><h3>{t("settings.themeBuiltIn")}</h3>{builtIns.map((theme) => <div className="theme-catalog-row" key={theme.id}><span><strong>{theme.name}</strong><small>{theme.id}</small></span><em>{t("settings.themeBuiltInBadge")}</em></div>)}<h3>{t("settings.themeCustom")}</h3>{userThemes.length ? userThemes.map((theme) => <div className="theme-catalog-row" key={theme.id}><span><strong>{theme.name}</strong><small>{theme.filePath ?? theme.id}</small></span><button className="danger" disabled={busy} onClick={() => remove(theme)}>{t("settings.themeDelete")}</button></div>) : <p>{t("settings.themeNone")}</p>}</section>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}

function AISkillsSettingsPanel() {
  const [skills, setSkills] = useState<AIProjectSkill[]>([]);
  const [selectedName, setSelectedName] = useState("");
  const [name, setName] = useState("");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = skills.find((skill) => skill.name === selectedName);
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

export function SettingsDialog({ onClose, initial = "general" }: { onClose(): void; initial?: Section }) {
  const store = useSettings();
  const [section, setSection] = useState<Section>(initial);
  const [scope, setScope] = useState<"global" | "project">("global");
  const [capture, setCapture] = useState<CommandId>();
  const [pending, setPending] = useState("");
  const [conflict, setConflict] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const [detecting, setDetecting] = useState(false);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { if (capture) setCapture(undefined); else onClose(); } };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [capture, onClose]);
  const sectionProjectKeys = projectSettingsBySection[section] ?? [];
  const projectScopeAvailable = Boolean(store.projectId() && sectionProjectKeys.length);
  useEffect(() => { if (!projectScopeAvailable && scope === "project") setScope("global"); }, [projectScopeAvailable, scope]);
  const read = (key: PreferenceKey) => scope === "global" ? store.global(key) : store.get(key);
  const row = (key: PreferenceKey, label: string, options?: Array<[string, string]>, numeric = false) => {
    const allowed = scope === "global" || projectPreferenceKeys.includes(key);
    const value = read(key);
    const hint = key === "hideBuildArtifacts" ? t("settings.hideBuildArtifactsHint") : key === "documentWordCompletion" ? t("settings.documentWordCompletionHint") : key === "autoPairSymbols" ? t("settings.autoPairSymbolsHint") : key === "mathPreviewOnHover" ? t("settings.mathPreviewOnHoverHint") : key === "autoEnvironmentLabels" ? t("settings.autoEnvironmentLabelsHint") : key === "confirmPreviewEdits" ? t("settings.confirmPreviewEditsHint") : key === "warnIncompatibleEnvironmentConversion" ? t("settings.warnIncompatibleEnvironmentConversionHint") : undefined;
    return <label className="preference-row" key={key}><span><strong>{t(label)}</strong>{hint && <small>{hint}</small>}{scope === "project" && !(key in store.snapshot().project) && <small>{t(allowed ? "settings.inherited" : "settings.globalOnly")}</small>}</span>
      {options ? <select data-setting={key} disabled={!allowed} value={String(value)} onChange={(event) => void store.set(key, numeric ? Number(event.target.value) : event.target.value as never, scope)}>{options.map(([id, labelKey]) => <option key={id} value={id}>{t(labelKey)}</option>)}</select> : numeric ? <input data-setting={key} disabled={!allowed} type="number" min={10} max={32} value={Number(value)} onChange={(event) => { const next = Number(event.target.value); if (next >= 10 && next <= 32) void store.set(key, next, scope); }}/> : <input data-setting={key} disabled={!allowed} type="checkbox" checked={Boolean(value)} onChange={(event) => void store.set(key, event.target.checked, scope)}/>}
      <button type="button" disabled={!allowed} onClick={() => void store.reset(key, scope)}>{t("settings.reset")}</button></label>;
  };
  const detect = async (manual?: "directory" | "executable") => { setDetecting(true); await store.detect(manual); setDetecting(false); };
  const applyBinding = (value: string, replace?: string) => {
    if (!capture) return;
    const next = { ...store.global("keybindings"), [capture]: value, ...(replace ? { [replace]: "" } : {}) };
    void store.set("keybindings", next); setCapture(undefined); setConflict(undefined);
  };
  const configured = read("environments") as EnvironmentDefinition[];
  const resetKeys = async (keys: PreferenceKey[]) => {
    for (const key of keys) {
      if (scope === "global" || projectPreferenceKeys.includes(key)) await store.reset(key, scope);
    }
  };
  const resetSection = () => void resetKeys(sectionProjectKeys.length && scope === "project" ? sectionProjectKeys : Object.keys(preferenceDefaults).filter((key) => {
    if (section === "general") return ["autoSave", "restoreProject", "maximize"].includes(key);
    if (section === "appearance") return ["theme", "themeDirectory"].includes(key);
    if (section === "editor") return ["fontSize", "tabSize", "wordWrap", "autoPairSymbols", "mathPreviewOnHover", "documentWordCompletion", "autoEnvironmentLabels", "confirmPreviewEdits", "warnIncompatibleEnvironmentConversion"].includes(key);
    if (section === "language") return key === "locale";
    if (section === "searchFilter") return key === "visibleFilterGroups";
    if (section === "compiler") return key === "engine";
    if (section === "shortcuts") return key === "keybindings";
    if (section === "spellcheck") return ["spellCheckMode", "spellCheckLanguage", "spellCheckActiveLanguages"].includes(key);
    if (section === "ai") return ["aiDefaultMode", "aiPermissionMode", "aiReasoningEffort", "aiCopilotReasoningEffort"].includes(key);
    if (section === "images") return key === "images";
    if (section === "tables") return key === "tables";
    if (section === "history") return key === "history";
    if (section === "environments") return key === "environments";
    return false;
  }) as PreferenceKey[]);
  const resetAll = () => void resetKeys(scope === "project" ? projectPreferenceKeys : Object.keys(preferenceDefaults) as PreferenceKey[]);
  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="preferences-dialog" role="dialog" aria-modal="true" aria-label={t("activity.settings")}>
    <header><h1>{t("activity.settings")}</h1><select aria-label={t("settings.scope")} value={scope} onChange={(event) => setScope(event.target.value as "global" | "project")}><option value="global">{t("settings.global")}</option>{projectScopeAvailable && <option value="project">{t("settings.project")}</option>}</select><div className="settings-header-actions">{section !== "aiSkills" && <><button type="button" onClick={resetSection}>{t("settings.resetSection")}</button><button type="button" onClick={resetAll}>{t("settings.resetAll")}</button></>}<button aria-label={t("common.close")} onClick={onClose}>×</button></div></header>
    <div className="preferences-body"><nav>{sections.map((item) => <button data-section={item} className={section === item ? "active" : ""} key={item} onClick={() => setSection(item)}>{item === "images" ? "Images" : item === "tables" ? "Tables" : t(item === "environments" ? "environment.manager" : item === "styleResources" ? "settings.styleResources" : `settings.${item}`)}</button>)}</nav><main>
      {section === "general" && <><h2>{t("settings.general")}</h2>{row("autoSave", "settings.autoSave", [["off", "settings.off"], ["afterDelay", "settings.afterDelay"]])}{row("hideBuildArtifacts", "settings.hideBuildArtifacts")}{row("restoreProject", "settings.restore")}{row("maximize", "settings.maximize")}</>}
      {section === "appearance" && <ThemeSettingsPanel store={store}/>} 
      {section === "language" && row("locale", "settings.language", [["en", "settings.localeEnglish"], ["ja", "settings.localeJapanese"], ["zh-CN", "settings.localeSimplifiedChinese"], ["zh-TW", "settings.localeTraditionalChinese"], ["ko", "settings.localeKorean"], ["fr", "settings.localeFrench"]])}
      {section === "editor" && <>{row("fontSize", "settings.fontSize", undefined, true)}{row("wordWrap", "settings.wordWrap")}{row("tabSize", "settings.tabSize", [["2", "2"], ["4", "4"], ["8", "8"]], true)}{row("autoPairSymbols", "settings.autoPairSymbols")}{row("mathPreviewOnHover", "settings.mathPreviewOnHover")}{row("documentWordCompletion", "settings.documentWordCompletion")}{row("autoEnvironmentLabels", "settings.autoEnvironmentLabels")}{row("confirmPreviewEdits", "settings.confirmPreviewEdits")}{row("warnIncompatibleEnvironmentConversion", "settings.warnIncompatibleEnvironmentConversion")}</>}
      {section === "images" && <ImageSettingsPanel store={store} scope={scope}/>}
      {section === "tables" && <TableSettingsPanel store={store} scope={scope}/>}
      {section === "history" && <HistorySettingsPanel store={store} scope={scope}/>}
      {section === "searchFilter" && <><h2>{t("settings.searchFilter")}</h2><p>{t("settings.filterGroupsHint")}</p>{(["blockType", "location", "file", "properties"] as const).map((group) => { const visible = store.global("visibleFilterGroups"); return <label className="preference-row" key={group}><span><strong>{t(`filter.${group}`)}</strong></span><input type="checkbox" checked={visible.includes(group)} onChange={(event) => void store.set("visibleFilterGroups", event.target.checked ? [...visible, group] : visible.filter((item) => item !== group))}/><button type="button" onClick={() => void store.reset("visibleFilterGroups")}>{t("settings.reset")}</button></label>; })}</>}
      {section === "environment" && <EnvironmentSettingsPanel store={store}/>}
      {section === "shortcuts" && <><p>{t("settings.globalOnly")}</p>{row("referenceLinkModifier", "settings.referenceLinkModifier", [["ctrl", "settings.modifierCtrl"], ["alt", "settings.modifierAlt"], ["shift", "settings.modifierShift"], ["meta", "settings.modifierMeta"]])}{(Object.keys(defaultBindings) as CommandId[]).map((id) => <div className="preference-row" key={id}><span><strong>{t(commandLabels[id])}</strong><small>{t(commandContexts[id])}</small></span><button data-command={id} onClick={() => { setCapture(id); setConflict(undefined); setInvalid(false); }}>{displayBinding(bindings()[id] ?? "") || t("settings.off")}</button><button onClick={() => { const next = { ...store.global("keybindings") }; delete next[id]; const duplicate = (Object.entries(bindings()) as Array<[CommandId, string]>).find(([other, value]) => other !== id && commandContexts[other] === commandContexts[id] && value === defaultBindings[id]); if (duplicate) next[duplicate[0]] = ""; void store.set("keybindings", next); }}>{t("settings.reset")}</button></div>)}
        {capture && <div className="shortcut-capture"><p>{t(commandLabels[capture])} · {t(commandContexts[capture])}</p><input data-shortcut-capture autoFocus readOnly placeholder={t("shortcut.capture")} value={displayBinding(pending)} onKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); if (event.key === "Escape") { setCapture(undefined); return; } if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return; const value = eventBinding(event.nativeEvent); setPending(value); if (!validBinding(value)) { setInvalid(true); return; } setInvalid(false); const duplicate = (Object.entries(bindings()) as Array<[CommandId, string]>).find(([id, binding]) => id !== capture && commandContexts[id] === commandContexts[capture] && binding === value); if (duplicate) setConflict(duplicate[0]); else applyBinding(value); }}/>{invalid && <p role="alert">{t("shortcut.invalid")}</p>}{conflict && <><p role="alert">{t("shortcut.conflict")} {t(commandLabels[conflict as CommandId])}</p><button onClick={() => applyBinding(pending, conflict)}>{t("shortcut.replace")}</button></>}<button onClick={() => setCapture(undefined)}>{t("project.cancel")}</button></div>}</>}
      {section === "compiler" && <><h2>{t("settings.localToolchain")}</h2><p>{t("settings.globalOnly")}</p><div className="toolchain-actions"><button disabled={detecting} onClick={() => void detect()}>{t("settings.detect")}</button><button disabled={detecting} onClick={() => void detect("directory")}>{t("settings.locate")}</button><button disabled={detecting} onClick={() => void detect("executable")}>{t("settings.executable")}</button></div><p>{store.snapshot().toolchain?.distribution ?? "unknown"}</p>{(["latexmk", "pdflatex", "xelatex", "lualatex", "bibtex", "biber"] as const).map((tool) => <div className="toolchain-row" key={tool}><strong>{tool}</strong><span>{t(store.snapshot().toolchain?.[tool] ? "settings.found" : "settings.notFound")}</span><code>{store.snapshot().toolchain?.[tool] ?? "—"}</code></div>)}{row("engine", "settings.engine", [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"]])}<p>{t("settings.mainFileHint")}</p><p>{t("settings.buildUnavailable")}</p></>}
      {section === "spellcheck" && <SpellCheckSettingsPanel store={store}/>}
      {section === "ai" && <><h2>{t("settings.ai")}</h2><p>{t("settings.aiPrivacyHint")}</p>{row("aiDefaultMode", "settings.aiDefaultMode", [["chat", "ai.copilot"], ["codex", "ai.codex"]])}{row("aiPermissionMode", "settings.aiPermissionMode", [["ask", "ai.permission.ask"], ["auto", "ai.permission.auto"], ["full", "ai.permission.full"]])}<div className="ai-phase-card"><strong>{t("settings.aiChangeReview")}</strong><p>{t("settings.aiChangeReviewDetails")}</p></div></>}
      {section === "aiSkills" && <AISkillsSettingsPanel/>}
      {section === "environments" && <div className="settings-environments"><button onClick={() => void store.reset("environments", scope)}>{t("settings.reset")}</button><EnvironmentManager definitions={configured.length ? includeNewBuiltInEnvironments(configured) : DEFAULT_ENVIRONMENTS} onChange={(next) => void store.set("environments", next, scope)}/></div>}
      {section === "styleResources" && <StyleResourcesPanel/>}
      {store.error() && <p role="alert">{t("settings.saveFailed")} {store.error()}</p>}
    </main></div><footer>{t("settings.saved")}</footer>
  </section></div>;
}
