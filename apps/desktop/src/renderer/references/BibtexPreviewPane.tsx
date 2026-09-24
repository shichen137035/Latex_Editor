import { useEffect, useMemo, useState } from "react";
import type { ReferenceLibrarySnapshot } from "@latex-editor/contracts";
import { citationOccurrences, field, parseBibtex, type BibEntryPreview, type CitationOccurrence } from "./bibtex.js";
import "./references.css";

export interface ReferenceSourceLocation { filePath: string; offset: number; line?: number; column?: number; }

export function BibtexPreviewPane({ source, filePath, projectId, documents, onLocate }: { source: string; filePath: string; projectId: string; documents: Array<{ fileId: string; content: string }>; onLocate?(location: ReferenceSourceLocation): void }) {
  const api = window.latexEditor;
  const parsed = useMemo(() => parseBibtex(source), [source]);
  const occurrences = useMemo(() => citationOccurrences(documents.map((document) => ({ filePath: document.fileId, content: document.content }))), [documents]);
  const [snapshot, setSnapshot] = useState<ReferenceLibrarySnapshot>();
  const [query, setQuery] = useState("");
  const [onlyCited, setOnlyCited] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = async () => { if (api) setSnapshot(await api.references.snapshot(projectId)); };
  useEffect(() => { void reload(); }, [projectId]);
  const entries = parsed.entries.filter((entry) => {
    const haystack = [entry.entryType, entry.citationKey, ...Object.values(entry.fields)].join(" ").toLocaleLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLocaleLowerCase())) && (!onlyCited || occurrences.some((item) => item.key === entry.citationKey));
  });
  const add = async (entry: BibEntryPreview) => {
    if (!api || !entry.valid) return;
    setBusy(true);
    try { await api.references.saveEntry({ citationKey: entry.citationKey, entryType: entry.entryType, fields: entry.fields, rawBibtex: entry.rawBibtex, sourceFile: filePath }); await reload(); }
    finally { setBusy(false); }
  };
  const remove = async (entry: BibEntryPreview) => {
    const libraryEntry = snapshot?.entries.find((item) => item.citationKey === entry.citationKey);
    if (!api || !libraryEntry) return;
    await api.references.removeEntry(libraryEntry.id); await reload();
  };
  const addAll = async () => { for (const entry of entries.filter((item) => item.valid && !snapshot?.entries.some((library) => library.citationKey === item.citationKey))) await add(entry); };
  return <section className="bib-preview-pane"><header className="bib-preview-header"><div><p className="reference-eyebrow">BIBTEX PREVIEW</p><h2>{filePath}</h2><p>{parsed.entries.length} entries · {parsed.invalid.length} warnings · source order preserved</p></div><div className="bib-preview-actions"><button onClick={() => setOnlyCited((value) => !value)} className={onlyCited ? "active" : ""}>{onlyCited ? "Cited only" : "All entries"}</button><button onClick={() => void addAll()} disabled={busy}>Add all valid</button></div></header><div className="bib-preview-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search citation key, title, author..."/><span>{entries.length} shown</span></div>{parsed.invalid.map((item, index) => <div className="bib-warning-card" key={`${item.start}-${index}`}><strong>Parse warning</strong><span>{item.message}</span><button onClick={() => onLocate?.({ filePath, offset: item.start })}>Open source</button></div>)}<div className="bib-entry-list">{entries.map((entry) => <BibEntryCard key={`${entry.citationKey}:${entry.start}`} entry={entry} inLibrary={Boolean(snapshot?.entries.some((item) => item.citationKey === entry.citationKey))} usage={occurrences.filter((item) => item.key === entry.citationKey)} onAdd={() => void add(entry)} onRemove={() => void remove(entry)} onLocate={onLocate} filePath={filePath}/>)}</div></section>;
}

function BibEntryCard({ entry, inLibrary, usage, onAdd, onRemove, onLocate, filePath }: { entry: BibEntryPreview; inLibrary: boolean; usage: CitationOccurrence[]; onAdd(): void; onRemove(): void; onLocate?: ((location: ReferenceSourceLocation) => void) | undefined; filePath: string }) {
  const [expanded, setExpanded] = useState(false);
  return <article className={`bib-entry-card ${entry.valid ? "" : "invalid"}`}><header><span className="reference-entry-type">{entry.entryType}</span><strong>{field(entry, "author") || "Unknown author"} {field(entry, "year") && `(${field(entry, "year")})`}</strong><code>{entry.citationKey || "missing-key"}</code><button className={inLibrary ? "reference-library-state linked" : "reference-library-state"} onClick={inLibrary ? onRemove : onAdd} disabled={!entry.valid}>{inLibrary ? "− In Library" : "+ Add to Library"}</button></header><h3>{field(entry, "title") || "Untitled entry"}</h3><p className="bib-entry-publication">{field(entry, "journal") || field(entry, "booktitle") || field(entry, "publisher") || "No publication field"}</p><div className="bib-entry-row"><span>{usage.length ? `Cited · ${usage.length} occurrence${usage.length === 1 ? "" : "s"}` : "Not cited / not indexed"}</span><button onClick={() => setExpanded((value) => !value)}>{expanded ? "Hide fields" : "Show fields"}</button><button onClick={() => onLocate?.({ filePath, offset: entry.start })}>Source</button></div>{expanded && <><dl className="bib-fields">{Object.entries(entry.fields).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{usage.length > 0 && <div className="bib-occurrences">{usage.map((item) => <button key={`${item.filePath}:${item.start}`} onClick={() => onLocate?.({ filePath: item.filePath, offset: item.start, line: item.line, column: item.column })}>{item.filePath}:{item.line} · \\{item.command}{`{${item.key}}`}</button>)}</div>}</>}</article>;
}
