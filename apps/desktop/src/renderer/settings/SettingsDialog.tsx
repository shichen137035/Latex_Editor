import { useEffect, useState } from "react";
import { projectPreferenceKeys, type PreferenceKey, type StyleResource, type ThemeDefinition } from "@latex-editor/contracts";
import type { SpellCheckStatus } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { EnvironmentManager } from "../preview/EnvironmentManager.js";
import { DEFAULT_ENVIRONMENTS } from "../preview/environments.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { useSettings } from "./service.js";
import { bindings, commandContexts, commandLabels, defaultBindings, displayBinding, eventBinding, validBinding, type CommandId } from "./commands.js";
import "./settings.css";

const sections = ["general", "appearance", "editor", "searchFilter", "language", "shortcuts", "compiler", "spellcheck", "environments", "styleResources"] as const;
type Section = typeof sections[number];

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
  const [loading, setLoading] = useState(false);
  const mode = store.global("spellCheckMode");
  const language = store.global("spellCheckLanguage");
  const reload = async () => {
    setLoading(true);
    try { setStatus(await window.latexEditor!.spellcheck.status()); } finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, []);
  const languages = [...new Set(["en-US", ...(status?.availableLanguages ?? [])])].sort((a, b) => a.localeCompare(b));
  const setMode = (next: "auto" | "manual" | "disabled") => { void store.set("spellCheckMode", next); };
  return <div className="spellcheck-settings">
    <div className="spellcheck-settings-header"><div><h2>{t("settings.spellcheck")}</h2><p>{t("settings.spellcheckDescription")}</p></div><button disabled={loading} onClick={() => void reload()}>{t("settings.spellcheckRefresh")}</button></div>
    <div className="spellcheck-status-card"><div><strong>{t("settings.spellcheckProvider")}</strong><span>{status?.provider === "hunspell" ? "Hunspell (nspell)" : status?.provider ?? "—"}</span></div><div><strong>{t("settings.spellcheckPlatform")}</strong><span>{status?.platform ?? "—"}</span></div><div><strong>{t("settings.spellcheckAvailability")}</strong><span className={status?.available ? "status-ok" : "status-warning"}>{status ? (status.available ? t("settings.spellcheckAvailable") : t("settings.spellcheckUnavailable")) : t("settings.spellcheckChecking")}</span></div></div>
    <label className="preference-row"><span><strong>{t("settings.spellcheckMode")}</strong><small>{t("settings.spellcheckModeHint")}</small></span><select value={mode} onChange={(event) => setMode(event.target.value as "auto" | "manual" | "disabled")}><option value="auto">{t("settings.spellcheckAuto")}</option><option value="manual">{t("settings.spellcheckManual")}</option><option value="disabled">{t("settings.spellcheckDisabled")}</option></select><button type="button" onClick={() => void store.reset("spellCheckMode")}>{t("settings.reset")}</button></label>
    {mode === "manual" && <label className="preference-row"><span><strong>{t("settings.spellcheckLanguage")}</strong><small>{t("settings.spellcheckLanguageHint")}</small></span><select value={language} onChange={(event) => void store.set("spellCheckLanguage", event.target.value)}>{languages.map((item) => <option key={item} value={item}>{item}</option>)}</select><button type="button" onClick={() => void store.reset("spellCheckLanguage")}>{t("settings.reset")}</button></label>}
    <p className="spellcheck-settings-note">{t("settings.spellcheckElectronHint")}</p>
    <p>{t("settings.spellcheckLanguages")}: {status?.availableLanguages.join(", ") || "—"}</p>
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
    <label className="preference-row"><span><strong>{t("settings.activeTheme")}</strong><small>{t("settings.activeThemeHint")}</small></span><select value={store.global("theme")} onChange={(event) => void store.set("theme", event.target.value)}>{[...builtIns, ...userThemes].map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}</select><button type="button" onClick={() => void store.reset("theme")}>{t("settings.reset")}</button></label>
    <div className="theme-import-actions"><button disabled={busy} onClick={importFiles}>＋ {t("settings.themeImport")}</button><button disabled={busy} onClick={importFolder}>{t("settings.themeImportFolder")}</button></div>
    <div className="theme-directory"><strong>{t("settings.themeDirectory")}</strong><code>{directory || "—"}</code><div><button disabled={busy} onClick={chooseDirectory}>{t("settings.themeChooseDirectory")}</button><button disabled={busy || !store.global("themeDirectory")} onClick={resetDirectory}>{t("settings.themeResetDirectory")}</button></div></div>
    <section className="theme-catalog"><h3>{t("settings.themeBuiltIn")}</h3>{builtIns.map((theme) => <div className="theme-catalog-row" key={theme.id}><span><strong>{theme.name}</strong><small>{theme.id}</small></span><em>{t("settings.themeBuiltInBadge")}</em></div>)}<h3>{t("settings.themeCustom")}</h3>{userThemes.length ? userThemes.map((theme) => <div className="theme-catalog-row" key={theme.id}><span><strong>{theme.name}</strong><small>{theme.filePath ?? theme.id}</small></span><button className="danger" disabled={busy} onClick={() => remove(theme)}>{t("settings.themeDelete")}</button></div>) : <p>{t("settings.themeNone")}</p>}</section>
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
  const read = (key: PreferenceKey) => scope === "global" ? store.global(key) : store.get(key);
  const row = (key: PreferenceKey, label: string, options?: Array<[string, string]>, numeric = false) => {
    const allowed = scope === "global" || projectPreferenceKeys.includes(key);
    const value = read(key);
    const hint = key === "hideBuildArtifacts" ? t("settings.hideBuildArtifactsHint") : key === "documentWordCompletion" ? t("settings.documentWordCompletionHint") : key === "confirmPreviewEdits" ? t("settings.confirmPreviewEditsHint") : undefined;
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
  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="preferences-dialog" role="dialog" aria-modal="true" aria-label={t("activity.settings")}>
    <header><h1>{t("activity.settings")}</h1><select aria-label={t("settings.scope")} value={scope} onChange={(event) => setScope(event.target.value as "global" | "project")}><option value="global">{t("settings.global")}</option>{store.projectId() && <option value="project">{t("settings.project")}</option>}</select><button aria-label={t("common.close")} onClick={onClose}>×</button></header>
    <div className="preferences-body"><nav>{sections.map((item) => <button data-section={item} className={section === item ? "active" : ""} key={item} onClick={() => setSection(item)}>{t(item === "environments" ? "environment.manager" : item === "styleResources" ? "settings.styleResources" : `settings.${item}`)}</button>)}</nav><main>
      {section === "general" && <><h2>{t("settings.general")}</h2>{row("autoSave", "settings.autoSave", [["off", "settings.off"], ["afterDelay", "settings.afterDelay"]])}{row("hideBuildArtifacts", "settings.hideBuildArtifacts")}{row("restoreProject", "settings.restore")}{row("maximize", "settings.maximize")}</>}
      {section === "appearance" && <ThemeSettingsPanel store={store}/>} 
      {section === "language" && row("locale", "settings.language", [["en", "English"], ["ja", "日本語"]])}
      {section === "editor" && <>{row("fontSize", "settings.fontSize", undefined, true)}{row("wordWrap", "settings.wordWrap")}{row("tabSize", "settings.tabSize", [["2", "2"], ["4", "4"], ["8", "8"]], true)}{row("documentWordCompletion", "settings.documentWordCompletion")}{row("confirmPreviewEdits", "settings.confirmPreviewEdits")}</>}
      {section === "searchFilter" && <><h2>{t("settings.searchFilter")}</h2><p>{t("settings.filterGroupsHint")}</p>{(["blockType", "location", "file", "properties"] as const).map((group) => { const visible = store.global("visibleFilterGroups"); return <label className="preference-row" key={group}><span><strong>{t(`filter.${group}`)}</strong></span><input type="checkbox" checked={visible.includes(group)} onChange={(event) => void store.set("visibleFilterGroups", event.target.checked ? [...visible, group] : visible.filter((item) => item !== group))}/><button type="button" onClick={() => void store.reset("visibleFilterGroups")}>{t("settings.reset")}</button></label>; })}</>}
      {section === "shortcuts" && <><p>{t("settings.globalOnly")}</p>{row("referenceLinkModifier", "settings.referenceLinkModifier", [["ctrl", "settings.modifierCtrl"], ["alt", "settings.modifierAlt"], ["shift", "settings.modifierShift"], ["meta", "settings.modifierMeta"]])}{(Object.keys(defaultBindings) as CommandId[]).map((id) => <div className="preference-row" key={id}><span><strong>{t(commandLabels[id])}</strong><small>{t(commandContexts[id])}</small></span><button data-command={id} onClick={() => { setCapture(id); setConflict(undefined); setInvalid(false); }}>{displayBinding(bindings()[id] ?? "") || t("settings.off")}</button><button onClick={() => { const next = { ...store.global("keybindings") }; delete next[id]; const duplicate = (Object.entries(bindings()) as Array<[CommandId, string]>).find(([other, value]) => other !== id && commandContexts[other] === commandContexts[id] && value === defaultBindings[id]); if (duplicate) next[duplicate[0]] = ""; void store.set("keybindings", next); }}>{t("settings.reset")}</button></div>)}
        {capture && <div className="shortcut-capture"><p>{t(commandLabels[capture])} · {t(commandContexts[capture])}</p><input data-shortcut-capture autoFocus readOnly placeholder={t("shortcut.capture")} value={displayBinding(pending)} onKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); if (event.key === "Escape") { setCapture(undefined); return; } if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return; const value = eventBinding(event.nativeEvent); setPending(value); if (!validBinding(value)) { setInvalid(true); return; } setInvalid(false); const duplicate = (Object.entries(bindings()) as Array<[CommandId, string]>).find(([id, binding]) => id !== capture && commandContexts[id] === commandContexts[capture] && binding === value); if (duplicate) setConflict(duplicate[0]); else applyBinding(value); }}/>{invalid && <p role="alert">{t("shortcut.invalid")}</p>}{conflict && <><p role="alert">{t("shortcut.conflict")} {t(commandLabels[conflict as CommandId])}</p><button onClick={() => applyBinding(pending, conflict)}>{t("shortcut.replace")}</button></>}<button onClick={() => setCapture(undefined)}>{t("project.cancel")}</button></div>}</>}
      {section === "compiler" && <><h2>{t("settings.localToolchain")}</h2><p>{t("settings.globalOnly")}</p><div className="toolchain-actions"><button disabled={detecting} onClick={() => void detect()}>{t("settings.detect")}</button><button disabled={detecting} onClick={() => void detect("directory")}>{t("settings.locate")}</button><button disabled={detecting} onClick={() => void detect("executable")}>{t("settings.executable")}</button></div><p>{store.snapshot().toolchain?.distribution ?? "unknown"}</p>{(["latexmk", "pdflatex", "xelatex", "lualatex", "bibtex", "biber"] as const).map((tool) => <div className="toolchain-row" key={tool}><strong>{tool}</strong><span>{t(store.snapshot().toolchain?.[tool] ? "settings.found" : "settings.notFound")}</span><code>{store.snapshot().toolchain?.[tool] ?? "—"}</code></div>)}{row("engine", "settings.engine", [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"]])}<p>{t("settings.mainFileHint")}</p><p>{t("settings.buildUnavailable")}</p></>}
      {section === "spellcheck" && <SpellCheckSettingsPanel store={store}/>}
      {section === "environments" && <div className="settings-environments"><button onClick={() => void store.reset("environments", scope)}>{t("settings.reset")}</button><EnvironmentManager definitions={configured.length ? configured : DEFAULT_ENVIRONMENTS} onChange={(next) => void store.set("environments", next, scope)}/></div>}
      {section === "styleResources" && <StyleResourcesPanel/>}
      {store.error() && <p role="alert">{t("settings.saveFailed")} {store.error()}</p>}
    </main></div><footer>{t("settings.saved")}</footer>
  </section></div>;
}
