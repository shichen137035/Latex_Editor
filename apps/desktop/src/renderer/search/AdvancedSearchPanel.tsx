import type { FilterGroupId, FilterOptions, FilterQuery, ContentProperty } from "../filter/types.js";
import { catalogs, t } from "../i18n/index.js";
import type { SearchQuery, SearchResponse, SearchResult } from "./types.js";
import { nextSearchResult } from "./SearchEngine.js";
import { defaultFilterQuery } from "../filter/types.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./advanced-search.css";

interface Props {
  toolbarTarget?: HTMLElement | null;
  focusRequest?: number;
  searching?: boolean;
  busy?: boolean;
  ready?: boolean;
  canReplace?: boolean;
  notice?: string;
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

function blockTypeLabel(value: string): string {
  const key = value.startsWith("content:") ? `filter.contentType.${value.slice("content:".length)}` : `environment.${value}`;
  return Object.hasOwn(catalogs.en, key) ? t(key) : value;
}

function toggle(values: string[], value: string): string[] { return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]; }

export function AdvancedSearchPanel(props: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchCollapsed, setSearchCollapsed] = useState(false);
  const [filterCollapsed, setFilterCollapsed] = useState(false);
  useEffect(() => { setSearchCollapsed(false); }, [props.focusRequest]);
  useLayoutEffect(() => {
    if (searchCollapsed) return;
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, [props.focusRequest, searchCollapsed]);
  const [split, setSplit] = useState(64);
  const [visibleCount, setVisibleCount] = useState(100);
  const dragCleanup = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => dragCleanup.current?.(), []);
  useEffect(() => setVisibleCount(100), [props.response]);
  const { query, response, activeResultId, filter, options } = props;
  const activeIndex = response.results.findIndex((result) => result.id === activeResultId);
  const ready = props.ready !== false && !props.busy;
  const canReplace = ready && props.canReplace !== false;
  const navigate = (direction: -1 | 1) => {
    if (!ready) return;
    const result = nextSearchResult(response.results, activeResultId, direction);
    if (result) props.selectResult(result);
  };
  const propertyOptions: ContentProperty[] = ["hasMath", "hasCitation", "hasLabel", "hasFigure", "hasTable", "hasReference"];
  const setGroupMode = (id: FilterGroupId) => props.setFilter({ ...filter, groupModes: { ...filter.groupModes, [id]: filter.groupModes[id] === "include" ? "exclude" : "include" } });
  const setAllModes = () => {
    const mode = filter.masterMode === "include" ? "exclude" : "include";
    props.setFilter({ ...filter, masterMode: mode, groupModes: { blockType: mode, location: mode, file: mode, properties: mode } });
  };
  const searchControls = <>{query.text && <button title={t("search.clear")} aria-label={t("search.clear")} onClick={() => props.setQuery({ ...query, text: "" })}>×</button>}<SectionCollapse title={t("sidebar.search")} collapsed={searchCollapsed} onClick={() => setSearchCollapsed(!searchCollapsed)}/></>;
  const sharedHeading = props.toolbarTarget !== undefined;
  const rows = filterCollapsed ? "minmax(0, 1fr) 0px 39px" : searchCollapsed ? `${sharedHeading ? 0 : 42}px 0px minmax(0, 1fr)` : `${split}% 1px calc(${100 - split}% - 1px)`;
  return <div className="advanced-search-panel" style={{ gridTemplateRows: rows }}>
    <section className={`advanced-search-main${sharedHeading ? " has-heading-toolbar" : ""}`} data-section-collapsed={searchCollapsed}>
      {sharedHeading ? props.toolbarTarget && createPortal(searchControls, props.toolbarTarget) : <header className="advanced-search-heading"><strong>{t("sidebar.search")}</strong>{searchControls}</header>}
      <div className="advanced-search-field"><SearchIcon/><input ref={inputRef} className="advanced-search-input" aria-label={t("search.placeholder")} value={query.text} placeholder={t("search.placeholder")} onChange={(event) => props.setQuery({ ...query, text: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); navigate(event.shiftKey ? -1 : 1); } }}/></div>
      <div className="search-option-row"><button className={query.caseSensitive ? "active" : ""} title={t("search.caseSensitive")} onClick={() => props.setQuery({ ...query, caseSensitive: !query.caseSensitive })}>Aa</button><button className={query.wholeWord ? "active" : ""} disabled={query.useRegex} title={t("search.wholeWord")} onClick={() => props.setQuery({ ...query, wholeWord: !query.wholeWord })}>W</button><button className={query.useRegex ? "active" : ""} title={t("search.regex")} onClick={() => props.setQuery({ ...query, useRegex: !query.useRegex })}>.*</button><select aria-label={t("search.scope")} value={query.scope} onChange={(event) => props.setQuery({ ...query, scope: event.target.value as SearchQuery["scope"] })}><option value="current-file">{t("search.currentFile")}</option><option value="entire-project">{t("search.entireProject")}</option></select></div>
      {response.error && <p className="search-query-error" role="alert">{response.error}</p>}
      {props.notice && <p className="search-query-error" role="alert">{props.notice}</p>}
      {props.searching && <small role="status">{t("search.searching")}</small>}
      {response.truncated && <small role="status">{t("search.resultLimit", { count: response.results.length })}</small>}
      <button className="replace-disclosure" onClick={() => props.setReplaceOpen(!props.replaceOpen)}>{props.replaceOpen ? "▾" : "▸"} {t("search.replace")}</button>
      {props.replaceOpen && <div className="replace-panel"><input value={props.replacement} placeholder={t("search.replacePlaceholder")} onChange={(event) => props.setReplacement(event.target.value)}/><div><button disabled={!canReplace || activeIndex < 0} onClick={props.replaceCurrent}>{t("search.replaceCurrent")}</button><button disabled={!canReplace || !response.results.length || response.truncated || response.incomplete} onClick={props.replaceAll}>{t("search.replaceAll", { count: response.results.length })}</button></div>{filter.enabled && <small>{t("search.filteredReplaceHint", { count: response.results.length })}</small>}</div>}
      <div className="search-result-heading"><span>{activeIndex >= 0 ? `${activeIndex + 1} / ` : ""}{t("search.matches", { count: response.results.length })}</span><div><button disabled={!ready || !response.results.length} onClick={() => navigate(-1)} title={t("search.previous")}>↑</button><button disabled={!ready || !response.results.length} onClick={() => navigate(1)} title={t("search.next")}>↓</button></div></div>
      <div className="search-result-list">{response.results.slice(0, visibleCount).map((result) => <button disabled={!ready} className={result.id === activeResultId ? "active" : ""} key={result.id} onClick={() => props.selectResult(result)}><span><strong>{result.fileId}</strong><small>{result.line}:{result.column}</small></span><p>{result.previewSnippet}</p></button>)}{response.results.length > visibleCount && <button onClick={() => setVisibleCount(count => count + 100)}>{t("search.showMore")}</button>}{query.text && !props.searching && !response.error && !response.results.length && <p className="search-empty">{t("search.noResults")}</p>}</div>
    </section>
    <div className="advanced-search-divider" hidden={searchCollapsed || filterCollapsed} onPointerDown={(event) => {
      event.preventDefault();
      const panel = event.currentTarget.parentElement;
      if (!panel) return;
      const bounds = panel.getBoundingClientRect();
      dragCleanup.current?.();
      const move = (next: PointerEvent) => setSplit(Math.min(76, Math.max(48, (next.clientY - bounds.top) / bounds.height * 100)));
      const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); window.removeEventListener("pointercancel", stop); window.removeEventListener("blur", stop); dragCleanup.current = undefined; };
      dragCleanup.current = stop;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop, { once: true });
      window.addEventListener("pointercancel", stop, { once: true });
      window.addEventListener("blur", stop, { once: true });
    }}/>
    <section className="filter-panel" data-section-collapsed={filterCollapsed}>
      <header className="sidebar-heading"><strong title={t("filter.title")}>{t("filter.title")}</strong><div className="sidebar-heading-actions">{filter.blockTypes.length + filter.files.length + filter.locations.length + filter.properties.length > 0 && <button aria-label={t("filter.clear")} title={t("filter.clear")} onClick={() => props.setFilter({ ...defaultFilterQuery, enabled: filter.enabled, viewMode: filter.viewMode })}>×</button>}<button type="button" className={`filter-master-mode ${filter.masterMode}`} onClick={setAllModes} aria-label={t(filter.masterMode === "include" ? "filter.includeAll" : "filter.excludeAll")} title={`${t(filter.masterMode === "include" ? "filter.includeAll" : "filter.excludeAll")} · ${t("filter.applyAllModes")}`}><FilterModeIcon mode={filter.masterMode}/></button><label className="filter-switch"><input aria-label={t("filter.title")} type="checkbox" checked={filter.enabled} onChange={(event) => props.setFilter({ ...filter, enabled: event.target.checked })}/><span/></label><SectionCollapse title={t("filter.title")} collapsed={filterCollapsed} onClick={() => setFilterCollapsed(!filterCollapsed)}/></div></header>
      <div className="filter-groups">
        {props.visibleGroups.includes("blockType") && <FilterGroup title={t("filter.blockType")} mode={filter.groupModes.blockType} onModeToggle={() => setGroupMode("blockType")} selected={filter.blockTypes} options={options.blockTypes.map(value => ({ value, label: blockTypeLabel(value) }))} onChange={value => props.setFilter({ ...filter, blockTypes: toggle(filter.blockTypes, value) })}/>}
        {props.visibleGroups.includes("location") && <FilterGroup title={t("filter.location")} mode={filter.groupModes.location} onModeToggle={() => setGroupMode("location")} selected={filter.locations} options={options.locations.map(item => ({ value: item.id, label: options.files.length > 1 && item.fileId ? `${item.title} · ${item.fileId}` : item.title, depth: item.depth }))} onChange={value => props.setFilter({ ...filter, locations: toggle(filter.locations, value) })}/>}
        {props.visibleGroups.includes("file") && <FilterGroup title={t("filter.file")} mode={filter.groupModes.file} onModeToggle={() => setGroupMode("file")} selected={filter.files} options={options.files.map(value => ({ value, label: value }))} onChange={value => props.setFilter({ ...filter, files: toggle(filter.files, value) })}/>}
        {props.visibleGroups.includes("properties") && <FilterGroup title={t("filter.properties")} mode={filter.groupModes.properties} onModeToggle={() => setGroupMode("properties")} selected={filter.properties} options={propertyOptions.map(value => ({ value, label: t(`filter.${value}`) }))} onChange={value => props.setFilter({ ...filter, properties: toggle(filter.properties, value) as ContentProperty[] })}/>}
      </div>
    </section>
  </div>;
}

