import { useEffect, useMemo, useState } from "react";
import { useUnsavedChanges } from "../lifecycle/unsavedChanges.js";
import type { ReferenceLibraryEntry, ReferenceLibrarySnapshot } from "@latex-editor/contracts";
import { bibtexEntryWithKey, citationKeyIdentity, citationOccurrences, field, isValidCitationKey, parseBibtex, type BibEntry as BibEntryPreview, type CitationOccurrence } from "./bibtex.js";
import "./references.css";

export interface ReferenceSourceLocation { filePath: string; offset: number; line?: number; column?: number; }

export function BibtexPreviewPane({ source, filePath, projectId, documents, onLocate, onSourceChange }: { source: string; filePath: string; projectId: string; documents: Array<{ fileId: string; content: string }>; onLocate?(location: ReferenceSourceLocation): void; onSourceChange?(source: string): void }) {
  const api = window.latexEditor;
  const parsed = useMemo(() => parseBibtex(source), [source]);
  const occurrences = useMemo(() => citationOccurrences(documents.map((document) => ({ filePath: document.fileId, content: document.content }))), [documents]);
  const [snapshot, setSnapshot] = useState<ReferenceLibrarySnapshot>();
  const [query, setQuery] = useState("");
  const [onlyCited, setOnlyCited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [editingSourceStart, setEditingSourceStart] = useState<number>();
  const [sourceDraft, setSourceDraft] = useState("");
  const [sourceError, setSourceError] = useState("");
  const [libraryPickerOpen, setLibraryPickerOpen] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [pendingDuplicate, setPendingDuplicate] = useState<ReferenceLibraryEntry>();
  const [duplicateKey, setDuplicateKey] = useState("");
  const [duplicateKeyError, setDuplicateKeyError] = useState("");
  const [removeRequest, setRemoveRequest] = useState<BibEntryPreview>();
  const reload = async () => { if (api) setSnapshot(await api.references.snapshot(projectId)); };
  useEffect(() => { void reload(); }, [projectId]);

  const entries = parsed.entries.filter((entry) => {
    const haystack = [entry.entryType, entry.citationKey, ...Object.values(entry.fields)].join(" ").toLocaleLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLocaleLowerCase())) && (!onlyCited || occurrences.some((item) => citationKeyIdentity(item.key) === citationKeyIdentity(entry.citationKey)));
  });
  const keyCounts = new Map<string, number>();
  for (const entry of parsed.entries) keyCounts.set(citationKeyIdentity(entry.citationKey), (keyCounts.get(citationKeyIdentity(entry.citationKey)) ?? 0) + 1);
  const duplicateKeys = [...keyCounts].filter(([, count]) => count > 1).map(([key]) => key);
  const duplicateKeySet = new Set(duplicateKeys);
  const duplicateStarts = new Set(parsed.entries.filter((entry) => duplicateKeySet.has(citationKeyIdentity(entry.citationKey))).map((entry) => entry.start));
  const availableLibraryEntries = (snapshot?.entries ?? []).filter((entry) => {
    const search = [entry.citationKey, entry.entryType, ...Object.values(entry.fields)].join(" ").toLocaleLowerCase();
    return !libraryQuery.trim() || search.includes(libraryQuery.trim().toLocaleLowerCase());
  });

  const uniqueKeyFor = (base: string) => {
    const used = new Set(parsed.entries.map((entry) => citationKeyIdentity(entry.citationKey)));
    const safeBase = base.replace(/[\s,{}()]+/g, "_").replace(/^_+|_+$/g, "") || "reference";
    let suffix = 2;
    let candidate = `${safeBase}_${suffix}`;
    while (used.has(citationKeyIdentity(candidate))) { suffix += 1; candidate = `${safeBase}_${suffix}`; }
    return candidate;
  };
  const writeLibraryEntryToProject = (entry: ReferenceLibraryEntry, key = entry.citationKey) => {
    if (!onSourceChange) { setNotice("This BibTeX source is read-only."); return; }
    const existing = parsed.entries.some((item) => citationKeyIdentity(item.citationKey) === citationKeyIdentity(key));
    if (existing) { setNotice(`Citation key “${key}” already exists in this file.`); return; }
    const raw = bibtexEntryWithKey(entry, key);
    const prefix = source.length === 0 || source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n";
    const suffix = source.length && !source.endsWith("\n") ? "\n" : "";
    onSourceChange(`${source}${prefix}${raw}${suffix}`);
    setNotice(`Added “${key}” to ${filePath}.`);
    setPendingDuplicate(undefined);
    setLibraryPickerOpen(false);
  };
  const selectLibraryEntry = (entry: ReferenceLibraryEntry) => {
    const collision = parsed.entries.some((item) => citationKeyIdentity(item.citationKey) === citationKeyIdentity(entry.citationKey));
    if (!collision) { writeLibraryEntryToProject(entry); return; }
    setPendingDuplicate(entry);
    setDuplicateKey(uniqueKeyFor(entry.citationKey));
    setDuplicateKeyError("");
  };

  const add = async (entry: BibEntryPreview) => {
    if (!api || !entry.valid || busy) return;
    setBusy(true);
    try {
      await api.references.saveEntry({ citationKey: entry.citationKey, entryType: entry.entryType, fields: entry.fields, rawBibtex: entry.rawBibtex, sourceFile: filePath });
      await reload();
      setNotice(`Added “${entry.citationKey}” to the Library.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const addAll = async () => {
    if (!api || busy) return;
    setBusy(true);
    setNotice("");
    const known = new Set(snapshot?.entries.map((item) => citationKeyIdentity(item.citationKey)) ?? []);
    const handled = new Set<string>();
    let added = 0;
    let skipped = 0;
    try {
      for (const entry of parsed.entries.filter((item) => item.valid)) {
        const normalizedKey = citationKeyIdentity(entry.citationKey);
        if (known.has(normalizedKey) || handled.has(normalizedKey)) { skipped += 1; continue; }
        await api.references.saveEntry({ citationKey: entry.citationKey, entryType: entry.entryType, fields: entry.fields, rawBibtex: entry.rawBibtex, sourceFile: filePath });
        handled.add(normalizedKey);
        added += 1;
      }
      await reload();
      setNotice(`${added} added${skipped ? `; ${skipped} existing or duplicate entries skipped` : ""}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); await reload(); }
    finally { setBusy(false); }
  };

  const beginSourceEdit = (entry: BibEntryPreview) => {
    setEditingSourceStart(entry.start);
    setSourceDraft(entry.rawBibtex);
    setSourceError("");
  };
  const saveSourceEdit = (entry: BibEntryPreview) => {
    const parsedDraft = parseBibtex(sourceDraft);
    if (parsedDraft.entries.length !== 1 || parsedDraft.invalid.length || !parsedDraft.entries[0]?.valid) {
      setSourceError("Enter exactly one complete, valid BibTeX entry.");
      return false;
    }
    const updated = parsedDraft.entries[0];
    if (!isValidCitationKey(updated.citationKey)) {
      setSourceError("Citation keys cannot contain spaces, commas, or BibTeX delimiters.");
      return false;
    }
    if (parsed.entries.some((item) => item.start !== entry.start && citationKeyIdentity(item.citationKey) === citationKeyIdentity(updated.citationKey))) {
      setSourceError(`Citation key “${updated.citationKey}” is already used in this file.`);
      return false;
    }
    if (!onSourceChange) {
      setSourceError("This BibTeX source is read-only.");
      return false;
    }
    onSourceChange(source.slice(0, entry.start) + sourceDraft + source.slice(entry.end));
    setEditingSourceStart(undefined);
    setSourceError("");
    setNotice(`Updated “${updated.citationKey}” in ${filePath}.`);
    return true;
  };
  const editingEntry = parsed.entries.find((entry) => entry.start === editingSourceStart);
  useUnsavedChanges({
    hasChanges: () => !!onSourceChange && !!editingEntry && sourceDraft !== editingEntry.rawBibtex,
    commit: () => { if (editingEntry && !saveSourceEdit(editingEntry)) throw new Error(`Could not save the BibTeX draft in ${filePath}. Please fix its syntax or duplicate citation key first.`); }
  });
  const confirmDuplicateAdd = () => {
    if (!pendingDuplicate) return;
    const key = duplicateKey.trim();
    if (!isValidCitationKey(key)) { setDuplicateKeyError("Use a key without spaces, commas, or BibTeX delimiters."); return; }
    if (parsed.entries.some((item) => citationKeyIdentity(item.citationKey) === citationKeyIdentity(key))) {
      setDuplicateKeyError(`Citation key “${key}” is still duplicated. Choose a different key.`);
      return;
    }
    writeLibraryEntryToProject(pendingDuplicate, key);
  };
  const removeCurrentEntry = () => {
    if (!removeRequest || !onSourceChange) return;
    let start = removeRequest.start;
    let end = removeRequest.end;
    if (source.slice(end, end + 2) === "\r\n") end += 2;
    else if (source[end] === "\n" || source[end] === "\r") end += 1;
    else if (source.slice(Math.max(0, start - 2), start) === "\r\n") start -= 2;
    else if (source[start - 1] === "\n" || source[start - 1] === "\r") start -= 1;
    const references = occurrences.filter((item) => citationKeyIdentity(item.key) === citationKeyIdentity(removeRequest.citationKey)).length;
    onSourceChange(source.slice(0, start) + source.slice(end));
    setNotice(references ? `Removed “${removeRequest.citationKey}” from this .bib; ${references} citation occurrence${references === 1 ? " remains" : "s remain"} in project files.` : `Removed “${removeRequest.citationKey}” from this .bib.`);
    setRemoveRequest(undefined);
    if (editingSourceStart === removeRequest.start) setEditingSourceStart(undefined);
  };

  return <section className="bib-preview-pane">
    <header className="bib-preview-header"><div><p className="reference-eyebrow">BIBTEX PREVIEW</p><h2>{filePath}</h2><p>{parsed.entries.length} entries · {parsed.invalid.length} warnings · source order preserved</p></div><div className="bib-preview-actions"><button onClick={() => setOnlyCited((value) => !value)} className={onlyCited ? "active" : ""}>{onlyCited ? "Cited only" : "All entries"}</button><button onClick={() => { setLibraryQuery(""); setLibraryPickerOpen((value) => !value); }} disabled={busy || !onSourceChange}>+ Add from Library</button><button onClick={() => void addAll()} disabled={busy}>Import valid to Library</button></div></header>
    <div className="bib-preview-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search citation key, title, author..."/><span>{entries.length} shown</span></div>
    {notice && <p className="bib-preview-notice" role="status">{notice}</p>}
    {duplicateKeys.length > 0 && <div className="bib-warning-card bib-duplicate-warning" role="alert"><strong>Duplicate citation keys</strong><span>This file contains repeated keys: {duplicateKeys.join(", ")}. Imports will not add another entry with those keys.</span></div>}
    {libraryPickerOpen && <section className="bib-library-picker" aria-label="Add a reference from the Library"><header><div><strong>Add from Library</strong><span>Choose an entry to append to this project’s .bib file.</span></div><button onClick={() => setLibraryPickerOpen(false)} aria-label="Close">×</button></header><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search title, author, or citation key..."/>{availableLibraryEntries.length ? <div className="bib-library-picker-list">{availableLibraryEntries.map((entry) => { const duplicate = parsed.entries.some((item) => citationKeyIdentity(item.citationKey) === citationKeyIdentity(entry.citationKey)); return <article key={entry.id}><div><strong>{field(entry, "title") || "Untitled reference"}</strong><span>{entry.citationKey} · {field(entry, "author") || entry.entryType} {duplicate && <em>Key already exists</em>}</span></div><button onClick={() => selectLibraryEntry(entry)}>{duplicate ? "Resolve duplicate…" : "Add to .bib"}</button></article>; })}</div> : <p className="bib-library-picker-empty">{snapshot ? "No matching references in the Library." : "Loading Library…"}</p>}</section>}
    {parsed.invalid.map((item, index) => <div className="bib-warning-card" key={`${item.start}-${index}`}><strong>Parse warning</strong><span>{item.message}</span><button onClick={() => onLocate?.({ filePath, offset: item.start })}>Open source</button></div>)}
    <div className="bib-entry-list">{entries.map((entry) => <BibEntryCard key={`${entry.citationKey}:${entry.start}`} entry={entry} inLibrary={Boolean(snapshot?.entries.some((item) => item.citationKey === entry.citationKey))} duplicateInFile={duplicateStarts.has(entry.start)} canEditProject={Boolean(onSourceChange)} usage={occurrences.filter((item) => item.key === entry.citationKey)} onAdd={() => void add(entry)} onRemoveFromProject={() => setRemoveRequest(entry)} onLocate={onLocate} filePath={filePath} busy={busy} sourceEditing={editingSourceStart === entry.start} sourceDraft={sourceDraft} sourceError={sourceError} onBeginSourceEdit={() => beginSourceEdit(entry)} onSourceDraftChange={setSourceDraft} onSaveSource={() => saveSourceEdit(entry)} onCancelSource={() => { setEditingSourceStart(undefined); setSourceError(""); }}/>)}</div>
    {pendingDuplicate && <div className="bib-operation-backdrop"><section className="bib-operation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="bib-duplicate-title"><h2 id="bib-duplicate-title">Citation key already exists</h2><p><code>{pendingDuplicate.citationKey}</code> is already present in this .bib file. Choose a new key to add this Library entry as a separate reference.</p><label>New citation key<input autoFocus value={duplicateKey} onChange={(event) => { setDuplicateKey(event.target.value); setDuplicateKeyError(""); }} onKeyDown={(event) => { if (event.key === "Enter") confirmDuplicateAdd(); if (event.key === "Escape") setPendingDuplicate(undefined); }}/></label>{duplicateKeyError && <p className="bib-operation-error" role="alert">{duplicateKeyError}</p>}<div><button onClick={() => setPendingDuplicate(undefined)}>Cancel</button><button className="primary" onClick={confirmDuplicateAdd}>Add with new key</button></div></section></div>}
    {removeRequest && <div className="bib-operation-backdrop"><section className="bib-operation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="bib-remove-title"><h2 id="bib-remove-title">Remove from this .bib file?</h2><p>Remove <code>{removeRequest.citationKey}</code> from this project file?{occurrences.some((item) => citationKeyIdentity(item.key) === citationKeyIdentity(removeRequest.citationKey)) && <> It is cited in {occurrences.filter((item) => citationKeyIdentity(item.key) === citationKeyIdentity(removeRequest.citationKey)).length} project location(s); those citations may become unresolved.</>}</p><div><button onClick={() => setRemoveRequest(undefined)}>Cancel</button><button className="danger" onClick={removeCurrentEntry}>Remove entry</button></div></section></div>}
  </section>;
}

function BibEntryCard({ entry, inLibrary, duplicateInFile, canEditProject, usage, onAdd, onRemoveFromProject, onLocate, filePath, busy, sourceEditing, sourceDraft, sourceError, onBeginSourceEdit, onSourceDraftChange, onSaveSource, onCancelSource }: { entry: BibEntryPreview; inLibrary: boolean; duplicateInFile: boolean; canEditProject: boolean; usage: CitationOccurrence[]; onAdd(): void; onRemoveFromProject(): void; onLocate?: ((location: ReferenceSourceLocation) => void) | undefined; filePath: string; busy: boolean; sourceEditing: boolean; sourceDraft: string; sourceError: string; onBeginSourceEdit(): void; onSourceDraftChange(value: string): void; onSaveSource(): void; onCancelSource(): void }) {
  const [expanded, setExpanded] = useState(false);
  return <article className={`bib-entry-card ${entry.valid ? "" : "invalid"} ${duplicateInFile ? "duplicate-key" : ""}`}>
    <header><span className="reference-entry-type">{entry.entryType}</span><strong>{field(entry, "author") || "Unknown author"} {field(entry, "year") && `(${field(entry, "year")})`}</strong><code>{entry.citationKey || "missing-key"}</code>{inLibrary ? <span className="reference-library-state linked">✓ In Library</span> : <button className="reference-library-state" onClick={onAdd} disabled={!entry.valid || busy}>+ Add to Library</button>}</header>
    {duplicateInFile && <div className="bib-entry-duplicate-warning">This citation key is duplicated in the current .bib file.</div>}
    <h3>{field(entry, "title") || "Untitled entry"}</h3><p className="bib-entry-publication">{field(entry, "journal") || field(entry, "booktitle") || field(entry, "publisher") || "No publication field"}</p>
    <div className="bib-entry-row"><span>{usage.length ? `Cited · ${usage.length} occurrence${usage.length === 1 ? "" : "s"}` : "Not cited / not indexed"}</span><button onClick={() => setExpanded((value) => !value)}>{expanded ? "Hide fields" : "Show fields"}</button><button className={sourceEditing ? "active" : ""} onClick={sourceEditing ? onCancelSource : onBeginSourceEdit}>{sourceEditing ? "Close source" : "Source"}</button><button className="danger" onClick={onRemoveFromProject} disabled={busy || !canEditProject}>Remove from .bib</button></div>
    {expanded && <><dl className="bib-fields">{Object.entries(entry.fields).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{usage.length > 0 && <div className="bib-occurrences">{usage.map((item) => <button key={`${item.filePath}:${item.start}`} onClick={() => onLocate?.({ filePath: item.filePath, offset: item.start, line: item.line, column: item.column })}>{item.filePath}:{item.line} · \{item.command}{`{${item.key}}`}</button>)}</div>}</>}
    {sourceEditing && <div className="bib-entry-source-editor"><label>Entry source <small>{filePath}</small></label><textarea aria-label={`BibTeX source for ${entry.citationKey}`} spellCheck={false} value={sourceDraft} onChange={(event) => onSourceDraftChange(event.target.value)}/>{sourceError && <p role="alert">{sourceError}</p>}<div><button onClick={onCancelSource}>Cancel</button><button className="primary" onClick={onSaveSource}>Apply to project</button></div></div>}
  </article>;
}
