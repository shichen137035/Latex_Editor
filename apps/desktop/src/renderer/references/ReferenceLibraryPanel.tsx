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

export function ReferenceLibraryPanel({ project, documents, canCite, onOpenReference, onWriteBibliography, onOpenLibrary, onCite }: {
  project: Project;
  documents: ReferenceDocument[];
  canCite: boolean;
  onOpenReference(path: string, offset: number): void;
  onWriteBibliography(path: string, content: string): Promise<void>;
  onOpenLibrary(): void;
  onCite(key: string): void;
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
      setNotice(`Citation key “${entry.citationKey}” already exists in a project .bib file. Cite it from In this project.`);
      return false;
    }
    operationBusy.current = true;
    setBusyId(entry.id);
    try {
      await api.references.setProjectLink({ projectId: project.id, libraryEntryId: entry.id, citationKeyInProject: entry.citationKey, mode: "link", targetBibPath: ".texweave/generated-references.bib" });
      try { await syncLinkedBib(); }
      catch (error) { await api.references.removeProjectLink(project.id, entry.id); throw error; }
      await reload();
      setNotice(`${entry.citationKey} added. Include .texweave/generated-references.bib in your bibliography configuration.`);
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
      setNotice(`${entry.citationKey} removed from this project`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { operationBusy.current = false; setBusyId(undefined); }
  };

  const shownEntries = view === "find" && hasSearchFilter ? results.slice(0, visibleCount) : [];

  return <section className="reference-quick-panel">
    <header className="reference-quick-header">
      <div className="reference-quick-title"><span className="reference-quick-mark">R</span><div><strong>Project references</strong><small>{project.name}</small></div></div>
      <div className="reference-quick-navigation"><button onClick={() => void reload().catch(error => setNotice(String(error)))} aria-label="Refresh reference library" title="Refresh reference library">↻</button><button onClick={onOpenLibrary} title="Open the full reference library">Full library ↗</button></div>
    </header>

    <div className="reference-quick-tabs" role="tablist" aria-label="Project references">
      <button role="tab" aria-selected={view === "find"} className={view === "find" ? "active" : ""} onClick={() => setView("find")}>Find in library</button>
      <button role="tab" aria-selected={view === "project"} className={view === "project" ? "active" : ""} onClick={() => setView("project")}>In this project <span>{projectIndex.entries.length}</span></button>
    </div>

    {view === "find" && <div className="reference-quick-filters">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, author, key…" aria-label="Search references"/>
      <div className="reference-quick-filter-row">
        <select value={collection} onChange={(event) => setCollection(event.target.value)} aria-label="Filter by collection"><option value="">All collections</option>{(snapshot?.collections ?? []).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select>
        <select value={entryType} onChange={(event) => setEntryType(event.target.value)} aria-label="Filter by reference type"><option value="">All types</option>{[...new Set((snapshot?.entries ?? []).map((entry) => entry.entryType))].sort().map((type) => <option key={type} value={type}>{type}</option>)}</select>
        <button className={favoritesOnly ? "favorite-filter active" : "favorite-filter"} onClick={() => setFavoritesOnly((value) => !value)} title="Show starred references" aria-pressed={favoritesOnly}>★</button>
      </div>
    </div>}

    {view === "project" && <ProjectReferencesPanel index={projectIndex} canCite={canCite} onCite={onCite} onOpen={onOpenReference}/>}
    {view === "find" && <><div className="reference-quick-summary">{hasSearchFilter ? `${results.length} matching references` : "Filter the library to find a reference"}</div>
    <div className="reference-quick-results">
      {view === "find" && !hasSearchFilter && <div className="reference-quick-empty"><span>⌕</span><strong>Search your library</strong><p>Results appear here after you search or apply a filter.</p></div>}
      {view === "find" && hasSearchFilter && results.length === 0 && <div className="reference-quick-empty"><strong>No matches</strong><p>Try another title, author, collection, or type.</p></div>}
      {shownEntries.map((entry) => {
        const author = field(entry, "author");
        const venue = field(entry, "journal") || field(entry, "booktitle") || field(entry, "publisher");
        return <article className="reference-quick-entry" key={entry.id}>
          <div className="reference-quick-entry-meta"><span className="reference-quick-type">{entry.entryType}</span><code>{entry.citationKey}</code>{entry.favorite && <span className="reference-quick-star" aria-label="Starred">★</span>}</div>
          <strong className="reference-quick-entry-title" title={field(entry, "title")}>{field(entry, "title") || "Untitled reference"}</strong>
          <div className="reference-quick-entry-byline">{author || "Unknown author"}{field(entry, "year") && ` · ${field(entry, "year")}`}{venue && ` · ${venue}`}</div>
          {entry.tags.length > 0 && <div className="reference-quick-tags">{entry.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}{entry.tags.length > 3 && <span>+{entry.tags.length - 3}</span>}</div>}
          <footer><button className="reference-quick-add" disabled={!!busyId || !project.writable} onClick={() => void linkToProject(entry)}>{busyId === entry.id ? "Adding…" : "+ Add"}</button><button className="reference-quick-cite" disabled={!!busyId || !canCite} onClick={() => void citeEntry(entry)}>Cite</button></footer>
        </article>;
      })}
    </div>
    {hasSearchFilter && results.length > PAGE_SIZE && <button className="reference-quick-more" onClick={() => setVisibleCount(count => count >= results.length ? PAGE_SIZE : count + PAGE_SIZE)}>{visibleCount >= results.length ? "Show fewer" : "Show more"}</button>}</>}
    {view === "project" && linkedEntries.length > 0 && <details className="project-reference-links"><summary>Library links ({linkedEntries.length})</summary>{linkedEntries.map(({ link, entry }) => <div key={entry.id}><code>{link.citationKeyInProject}</code><button disabled={!!busyId || !canCite} onClick={() => onCite(link.citationKeyInProject)}>Cite</button><button disabled={!!busyId || !project.writable} onClick={() => void removeFromProject(entry)}>Unlink</button></div>)}</details>}
    {notice && <div className="reference-quick-notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div>}
    <button className="reference-quick-open-library" onClick={onOpenLibrary}>Manage library and references <span>↗</span></button>
  </section>;
}
