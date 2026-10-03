import { DiffEditor } from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { suggestHistoryVersion, type HistoryFileChange, type ProjectHistoryDetails, type ProjectHistoryEntry, type ProjectHistoryStorage } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { editorThemeName } from "../themes/runtime.js";
import { settings } from "../settings/service.js";
import "./history.css";

type Filter = "all" | "version" | "snapshot" | "temporary";
type Dialog = { kind: "version" | "temporary" | "promote" | "edit"; entry?: ProjectHistoryEntry } | { kind: "restore"; entry: ProjectHistoryEntry } | { kind: "compare"; path: string; historical?: string; current?: string };

const label = (entry: ProjectHistoryEntry) => entry.type === "version" ? `${t("history.version")} ${entry.versionNumber}` : entry.title || (entry.type === "temporary" ? t("history.temporary") : t("history.snapshot"));
const date = (value: string) => new Intl.DateTimeFormat(settings.get("locale"), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function ProjectHistoryPanel({ projectId, onBeforeCapture, onRestored, onOpenSettings }: {
  projectId: string;
  onBeforeCapture(): Promise<void>;
  onRestored(paths: string[]): Promise<void>;
  onOpenSettings(): void;
}) {
  const api = window.latexEditor!.history;
  const [entries, setEntries] = useState<ProjectHistoryEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [details, setDetails] = useState<ProjectHistoryDetails>();
  const [storage, setStorage] = useState<ProjectHistoryStorage>();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>();
  const [versionNumber, setVersionNumber] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reload = async () => {
    const [list, usage] = await Promise.all([api.list(projectId), api.storage(projectId)]);
    setEntries(list); setStorage(usage);
    setSelectedId((current) => current && list.some((entry) => entry.id === current) ? current : list[0]?.id);
  };
  useEffect(() => { let live = true;
    const refresh = () => void Promise.all([api.list(projectId), api.storage(projectId)]).then(([list, usage]) => {
      if (!live) return;
      setEntries(list); setStorage(usage);
      setSelectedId((current) => current && list.some((entry) => entry.id === current) ? current : list[0]?.id);
    }).catch((reason: unknown) => { if (live) setError(String(reason)); });
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [api, projectId]);
  useEffect(() => { if (!selectedId) { setDetails(undefined); return; } let live = true;
    void api.details(projectId, selectedId).then((result) => { if (live) setDetails(result); }).catch((reason: unknown) => { if (live) setError(String(reason)); });
    return () => { live = false; };
  }, [projectId, selectedId, entries]);

  const visible = useMemo(() => entries.filter((entry) => (filter === "all" || entry.type === filter)
    && `${entry.versionNumber ?? ""} ${entry.title ?? ""} ${entry.summary ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [entries, filter, query]);
  const selected = entries.find((entry) => entry.id === selectedId);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await work(); await reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const openForm = (kind: "version" | "temporary" | "promote" | "edit", entry?: ProjectHistoryEntry) => {
    setDialog({ kind, ...(entry ? { entry } : {}) }); setError("");
    setVersionNumber(kind === "edit" ? entry?.versionNumber ?? "" : suggestHistoryVersion(entries));
    setTitle(entry?.title ?? ""); setSummary(entry?.summary ?? "");
  };
  const saveForm = () => void run(async () => {
    if (!dialog || !["version", "temporary", "promote", "edit"].includes(dialog.kind)) return;
    if (dialog.kind === "version") { await onBeforeCapture(); await api.createVersion(projectId, { versionNumber, title, summary }); }
    else if (dialog.kind === "temporary") { await onBeforeCapture(); await api.createTemporary(projectId, { title, summary }); }
    else if (dialog.kind === "promote" && dialog.entry) await api.promote(projectId, dialog.entry.id, { versionNumber, title, summary });
    else if (dialog.kind === "edit" && dialog.entry) await api.editVersion(projectId, dialog.entry.id, { title, summary });
    setDialog(undefined);
  });
  const openRestore = (entry: ProjectHistoryEntry) => {
    setSelectedPaths(details?.entry.id === entry.id ? details.changes.map((change) => change.path) : []);
    setDialog({ kind: "restore", entry });
  };
  const restore = (entry: ProjectHistoryEntry, partial: boolean) => void run(async () => {
    await onBeforeCapture();
    const result = await api.restore(projectId, entry.id, partial ? selectedPaths : undefined);
    await onRestored(result.restored);
    setDialog(undefined);
  });
  const compare = (change: HistoryFileChange) => void run(async () => {
    if (!selected) return;
    const historical = change.inHistory ? await api.readText(projectId, selected.id, change.path) : "";
    const current = change.status === "removed" ? "" : await window.latexEditor!.files.read(projectId, change.path).then((file) => file.content).catch(() => undefined);
    setDialog({ kind: "compare", path: change.path, ...(historical !== undefined ? { historical } : {}), ...(current !== undefined ? { current } : {}) });
  });

  return <section className="project-history-panel" aria-label={t("history.title")}>
    <header className="history-heading"><strong>{t("history.title")}</strong><button onClick={() => void run(async () => { await onBeforeCapture(); await api.snapshot(projectId, "manual"); })} disabled={busy} title={t("history.createSnapshot")}>＋</button><button onClick={onOpenSettings} title={t("history.settings")}>⚙</button></header>
    <div className="history-create"><button onClick={() => openForm("version")} disabled={busy}>{t("history.createVersion")}</button><button onClick={() => openForm("temporary")} disabled={busy}>{t("history.createTemporary")}</button></div>
    <div className="history-filters"><select aria-label={t("history.filter")} value={filter} onChange={(event) => setFilter(event.target.value as Filter)}><option value="all">{t("history.all")}</option><option value="version">{t("history.versions")}</option><option value="snapshot">{t("history.snapshots")}</option><option value="temporary">{t("history.temporarySaves")}</option></select><input aria-label={t("history.search")} placeholder={t("history.search")} value={query} onChange={(event) => setQuery(event.target.value)}/></div>
    <div className="history-scroll"><div className="history-current">● {t("history.current")}</div>{visible.length ? visible.map((entry) => <button key={entry.id} data-history-id={entry.id} className={`history-entry ${entry.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(entry.id)}><span className={`history-dot ${entry.type}`}>●</span><span><strong>{label(entry)}</strong>{entry.type === "version" && entry.title && <small>{entry.title}</small>}{entry.reason && <small>{t(`history.reason.${entry.reason}`)}</small>}<time>{date(entry.createdAt)}</time></span></button>) : <p className="history-empty">{t("history.empty")}</p>}
      {selected && details?.entry.id === selected.id && <article className="history-details"><h3>{label(selected)}</h3><time>{date(selected.createdAt)}</time>{selected.title && selected.type === "version" && <p>{selected.title}</p>}{selected.summary && <p>{selected.summary}</p>}<small>{t("history.fileCount", { count: selected.fileCount })} · {t("history.changedCount", { count: details.changes.length })}</small><div className="history-actions"><button onClick={() => openRestore(selected)} disabled={busy}>{t("history.restore")}</button>{selected.type !== "version" && <button onClick={() => openForm("promote", selected)} disabled={busy}>{t("history.promote")}</button>}{selected.type === "version" && <button onClick={() => openForm("edit", selected)} disabled={busy}>{t("history.editMetadata")}</button>}<button onClick={() => { if (window.confirm(t("history.deleteConfirm", { name: label(selected) }))) void run(() => api.remove(projectId, selected.id)); }} disabled={busy}>{t("history.delete")}</button></div><h4>{t("history.changes")}</h4>{details.changes.length ? details.changes.map((change) => <button key={change.path} className="history-file" onClick={() => compare(change)}><span>{change.path}</span><small>{t(`history.status.${change.status}`)}</small></button>) : <p>{t("history.noChanges")}</p>}</article>}
    </div>
    <footer className="history-storage"><span>{t("history.storage")}: {storage ? size(storage.bytes) : "…"}</span><button onClick={() => void run(async () => { await api.optimize(projectId); })} disabled={busy}>{t("history.optimize")}</button></footer>
    {error && <p className="history-error" role="alert">{error}</p>}
    {dialog && createPortal(<div className="history-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDialog(undefined); }}><section className={`history-modal ${dialog.kind === "compare" ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={t("history.title")}>
      {dialog.kind === "compare" ? <><h2>{dialog.path}</h2><p>{t("history.compareHint")}</p>{dialog.historical !== undefined && dialog.current !== undefined ? <div className="history-diff"><DiffEditor original={dialog.historical} modified={dialog.current} language={/\.bib$/i.test(dialog.path) ? "bibtex" : /\.json$/i.test(dialog.path) ? "json" : "latex"} theme={editorThemeName(settings.get("theme"))} options={{ readOnly: true, renderSideBySide: true, automaticLayout: true }}/></div> : <p>{t("history.binaryPreview")}</p>}<div className="history-dialog-actions"><button onClick={() => setDialog(undefined)}>{t("common.close")}</button></div></> : dialog.kind === "restore" ? <><h2>{t("history.restoreTitle", { name: label(dialog.entry) })}</h2><p>{t("history.restoreHint")}</p><div className="history-restore-files">{details?.entry.id === dialog.entry.id && details.changes.map((change) => <label key={change.path}><input type="checkbox" checked={selectedPaths.includes(change.path)} onChange={(event) => setSelectedPaths((paths) => event.target.checked ? [...paths, change.path] : paths.filter((path) => path !== change.path))}/>{change.path} <small>{t(`history.status.${change.status}`)}</small></label>)}</div><div className="history-dialog-actions"><button onClick={() => setDialog(undefined)} disabled={busy}>{t("project.cancel")}</button><button onClick={() => restore(dialog.entry, true)} disabled={busy || !selectedPaths.length}>{t("history.restoreSelected")}</button><button className="primary" onClick={() => restore(dialog.entry, false)} disabled={busy}>{t("history.restoreProject")}</button></div></> : <><h2>{t(dialog.kind === "version" ? "history.createVersion" : dialog.kind === "temporary" ? "history.createTemporary" : dialog.kind === "promote" ? "history.promote" : "history.editMetadata")}</h2>{dialog.kind !== "temporary" && dialog.kind !== "edit" && <label>{t("history.versionNumber")}<input value={versionNumber} onChange={(event) => setVersionNumber(event.target.value)} autoFocus/></label>}<label>{t("history.entryTitle")}<input value={title} onChange={(event) => setTitle(event.target.value)} autoFocus={dialog.kind === "temporary" || dialog.kind === "edit"}/></label><label>{t("history.summary")}<textarea value={summary} onChange={(event) => setSummary(event.target.value)}/></label><div className="history-dialog-actions"><button onClick={() => setDialog(undefined)} disabled={busy}>{t("project.cancel")}</button><button className="primary" onClick={saveForm} disabled={busy || (dialog.kind !== "temporary" && dialog.kind !== "edit" && !versionNumber.trim())}>{t("history.save")}</button></div></>}
      {error && <p className="history-error" role="alert">{error}</p>}
    </section></div>, document.body)}
  </section>;
}
