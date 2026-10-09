import { t } from "../i18n/index.js";
import { useMemo, useState } from "react";
import { field, isValidCitationKey } from "./bibtex.js";
import { filterProjectReferences, type indexProjectReferences } from "./projectReferences.js";

export function ProjectReferencesPanel({ index, canCite, onCite, onOpen }: {
  index: ReturnType<typeof indexProjectReferences>;
  canCite: boolean;
  onCite(key: string): void;
  onOpen(path: string, offset: number): void;
}) {
  const [query, setQuery] = useState("");
  const [file, setFile] = useState("");
  const [type, setType] = useState("");
  const [limit, setLimit] = useState(30);
  const selectedFile = index.files.some(item => item.path === file) ? file : "";
  const entries = useMemo(() => filterProjectReferences(index.entries, query, selectedFile, type), [index, query, selectedFile, type]);
  const reset = () => setLimit(30);
  return <div className="project-reference-browser">
    <div className="reference-quick-filters">
      <input value={query} onChange={event => { setQuery(event.target.value); reset(); }} placeholder={t("ui.ProjectReferencesPanel.search_title_author_key")} aria-label={t("ui.ProjectReferencesPanel.search_project_references")}/>
      <div className="reference-quick-filter-row">
        <select aria-label={t("ui.ProjectReferencesPanel.reference_file")} value={selectedFile} onChange={event => { setFile(event.target.value); reset(); }}><option value="">{t("ui.ProjectReferencesPanel.all_bib_files")}</option>{index.files.map(item => <option key={item.path} value={item.path}>{item.path} ({item.entries.length})</option>)}</select>
        <select aria-label={t("ui.ProjectReferencesPanel.project_reference_type")} value={type} onChange={event => { setType(event.target.value); reset(); }}><option value="">{t("ui.ProjectReferencesPanel.all_types")}</option>{[...new Set(index.entries.map(entry => entry.entryType))].sort().map(value => <option key={value}>{value}</option>)}</select>
      </div>
    </div>
    <div className="reference-quick-summary">{entries.length} {t("ui.ProjectReferencesPanel.references")}{index.files.length} {t("ui.ProjectReferencesPanel.bib_files")}</div>
    <div className="reference-quick-results">
      {!index.files.length && <div className="reference-quick-empty"><strong>{t("ui.ProjectReferencesPanel.no_bib_files_in_this_project")}</strong><p>{t("ui.ProjectReferencesPanel.import_a_reference_file_or_add_entries")}</p></div>}
      {!!index.files.length && !entries.length && <div className="reference-quick-empty"><strong>{t("ui.ProjectReferencesPanel.no_matching_references")}</strong><p>{t("ui.ProjectReferencesPanel.choose_a_file_or_adjust_the_search")}</p></div>}
      {index.files.filter(item => !selectedFile || item.path === selectedFile).flatMap(item => item.invalid.map((error, position) => <div className="project-reference-warning" role="status" key={`${item.path}:${position}`}>{item.path}: {error.message}<button onClick={() => onOpen(item.path, error.start)}>{t("ui.ProjectReferencesPanel.open")}</button></div>))}
      {entries.slice(0, limit).map(entry => <article className="reference-quick-entry" key={entry.id}>
        <div className="reference-quick-entry-meta"><span className="reference-quick-type">{entry.entryType}</span><code>{entry.citationKey || t("ui.ProjectReferencesPanel.missing_key")}</code></div>
        <strong className="reference-quick-entry-title">{field(entry, "title") || t("ui.BibtexPreviewPane.untitled_reference")}</strong>
        <div className="reference-quick-entry-byline">{field(entry, "author") || t("ui.BibtexPreviewPane.unknown_author")}{field(entry, "year") && ` · ${field(entry, "year")}`}</div>
        <button className="project-reference-source" title={t("ui.ProjectReferencesPanel.open_2", { value1: entry.filePath })} onClick={() => onOpen(entry.filePath, entry.start)}>{entry.filePath} ↗</button>
        {entry.duplicate && <small className="project-reference-warning">{t("ui.ProjectReferencesPanel.duplicate_citation_key_in_project")}</small>}
        <details className="project-reference-details"><summary>{t("ui.ProjectReferencesPanel.details_bibtex")}</summary><dl>{Object.entries(entry.fields).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><pre>{entry.rawBibtex}</pre></details>
        <footer><span className="reference-quick-linked">{entry.uses ? t("ui.ProjectReferencesPanel.citations", { value1: entry.uses }) : t("ui.ProjectReferencesPanel.not_cited")}</span><button className="reference-quick-cite" disabled={!canCite || !entry.valid || !isValidCitationKey(entry.citationKey)} title={canCite ? t("ui.ProjectReferencesPanel.insert_at_the_editor_cursor") : t("ui.ProjectReferencesPanel.open_a_writable_tex_file_to_cite")} onClick={() => onCite(entry.citationKey)}>{t("editor.quick.citationShort")}</button></footer>
      </article>)}
      {entries.length > limit && <button className="reference-quick-more" onClick={() => setLimit(value => value + 30)}>{t("ui.ProjectReferencesPanel.show_more")}{entries.length - limit})</button>}
    </div>
  </div>;
}