function SectionCollapse({ title, collapsed, onClick }: { title: string; collapsed: boolean; onClick(): void }) {
  const action = t(collapsed ? "blockOperation.expand" : "blockOperation.collapse");
  return <button type="button" className={`search-section-collapse${collapsed ? " collapsed" : ""}`} aria-expanded={!collapsed} aria-label={`${action}: ${title}`} title={action} onClick={onClick}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg></button>;
}

interface FilterOption { value: string; label: string; depth?: number }

function FilterGroup({ title, selected, options, mode, onModeToggle, onChange }: { title: string; selected: string[]; options: FilterOption[]; mode: "include" | "exclude"; onModeToggle(): void; onChange(value: string): void }) {
  const details = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState("");
  const term = query.trim().normalize("NFKC").toLocaleLowerCase();
  const choices = term ? options.filter(option => `${option.label} ${option.value}`.normalize("NFKC").toLocaleLowerCase().includes(term)) : options;
  const summary = selected.map(value => options.find(option => option.value === value)?.label ?? value);
  return <details ref={details} className="filter-group"><summary onClick={event => {
    if ((event.target as Element).closest("button, input, label")) return;
    if (term) { event.preventDefault(); setQuery(""); if (details.current) details.current.open = true; }
  }}>
    <div className="filter-group-heading"><svg className="filter-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg><span className="filter-group-name"><strong title={title}>{title}</strong>{summary.length > 0 && <small title={summary.join(" · ")}>{summary.join(" · ")}</small>}</span>
      <label className="filter-group-search" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><SearchIcon/><input aria-label={t("filter.searchOptions", { group: title })} value={query} onChange={event => { setQuery(event.target.value); if (details.current) details.current.open = true; }}/>{query && <button type="button" aria-label={t("search.clear")} title={t("search.clear")} onClick={event => { event.preventDefault(); setQuery(""); }}>×</button>}</label>
      <button type="button" className={`filter-group-mode ${mode}`} aria-label={t(mode === "include" ? "filter.includeHint" : "filter.excludeHint")} title={t(mode === "include" ? "filter.includeHint" : "filter.excludeHint")} onClick={event => { event.preventDefault(); event.stopPropagation(); onModeToggle(); }}><FilterModeIcon mode={mode}/></button>
    </div>
  </summary><div>{choices.map(option => <FilterChoice key={option.value} checked={selected.includes(option.value)} label={option.label} depth={option.depth ?? 0} onChange={() => onChange(option.value)}/>)}{choices.length === 0 && <p className="filter-options-empty">{t("filter.noOptions")}</p>}</div></details>;

}

function FilterModeIcon({ mode }: { mode: "include" | "exclude" }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="8"/>{mode === "include" ? <path d="m8 12 3 3 5-6"/> : <path d="m9 9 6 6m0-6-6 6"/>}</svg>;
}

function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>; }

function FilterChoice({ checked, label, depth = 0, onChange }: { checked: boolean; label: string; depth?: number; onChange(): void }) {
  return <label className="filter-choice" style={{ paddingLeft: 10 + depth * 14 }}><input type="checkbox" checked={checked} onChange={onChange}/><span>{label}</span></label>;
}
