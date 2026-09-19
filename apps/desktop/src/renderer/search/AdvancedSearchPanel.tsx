import type { FilterGroupId, FilterOptions, FilterQuery, ContentProperty } from "../filter/types.js";
import { t } from "../i18n/index.js";
import type { SearchQuery, SearchResponse, SearchResult } from "./types.js";
import { useState } from "react";
import "./advanced-search.css";

interface Props {
  query: SearchQuery;
  response: SearchResponse;
  activeResultId: string | undefined;
  replacement: string;
  replaceOpen: boolean;
  filter: FilterQuery;
  options: FilterOptions;
  visibleGroups: FilterGroupId[];
  setQuery(next: SearchQuery): void;
  setReplacement(value: string): void;
  setReplaceOpen(value: boolean): void;
  setFilter(next: FilterQuery): void;
  selectResult(result: SearchResult): void;
  replaceCurrent(): void;
  replaceAll(): void;
}

function toggle(values: string[], value: string): string[] { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

export function AdvancedSearchPanel(props: Props) {
  const [split, setSplit] = useState(64);
  const { query, response, activeResultId, filter, options } = props;
  const activeIndex = Math.max(0, response.results.findIndex((result) => result.id === activeResultId));
  const navigate = (direction: -1 | 1) => {
    if (!response.results.length) return;
    const current = response.results.findIndex((result) => result.id === activeResultId);
    const index = (Math.max(0, current) + direction + response.results.length) % response.results.length;
    const result = response.results[index];
    if (result) props.selectResult(result);
  };
  const propertyOptions: ContentProperty[] = ["hasMath", "hasCitation", "hasLabel", "hasFigure", "hasTable", "hasReference"];
  const setGroupMode = (id: FilterGroupId) => props.setFilter({ ...filter, groupModes: { ...filter.groupModes, [id]: filter.groupModes[id] === "include" ? "exclude" : "include" } });
  const setAllModes = () => {
    const mode = filter.masterMode === "include" ? "exclude" : "include";
    props.setFilter({ ...filter, masterMode: mode, groupModes: { blockType: mode, location: mode, file: mode, properties: mode } });
  };
  return <div className="advanced-search-panel" style={{ gridTemplateRows: `${split}% 5px calc(${100 - split}% - 5px)` }}>
    <section className="advanced-search-main">
      <div className="advanced-search-heading"><strong>{t("search.title")}</strong>{query.text && <button title={t("search.clear")} onClick={() => props.setQuery({ ...query, text: "" })}>×</button>}</div>
      <input className="advanced-search-input" autoFocus value={query.text} placeholder={t("search.placeholder")} onChange={(event) => props.setQuery({ ...query, text: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); } }}/>
      <div className="search-option-row"><button className={query.caseSensitive ? "active" : ""} title={t("search.caseSensitive")} onClick={() => props.setQuery({ ...query, caseSensitive: !query.caseSensitive })}>Aa</button><button className={query.wholeWord ? "active" : ""} disabled={query.useRegex} title={t("search.wholeWord")} onClick={() => props.setQuery({ ...query, wholeWord: !query.wholeWord })}>W</button><button className={query.useRegex ? "active" : ""} title={t("search.regex")} onClick={() => props.setQuery({ ...query, useRegex: !query.useRegex })}>.*</button><select aria-label={t("search.scope")} value={query.scope} onChange={(event) => props.setQuery({ ...query, scope: event.target.value as SearchQuery["scope"] })}><option value="current-file">{t("search.currentFile")}</option><option value="entire-project">{t("search.entireProject")}</option></select></div>
      {response.error && <p className="search-query-error" role="alert">{response.error}</p>}
      <button className="replace-disclosure" onClick={() => props.setReplaceOpen(!props.replaceOpen)}>{props.replaceOpen ? "▾" : "▸"} {t("search.replace")}</button>
      {props.replaceOpen && <div className="replace-panel"><input value={props.replacement} placeholder={t("search.replacePlaceholder")} onChange={(event) => props.setReplacement(event.target.value)}/><div><button disabled={!activeResultId} onClick={props.replaceCurrent}>{t("search.replaceCurrent")}</button><button disabled={!response.results.length} onClick={props.replaceAll}>{t("search.replaceAll", { count: response.results.length })}</button></div>{filter.enabled && <small>{t("search.filteredReplaceHint", { count: response.results.length })}</small>}</div>}
      <div className="search-result-heading"><span>{activeResultId && response.results.length ? `${activeIndex + 1} / ` : ""}{t("search.matches", { count: response.results.length })}</span><div><button onClick={() => navigate(-1)} title={t("search.previous")}>↑</button><button onClick={() => navigate(1)} title={t("search.next")}>↓</button></div></div>
      <div className="search-result-list">{response.results.map((result) => <button className={result.id === activeResultId ? "active" : ""} key={result.id} onClick={() => props.selectResult(result)}><span><strong>{result.fileId}</strong><small>{result.line}:{result.column}</small></span><p>{result.previewSnippet}</p></button>)}{query.text && !response.error && !response.results.length && <p className="search-empty">{t("search.noResults")}</p>}</div>
    </section>
    <div className="advanced-search-divider" onPointerDown={(event) => {
      event.preventDefault();
      const panel = event.currentTarget.parentElement;
      if (!panel) return;
      const bounds = panel.getBoundingClientRect();
      const move = (next: PointerEvent) => setSplit(Math.min(76, Math.max(48, (next.clientY - bounds.top) / bounds.height * 100)));
      const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop, { once: true });
    }}/>
    <section className="filter-panel">
      <header><strong>{t("filter.title")}</strong><button className="filter-master-mode" onClick={setAllModes} title={t("filter.applyAllModes")}>{t(filter.masterMode === "include" ? "filter.includeAll" : "filter.excludeAll")}</button><label className="filter-switch"><input type="checkbox" checked={filter.enabled} onChange={(event) => props.setFilter({ ...filter, enabled: event.target.checked })}/><span/></label><select value={filter.viewMode} onChange={(event) => props.setFilter({ ...filter, viewMode: event.target.value as FilterQuery["viewMode"] })}><option value="original">{t("filter.original")}</option><option value="dim">{t("filter.dim")}</option><option value="collapse">{t("filter.collapse")}</option><option value="remove">{t("filter.remove")}</option></select></header>
      <div className="filter-groups">
        {props.visibleGroups.includes("blockType") && <FilterGroup title={t("filter.blockType")} mode={filter.groupModes.blockType} onModeToggle={() => setGroupMode("blockType")} summary={filter.blockTypes.map((value) => t(`environment.${value}`))}>{options.blockTypes.map((value) => <FilterChoice key={value} checked={filter.blockTypes.includes(value)} label={t(`environment.${value}`)} onChange={() => props.setFilter({ ...filter, blockTypes: toggle(filter.blockTypes, value) })}/>)}</FilterGroup>}
        {props.visibleGroups.includes("location") && <FilterGroup title={t("filter.location")} mode={filter.groupModes.location} onModeToggle={() => setGroupMode("location")} summary={options.locations.filter((item) => filter.locations.includes(item.id)).map((item) => item.title)}>{options.locations.map((item) => <FilterChoice key={item.id} checked={filter.locations.includes(item.id)} label={item.title} depth={item.depth} onChange={() => props.setFilter({ ...filter, locations: toggle(filter.locations, item.id) })}/>)}</FilterGroup>}
        {props.visibleGroups.includes("file") && <FilterGroup title={t("filter.file")} mode={filter.groupModes.file} onModeToggle={() => setGroupMode("file")} summary={filter.files}>{options.files.map((value) => <FilterChoice key={value} checked={filter.files.includes(value)} label={value} onChange={() => props.setFilter({ ...filter, files: toggle(filter.files, value) })}/>)}</FilterGroup>}
        {props.visibleGroups.includes("properties") && <FilterGroup title={t("filter.properties")} mode={filter.groupModes.properties} onModeToggle={() => setGroupMode("properties")} summary={filter.properties.map((value) => t(`filter.${value}`))}>{propertyOptions.map((value) => <FilterChoice key={value} checked={filter.properties.includes(value)} label={t(`filter.${value}`)} onChange={() => props.setFilter({ ...filter, properties: toggle(filter.properties, value) as ContentProperty[] })}/>)}</FilterGroup>}
      </div>
    </section>
  </div>;
}

function FilterGroup({ title, summary, mode, onModeToggle, children }: { title: string; summary: string[]; mode: "include" | "exclude"; onModeToggle(): void; children: React.ReactNode }) {
  return <details className="filter-group"><summary><span><strong>{title}</strong><small>{summary.length ? summary.join(" · ") : t("filter.any")}</small></span><button className={`filter-group-mode ${mode}`} title={t(mode === "include" ? "filter.includeHint" : "filter.excludeHint")} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onModeToggle(); }}>{t(mode === "include" ? "filter.include" : "filter.exclude")}</button><b>＋</b></summary><div>{children}</div></details>;
}

function FilterChoice({ checked, label, depth = 0, onChange }: { checked: boolean; label: string; depth?: number; onChange(): void }) {
  return <label className="filter-choice" style={{ paddingLeft: 10 + depth * 14 }}><input type="checkbox" checked={checked} onChange={onChange}/><span>{label}</span></label>;
}
