import { useEffect, useState } from "react";
import { latexComponentIds, type ToolchainInstallSelection, type ToolchainInstallStatus } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import type { settings } from "./service.js";

export function ToolchainInstallPanel({ store, onRunningChange }: { store: typeof settings; onRunningChange: (running: boolean) => void }) {
  const [status, setStatus] = useState<ToolchainInstallStatus>();
  const [directory, setDirectory] = useState("");
  const current = store.snapshot().toolchain;
  const initialDistribution = current?.distribution === "texlive" ? "tinytex" : "miktex";
  const [selection, setSelection] = useState<ToolchainInstallSelection>({ distribution: initialDistribution, components: ["math", "tables"], customPackages: [], full: false, autoInstall: true, existing: Boolean(current?.binDirectory && ["miktex", "texlive"].includes(current.distribution)) });
  const [customPackages, setCustomPackages] = useState("");
  const compatible = current?.binDirectory && current.distribution === (selection.distribution === "miktex" ? "miktex" : "texlive");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const running = Boolean(status?.running);
  useEffect(() => {
    let mounted = true;
    void window.latexEditor!.settings.toolchainInstallStatus().then(async value => {
      if (mounted) {
        setStatus(value);
        if (value.selection) { setSelection(value.selection); setCustomPackages(value.selection.customPackages.join(", ")); }
        setDirectory(value.selection ? value.directory : value.defaultDirectories?.[initialDistribution] ?? value.defaultDirectory);
        if (value.phase === "complete") await store.load(store.projectId());
      }
    }).catch(reason => { if (mounted) setError(String(reason)); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { onRunningChange(running || submitting); }, [running, submitting, onRunningChange]);
  useEffect(() => {
    if (!running) return;
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await window.latexEditor!.settings.toolchainInstallStatus();
        if (!mounted) return;
        setStatus(next);
        if (!next.running && next.phase === "complete") await store.load(store.projectId());
        if (next.running && mounted) timer = setTimeout(() => void refresh(), 1000);
      } catch (reason) {
        if (mounted) { setError(String(reason)); timer = setTimeout(() => void refresh(), 2000); }
      }
    };
    timer = setTimeout(() => void refresh(), 500);
    return () => { mounted = false; clearTimeout(timer); };
  }, [running, store]);
  const install = async () => {
    setSubmitting(true); setError("");
    try { setStatus(await window.latexEditor!.settings.installToolchain(directory, { ...selection, customPackages: customPackages.split(/[\s,;]+/).filter(Boolean) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSubmitting(false); }
  };
  const busy = running || submitting;
  const changeDistribution = (distribution: ToolchainInstallSelection["distribution"]) => {
    setSelection(previous => ({ ...previous, distribution, existing: Boolean(current?.binDirectory && current.distribution === (distribution === "miktex" ? "miktex" : "texlive")) }));
    setDirectory(status?.defaultDirectories?.[distribution] ?? status?.defaultDirectory ?? "");
  };
  return <section className="toolchain-install-panel">
    <h3>{t("toolchainInstall.title")}</h3>
    <p>{t("toolchainInstall.hint")}</p>
    {status && !status.supported ? <p>{t("toolchainInstall.windows")}</p> : <>
      <label htmlFor="latex-install-distribution">{t("toolchainInstall.distribution")}</label>
      <select id="latex-install-distribution" disabled={busy} value={selection.distribution} onChange={event => changeDistribution(event.target.value as ToolchainInstallSelection["distribution"])}>
        <option value="miktex">{t("toolchainInstall.miktex")}</option><option value="tinytex">{t("toolchainInstall.tinytex")}</option>
      </select>
      <p>{t(`toolchainInstall.description.${selection.distribution}`)}</p>
      {compatible && <label className="toolchain-install-check"><input data-latex-existing type="checkbox" checked={selection.existing} disabled={busy} onChange={event => setSelection({ ...selection, existing: event.target.checked })}/><span>{t("toolchainInstall.existing")}<small>{current.binDirectory}</small></span></label>}
      <fieldset disabled={busy} className="toolchain-install-components"><legend>{t("toolchainInstall.components")}</legend>
        <p>{t("toolchainInstall.core")}</p>
        {latexComponentIds.map(id => <label className="toolchain-install-check" key={id}><input data-latex-component={id} type="checkbox" disabled={selection.full} checked={selection.components.includes(id)} onChange={event => setSelection({ ...selection, components: event.target.checked ? [...selection.components, id] : selection.components.filter(item => item !== id) })}/><span>{t(`toolchainInstall.component.${id}`)}<small>{t(`toolchainInstall.componentHint.${id}`)}</small></span></label>)}
        <label className="toolchain-install-check"><input data-latex-full type="checkbox" checked={selection.full} onChange={event => setSelection({ ...selection, full: event.target.checked })}/><span>{t("toolchainInstall.full")}<small>{t("toolchainInstall.fullHint")}</small></span></label>
        <label htmlFor="latex-install-packages">{t("toolchainInstall.custom")}</label><input id="latex-install-packages" value={customPackages} placeholder={t("toolchainInstall.customExample")} onChange={event => setCustomPackages(event.target.value)}/><small>{t("toolchainInstall.customHint")}</small>
        {selection.distribution === "miktex" && <label className="toolchain-install-check"><input data-latex-auto type="checkbox" checked={selection.autoInstall} onChange={event => setSelection({ ...selection, autoInstall: event.target.checked })}/><span>{t("toolchainInstall.auto")}<small>{t("toolchainInstall.autoHint")}</small></span></label>}
      </fieldset>
      {selection.existing && compatible ? <p>{t("toolchainInstall.existingHint")}</p> : <>
      <label htmlFor="latex-install-directory">{t("toolchainInstall.directory")}</label>
      <div className="toolchain-install-directory"><input id="latex-install-directory" value={directory} disabled={busy} onChange={event => setDirectory(event.target.value)}/><button disabled={busy} onClick={() => { void window.latexEditor!.dialogs.pickFolder().then(folder => { if (folder) setDirectory(folder); }).catch(reason => setError(String(reason))); }}>{t("project.browse")}</button></div>
      <small>{t("toolchainInstall.folderHint")}</small></>}
      <div className="toolchain-install-actions"><button className="primary" disabled={busy || !status || !directory.trim()} onClick={() => void install()}>{t(selection.existing ? "toolchainInstall.addComponents" : "toolchainInstall.install")}</button>{running && <button onClick={() => { void window.latexEditor!.settings.cancelToolchainInstall().then(setStatus).catch(reason => setError(String(reason))); }}>{t("project.cancel")}</button>}</div>
    </>}
    {status && status.phase !== "idle" && <div className="toolchain-install-progress" role="status" aria-live="polite">
      <strong>{t(`toolchainInstall.phase.${status.phase}`)}</strong>
      {status.phase === "downloading" && <><progress max={status.totalBytes || undefined} value={status.totalBytes ? status.downloadedBytes : undefined}/><span>{t("toolchainInstall.downloaded", { current: (status.downloadedBytes / 1048576).toFixed(1), total: (status.totalBytes / 1048576).toFixed(1) })}</span></>}
    </div>}
    {(error || status?.error) && <p className="toolchain-install-error" role="alert">{error || status?.error}</p>}
    {status?.log && <details className="toolchain-install-log"><summary>{t("toolchainInstall.log")}</summary><pre>{status.log}</pre></details>}
  </section>;
}
