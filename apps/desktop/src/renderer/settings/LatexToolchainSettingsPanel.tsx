import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { LatexToolchain } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import type { settings } from "./service.js";
import { ToolchainInstallPanel } from "./ToolchainInstallPanel.js";

export function LatexToolchainSettingsPanel({ store, toolbarTarget, onBusyChange }: { store: typeof settings; toolbarTarget?: HTMLElement | null; onBusyChange?: (busy: boolean) => void }) {
  const [detecting, setDetecting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installationOpen, setInstallationOpen] = useState(false);
  useEffect(() => { onBusyChange?.(detecting || installing); }, [detecting, installing, onBusyChange]);
  const toolchain = store.snapshot().toolchain as LatexToolchain | undefined;
  const status = toolchain?.overallStatus ?? (toolchain?.available ? "ready" : toolchain ? "unavailable" : "unknown");
  const tools = [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"], ["latexmk", "latexmk"], ["bibtex", "BibTeX"], ["biber", "Biber"], ["makeindex", "MakeIndex"]] as const;
  const detect = async (manual?: "directory" | "executable") => { setDetecting(true); await store.detect(manual); setDetecting(false); };
  const toolbar = <div className="toolchain-manager-toolbar"><button disabled={detecting || installing} onClick={() => void detect()}>{t("settings.recheck")}</button><button disabled={detecting || installing} onClick={() => void detect("directory")}>{t("settings.locate")}</button><button disabled={detecting || installing} onClick={() => void detect("executable")}>{t("settings.executable")}</button></div>;
  return <div className="environment-settings">
    {toolbarTarget !== undefined ? toolbarTarget && createPortal(toolbar, toolbarTarget) : <div className="environment-settings-header">{toolbar}</div>}
    <section className={`environment-status-card ${status}`}><div><strong>{t("settings.environmentStatus")}</strong><b>{t(`settings.environmentStatus.${status}`)}</b></div><div><strong>{t("settings.distribution")}</strong><span>{toolchain?.distribution ?? t("settings.notChecked")}{toolchain?.version ? ` · ${toolchain.version}` : ""}</span></div><div><strong>{t("settings.installation")}</strong><code>{toolchain?.binDirectory ?? t("settings.notConfigured")}</code></div></section>
    <section className="environment-tool-grid"><h3>{t("settings.latexTools")}</h3>{tools.map(([id, label]) => <div className="environment-tool-row" key={id}><strong>{label}</strong><span className={(toolchain?.environment ? toolchain.environment[id].status === "ready" : toolchain?.[id]) ? "status-ok" : "status-warning"}>{(toolchain?.environment ? toolchain.environment[id].status === "ready" : toolchain?.[id]) ? t("settings.found") : t("settings.notFound")}</span><code>{toolchain?.[id] ?? "—"}</code></div>)}</section>
    {status === "limited" && <p className="spellcheck-settings-note">{t("settings.limitedToolchain")}</p>}
    {status === "unavailable" && <p className="spellcheck-settings-note">{t("settings.missingToolchain")}</p>}
    <label className="toolchain-install-check"><input data-texlive-auto-install type="checkbox" checked={store.global("texLiveAutoInstall")} disabled={installing} onChange={event => void store.set("texLiveAutoInstall", event.target.checked)}/><span>{t("toolchainInstall.texLiveAuto")}<small>{t("toolchainInstall.texLiveAutoHint")}</small></span></label>
    <details className="toolchain-install-options" onToggle={event => setInstallationOpen(event.currentTarget.open)} open={installationOpen || installing || !tools.every(([id]) => toolchain?.environment ? toolchain.environment[id].status === "ready" : Boolean(toolchain?.[id]))}>
      <summary>{t("toolchainInstall.title")}</summary><ToolchainInstallPanel store={store} onRunningChange={setInstalling}/>
    </details>
  </div>;
}

