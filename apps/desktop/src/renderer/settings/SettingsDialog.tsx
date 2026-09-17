import { useEffect, useState } from "react";
import { projectPreferenceKeys, type PreferenceKey } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { EnvironmentManager } from "../preview/EnvironmentManager.js";
import { DEFAULT_ENVIRONMENTS } from "../preview/environments.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { useSettings } from "./service.js";
import { bindings, commandLabels, defaultBindings, displayBinding, eventBinding, validBinding, type CommandId } from "./commands.js";
import "./settings.css";

const sections = ["general", "appearance", "editor", "language", "shortcuts", "compiler", "environments"] as const;
type Section = typeof sections[number];
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
    return <label className="preference-row" key={key}><span><strong>{t(label)}</strong>{scope === "project" && !(key in store.snapshot().project) && <small>{t(allowed ? "settings.inherited" : "settings.globalOnly")}</small>}</span>
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
    <div className="preferences-body"><nav>{sections.map((item) => <button data-section={item} className={section === item ? "active" : ""} key={item} onClick={() => setSection(item)}>{t(item === "environments" ? "environment.manager" : `settings.${item}`)}</button>)}</nav><main>
      {section === "general" && <>{row("autoSave", "settings.autoSave", [["off", "settings.off"], ["afterDelay", "settings.afterDelay"]])}{row("hideBuildArtifacts", "settings.hideBuildArtifacts")}{row("restoreProject", "settings.restore")}{row("maximize", "settings.maximize")}</>}
      {section === "appearance" && row("theme", "settings.theme", [["light", "settings.light"], ["dark", "settings.dark"]])}
      {section === "language" && row("locale", "settings.language", [["en", "English"], ["ja", "日本語"]])}
      {section === "editor" && <>{row("fontSize", "settings.fontSize", undefined, true)}{row("wordWrap", "settings.wordWrap")}{row("tabSize", "settings.tabSize", [["2", "2"], ["4", "4"], ["8", "8"]], true)}</>}
      {section === "shortcuts" && <><p>{t("settings.globalOnly")}</p>{(Object.keys(defaultBindings) as CommandId[]).map((id) => <div className="preference-row" key={id}><strong>{t(commandLabels[id])}</strong><button data-command={id} onClick={() => { setCapture(id); setConflict(undefined); setInvalid(false); }}>{displayBinding(bindings()[id] ?? "") || t("settings.off")}</button><button onClick={() => { const next = { ...store.global("keybindings") }; delete next[id]; const duplicate = Object.entries(bindings()).find(([other, value]) => other !== id && value === defaultBindings[id]); if (duplicate) next[duplicate[0]] = ""; void store.set("keybindings", next); }}>{t("settings.reset")}</button></div>)}
        {capture && <div className="shortcut-capture"><p>{t(commandLabels[capture])}</p><input data-shortcut-capture autoFocus readOnly placeholder={t("shortcut.capture")} value={displayBinding(pending)} onKeyDown={(event) => { event.preventDefault(); event.stopPropagation(); if (event.key === "Escape") { setCapture(undefined); return; } if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return; const value = eventBinding(event.nativeEvent); setPending(value); if (!validBinding(value)) { setInvalid(true); return; } setInvalid(false); const duplicate = Object.entries(bindings()).find(([id, binding]) => id !== capture && binding === value); if (duplicate) setConflict(duplicate[0]); else applyBinding(value); }}/>{invalid && <p role="alert">{t("shortcut.invalid")}</p>}{conflict && <><p role="alert">{t("shortcut.conflict")} {t(commandLabels[conflict as CommandId])}</p><button onClick={() => applyBinding(pending, conflict)}>{t("shortcut.replace")}</button></>}<button onClick={() => setCapture(undefined)}>{t("project.cancel")}</button></div>}</>}
      {section === "compiler" && <><h2>{t("settings.localToolchain")}</h2><p>{t("settings.globalOnly")}</p><div className="toolchain-actions"><button disabled={detecting} onClick={() => void detect()}>{t("settings.detect")}</button><button disabled={detecting} onClick={() => void detect("directory")}>{t("settings.locate")}</button><button disabled={detecting} onClick={() => void detect("executable")}>{t("settings.executable")}</button></div><p>{store.snapshot().toolchain?.distribution ?? "unknown"}</p>{(["latexmk", "pdflatex", "xelatex", "lualatex", "bibtex", "biber"] as const).map((tool) => <div className="toolchain-row" key={tool}><strong>{tool}</strong><span>{t(store.snapshot().toolchain?.[tool] ? "settings.found" : "settings.notFound")}</span><code>{store.snapshot().toolchain?.[tool] ?? "—"}</code></div>)}{row("engine", "settings.engine", [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"]])}<p>{t("settings.mainFileHint")}</p><p>{t("settings.buildUnavailable")}</p></>}
      {section === "environments" && <div className="settings-environments"><button onClick={() => void store.reset("environments", scope)}>{t("settings.reset")}</button><EnvironmentManager definitions={configured.length ? configured : DEFAULT_ENVIRONMENTS} onChange={(next) => void store.set("environments", next, scope)}/></div>}
      {store.error() && <p role="alert">{t("settings.saveFailed")} {store.error()}</p>}
    </main></div><footer>{t("settings.saved")}</footer>
  </section></div>;
}
