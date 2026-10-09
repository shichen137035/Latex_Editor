import { styleResourceName, styleResourceDescription } from "../i18n/displayNames.js";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { StyleResource, StyleResourceFile } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import "./style-resources-manager.css";

export function StyleResourcesManager({ toolbarTarget }: { toolbarTarget?: HTMLElement | null }) {
  const [resources, setResources] = useState<StyleResource[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [expandedFilePath, setExpandedFilePath] = useState("");
  const [previewedFile, setPreviewedFile] = useState<StyleResourceFile>();
  const [busy, setBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState("");
  const selected = resources.find((resource) => resource.id === selectedId);
  const activeResourceId = selected?.id;

  const reload = useCallback(async () => {
    const next = await window.latexEditor!.styleResources.list();
    setResources(next);
    setSelectedId((current) => next.some((resource) => resource.id === current) ? current : next[0]?.id ?? "");
    setExpandedFilePath("");
  }, []);

  useEffect(() => { void reload().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))); }, [reload]);
  useEffect(() => {
    if (!activeResourceId || !expandedFilePath) {
      setPreviewedFile(undefined);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewedFile(undefined);
    setError("");
    void window.latexEditor!.styleResources.readFile(activeResourceId, expandedFilePath).then((file) => {
      if (cancelled) return;
      if (file === undefined) throw new Error(t("ui.StyleResourcesManager.resource_file_not_found", { value1: expandedFilePath }));
      setPreviewedFile(file);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setPreviewLoading(false);
    });
    return () => { cancelled = true; };
  }, [activeResourceId, expandedFilePath]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      if (result && typeof result === "object" && "id" in result) setSelectedId(String(result.id));
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const toolbar: ReactNode = <div className="style-resource-toolbar"><div className="style-resource-toolbar-heading"><h1>{t("resource.title")}</h1></div></div>;
  const builtIns = resources.filter((resource) => resource.source === "built-in");
  const customResources = resources.filter((resource) => resource.source === "user");

  return <div className="style-resources-page">
    {toolbarTarget !== undefined ? toolbarTarget && createPortal(toolbar, toolbarTarget) : <header className="style-resource-fallback-header">{toolbar}</header>}
    <div className="style-resource-layout">
      <aside className="style-resource-list" aria-label={t("resource.title")}>
        <h3>{t("resource.builtIn")}</h3>
        {builtIns.map((resource) => <button className={selectedId === resource.id ? "active" : ""} key={resource.id} onClick={() => { setSelectedId(resource.id); setExpandedFilePath(""); }}>
          <strong>{styleResourceName(resource)}</strong><small>{resource.files.length} {t("resource.files")}</small>
        </button>)}
        <h3>{t("resource.myResources")}</h3>
        {customResources.map((resource) => <button className={selectedId === resource.id ? "active" : ""} key={resource.id} onClick={() => { setSelectedId(resource.id); setExpandedFilePath(""); }}>
          <strong>{styleResourceName(resource)}</strong><small>{resource.files.length} {t("resource.files")}</small>
        </button>)}
        {customResources.length === 0 && <p className="style-resource-empty">{t("resource.none")}</p>}
      </aside>

      <section className="style-resource-detail">
        <div className="style-resource-actions style-resource-library-actions">
          <button disabled={busy} onClick={() => void run(() => window.latexEditor!.styleResources.create(t("resource.newDefaultName")))}>＋ {t("resource.new")}</button>
          <button disabled={busy} onClick={() => void run(async () => {
            const paths = await window.latexEditor!.dialogs.pickFiles();
            return paths.length ? window.latexEditor!.styleResources.importFiles(paths) : undefined;
          })}>{t("resource.importFiles")}</button>
          <button disabled={busy} onClick={() => void run(async () => {
            const path = await window.latexEditor!.dialogs.pickFolder();
            return path ? window.latexEditor!.styleResources.importFolder(path) : undefined;
          })}>{t("resource.importFolder")}</button>
        </div>
        {selected ? <>
          <div className="style-resource-detail-head">
            <div><span className="resource-source">{selected.source === "built-in" ? t("resource.builtIn") : t("resource.custom")}</span><h2>{styleResourceName(selected)}</h2><p>{styleResourceDescription(selected)}</p></div>
            {selected.source === "user" && <div className="style-resource-detail-actions">
              <button disabled={busy} onClick={() => void run(async () => {
                const paths = await window.latexEditor!.dialogs.pickFiles();
                return paths.length ? window.latexEditor!.styleResources.addFiles(selected.id, paths) : undefined;
              })}>{t("resource.addFiles")}</button>
              <button disabled={busy} onClick={() => {
                const name = window.prompt(t("resource.renamePrompt"), selected.name);
                if (name) void run(() => window.latexEditor!.styleResources.rename(selected.id, name));
              }}>{t("resource.rename")}</button>
              <button disabled={busy} onClick={() => void run(() => window.latexEditor!.styleResources.duplicate(selected.id))}>{t("resource.duplicate")}</button>
              <button className="danger" disabled={busy} onClick={() => {
                if (window.confirm(t("resource.deleteConfirm", { name: selected.name }))) void run(() => window.latexEditor!.styleResources.remove(selected.id));
              }}>{t("resource.delete")}</button>
            </div>}
          </div>
          {selected.mainStyle && <p className="style-resource-note">{t("resource.importHint", { name: selected.mainStyle.name })}</p>}
          <h3 className="style-resource-files-title">{t("resource.filesTitle")}</h3>
          {selected.files.length > 0 ? <>
            <div className="style-resource-files" aria-label={t("resource.filesTitle")}>
              {selected.files.map((file) => {
                const expanded = expandedFilePath === file.targetPath;
                return <div className={`style-resource-file-item${expanded ? " expanded" : ""}`} key={file.targetPath}>
                  <button type="button" aria-expanded={expanded} className="style-resource-file-trigger" onClick={() => setExpandedFilePath((current) => current === file.targetPath ? "" : file.targetPath)}>
                    <svg className="style-resource-file-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
                    <code>{file.targetPath}</code><small>{file.kind}</small>
                  </button>
                  {expanded && <div className="style-resource-file-content">
                    {previewLoading ? <div className="style-resource-viewer-loading" role="status"><span aria-hidden="true"/></div> : previewedFile?.targetPath === file.targetPath ? <pre>{previewedFile.content ?? ""}</pre> : null}
                  </div>}
                </div>;
              })}
            </div>
          </> : <p className="style-resource-empty-files">{t("resource.emptyFiles")}</p>}
        </> : <p>{t("resource.selectHint")}</p>}
        {error && <p role="alert" className="inline-error">{error}</p>}
      </section>
    </div>
  </div>;
}
