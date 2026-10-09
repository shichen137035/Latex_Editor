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
      <input value={query} onChange={event => { setQuery(event.target.value); reset(); }} placeholder="Search title, author, key…" aria-label="Search project references"/>
      <div className="reference-quick-filter-row">
        <select aria-label="Reference file" value={selectedFile} onChange={event => { setFile(event.target.value); reset(); }}><option value="">All .bib files</option>{index.files.map(item => <option key={item.path} value={item.path}>{item.path} ({item.entries.length})</option>)}</select>
        <select aria-label="Project reference type" value={type} onChange={event => { setType(event.target.value); reset(); }}><option value="">All types</option>{[...new Set(index.entries.map(entry => entry.entryType))].sort().map(value => <option key={value}>{value}</option>)}</select>
      </div>
    </div>
    <div className="reference-quick-summary">{entries.length} references · {index.files.length} .bib files</div>
    <div className="reference-quick-results">
      {!index.files.length && <div className="reference-quick-empty"><strong>No .bib files in this project</strong><p>Import a reference file or add entries from the library.</p></div>}
      {!!index.files.length && !entries.length && <div className="reference-quick-empty"><strong>No matching references</strong><p>Choose a file or adjust the search.</p></div>}
      {index.files.filter(item => !selectedFile || item.path === selectedFile).flatMap(item => item.invalid.map((error, position) => <div className="project-reference-warning" role="status" key={`${item.path}:${position}`}>{item.path}: {error.message}<button onClick={() => onOpen(item.path, error.start)}>Open</button></div>))}
      {entries.slice(0, limit).map(entry => <article className="reference-quick-entry" key={entry.id}>
        <div className="reference-quick-entry-meta"><span className="reference-quick-type">{entry.entryType}</span><code>{entry.citationKey || "Missing key"}</code></div>
        <strong className="reference-quick-entry-title">{field(entry, "title") || "Untitled reference"}</strong>
        <div className="reference-quick-entry-byline">{field(entry, "author") || "Unknown author"}{field(entry, "year") && ` · ${field(entry, "year")}`}</div>
        <button className="project-reference-source" title={`Open ${entry.filePath}`} onClick={() => onOpen(entry.filePath, entry.start)}>{entry.filePath} ↗</button>
        {entry.duplicate && <small className="project-reference-warning">Duplicate citation key in project</small>}
        <details className="project-reference-details"><summary>Details / BibTeX</summary><dl>{Object.entries(entry.fields).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><pre>{entry.rawBibtex}</pre></details>
        <footer><span className="reference-quick-linked">{entry.uses ? `${entry.uses} citations` : "Not cited"}</span><button className="reference-quick-cite" disabled={!canCite || !entry.valid || !isValidCitationKey(entry.citationKey)} title={canCite ? "Insert at the editor cursor" : "Open a writable .tex file to cite"} onClick={() => onCite(entry.citationKey)}>Cite</button></footer>
      </article>)}
      {entries.length > limit && <button className="reference-quick-more" onClick={() => setLimit(value => value + 30)}>Show more ({entries.length - limit})</button>}
    </div>
  </div>;
}
