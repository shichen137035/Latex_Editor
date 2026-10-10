import { createPortal } from "react-dom";
import { t } from "../i18n/index.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Project, ProjectTreeNode, ReferenceLibraryEntry, ReferenceLibrarySnapshot } from "@latex-editor/contracts";
import { bibtexEntryWithKey, citationKeyIdentity, field, isValidCitationKey } from "./bibtex.js";
import { indexProjectReferences, type ReferenceDocument } from "./projectReferences.js";
import { ProjectReferencesPanel } from "./ProjectReferencesPanel.js";
import "./reference-quick-panel.css";

function flatten(nodes: ProjectTreeNode[], result: ProjectTreeNode[] = []): ProjectTreeNode[] {
  for (const node of nodes) { result.push(node); if (node.children) flatten(node.children, result); }
  return result;
}

const PAGE_SIZE = 5;

export function ReferenceLibraryPanel({ project, documents, canCite, onOpenReference, onWriteBibliography, onOpenLibrary, onCite, toolbarTarget }: {
  project: Project;
  documents: ReferenceDocument[];
  canCite: boolean;
  onOpenReference(path: string, offset: number): void;
  onWriteBibliography(path: string, content: string): Promise<void>;
  onOpenLibrary(): void;
  onCite(key: string): void;
  toolbarTarget?: HTMLElement | null;
}) {
  const api = window.latexEditor;
  const [snapshot, setSnapshot] = useState<ReferenceLibrarySnapshot>();
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("");
  const [entryType, setEntryType] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [view, setView] = useState<"find" | "project">("project");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [busyId, setBusyId] = useState<string>();
  const [notice, setNotice] = useState("");
  const operationBusy = useRef(false);
  const projectIndex = useMemo(() => indexProjectReferences(documents), [documents]);

  const reload = async () => { if (api) setSnapshot(await api.references.snapshot(project.id)); };
  useEffect(() => {
    let cancelled = false;
    void api?.references.snapshot(project.id).then(value => { if (!cancelled) setSnapshot(value); }).catch(error => { if (!cancelled) setNotice(String(error)); });
    return () => { cancelled = true; };
  }, [api, project.id]);
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [query, collection, entryType, favoritesOnly, view]);

  const linkedEntries = useMemo(() => (snapshot?.projectLinks ?? []).map((link) => ({ link, entry: snapshot?.entries.find((item) => item.id === link.libraryEntryId) })).filter((item): item is { link: NonNullable<typeof item.link>; entry: ReferenceLibraryEntry } => Boolean(item.entry)), [snapshot]);
  const results = useMemo(() => {
    const linkedIds = new Set((snapshot?.projectLinks ?? []).map((link) => link.libraryEntryId));
    const needle = query.trim().toLocaleLowerCase();
    return (snapshot?.entries ?? []).filter((entry) => {
      const searchable = [entry.citationKey, entry.entryType, ...Object.values(entry.fields), ...entry.tags, ...entry.collections].join(" ").toLocaleLowerCase();
      return (!needle || searchable.includes(needle))
        && (!collection || entry.collections.includes(collection))
        && (!entryType || entry.entryType === entryType)
        && (!favoritesOnly || entry.favorite)
        && !linkedIds.has(entry.id);
    });
  }, [collection, entryType, favoritesOnly, query, snapshot]);
  const hasSearchFilter = Boolean(query.trim() || collection || entryType || favoritesOnly);

  const syncLinkedBib = async () => {
    if (!api) return;
    const latest = await api.references.snapshot(project.id);
    if (!latest) return;
    const tree = flatten(await api.files.tree(project.id));
    if (!tree.some((node) => node.kind === "directory" && node.relativePath === ".texweave")) await api.files.createDirectory(project.id, ".texweave");
    const bibPath = ".texweave/generated-references.bib";
    if (!tree.some((node) => node.kind === "file" && node.relativePath === bibPath)) await api.files.createFile(project.id, bibPath);
    const content = latest.projectLinks.filter((link) => link.mode === "link" && (!link.targetBibPath || link.targetBibPath === bibPath))
      .flatMap(link => { const entry = latest.entries.find(item => item.id === link.libraryEntryId); return entry ? [bibtexEntryWithKey(entry, link.citationKeyInProject)] : []; }).join("\n\n");
    await onWriteBibliography(bibPath, content ? `${content}\n` : "");
  };

  const linkToProject = async (entry: ReferenceLibraryEntry) => {
    if (!api || !project.writable || operationBusy.current || !isValidCitationKey(entry.citationKey)) return false;
    if (snapshot?.projectLinks.some((link) => link.libraryEntryId === entry.id)) return true;
    if (projectIndex.entries.some(item => citationKeyIdentity(item.citationKey) === citationKeyIdentity(entry.citationKey))) {
      setNotice(t("ui.ReferenceLibraryPanel.citation_key_already_exists_in_a_project", { value1: entry.citationKey }));
      return false;
    }
    operationBusy.current = true;
    setBusyId(entry.id);
    try {
      await api.references.setProjectLink({ projectId: project.id, libraryEntryId: entry.id, citationKeyInProject: entry.citationKey, mode: "link", targetBibPath: ".texweave/generated-references.bib" });
      try { await syncLinkedBib(); }
      catch (error) { await api.references.removeProjectLink(project.id, entry.id); throw error; }
      await reload();
      setNotice(t("ui.ReferenceLibraryPanel.added_include_texweave_generated_references_bib_in", { value1: entry.citationKey }));
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
      return false;
    } finally { operationBusy.current = false; setBusyId(undefined); }
  };

  const citeEntry = async (entry: ReferenceLibraryEntry) => {
    if (await linkToProject(entry)) onCite(snapshot?.projectLinks.find(link => link.libraryEntryId === entry.id)?.citationKeyInProject ?? entry.citationKey);
  };
  const removeFromProject = async (entry: ReferenceLibraryEntry) => {
    if (!api || !project.writable || operationBusy.current) return;
    operationBusy.current = true;
    setBusyId(entry.id);
    try {
      const link = snapshot?.projectLinks.find((item) => item.libraryEntryId === entry.id);
      await api.references.removeProjectLink(project.id, entry.id);
      try { if (link?.mode === "link") await syncLinkedBib(); }
      catch (error) { if (link) await api.references.setProjectLink(link); throw error; }
      await reload();
      setNotice(t("ui.ReferenceLibraryPanel.removed_from_this_project", { value1: entry.citationKey }));
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { operationBusy.current = false; setBusyId(undefined); }
  };

  const shownEntries = view === "find" && hasSearchFilter ? results.slice(0, visibleCount) : [];

  const toolbar = <div className="reference-quick-navigation"><button onClick={() => void reload().catch(error => setNotice(String(error)))} aria-label={t("ui.ReferenceLibraryPanel.refresh_reference_library")} title={t("ui.ReferenceLibraryPanel.refresh_reference_library")}>↻</button><button onClick={onOpenLibrary} aria-label={t("ui.ReferenceLibraryPanel.open_the_full_reference_library")} title={t("ui.ReferenceLibraryPanel.open_the_full_reference_library")}>↗</button></div>;
  return <section className="reference-quick-panel">
    {toolbarTarget && createPortal(toolbar, toolbarTarget)}
    <header className="reference-quick-header reference-quick-compact-header">
      <div className="reference-quick-tabs" role="tablist" aria-label={t("ui.ReferenceLibraryPanel.project_references")}>
        <button role="tab" aria-selected={view === "find"} className={view === "find" ? "active" : ""} onClick={() => setView("find")}>{t("ui.ReferenceLibraryPanel.find_in_library")}</button>
        <button role="tab" aria-selected={view === "project"} className={view === "project" ? "active" : ""} onClick={() => setView("project")}>{t("ui.ReferenceLibraryPanel.in_this_project")}<span>{projectIndex.entries.length}</span></button>
      </div>
      {!toolbarTarget && toolbar}

    </header>
    {view === "find" && <div className="reference-quick-filters">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("ui.ProjectReferencesPanel.search_title_author_key")} aria-label={t("ui.ReferenceLibraryPanel.search_references")}/>
      <div className="reference-quick-filter-row">
        <select value={collection} onChange={(event) => setCollection(event.target.value)} aria-label={t("ui.ReferenceLibraryPanel.filter_by_collection")}><option value="">{t("ui.ReferenceLibraryPanel.all_collections")}</option>{(snapshot?.collections ?? []).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select>
        <select value={entryType} onChange={(event) => setEntryType(event.target.value)} aria-label={t("ui.ReferenceLibraryPanel.filter_by_reference_type")}><option value="">{t("ui.ProjectReferencesPanel.all_types")}</option>{[...new Set((snapshot?.entries ?? []).map((entry) => entry.entryType))].sort().map((type) => <option key={type} value={type}>{type}</option>)}</select>
        <button className={favoritesOnly ? "favorite-filter active" : "favorite-filter"} onClick={() => setFavoritesOnly((value) => !value)} title={t("ui.ReferenceLibraryPanel.show_starred_references")} aria-pressed={favoritesOnly}>★</button>
      </div>
    </div>}

    {view === "project" && <ProjectReferencesPanel index={projectIndex} canCite={canCite} onCite={onCite} onOpen={onOpenReference}/>}
    {view === "find" && <><div className="reference-quick-summary">{hasSearchFilter ? t("ui.ReferenceLibraryPanel.matching_references", { value1: results.length }) : t("ui.ReferenceLibraryPanel.filter_the_library_to_find_a_reference")}</div>
    <div className="reference-quick-results">
      {view === "find" && !hasSearchFilter && <div className="reference-quick-empty"><span>⌕</span><strong>{t("ui.ReferenceLibraryPanel.search_your_library")}</strong><p>{t("ui.ReferenceLibraryPanel.results_appear_here_after_you_search_or")}</p></div>}
      {view === "find" && hasSearchFilter && results.length === 0 && <div className="reference-quick-empty"><strong>{t("search.noResults")}</strong><p>{t("ui.ReferenceLibraryPanel.try_another_title_author_collection_or_type")}</p></div>}
      {shownEntries.map((entry) => {
        const author = field(entry, "author");
        const venue = field(entry, "journal") || field(entry, "booktitle") || field(entry, "publisher");
        return <article className="reference-quick-entry" key={entry.id}>
          <div className="reference-quick-entry-meta"><span className="reference-quick-type">{entry.entryType}</span><code>{entry.citationKey}</code>{entry.favorite && <span className="reference-quick-star" aria-label={t("ui.ReferenceLibraryPanel.starred")}>★</span>}</div>
          <strong className="reference-quick-entry-title" title={field(entry, "title")}>{field(entry, "title") || t("ui.BibtexPreviewPane.untitled_reference")}</strong>
          <div className="reference-quick-entry-byline">{author || t("ui.BibtexPreviewPane.unknown_author")}{field(entry, "year") && ` · ${field(entry, "year")}`}{venue && ` · ${venue}`}</div>
          {entry.tags.length > 0 && <div className="reference-quick-tags">{entry.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}{entry.tags.length > 3 && <span>+{entry.tags.length - 3}</span>}</div>}
          <footer><button className="reference-quick-add" disabled={!!busyId || !project.writable} onClick={() => void linkToProject(entry)}>{busyId === entry.id ? t("ui.ReferenceLibraryPanel.adding") : t("ui.ReferenceLibraryPanel.add")}</button><button className="reference-quick-cite" disabled={!!busyId || !canCite} onClick={() => void citeEntry(entry)}>{t("editor.quick.citationShort")}</button></footer>
        </article>;
      })}
    </div>
    {hasSearchFilter && results.length > PAGE_SIZE && <button className="reference-quick-more" onClick={() => setVisibleCount(count => count >= results.length ? PAGE_SIZE : count + PAGE_SIZE)}>{visibleCount >= results.length ? t("ui.ReferenceLibraryPanel.show_fewer") : t("ui.ReferenceLibraryPanel.show_more")}</button>}</>}
    {view === "project" && linkedEntries.length > 0 && <details className="project-reference-links"><summary>{t("ui.ReferenceLibraryPanel.library_links")}{linkedEntries.length})</summary>{linkedEntries.map(({ link, entry }) => <div key={entry.id}><code>{link.citationKeyInProject}</code><button disabled={!!busyId || !canCite} onClick={() => onCite(link.citationKeyInProject)}>{t("editor.quick.citationShort")}</button><button disabled={!!busyId || !project.writable} onClick={() => void removeFromProject(entry)}>{t("ui.ReferenceLibraryPanel.unlink")}</button></div>)}</details>}
    {notice && <div className="reference-quick-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label={t("ui.ReferenceLibraryPanel.dismiss")}>×</button></div>}
    <button className="reference-quick-open-library" onClick={onOpenLibrary}>{t("ui.ReferenceLibraryPanel.manage_library_and_references")}<span>↗</span></button>
  </section>;
}
