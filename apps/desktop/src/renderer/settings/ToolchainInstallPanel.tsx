import { useEffect, useState } from "react";
import type { ToolchainInstallStatus } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import type { settings } from "./service.js";

export function ToolchainInstallPanel({ store, onRunningChange }: { store: typeof settings; onRunningChange: (running: boolean) => void }) {
  const [status, setStatus] = useState<ToolchainInstallStatus>();
  const [directory, setDirectory] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const running = Boolean(status?.running);
  useEffect(() => {
    let mounted = true;
    void window.latexEditor!.settings.toolchainInstallStatus().then(async value => {
      if (mounted) {
        setStatus(value); setDirectory(value.directory || value.defaultDirectory);
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
    try { setStatus(await window.latexEditor!.settings.installToolchain(directory)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSubmitting(false); }
  };
  const busy = running || submitting;
  return <section className="toolchain-install-panel">
    <h3>{t("toolchainInstall.title")}</h3>
    <p>{t("toolchainInstall.hint")}</p>
    {status && !status.supported ? <p>{t("toolchainInstall.windows")}</p> : <>
      <label htmlFor="latex-install-directory">{t("toolchainInstall.directory")}</label>
      <div className="toolchain-install-directory"><input id="latex-install-directory" value={directory} disabled={busy} onChange={event => setDirectory(event.target.value)}/><button disabled={busy} onClick={() => { void window.latexEditor!.dialogs.pickFolder().then(folder => { if (folder) setDirectory(folder); }).catch(reason => setError(String(reason))); }}>{t("project.browse")}</button></div>
      <small>{t("toolchainInstall.folderHint")}</small>
      <div className="toolchain-install-actions"><button className="primary" disabled={busy || !status || !directory.trim()} onClick={() => void install()}>{t("toolchainInstall.install")}</button>{running && <button onClick={() => { void window.latexEditor!.settings.cancelToolchainInstall().then(setStatus).catch(reason => setError(String(reason))); }}>{t("project.cancel")}</button>}</div>
    </>}
    {status && status.phase !== "idle" && <div className="toolchain-install-progress" role="status" aria-live="polite">
      <strong>{t(`toolchainInstall.phase.${status.phase}`)}</strong>
      {status.phase === "downloading" && <><progress max={status.totalBytes || undefined} value={status.totalBytes ? status.downloadedBytes : undefined}/><span>{t("toolchainInstall.downloaded", { current: (status.downloadedBytes / 1048576).toFixed(1), total: (status.totalBytes / 1048576).toFixed(1) })}</span></>}
    </div>}
    {(error || status?.error) && <p className="toolchain-install-error" role="alert">{error || status?.error}</p>}
    {status?.log && <details className="toolchain-install-log"><summary>{t("toolchainInstall.log")}</summary><pre>{status.log}</pre></details>}
  </section>;
}
