import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LatexToolchain } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import type { settings } from "./service.js";
import { ToolchainInstallPanel } from "./ToolchainInstallPanel.js";
import { toolchainReadiness, toolchainTools, toolReady } from "./toolchainReadiness.js";

export function LatexToolchainSettingsPanel({ store, toolbarTarget, onBusyChange }: { store: typeof settings; toolbarTarget?: HTMLElement | null; onBusyChange?: (busy: boolean) => void }) {
  const [detecting, setDetecting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installationOpen, setInstallationOpen] = useState(() => !toolchainReadiness(store.snapshot().toolchain, store.get("engine")).complete);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => { onBusyChange?.(detecting || installing); }, [detecting, installing, onBusyChange]);
  const toolchain = store.snapshot().toolchain as LatexToolchain | undefined;
  const readiness = toolchainReadiness(toolchain, store.get("engine"));
  const status = readiness.ready ? "ready" : toolchain?.overallStatus === "unavailable" ? "unavailable" : toolchain ? "limited" : "unknown";
  const detect = async (manual?: "directory" | "executable") => { setDetecting(true); try { await store.detect(manual); } finally { setDetecting(false); } };
  useEffect(() => { void detect(); }, []);
  const configure = () => {
    setInstallationOpen(true);
    requestAnimationFrame(() => { const button = panel.current?.querySelector<HTMLButtonElement>(".toolchain-install-actions .primary"); button?.scrollIntoView({ block: "center" }); button?.focus(); });
  };
  const toolbar = <div className="toolchain-manager-toolbar"><button disabled={detecting || installing} onClick={() => void detect()}>{t("settings.recheck")}</button><button disabled={detecting || installing} onClick={() => void detect("directory")}>{t("settings.locate")}</button><button disabled={detecting || installing} onClick={() => void detect("executable")}>{t("settings.executable")}</button></div>;
  return <div className="environment-settings" ref={panel}>
    {toolbarTarget !== undefined ? toolbarTarget && createPortal(toolbar, toolbarTarget) : <div className="environment-settings-header">{toolbar}</div>}
    <section className="toolchain-guidance" role="status"><h3>{t(readiness.ready ? "toolchainGuide.ready" : "toolchainGuide.title")}</h3><p>{t("toolchainGuide.hint")}</p>
      {!readiness.ready && readiness.known && <p>{t("toolchainGuide.required", { tools: readiness.missing.join(", ") })}</p>}
      {!!readiness.broken.length && <p>{t("toolchainGuide.broken", { tools: readiness.broken.join(", ") })}</p>}
      <label>{t("build.engine")}<select data-toolchain-engine value={store.get("engine")} disabled={installing} onChange={event => void store.set("engine", event.target.value as "pdflatex" | "xelatex" | "lualatex", store.projectId() ? "project" : "global")}><option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option></select></label>
      <button className="primary" data-toolchain-configure disabled={detecting || installing} onClick={configure}>{t("toolchainGuide.configure")}</button><p>{t("toolchainGuide.existing")}</p>
      {detecting && <small>{t("toolchainGuide.checking")}</small>}{store.error() && <p role="alert" className="toolchain-install-error">{store.error()}</p>}
    </section>
    <section className={`environment-status-card ${status}`}><div><strong>{t("settings.environmentStatus")}</strong><b>{t(`settings.environmentStatus.${status}`)}</b></div><div><strong>{t("settings.distribution")}</strong><span>{toolchain?.distribution ?? t("settings.notChecked")}{toolchain?.version ? ` · ${toolchain.version}` : ""}</span></div><div><strong>{t("settings.installation")}</strong><code>{toolchain?.binDirectory ?? t("settings.notConfigured")}</code></div></section>
    <section className="environment-tool-grid"><h3>{t("settings.latexTools")}</h3>{toolchainTools.map(([id, label]) => <div className="environment-tool-row" key={id}><strong>{label}</strong><span title={toolchain?.environment?.[id]?.error} className={toolReady(toolchain, id) ? "status-ok" : "status-warning"}>{toolReady(toolchain, id) ? t("settings.found") : toolchain?.environment?.[id]?.status === "broken" ? t("toolchainGuide.toolBroken") : t("settings.notFound")}</span><code>{toolchain?.[id] ?? "—"}{toolchain?.environment?.[id]?.error && <small>{toolchain.environment[id].error}</small>}</code></div>)}</section>
    {status === "limited" && <p className="spellcheck-settings-note">{t("settings.limitedToolchain")}</p>}
    {status === "unavailable" && <p className="spellcheck-settings-note">{t("settings.missingToolchain")}</p>}
    <label className="toolchain-install-check"><input data-texlive-auto-install type="checkbox" checked={store.global("texLiveAutoInstall")} disabled={installing} onChange={event => void store.set("texLiveAutoInstall", event.target.checked)}/><span>{t("toolchainInstall.texLiveAuto")}<small>{t("toolchainInstall.texLiveAutoHint")}</small></span></label>
    <details className="toolchain-install-options" onToggle={event => setInstallationOpen(event.currentTarget.open)} open={installationOpen || installing}>
      <summary>{t("toolchainInstall.title")}</summary><ToolchainInstallPanel store={store} onRunningChange={setInstalling} detecting={detecting}/>
    </details>
  </div>;
}

