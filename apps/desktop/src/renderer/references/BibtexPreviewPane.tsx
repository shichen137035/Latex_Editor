import { t } from "../i18n/index.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUnsavedChanges } from "../lifecycle/unsavedChanges.js";
import type { ReferenceLibraryEntry, ReferenceLibrarySnapshot } from "@latex-editor/contracts";
import { bibtexEntryWithKey, citationKeyIdentity, citationOccurrences, field, isValidCitationKey, parseBibtex, type BibEntry as BibEntryPreview, type CitationOccurrence } from "./bibtex.js";
import "./references.css";

export interface ReferenceSourceLocation { filePath: string; offset: number; line?: number; column?: number; }

export function BibtexPreviewPane({ source, filePath, projectId, documents, restoreScrollTop, onScrollPositionChange, onLocate, onSourceChange }: { source: string; filePath: string; projectId: string; documents: Array<{ fileId: string; content: string }>; restoreScrollTop?: number | undefined; onScrollPositionChange?(scrollTop: number): void; onLocate?(location: ReferenceSourceLocation): void; onSourceChange?(source: string): void }) {
  const api = window.latexEditor;
  const paneRef = useRef<HTMLElement | null>(null);
  useEffect(() => { if (paneRef.current) paneRef.current.scrollTop = restoreScrollTop ?? 0; }, [filePath]);
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
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteDraft, setPasteDraft] = useState("");
  const [pasteError, setPasteError] = useState("");
  const pasteReadId = useRef(0);
  const closePaste = () => { pasteReadId.current += 1; setPasteOpen(false); };
  useEffect(() => { closePaste(); setPasteDraft(""); setPasteError(""); return () => { pasteReadId.current += 1; }; }, [filePath]);
  useEffect(() => {
    if (!pasteOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePaste(); } };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [pasteOpen]);
  const openPaste = async () => {
    const requestId = ++pasteReadId.current;
    setPasteDraft(""); setPasteError(""); setLibraryPickerOpen(false); setPasteOpen(true);
    try {
      const text = await navigator.clipboard.readText();
      if (requestId === pasteReadId.current && parseBibtex(text).entries.length) setPasteDraft(current => current || text);
    } catch { /* Manual paste remains available when clipboard reading is unavailable. */ }
  };
  const addPastedEntries = () => {
    if (!onSourceChange) return;
    const incoming = parseBibtex(pasteDraft);
    if (!incoming.entries.length || incoming.invalid.length || incoming.entries.some(entry => !entry.valid)) {
      setPasteError(t(incoming.entries.length ? "ui.ReferenceLibraryPage.the_bibtex_source_is_not_valid" : "ui.ReferenceLibraryPage.paste_at_least_one_valid_bibtex_entry")); return;
    }
    const used = new Set(parsed.entries.map(entry => citationKeyIdentity(entry.citationKey)));
    for (const entry of incoming.entries) {
      if (!isValidCitationKey(entry.citationKey)) { setPasteError(t("ui.BibtexPreviewPane.use_a_key_without_spaces_commas_or")); return; }
      const key = citationKeyIdentity(entry.citationKey);
      if (used.has(key)) { setPasteError(t("ui.BibtexPreviewPane.citation_key_is_already_used_in_this", { value1: entry.citationKey })); return; }
      used.add(key);
    }
    const newline = source.match(/\r\n|\n|\r/)?.[0] ?? pasteDraft.match(/\r\n|\n|\r/)?.[0] ?? "\n";
    const prefix = !source.length || source.endsWith(newline + newline) ? "" : source.endsWith(newline) ? newline : newline + newline;
    const raw = pasteDraft.trim().replace(/\r\n|\r|\n/g, newline);
    onSourceChange(`${source}${prefix}${raw}${newline}`);
    setNotice(t("ui.BibtexPreviewPane.pasted_entries_added", { count: incoming.entries.length, file: filePath }));
    closePaste(); setPasteDraft(""); setPasteError("");
  };
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
    if (!onSourceChange) { setNotice(t("ui.BibtexPreviewPane.this_bibtex_source_is_read_only")); return; }
    const existing = parsed.entries.some((item) => citationKeyIdentity(item.citationKey) === citationKeyIdentity(key));
    if (existing) { setNotice(t("ui.BibtexPreviewPane.citation_key_already_exists_in_this_file", { value1: key })); return; }
    const raw = bibtexEntryWithKey(entry, key);
    const prefix = source.length === 0 || source.endsWith("\n\n") ? "" : source.endsWith("\n") ? "\n" : "\n\n";
    const suffix = source.length && !source.endsWith("\n") ? "\n" : "";
    onSourceChange(`${source}${prefix}${raw}${suffix}`);
    setNotice(t("ui.BibtexPreviewPane.added_to", { value1: key, value2: filePath }));
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
      setNotice(t("ui.BibtexPreviewPane.added_to_the_library", { value1: entry.citationKey }));
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
      setNotice(t("ui.BibtexPreviewPane.added", { value1: added, value2: (skipped ? t("ui.BibtexPreviewPane.existing_or_duplicate_entries_skipped", { value1: skipped }) : "") }));
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
      setSourceError(t("ui.BibtexPreviewPane.enter_exactly_one_complete_valid_bibtex_entry"));
      return false;
    }
    const updated = parsedDraft.entries[0];
    if (!isValidCitationKey(updated.citationKey)) {
      setSourceError(t("ui.BibtexPreviewPane.citation_keys_cannot_contain_spaces_commas_or"));
      return false;
    }
    if (parsed.entries.some((item) => item.start !== entry.start && citationKeyIdentity(item.citationKey) === citationKeyIdentity(updated.citationKey))) {
      setSourceError(t("ui.BibtexPreviewPane.citation_key_is_already_used_in_this", { value1: updated.citationKey }));
      return false;
    }
    if (!onSourceChange) {
      setSourceError(t("ui.BibtexPreviewPane.this_bibtex_source_is_read_only"));
      return false;
    }
    onSourceChange(source.slice(0, entry.start) + sourceDraft + source.slice(entry.end));
    setEditingSourceStart(undefined);
    setSourceError("");
    setNotice(t("ui.BibtexPreviewPane.updated_in", { value1: updated.citationKey, value2: filePath }));
    return true;
  };
  const editingEntry = parsed.entries.find((entry) => entry.start === editingSourceStart);
  useUnsavedChanges({
    hasChanges: () => !!onSourceChange && !!editingEntry && sourceDraft !== editingEntry.rawBibtex,
    commit: () => { if (editingEntry && !saveSourceEdit(editingEntry)) throw new Error(t("ui.BibtexPreviewPane.could_not_save_the_bibtex_draft_in", { value1: filePath })); }
  });
  const confirmDuplicateAdd = () => {
    if (!pendingDuplicate) return;
    const key = duplicateKey.trim();
    if (!isValidCitationKey(key)) { setDuplicateKeyError(t("ui.BibtexPreviewPane.use_a_key_without_spaces_commas_or")); return; }
    if (parsed.entries.some((item) => citationKeyIdentity(item.citationKey) === citationKeyIdentity(key))) {
      setDuplicateKeyError(t("ui.BibtexPreviewPane.citation_key_is_still_duplicated_choose_a", { value1: key }));
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
    setNotice(references ? t("ui.BibtexPreviewPane.removed_from_this_bib_citation_occurrence_s", { value1: removeRequest.citationKey, value2: references }) : t("ui.BibtexPreviewPane.removed_from_this_bib", { value1: removeRequest.citationKey }));
    setRemoveRequest(undefined);
    if (editingSourceStart === removeRequest.start) setEditingSourceStart(undefined);
  };

  return <section ref={paneRef} className="bib-preview-pane" onScroll={(event) => onScrollPositionChange?.(event.currentTarget.scrollTop)}>
    <header className="bib-preview-header"><div><p className="reference-eyebrow">{t("ui.BibtexPreviewPane.bibtex_preview")}</p><h2>{filePath}</h2><p>{parsed.entries.length} {t("ui.BibtexPreviewPane.entries")}{parsed.invalid.length} {t("ui.BibtexPreviewPane.warnings_source_order_preserved")}</p></div><div className="bib-preview-actions"><button onClick={() => setOnlyCited((value) => !value)} className={onlyCited ? "active" : ""}>{onlyCited ? t("ui.BibtexPreviewPane.cited_only") : t("ui.BibtexPreviewPane.all_entries")}</button><button onClick={() => { setLibraryQuery(""); setLibraryPickerOpen((value) => !value); }} disabled={busy || !onSourceChange}>{t("ui.BibtexPreviewPane.add_from_library")}</button><button onClick={() => void openPaste()} disabled={busy || !onSourceChange}>{t("ui.BibtexPreviewPane.paste_bibtex")}</button><button onClick={() => void addAll()} disabled={busy}>{t("ui.BibtexPreviewPane.import_valid_to_library")}</button></div></header>
    <div className="bib-preview-toolbar"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("ui.BibtexPreviewPane.search_citation_key_title_author")}/><span>{entries.length} {t("ui.BibtexPreviewPane.shown")}</span></div>
    {notice && <p className="bib-preview-notice" role="status">{notice}</p>}
    {pasteOpen && <div className="bib-operation-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) closePaste(); }}>
      <section className="bib-operation-dialog bib-paste-dialog" role="dialog" aria-modal="true" aria-labelledby="bib-paste-title">
        <h2 id="bib-paste-title">{t("ui.BibtexPreviewPane.paste_bibtex")}</h2>
        <p>{t("ui.BibtexPreviewPane.paste_bibtex_description")} <code>{filePath}</code></p>
        <textarea autoFocus aria-label={t("ui.ReferenceLibraryPage.bibtex_source")} spellCheck={false} value={pasteDraft} onChange={event => { pasteReadId.current += 1; setPasteDraft(event.target.value); setPasteError(""); }} onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); addPastedEntries(); } }} placeholder={'@article{key,\n  title = {...},\n  author = {...},\n  year = {2026}\n}'}/>
        {pasteError && <p className="bib-operation-error" role="alert">{pasteError}</p>}
        <div><button onClick={closePaste}>{t("settings.aiSkillsCancel")}</button><button className="primary" onClick={addPastedEntries} disabled={!pasteDraft.trim() || busy || !onSourceChange}>{t("ui.BibtexPreviewPane.add_to_bib")}</button></div>
      </section>
    </div>}
    {duplicateKeys.length > 0 && <div className="bib-warning-card bib-duplicate-warning" role="alert"><strong>{t("ui.BibtexPreviewPane.duplicate_citation_keys")}</strong><span>{t("ui.BibtexPreviewPane.this_file_contains_repeated_keys")}{duplicateKeys.join(", ")}{t("ui.BibtexPreviewPane.imports_will_not_add_another_entry_with")}</span></div>}
    {libraryPickerOpen && <section className="bib-library-picker" aria-label={t("ui.BibtexPreviewPane.add_a_reference_from_the_library")}><header><div><strong>{t("ui.BibtexPreviewPane.add_from_library_2")}</strong><span>{t("ui.BibtexPreviewPane.choose_an_entry_to_append_to_this")}</span></div><button onClick={() => setLibraryPickerOpen(false)} aria-label={t("ai.history.close")}>×</button></header><input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder={t("ui.BibtexPreviewPane.search_title_author_or_citation_key")}/>{availableLibraryEntries.length ? <div className="bib-library-picker-list">{availableLibraryEntries.map((entry) => { const duplicate = parsed.entries.some((item) => citationKeyIdentity(item.citationKey) === citationKeyIdentity(entry.citationKey)); return <article key={entry.id}><div><strong>{field(entry, "title") || t("ui.BibtexPreviewPane.untitled_reference")}</strong><span>{entry.citationKey} · {field(entry, "author") || entry.entryType} {duplicate && <em>{t("ui.BibtexPreviewPane.key_already_exists")}</em>}</span></div><button onClick={() => selectLibraryEntry(entry)}>{duplicate ? t("ui.BibtexPreviewPane.resolve_duplicate") : t("ui.BibtexPreviewPane.add_to_bib")}</button></article>; })}</div> : <p className="bib-library-picker-empty">{snapshot ? t("ui.BibtexPreviewPane.no_matching_references_in_the_library") : t("ui.BibtexPreviewPane.loading_library")}</p>}</section>}
    {parsed.invalid.map((item, index) => <div className="bib-warning-card" key={`${item.start}-${index}`}><strong>{t("ui.BibtexPreviewPane.parse_warning")}</strong><span>{item.message}</span><button onClick={() => onLocate?.({ filePath, offset: item.start })}>{t("ui.BibtexPreviewPane.open_source")}</button></div>)}
    <div className="bib-entry-list">{entries.map((entry) => <BibEntryCard key={`${entry.citationKey}:${entry.start}`} entry={entry} inLibrary={Boolean(snapshot?.entries.some((item) => item.citationKey === entry.citationKey))} duplicateInFile={duplicateStarts.has(entry.start)} canEditProject={Boolean(onSourceChange)} usage={occurrences.filter((item) => item.key === entry.citationKey)} onAdd={() => void add(entry)} onRemoveFromProject={() => setRemoveRequest(entry)} onLocate={onLocate} filePath={filePath} busy={busy} sourceEditing={editingSourceStart === entry.start} sourceDraft={sourceDraft} sourceError={sourceError} onBeginSourceEdit={() => beginSourceEdit(entry)} onSourceDraftChange={setSourceDraft} onSaveSource={() => saveSourceEdit(entry)} onCancelSource={() => { setEditingSourceStart(undefined); setSourceError(""); }}/>)}</div>
    {pendingDuplicate && <div className="bib-operation-backdrop"><section className="bib-operation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="bib-duplicate-title"><h2 id="bib-duplicate-title">{t("ui.BibtexPreviewPane.citation_key_already_exists")}</h2><p><code>{pendingDuplicate.citationKey}</code> {t("ui.BibtexPreviewPane.is_already_present_in_this_bib_file")}</p><label>{t("ui.BibtexPreviewPane.new_citation_key")}<input autoFocus value={duplicateKey} onChange={(event) => { setDuplicateKey(event.target.value); setDuplicateKeyError(""); }} onKeyDown={(event) => { if (event.key === "Enter") confirmDuplicateAdd(); if (event.key === "Escape") setPendingDuplicate(undefined); }}/></label>{duplicateKeyError && <p className="bib-operation-error" role="alert">{duplicateKeyError}</p>}<div><button onClick={() => setPendingDuplicate(undefined)}>{t("settings.aiSkillsCancel")}</button><button className="primary" onClick={confirmDuplicateAdd}>{t("ui.BibtexPreviewPane.add_with_new_key")}</button></div></section></div>}
    {removeRequest && <div className="bib-operation-backdrop"><section className="bib-operation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="bib-remove-title"><h2 id="bib-remove-title">{t("ui.BibtexPreviewPane.remove_from_this_bib_file")}</h2><p>{t("settings.spellcheckRemove")}<code>{removeRequest.citationKey}</code> {t("ui.BibtexPreviewPane.from_this_project_file")}{occurrences.some((item) => citationKeyIdentity(item.key) === citationKeyIdentity(removeRequest.citationKey)) && <> {t("ui.BibtexPreviewPane.it_is_cited_in")}{occurrences.filter((item) => citationKeyIdentity(item.key) === citationKeyIdentity(removeRequest.citationKey)).length} {t("ui.BibtexPreviewPane.project_location_s_those_citations_may_become")}</>}</p><div><button onClick={() => setRemoveRequest(undefined)}>{t("settings.aiSkillsCancel")}</button><button className="danger" onClick={removeCurrentEntry}>{t("ui.BibtexPreviewPane.remove_entry")}</button></div></section></div>}
  </section>;
}

function BibEntryCard({ entry, inLibrary, duplicateInFile, canEditProject, usage, onAdd, onRemoveFromProject, onLocate, filePath, busy, sourceEditing, sourceDraft, sourceError, onBeginSourceEdit, onSourceDraftChange, onSaveSource, onCancelSource }: { entry: BibEntryPreview; inLibrary: boolean; duplicateInFile: boolean; canEditProject: boolean; usage: CitationOccurrence[]; onAdd(): void; onRemoveFromProject(): void; onLocate?: ((location: ReferenceSourceLocation) => void) | undefined; filePath: string; busy: boolean; sourceEditing: boolean; sourceDraft: string; sourceError: string; onBeginSourceEdit(): void; onSourceDraftChange(value: string): void; onSaveSource(): void; onCancelSource(): void }) {
  const [expanded, setExpanded] = useState(false);
  return <article className={`bib-entry-card ${entry.valid ? "" : "invalid"} ${duplicateInFile ? "duplicate-key" : ""}`}>
    <header><span className="reference-entry-type">{entry.entryType}</span><strong>{field(entry, "author") || t("ui.BibtexPreviewPane.unknown_author")} {field(entry, "year") && `(${field(entry, "year")})`}</strong><code>{entry.citationKey || t("ui.BibtexPreviewPane.missing_key")}</code>{inLibrary ? <span className="reference-library-state linked">{t("ui.BibtexPreviewPane.in_library")}</span> : <button className="reference-library-state" onClick={onAdd} disabled={!entry.valid || busy}>{t("ui.BibtexPreviewPane.add_to_library")}</button>}</header>
    {duplicateInFile && <div className="bib-entry-duplicate-warning">{t("ui.BibtexPreviewPane.this_citation_key_is_duplicated_in_the")}</div>}
    <h3>{field(entry, "title") || t("ui.BibtexPreviewPane.untitled_entry")}</h3><p className="bib-entry-publication">{field(entry, "journal") || field(entry, "booktitle") || field(entry, "publisher") || t("ui.BibtexPreviewPane.no_publication_field")}</p>
    <div className="bib-entry-row"><span>{usage.length ? t("ui.BibtexPreviewPane.cited_occurrence_s", { value1: usage.length }) : t("ui.BibtexPreviewPane.not_cited_not_indexed")}</span><button onClick={() => setExpanded((value) => !value)}>{expanded ? t("ui.BibtexPreviewPane.hide_fields") : t("ui.BibtexPreviewPane.show_fields")}</button><button className={sourceEditing ? "active" : ""} onClick={sourceEditing ? onCancelSource : onBeginSourceEdit}>{sourceEditing ? t("ui.BibtexPreviewPane.close_source") : t("shortcut.source")}</button><button className="danger" onClick={onRemoveFromProject} disabled={busy || !canEditProject}>{t("ui.BibtexPreviewPane.remove_from_bib")}</button></div>
    {expanded && <><dl className="bib-fields">{Object.entries(entry.fields).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>{usage.length > 0 && <div className="bib-occurrences">{usage.map((item) => <button key={`${item.filePath}:${item.start}`} onClick={() => onLocate?.({ filePath: item.filePath, offset: item.start, line: item.line, column: item.column })}>{item.filePath}:{item.line} · \{item.command}{`{${item.key}}`}</button>)}</div>}</>}
    {sourceEditing && <div className="bib-entry-source-editor"><label>{t("ui.BibtexPreviewPane.entry_source")}<small>{filePath}</small></label><textarea aria-label={t("ui.BibtexPreviewPane.bibtex_source_for", { value1: entry.citationKey })} spellCheck={false} value={sourceDraft} onChange={(event) => onSourceDraftChange(event.target.value)}/>{sourceError && <p role="alert">{sourceError}</p>}<div><button onClick={onCancelSource}>{t("settings.aiSkillsCancel")}</button><button className="primary" onClick={onSaveSource}>{t("ui.BibtexPreviewPane.apply_to_project")}</button></div></div>}
  </article>;
}
