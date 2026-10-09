import { referenceTypeName } from "../i18n/displayNames.js";
import { t } from "../i18n/index.js";
import { useEffect, useMemo, useState } from "react";
import type { Project, ReferenceLibraryEntry, ReferenceLibrarySnapshot, ReferenceTag } from "@latex-editor/contracts";
import { citationKeyIdentity, field, parseBibtex, renderBibtexEntry } from "./bibtex.js";
import "./reference-library-page.css";

type LibraryFilter = "all" | "cited" | "unlinked" | "favorites";
type DetailMode = "details" | "source" | "edit";
type LibrarySort = "added" | "title" | "usage" | "year";
type SortDirection = "asc" | "desc";
type EntryInputMode = "source" | "fields";

const commonEntryTypes = ["article", "book", "inbook", "incollection", "inproceedings", "conference", "proceedings", "booklet", "manual", "mastersthesis", "phdthesis", "thesis", "techreport", "report", "patent", "online", "software", "dataset", "misc", "unpublished"];

export function ReferenceLibraryPage({ projects, onBack, returnToProject = false }: { projects: Project[]; onBack(): void; returnToProject?: boolean }) {
  const api = window.latexEditor;
  const [snapshot, setSnapshot] = useState<ReferenceLibrarySnapshot>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [type, setType] = useState("");
  const [collection, setCollection] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sort, setSort] = useState<LibrarySort>("added");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedId, setSelectedId] = useState<string>();
  const [detailMode, setDetailMode] = useState<DetailMode>("details");
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [inputMode, setInputMode] = useState<EntryInputMode>("source");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [entryTags, setEntryTags] = useState<string[]>([]);
  const [draft, setDraft] = useState({ citationKey: "", entryType: "article", author: "", title: "", year: "", journal: "", source: "" });

  const reload = async () => { if (api) setSnapshot(await api.references.snapshot()); };
  useEffect(() => { void reload(); }, []);

  const entries = useMemo(() => (snapshot?.entries ?? []).filter((entry) => {
    const links = snapshot?.projectLinks.filter((item) => item.libraryEntryId === entry.id) ?? [];
    const haystack = [entry.citationKey, entry.entryType, ...Object.values(entry.fields), ...entry.tags, ...entry.collections].join(" ").toLocaleLowerCase();
    return (!query.trim() || haystack.includes(query.trim().toLocaleLowerCase()))
      && (!type || entry.entryType === type)
      && (!collection || entry.collections.includes(collection))
      && (!tagFilter || entry.tags.includes(tagFilter))
      && (filter === "all" || (filter === "cited" && links.length > 0) || (filter === "unlinked" && links.length === 0) || (filter === "favorites" && entry.favorite));
  }).sort((left, right) => {
    let comparison = 0;
    if (sort === "title") comparison = (field(left, "title") || left.citationKey).localeCompare(field(right, "title") || right.citationKey, undefined, { sensitivity: "base" });
    else if (sort === "year") comparison = (Number(field(left, "year")) || 0) - (Number(field(right, "year")) || 0);
    else if (sort === "usage") comparison = (snapshot?.projectLinks.filter((item) => item.libraryEntryId === left.id).length ?? 0) - (snapshot?.projectLinks.filter((item) => item.libraryEntryId === right.id).length ?? 0);
    else comparison = left.createdAt.localeCompare(right.createdAt);
    if (comparison === 0) comparison = left.citationKey.localeCompare(right.citationKey, undefined, { sensitivity: "base" });
    return sortDirection === "asc" ? comparison : -comparison;
  }), [collection, filter, query, snapshot, sort, sortDirection, tagFilter, type]);
  const selected = snapshot?.entries.find((entry) => entry.id === selectedId);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);

  useEffect(() => {
    const closeTransientView = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (tagManagerOpen) setTagManagerOpen(false);
      else if (newEntryOpen) setNewEntryOpen(false);
      else if (selectedId) setSelectedId(undefined);
    };
    document.addEventListener("keydown", closeTransientView);
    return () => document.removeEventListener("keydown", closeTransientView);
  }, [newEntryOpen, selectedId, tagManagerOpen]);

  useEffect(() => {
    if (selectedId && !entries.some((entry) => entry.id === selectedId)) setSelectedId(undefined);
  }, [entries, selectedId]);
  useEffect(() => {
    if (tagFilter && !(snapshot?.tags ?? []).some((tag) => tag.name === tagFilter)) setTagFilter("");
  }, [snapshot, tagFilter]);

  const importBib = async () => {
    if (!api) return;
    const paths = await api.dialogs.pickFiles();
    const path = paths.find((item) => item.toLocaleLowerCase().endsWith(".bib"));
    if (!path) return;
    setBusy(true);
    try { const result = await api.references.importFile(path); setNotice(t("ui.ReferenceLibraryPage.entries_imported", { value1: result.entries.length, value2: (result.duplicates.length ? t("ui.ReferenceLibraryPage.duplicates_skipped", { value1: result.duplicates.length }) : "") })); await reload(); }
    catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const createEntry = async () => {
    if (!api) return;
    setBusy(true);
    try {
      if (inputMode === "source") {
        const parsed = parseBibtex(draft.source);
        const valid = parsed.entries.filter((entry) => entry.valid);
        if (!valid.length) { setNotice(parsed.invalid[0]?.message ?? t("ui.ReferenceLibraryPage.paste_at_least_one_valid_bibtex_entry")); return; }
        const existingKeys = new Set((snapshot?.entries ?? []).map((entry) => citationKeyIdentity(entry.citationKey)));
        const seen = new Set<string>();
        let added = 0;
        let duplicates = 0;
        for (const entry of valid) {
          const key = citationKeyIdentity(entry.citationKey);
          if (existingKeys.has(key) || seen.has(key)) { duplicates += 1; continue; }
          await api.references.saveEntry({ citationKey: entry.citationKey, entryType: entry.entryType, fields: entry.fields, rawBibtex: entry.rawBibtex, tags: entryTags });
          seen.add(key);
          added += 1;
        }
        setNotice(t("ui.ReferenceLibraryPage.reference_s_added", { value1: added, value2: (duplicates ? t("ui.ReferenceLibraryPage.duplicate_s_skipped", { value1: duplicates }) : ""), value3: (parsed.invalid.length ? t("ui.ReferenceLibraryPage.invalid_entr_s_skipped", { value1: parsed.invalid.length }) : "") }));
        if (added === 0) return;
      } else {
        if (!draft.citationKey.trim() || !draft.title.trim()) return;
        const fields = Object.fromEntries(Object.entries({ author: draft.author, title: draft.title, year: draft.year, journal: draft.journal }).filter(([, value]) => value.trim()));
        await api.references.saveEntry({ citationKey: draft.citationKey.trim(), entryType: draft.entryType, fields, tags: entryTags });
        setNotice(t("ui.ReferenceLibraryPage.reference_added_to_the_library"));
      }
      setDraft({ citationKey: "", entryType: "article", author: "", title: "", year: "", journal: "", source: "" });
      setEntryTags([]);
      setNewEntryOpen(false);
      setSelectedId(undefined);
      setDetailMode("details");
      await reload();
    } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const toggleFavorite = async (entry: ReferenceLibraryEntry) => {
    if (!api) return;
    await api.references.setFavorite(entry.id, !entry.favorite);
    await reload();
  };

  return <main className="library-page">
    <header className="library-page-header">
      <button className="library-back" onClick={onBack}>‹ <span>{returnToProject ? t("ui.ReferenceLibraryPage.back_to_project") : t("project.directory")}</span></button>
      <div className="library-title-lockup"><div><p>{t("ui.ReferenceLibraryPage.your_research_collection")}</p><h1>{t("ui.ReferenceLibraryPage.reference_library")}</h1></div></div>
      <div className="library-page-actions"><span className="library-count">{snapshot?.entries.length ?? 0} {t("ui.ReferenceLibraryPage.entries")}</span><button className="library-button secondary" onClick={() => void importBib()} disabled={busy}>{t("ui.ReferenceLibraryPage.import_bib")}</button><button className="library-button primary" onClick={() => { setEntryTags([]); setNewEntryOpen(true); }}>{t("ui.ReferenceLibraryPage.new_entry")}</button></div>
    </header>
    <div className="library-page-grid">
      <aside className="library-filter-rail">
        <label className="library-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("ui.ReferenceLibraryPage.find_references")} /></label>
        <div className="library-rail-section"><span className="library-rail-label">{t("ui.ReferenceLibraryPage.view")}</span><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>{t("ui.BibtexPreviewPane.all_entries")}<b>{snapshot?.entries.length ?? 0}</b></button><button className={filter === "favorites" ? "active" : ""} onClick={() => setFilter("favorites")}>{t("ui.ReferenceLibraryPage.favorites")}<b>{snapshot?.entries.filter((entry) => entry.favorite).length ?? 0}</b></button><button className={filter === "cited" ? "active" : ""} onClick={() => setFilter("cited")}>{t("ui.ReferenceLibraryPage.used_in_projects")}<b>{new Set((snapshot?.projectLinks ?? []).map((item) => item.libraryEntryId)).size}</b></button><button className={filter === "unlinked" ? "active" : ""} onClick={() => setFilter("unlinked")}>{t("ui.ReferenceLibraryPage.not_linked")}<b>{(snapshot?.entries ?? []).filter((entry) => !(snapshot?.projectLinks ?? []).some((item) => item.libraryEntryId === entry.id)).length}</b></button></div>
        <div className="library-rail-section"><span className="library-rail-label">{t("ui.ReferenceLibraryPage.entry_type")}</span><button className={!type ? "active" : ""} onClick={() => setType("")}>{t("ui.ProjectReferencesPanel.all_types")}<b>{snapshot?.entries.length ?? 0}</b></button>{[...new Set([...commonEntryTypes, ...(snapshot?.entries ?? []).map((entry) => entry.entryType)])].sort().map((value) => { const count = snapshot?.entries.filter((entry) => entry.entryType === value).length ?? 0; return <button className={type === value ? "active" : ""} key={value} onClick={() => setType(type === value ? "" : value)}>{referenceTypeName(value)}<b>{count}</b></button>; })}</div>
        <div className="library-rail-section"><span className="library-rail-label">{t("ui.ReferenceLibraryPage.collections")}</span>{(snapshot?.collections ?? []).map((item) => <button className={collection === item.name ? "active" : ""} key={item.id} onClick={() => setCollection(collection === item.name ? "" : item.name)}>{item.name}<b>{snapshot?.entries.filter((entry) => entry.collections.includes(item.name)).length}</b></button>)}{!(snapshot?.collections.length) && <p className="library-rail-empty">{t("ui.ReferenceLibraryPage.create_collections_from_the_quick_library_tool")}</p>}</div>
        <div className="library-rail-section"><div className="library-tag-rail-heading"><span className="library-rail-label">{t("ui.ReferenceLibraryPage.tags")}</span><button type="button" title={t("ui.ReferenceLibraryPage.manage_tag_library")} aria-label={t("ui.ReferenceLibraryPage.manage_tag_library")} onClick={() => setTagManagerOpen(true)}>＋</button></div>{(snapshot?.tags ?? []).map((item) => <button className={tagFilter === item.name ? "active" : ""} key={item.id} onClick={() => setTagFilter(tagFilter === item.name ? "" : item.name)}>{item.name}<b>{snapshot?.entries.filter((entry) => entry.tags.includes(item.name)).length}</b></button>)}{!(snapshot?.tags.length) && <p className="library-rail-empty">{t("ui.ReferenceLibraryPage.use_to_add_tags_to_your_library")}</p>}</div>
        {notice && <div className="library-notice">{notice}</div>}
      </aside>
      <section className="library-results">
        <div className="library-results-head"><div><p className="library-eyebrow">{t("ui.ReferenceLibraryPage.curated_locally")}</p><h2>{filter === "all" ? t("ui.ReferenceLibraryPage.all_references") : filter === "favorites" ? t("directory.tab.favorites") : filter === "cited" ? t("ui.ReferenceLibraryPage.used_in_projects") : t("ui.ReferenceLibraryPage.not_linked")}</h2></div><label className="library-sort">{t("ui.ReferenceLibraryPage.sort_by")}<select value={sort} onChange={(event) => { const nextSort = event.target.value as LibrarySort; setSort(nextSort); setSortDirection(nextSort === "title" ? "asc" : "desc"); }}><option value="added">{t("ui.ReferenceLibraryPage.recently_added")}</option><option value="title">{t("ui.ReferenceLibraryPage.title_a_z")}</option><option value="usage">{t("ui.ReferenceLibraryPage.most_used")}</option><option value="year">{t("ui.ReferenceLibraryPage.year")}</option></select><button className="library-sort-direction" type="button" onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")} aria-label={t("ui.ReferenceLibraryPage.switch_to_order", { value1: (sortDirection === "asc" ? t("common.sortDescending") : t("common.sortAscending")) })} title={t("ui.ReferenceLibraryPage.order", { value1: (sortDirection === "asc" ? t("common.sortAscending") : t("common.sortDescending")) })}>{sortDirection === "asc" ? "↑" : "↓"}</button></label><span>{entries.length} {t("ui.BibtexPreviewPane.shown")}</span></div>
        {entries.length ? <div className="library-row-list">{entries.map((entry) => <LibraryRow key={entry.id} entry={entry} links={(snapshot?.projectLinks ?? []).filter((item) => item.libraryEntryId === entry.id)} selected={entry.id === selectedId} onFavorite={() => void toggleFavorite(entry)} onClick={() => { setSelectedId(entry.id); setDetailMode("details"); }} />)}</div> : <div className="library-empty"><strong>{t("ui.ReferenceLibraryPage.no_references_match_this_view")}</strong><span>{t("ui.ReferenceLibraryPage.try_another_filter_or_import_a_bibtex")}</span></div>}
      </section>
    </div>
    {newEntryOpen && <div className="library-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setNewEntryOpen(false); }}><section className="library-new-entry" role="dialog" aria-modal="true"><header><div><p className="library-eyebrow">{t("ui.ReferenceLibraryPage.library_entry")}</p><h2>{t("ui.ReferenceLibraryPage.add_references")}</h2><p>{t("ui.ReferenceLibraryPage.paste_bibtex_copied_from_google_scholar_or")}</p></div><button onClick={() => setNewEntryOpen(false)}>×</button></header><nav className="library-input-mode"><button className={inputMode === "source" ? "active" : ""} onClick={() => setInputMode("source")}>{t("ui.ReferenceLibraryPage.bibtex_source")}<span>{t("ui.ReferenceLibraryPage.recommended")}</span></button><button className={inputMode === "fields" ? "active" : ""} onClick={() => setInputMode("fields")}>{t("ui.ReferenceLibraryPage.enter_fields")}</button></nav>{inputMode === "source" ? <div className="library-source-entry"><textarea autoFocus value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })} placeholder={'@article{author2024,\n  title = {Paper title},\n  author = {Author Name},\n  journal = {Journal},\n  year = {2024}\n}'} spellCheck={false}/><small>{parseBibtex(draft.source).entries.length} {t("ui.ReferenceLibraryPage.entries_detected_valid_entries_will_be_added")}</small></div> : <EntryForm draft={draft} onChange={setDraft} />}<div className="library-tag-field"><span className="library-tag-field-label">{t("ui.ReferenceLibraryPage.tags_2")}</span><ReferenceTagEditor value={entryTags} availableTags={snapshot?.tags ?? []} onChange={setEntryTags}/></div><footer><button className="library-button secondary" onClick={() => setNewEntryOpen(false)}>{t("settings.aiSkillsCancel")}</button><button className="library-button primary" onClick={() => void createEntry()} disabled={busy}>{inputMode === "source" ? t("ui.ReferenceLibraryPage.add_to_library") : t("ui.ReferenceLibraryPage.create_entry")}</button></footer></section></div>}
    {tagManagerOpen && <TagLibraryManager tags={snapshot?.tags ?? []} entries={snapshot?.entries ?? []} onClose={() => setTagManagerOpen(false)} onSaved={reload}/>}
    {selected && <LibraryDetail entry={selected} availableTags={snapshot?.tags ?? []} links={(snapshot?.projectLinks ?? []).filter((item) => item.libraryEntryId === selected.id)} projectNames={projectNames} mode={detailMode} onMode={setDetailMode} onClose={() => setSelectedId(undefined)} onSaved={async () => { await reload(); setDetailMode("details"); }} />}
  </main>;
}

function LibraryRow({ entry, links, selected, onClick, onFavorite }: { entry: ReferenceLibraryEntry; links: ReferenceLibrarySnapshot["projectLinks"]; selected: boolean; onClick(): void; onFavorite(): void }) {
  const tags = entry.tags.slice(0, 3);
  const projectCount = new Set(links.map((item) => item.projectId)).size;
  const venue = field(entry, "journal") || field(entry, "booktitle") || field(entry, "publisher") || field(entry, "institution");
  const citationLine = [venue, field(entry, "volume") && t("reference.volume", { value: field(entry, "volume") }), field(entry, "number") && t("reference.number", { value: field(entry, "number") }), field(entry, "pages") && t("reference.pages", { value: field(entry, "pages") })].filter(Boolean).join(" · ");
  return <article className={`library-reference-card ${selected ? "selected" : ""}`}><button className={`library-favorite ${entry.favorite ? "active" : ""}`} onClick={(event) => { event.stopPropagation(); onFavorite(); }} title={entry.favorite ? t("directory.removeFavorite") : t("directory.addFavorite")} aria-label={entry.favorite ? t("directory.removeFavorite") : t("directory.addFavorite")}>★</button><button className="library-reference-row" onClick={onClick}><span className="library-entry-icon">{entry.entryType.slice(0, 1).toUpperCase()}</span><span className="library-row-main"><span className="library-row-kicker">{referenceTypeName(entry.entryType)} <code>{entry.citationKey}</code></span><strong>{field(entry, "title") || t("ui.BibtexPreviewPane.untitled_entry")}</strong><small className="library-row-author">{field(entry, "author") || t("ui.BibtexPreviewPane.unknown_author")}<b>{field(entry, "year") || t("ui.ReferenceLibraryPage.year_n_a")}</b></small>{citationLine && <span className="library-row-venue">{citationLine}</span>}<span className="library-row-tags">{tags.map((tag) => <em key={tag}>{tag}</em>)}{entry.tags.length > 3 && <em>+{entry.tags.length - 3}</em>}</span></span><span className="library-row-usage">{projectCount ? <><b>{projectCount}</b><small>{t(projectCount === 1 ? "reference.projectOne" : "reference.projectMany")}</small></> : <small>{t("ui.ReferenceLibraryPage.not_linked")}</small>}<span className="library-row-chevron">›</span></span></button></article>;
}

function EntryForm({ draft, onChange }: { draft: { citationKey: string; entryType: string; author: string; title: string; year: string; journal: string; source: string }; onChange(next: typeof draft): void }) {
  const update = (key: keyof typeof draft, value: string) => onChange({ ...draft, [key]: value });
  return <div className="library-entry-form-grid"><label>{t("ui.ReferenceLibraryPage.citation_key")}<input value={draft.citationKey} onChange={(event) => update("citationKey", event.target.value)} /></label><label>{t("relation.type")}<select value={draft.entryType} onChange={(event) => update("entryType", event.target.value)}><option>{t("ui.ReferenceLibraryPage.article")}</option><option>{t("ui.ReferenceLibraryPage.book")}</option><option>{t("ui.ReferenceLibraryPage.inproceedings")}</option><option>{t("ui.ReferenceLibraryPage.misc")}</option></select></label><label>{t("history.entryTitle")}<input value={draft.title} onChange={(event) => update("title", event.target.value)} /></label><label>{t("ui.ReferenceLibraryPage.author")}<input value={draft.author} onChange={(event) => update("author", event.target.value)} /></label><label>{t("ui.ReferenceLibraryPage.year")}<input value={draft.year} onChange={(event) => update("year", event.target.value)} /></label><label>{t("ui.ReferenceLibraryPage.journal_venue")}<input value={draft.journal} onChange={(event) => update("journal", event.target.value)} /></label></div>;
}

function LibraryDetail({ entry, availableTags, links, projectNames, mode, onMode, onClose, onSaved }: { entry: ReferenceLibraryEntry; availableTags: ReferenceTag[]; links: ReferenceLibrarySnapshot["projectLinks"]; projectNames: Map<string, string>; mode: DetailMode; onMode(mode: DetailMode): void; onClose(): void; onSaved(): Promise<void> }) {
  const api = window.latexEditor;
  const [citationKey, setCitationKey] = useState(entry.citationKey);
  const [entryType, setEntryType] = useState(entry.entryType);
  const [fieldsText, setFieldsText] = useState(JSON.stringify(entry.fields, null, 2));
  const [tags, setTags] = useState(entry.tags);
  const [sourceText, setSourceText] = useState(entry.rawBibtex ?? renderBibtexEntry(entry));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setCitationKey(entry.citationKey); setEntryType(entry.entryType); setFieldsText(JSON.stringify(entry.fields, null, 2)); setTags(entry.tags); setSourceText(entry.rawBibtex ?? renderBibtexEntry(entry)); }, [entry]);
  const saveFields = async () => {
    if (!api) return;
    setSaving(true);
    try { const fields = JSON.parse(fieldsText) as Record<string, string>; await api.references.saveEntry({ ...entry, citationKey: citationKey.trim(), entryType: entryType.trim() || "misc", fields, tags }); await onSaved(); }
    catch (error) { window.alert(error instanceof Error ? error.message : t("ui.ReferenceLibraryPage.fields_must_be_valid_json")); }
    finally { setSaving(false); }
  };
  const saveSource = async () => {
    if (!api) return;
    const parsed = parseBibtex(sourceText).entries.find((item) => item.valid);
    if (!parsed) { window.alert(t("ui.ReferenceLibraryPage.the_bibtex_source_is_not_valid")); return; }
    setSaving(true);
    try { await api.references.saveEntry({ ...entry, citationKey: parsed.citationKey, entryType: parsed.entryType, fields: parsed.fields, rawBibtex: parsed.rawBibtex }); await onSaved(); }
    finally { setSaving(false); }
  };
  return <div className="library-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="library-detail" role="dialog" aria-modal="true">
      <header className="library-detail-header"><div><span className="reference-entry-type">{entry.entryType}</span><h2>{field(entry, "title") || t("ui.BibtexPreviewPane.untitled_entry")}</h2><p>{entry.citationKey}</p></div><button onClick={onClose}>×</button></header>
      <nav className="library-detail-tabs"><button className={mode === "details" ? "active" : ""} onClick={() => onMode("details")}>{t("ui.ReferenceLibraryPage.details")}</button><button className={mode === "source" ? "active" : ""} onClick={() => onMode("source")}>{t("ui.ReferenceLibraryPage.bibtex_source")}</button><button className={mode === "edit" ? "active" : ""} onClick={() => onMode("edit")}>{t("settings.aiSkillsEdit")}</button></nav>
      {mode === "details" && <div className="library-detail-content"><div className="library-detail-lead"><strong>{field(entry, "author") || t("ui.BibtexPreviewPane.unknown_author")}</strong><span>{field(entry, "year") || t("ui.ReferenceLibraryPage.year_not_specified")}</span></div><dl>{Object.entries(entry.fields).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><div className="library-detail-block"><span className="library-rail-label">{t("ui.ReferenceLibraryPage.tags")}</span><div className="library-row-tags">{entry.tags.length ? entry.tags.map((tag) => <em key={tag}>{tag}</em>) : <small>{t("ui.ReferenceLibraryPage.no_tags")}</small>}</div></div><div className="library-detail-block"><span className="library-rail-label">{t("ui.ReferenceLibraryPage.project_usage")}</span>{links.length ? <ul>{links.map((link) => <li key={link.projectId}><strong>{projectNames.get(link.projectId) ?? link.projectId}</strong><span>{link.mode} · {link.targetBibPath ?? "—"}</span></li>)}</ul> : <p>{t("ui.ReferenceLibraryPage.not_linked_to_any_project_yet")}</p>}</div>{entry.sourceFile && <p className="library-source-note">{t("ui.ReferenceLibraryPage.imported_from")}<code>{entry.sourceFile}</code></p>}</div>}
      {mode === "source" && <div className="library-detail-content"><textarea className="library-source-editor" value={sourceText} onChange={(event) => setSourceText(event.target.value)} spellCheck={false} /><button className="library-button primary library-save-button" onClick={() => void saveSource()} disabled={saving}>{t("ui.ReferenceLibraryPage.save_source")}</button></div>}
      {mode === "edit" && <div className="library-detail-content"><label className="library-edit-field">{t("ui.ReferenceLibraryPage.citation_key")}<input value={citationKey} onChange={(event) => setCitationKey(event.target.value)} /></label><label className="library-edit-field">{t("ui.ReferenceLibraryPage.entry_type_2")}<input value={entryType} onChange={(event) => setEntryType(event.target.value)} /></label><label className="library-edit-field">{t("ui.ReferenceLibraryPage.fields")}<small>{t("ui.ReferenceLibraryPage.json_object_existing_bibtex_fields_are_preserved")}</small><textarea className="library-fields-editor" value={fieldsText} onChange={(event) => setFieldsText(event.target.value)} spellCheck={false} /></label><div className="library-tag-field"><span className="library-tag-field-label">{t("ui.ReferenceLibraryPage.tags_2")}</span><ReferenceTagEditor value={tags} availableTags={availableTags} onChange={setTags}/></div><button className="library-button primary library-save-button" onClick={() => void saveFields()} disabled={saving}>{t("navigation.save")}</button></div>}
    </aside>
  </div>;
}

function ReferenceTagEditor({ value, availableTags, onChange }: { value: string[]; availableTags: ReferenceTag[]; onChange(next: string[]): void }) {
  const [query, setQuery] = useState("");
  const [showChoices, setShowChoices] = useState(false);
  const selected = new Set(value.map((name) => name.toLocaleLowerCase()));
  const matchingTag = availableTags.find((tag) => tag.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase());
  const choices = availableTags.filter((tag) => !selected.has(tag.name.toLocaleLowerCase()) && (!query.trim() || tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  const addTag = (name = query) => {
    const normalized = name.trim();
    if (!normalized) return;
    const canonical = availableTags.find((tag) => tag.name.toLocaleLowerCase() === normalized.toLocaleLowerCase())?.name ?? normalized;
    if (!value.some((tag) => tag.toLocaleLowerCase() === canonical.toLocaleLowerCase())) onChange([...value, canonical]);
    setQuery("");
    setShowChoices(false);
  };
  return <div className="reference-tag-editor">
    {value.length > 0 && <div className="reference-tag-chips">{value.map((tag) => <span className="reference-tag-chip" key={tag}>{tag}<button type="button" title={t("ui.ReferenceLibraryPage.remove", { value1: tag })} aria-label={t("ui.ReferenceLibraryPage.remove", { value1: tag })} onClick={() => onChange(value.filter((item) => item !== tag))}>×</button></span>)}</div>}
    <div className="reference-tag-input-row"><input value={query} onChange={(event) => { setQuery(event.target.value); setShowChoices(true); }} onKeyDown={(event) => { if (event.key === "Enter" && query.trim()) { event.preventDefault(); addTag(); } else if (event.key === "Escape") { setQuery(""); setShowChoices(false); } }} placeholder={t("ui.ReferenceLibraryPage.type_a_tag_or_choose_one")} aria-label={t("ui.ReferenceLibraryPage.add_a_tag")}/><button type="button" className="reference-tag-picker-button" title={t("ui.ReferenceLibraryPage.choose_from_the_tag_library")} aria-label={t("ui.ReferenceLibraryPage.choose_from_the_tag_library")} onClick={() => setShowChoices((open) => !open)}>＋</button>{query.trim() && <button type="button" className="reference-tag-add-button" onClick={() => addTag()} disabled={value.some((tag) => tag.toLocaleLowerCase() === query.trim().toLocaleLowerCase())}>{matchingTag ? t("ui.ReferenceLibraryPage.add") : t("ui.ImageInsertDialog.create")}</button>}</div>
    {(showChoices || query.trim()) && <div className="reference-tag-choices" role="listbox" aria-label={t("ui.ReferenceLibraryPage.available_tags")}>{choices.map((tag) => <button type="button" role="option" aria-selected="false" key={tag.id} onClick={() => addTag(tag.name)}>{tag.name}</button>)}{query.trim() && !matchingTag && <button type="button" role="option" aria-selected="false" className="create" onClick={() => addTag()}>{t("ui.ReferenceLibraryPage.create")}{query.trim()}”</button>}{showChoices && !choices.length && !query.trim() && <small>{t("ui.ReferenceLibraryPage.no_unused_tags_in_the_library")}</small>}</div>}
  </div>;
}

function TagLibraryManager({ tags, entries, onClose, onSaved }: { tags: ReferenceTag[]; entries: ReferenceLibraryEntry[]; onClose(): void; onSaved(): Promise<void> }) {
  const api = window.latexEditor;
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [editingName, setEditingName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    if (!api || !newName.trim()) return;
    setBusy(true); setError("");
    try { await api.references.createTag(newName); setNewName(""); await onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const rename = async () => {
    if (!api || !editingId || !editingName.trim()) return;
    setBusy(true); setError("");
    try { await api.references.renameTag(editingId, editingName); setEditingId(undefined); setEditingName(""); await onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const remove = async (tag: ReferenceTag) => {
    if (!api) return;
    const assigned = entries.filter((entry) => entry.tags.includes(tag.name)).length;
    if (!window.confirm(assigned ? t("ui.ReferenceLibraryPage.delete_it_is_assigned_to_reference_s", { value1: tag.name, value2: assigned }) : t("ui.ReferenceLibraryPage.delete_from_the_tag_library", { value1: tag.name }))) return;
    setBusy(true); setError("");
    try { await api.references.removeTag(tag.id); await onSaved(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <div className="library-tag-manager-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="library-tag-manager" role="dialog" aria-modal="true" aria-labelledby="library-tag-manager-title"><header><div><p className="library-eyebrow">{t("ui.ReferenceLibraryPage.reference_library_2")}</p><h2 id="library-tag-manager-title">{t("ui.ReferenceLibraryPage.manage_tags")}</h2><p>{t("ui.ReferenceLibraryPage.add_rename_or_remove_tags_shared_by")}</p></div><button type="button" onClick={onClose} aria-label={t("ui.ReferenceLibraryPage.close_tag_manager")}>×</button></header><div className="library-tag-create-row"><input value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} placeholder={t("ui.ReferenceLibraryPage.new_tag_name")} aria-label={t("ui.ReferenceLibraryPage.new_tag_name")}/><button className="library-button primary" type="button" disabled={busy || !newName.trim()} onClick={() => void create()}>{t("ui.ReferenceLibraryPage.add_tag")}</button></div>{error && <p className="library-tag-error" role="alert">{error}</p>}<div className="library-tag-manager-list">{tags.map((tag) => { const assigned = entries.filter((entry) => entry.tags.includes(tag.name)).length; const editing = editingId === tag.id; return <div className="library-tag-manager-row" key={tag.id}>{editing ? <input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void rename(); if (event.key === "Escape") setEditingId(undefined); }} aria-label={t("ui.ReferenceLibraryPage.rename", { value1: tag.name })}/> : <><strong>{tag.name}</strong><small>{t("reference.count", { count: assigned })}</small></>}<div>{editing ? <><button type="button" disabled={busy || !editingName.trim()} onClick={() => void rename()}>{t("menu.save")}</button><button type="button" onClick={() => setEditingId(undefined)}>{t("settings.aiSkillsCancel")}</button></> : <><button type="button" disabled={busy} onClick={() => { setEditingId(tag.id); setEditingName(tag.name); setError(""); }}>{t("resource.rename")}</button><button type="button" className="danger" disabled={busy} onClick={() => void remove(tag)}>{t("ai.history.delete")}</button></>}</div></div>; })}{!tags.length && <p className="library-tag-empty">{t("ui.ReferenceLibraryPage.no_tags_yet_add_one_above_or")}</p>}</div></section></div>;
}
