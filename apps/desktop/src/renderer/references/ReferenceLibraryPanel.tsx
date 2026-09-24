import { useEffect, useMemo, useState } from "react";
import type { Project, ProjectReferenceLink, ReferenceLibraryEntry, ReferenceLibrarySnapshot, ProjectTreeNode } from "@latex-editor/contracts";
import { field } from "./bibtex.js";
import { parseBibtex } from "./bibtex.js";
import "./references.css";

function flatten(nodes: ProjectTreeNode[], result: ProjectTreeNode[] = []): ProjectTreeNode[] {
  for (const node of nodes) { result.push(node); if (node.children) flatten(node.children, result); }
  return result;
}

export function ReferenceLibraryPanel({ project }: { project: Project }) {
  const api = window.latexEditor;
  const [snapshot, setSnapshot] = useState<ReferenceLibrarySnapshot>();
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [newEntry, setNewEntry] = useState(false);
  const [draft, setDraft] = useState({ citationKey: "", entryType: "article", author: "", title: "", year: "" });
  const [newCollection, setNewCollection] = useState("");
  const generatedBibPath = ".texweave/generated-references.bib";

  const reload = async () => { if (!api) return; setSnapshot(await api.references.snapshot(project.id)); };
  useEffect(() => { void reload(); }, [project.id]);
  const entries = useMemo(() => (snapshot?.entries ?? []).filter((entry) => {
    const text = [entry.citationKey, entry.entryType, ...Object.values(entry.fields), ...entry.tags, ...entry.collections].join(" ").toLocaleLowerCase();
    return (!query.trim() || text.includes(query.trim().toLocaleLowerCase())) && (!collection || entry.collections.includes(collection));
  }), [collection, query, snapshot]);
  const importFile = async () => {
    if (!api) return;
    const paths = await api.dialogs.pickFiles();
    const bib = paths.find((path) => path.toLocaleLowerCase().endsWith(".bib"));
    if (!bib) return;
    setBusy(true);
    try { const result = await api.references.importFile(bib); setNotice(`${result.entries.length} imported${result.duplicates.length ? ` · ${result.duplicates.length} duplicate keys skipped` : ""}${result.invalid.length ? ` · ${result.invalid.length} invalid fragments` : ""}`); await reload(); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const importExternalPath = async (path: string) => {
    if (!api || !path.toLocaleLowerCase().endsWith(".bib")) return;
    setBusy(true);
    try { const result = await api.references.importFile(path); setNotice(`${result.entries.length} imported from ${path.split(/[\\/]/).at(-1) ?? path}`); await reload(); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const importProjectBib = async () => {
    if (!api) return;
    const nodes = flatten(await api.files.tree(project.id));
    const path = nodes.find((node) => node.kind === "file" && node.relativePath.toLocaleLowerCase().endsWith(".bib"))?.relativePath;
    if (!path) { setNotice("No .bib file was found in this project."); return; }
    const source = await api.files.read(project.id, path);
    const parsed = parseBibtex(source.content);
    setBusy(true);
    try { for (const entry of parsed.entries.filter((item) => item.valid)) await api.references.saveEntry({ citationKey: entry.citationKey, entryType: entry.entryType, fields: entry.fields, rawBibtex: entry.rawBibtex, sourceFile: path }); setNotice(`${parsed.entries.filter((item) => item.valid).length} project entries imported from ${path}`); await reload(); }
    finally { setBusy(false); }
  };
  const addEntry = async () => {
    if (!api || !draft.citationKey.trim() || !draft.title.trim()) return;
    setBusy(true);
    try { await api.references.saveEntry({ citationKey: draft.citationKey.trim(), entryType: draft.entryType, fields: { author: draft.author, title: draft.title, year: draft.year } }); setDraft({ citationKey: "", entryType: "article", author: "", title: "", year: "" }); setNewEntry(false); await reload(); }
    finally { setBusy(false); }
  };
  const syncLinkedBib = async () => {
    if (!api) return;
    const latest = await api.references.snapshot(project.id);
    if (!latest) return;
    const nodes = flatten(await api.files.tree(project.id));
    if (!nodes.some((node) => node.kind === "directory" && node.relativePath === ".texweave")) await api.files.createDirectory(project.id, ".texweave");
    if (!nodes.some((node) => node.kind === "file" && node.relativePath === generatedBibPath)) await api.files.createFile(project.id, generatedBibPath);
    const content = latest.projectLinks
      .filter((link) => link.mode === "link")
      .map((link) => latest.entries.find((entry) => entry.id === link.libraryEntryId))
      .filter((entry): entry is ReferenceLibraryEntry => Boolean(entry))
      .map(renderBibtex)
      .join("\n\n");
    await api.files.write(project.id, generatedBibPath, content ? `${content}\n` : "");
  };
  const addToProject = async (entry: ReferenceLibraryEntry, mode: ProjectReferenceLink["mode"]) => {
    if (!api) return;
    setBusy(true);
    try {
      let targetBibPath = mode === "link" ? generatedBibPath : "reference.bib";
      if (mode === "copy") {
        const nodes = flatten(await api.files.tree(project.id));
        const existing = nodes.find((node) => node.kind === "file" && node.relativePath.toLocaleLowerCase().endsWith(".bib"));
        targetBibPath = existing?.relativePath ?? "reference.bib";
        if (!existing) await api.files.createFile(project.id, targetBibPath);
        const current = await api.files.read(project.id, targetBibPath);
        const keyPattern = new RegExp(`@[^\\n{]+\\{\\s*${escapeRegExp(entry.citationKey)}\\s*,`, "i");
        if (!keyPattern.test(current.content)) await api.files.write(project.id, targetBibPath, `${current.content.trimEnd()}\n\n${entry.rawBibtex ?? renderBibtex(entry)}\n`);
      }
      await api.references.setProjectLink({ projectId: project.id, libraryEntryId: entry.id, citationKeyInProject: entry.citationKey, mode, targetBibPath });
      if (mode === "link") await syncLinkedBib();
      setNotice(`${entry.citationKey} ${mode === "copy" ? "copied" : "linked"} in ${targetBibPath}`);
      await reload();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const removeFromProject = async (entry: ReferenceLibraryEntry) => {
    if (!api) return;
    const link = snapshot?.projectLinks.find((item) => item.libraryEntryId === entry.id);
    await api.references.removeProjectLink(project.id, entry.id);
    if (link?.mode === "link") await syncLinkedBib();
    await reload();
  };
  const toggleCollection = async () => { if (!api || !newCollection.trim()) return; await api.references.createCollection(newCollection.trim()); setNewCollection(""); await reload(); };

  return <section className="reference-library-panel" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); const paths = Array.from(event.dataTransfer.files).map((file) => api?.files.pathForFile(file)).filter((path): path is string => Boolean(path)); for (const path of paths) void importExternalPath(path); }}>
    <header className="reference-library-header"><div><p className="reference-eyebrow">LOCAL REFERENCE LIBRARY</p><h2>Library</h2><p>Shared citation entries for TeXWeave projects.</p></div><div className="reference-header-actions"><button onClick={() => void importFile()} disabled={busy}>Import .bib</button><button onClick={() => setNewEntry(true)}>+ Entry</button></div></header>
    <div className="reference-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, author, key, tag..."/><select value={collection} onChange={(event) => setCollection(event.target.value)}><option value="">All collections</option>{(snapshot?.collections ?? []).map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select><button onClick={() => void importProjectBib()} title="Import the first project .bib file">Project .bib</button></div>
    {newEntry && <div className="reference-entry-form"><input placeholder="Citation key" value={draft.citationKey} onChange={(event) => setDraft({ ...draft, citationKey: event.target.value })}/><select value={draft.entryType} onChange={(event) => setDraft({ ...draft, entryType: event.target.value })}><option>article</option><option>book</option><option>inproceedings</option><option>misc</option></select><input placeholder="Author" value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })}/><input placeholder="Title" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/><input placeholder="Year" value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })}/><button className="primary" onClick={() => void addEntry()} disabled={busy}>Save</button><button onClick={() => setNewEntry(false)}>Cancel</button></div>}
    <div className="reference-collection-create"><input placeholder="New collection" value={newCollection} onChange={(event) => setNewCollection(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void toggleCollection(); }}/><button onClick={() => void toggleCollection()}>Add collection</button>{notice && <span>{notice}</span>}</div>
    <div className="reference-library-summary"><span>{entries.length} entries</span><span>{snapshot?.collections.length ?? 0} collections</span><span>{snapshot?.tags.length ?? 0} tags</span></div>
    <div className="reference-entry-list">{entries.map((entry) => { const link = snapshot?.projectLinks.find((item) => item.libraryEntryId === entry.id); return <article className="reference-entry-card" key={entry.id}><div className="reference-entry-card-head"><span className="reference-entry-type">{entry.entryType}</span><strong>{field(entry, "author") || "Unknown author"} {field(entry, "year") && `(${field(entry, "year")})`}</strong><span className="reference-entry-key">{entry.citationKey}</span><button className={link ? "reference-library-state linked" : "reference-library-state"} onClick={() => link ? void removeFromProject(entry) : void addToProject(entry, "link")}>{link ? "Linked" : "Link"}</button></div><h3>{field(entry, "title") || "Untitled entry"}</h3><div className="reference-entry-meta">{field(entry, "journal") || field(entry, "booktitle") || field(entry, "publisher") || "No publication field"}{field(entry, "doi") && <span>DOI: {field(entry, "doi")}</span>}</div><div className="reference-entry-badges">{entry.tags.map((tag) => <span key={tag}>{tag}</span>)}{entry.collections.map((item) => <span className="collection" key={item}>{item}</span>)}</div><footer><small>{link ? `Used in this project · ${link.mode}` : "Not linked to this project"}</small><button onClick={() => void addToProject(entry, "copy")} disabled={busy}>Copy to reference.bib</button><button className="danger" onClick={() => { if (window.confirm(`Remove ${entry.citationKey} from the global Library?`)) void api?.references.removeEntry(entry.id).then(reload); }}>Remove</button></footer></article>; })}</div>
  </section>;
}

function renderBibtex(entry: ReferenceLibraryEntry): string {
  const fields = Object.entries(entry.fields).filter(([, value]) => value.trim()).map(([key, value]) => `  ${key} = {${value}}`).join(",\n");
  return `@${entry.entryType}{${entry.citationKey},\n${fields}\n}`;
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
