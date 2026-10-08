import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { isRelationCapableBlock, type BlockGraphSnapshot, type BlockId, type RelationDirection, type RelationScope } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { blockName, blockRole, blockSection, candidateRelationState, projectRelationCandidates, type HierarchyScope, type RelationFilters, type RelationTreeNode } from "./model.js";
import { filterDisposition, type FilterViewMode } from "../filter/types.js";
import { blockColorStyle, EnvironmentBadge, EnvironmentDot, RelationGraphIcon, RelationScopeControls } from "./presentation.js";

export interface RelationBrowserProps {
  snapshot: BlockGraphSnapshot; definitions: EnvironmentDefinition[];
  focusId: BlockId | null; selectedId: BlockId | null; scope: RelationScope;
  direction: RelationDirection; depth: number | "all"; documentFiltered: boolean;
  filters: RelationFilters; viewMode: FilterViewMode;
  onSelect(id: BlockId): void; onFocus(id: BlockId): void; onLocate(id: BlockId): void;
  onDirection(direction: RelationDirection): void; onDepth(depth: number | "all"): void; onDocumentFiltered(enabled: boolean): void;
  onFilters(filters: RelationFilters): void;
  onToggleRelation(id: BlockId, event: MouseEvent<HTMLButtonElement>): void;
}

export function RelationBrowser(props: RelationBrowserProps) {
  const [showAll, setShowAll] = useState(false);
  const scopeIds = useMemo(() => new Set(props.scope.blockIds), [props.scope]);
  const scoped = !!props.scope.focusIds.length && !showAll;
  const projection = useMemo(() => projectRelationCandidates(props.snapshot, props.focusId, props.filters, scoped ? scopeIds : undefined), [props.snapshot, props.focusId, props.filters, scoped, scopeIds]);
  const entries = useMemo(() => new Map(props.scope.entries.map(entry => [entry.blockId, entry])), [props.scope]);
  const [manualExpanded, setManualExpanded] = useState<Set<BlockId>>(new Set());
  const expansionInitialized = useRef(false);
  useEffect(() => {
    if (expansionInitialized.current || props.snapshot.blocks.length === 0) return;
    expansionInitialized.current = true;
    setManualExpanded(new Set(projection.roots.map(node => node.block.id)));
  }, [props.snapshot.blocks.length, projection.roots]);
  const effectiveExpanded = useMemo(() => new Set([...manualExpanded, ...projection.autoExpandedIds]), [manualExpanded, projection.autoExpandedIds]);
  const roles = useMemo(() => [...new Set(props.snapshot.blocks.map(blockRole).filter(role => role.toLowerCase() !== "paragraph"))].sort(), [props.snapshot.blocks]);
  const labels = useMemo(() => [...new Set(props.snapshot.blocks.map(block => block.label).filter((label): label is string => !!label))].sort(), [props.snapshot.blocks]);
  const focus = props.snapshot.blocks.find(block => block.id === props.focusId);
  const selected = props.snapshot.blocks.find(block => block.id === props.selectedId) ?? focus;
  const section = selected ? blockSection(props.snapshot, selected.id) : undefined;
  const selectedEntry = selected ? entries.get(selected.id) : undefined;
  const selectedRelations = selected ? props.snapshot.dependencies.filter(edge => edge.from === selected.id || edge.to === selected.id).length : 0;
  const matchingCount = props.snapshot.blocks.filter(block => blockRole(block).toLowerCase() !== "paragraph" && projection.matchIds.has(block.id)).length;
  const totalCount = props.snapshot.blocks.filter(block => blockRole(block).toLowerCase() !== "paragraph").length;
  const hasDisplayFilter = matchingCount < totalCount;
  const visibleCount = props.viewMode === "original" || props.viewMode === "dim" ? totalCount : matchingCount;
  const counts = useMemo(() => {
    const result = new Map<BlockId, number>();
    const visit = (node: RelationTreeNode): number => {
      const total = Number(projection.matchIds.has(node.block.id) && blockRole(node.block).toLowerCase() !== "paragraph") + node.children.reduce((count, child) => count + visit(child), 0);
      result.set(node.block.id, total);
      return total;
    };
    projection.roots.forEach(visit);
    return result;
  }, [projection]);
  const setFilter = <K extends keyof RelationFilters>(key: K, value: RelationFilters[K]) => props.onFilters({ ...props.filters, [key]: value });
  const refineCount = [props.filters.hierarchyScope !== "all", props.filters.role !== "all", props.filters.origin !== "all", props.filters.label !== "all", !!props.filters.textQuery.trim()].filter(Boolean).length;

  const renderNode = (node: RelationTreeNode, depth: number) => {
    if (blockRole(node.block).toLowerCase() === "paragraph") return <Fragment key={node.block.id}>{node.children.map(child => renderNode(child, depth))}</Fragment>;
    const matches = projection.matchIds.has(node.block.id), context = projection.contextIds.has(node.block.id);
    const disposition = filterDisposition(matches ? "match" : context ? "context" : "unmatched", props.viewMode);
    if (disposition === "remove") return null;
    if (disposition === "collapse") {
      const countBlocks = (item: RelationTreeNode): number => Number(blockRole(item.block).toLocaleLowerCase() !== "paragraph") + item.children.reduce((count, child) => count + countBlocks(child), 0);
      return <div key={node.block.id} className="relation-filter-collapsed" style={{ marginLeft: 6 + depth * 13 }} role="note">⋯ {countBlocks(node)} {t(countBlocks(node) === 1 ? "filter.blockCollapsed" : "filter.blocksCollapsed")}</div>;
    }
    const expanded = effectiveExpanded.has(node.block.id), entry = entries.get(node.block.id);
    const relation = candidateRelationState(props.snapshot, props.focusId, node.block.id, props.direction);
    const isFocus = node.block.id === props.focusId, isSelected = node.block.id === selected?.id;
    return <div className="relation-tree-node" key={node.block.id} role="treeitem" aria-level={depth + 1} aria-selected={isSelected} {...(node.children.length ? { "aria-expanded": expanded } : {})}>
      <div data-block-id={node.block.id} className={`relation-row ${matches ? "match" : "unmatched"} ${context && !matches ? "context" : ""} ${isFocus ? "focus" : ""} ${isSelected ? "selected" : ""}`} style={{ ...blockColorStyle(node.block, props.definitions), paddingLeft: 6 + depth * 13 }}>
        <button className="relation-expand" disabled={!node.children.length} aria-label={expanded ? t("relation.collapse") : t("relation.expand")} onClick={() => setManualExpanded(current => { const next = new Set(current); if (next.has(node.block.id)) next.delete(node.block.id); else next.add(node.block.id); return next; })}>{node.children.length ? expanded ? "⌄" : "›" : ""}</button>
        <EnvironmentDot block={node.block} definitions={props.definitions}/>
        <button className="relation-focus-name" title={blockName(node.block)} onClick={() => props.onSelect(node.block.id)} onDoubleClick={event => { event.preventDefault(); props.onLocate(node.block.id); }}><span>{blockName(node.block)}</span>{node.block.state && node.block.state !== "active" && <i title={node.block.state}>!</i>}</button>
        <span className="relation-row-count" title={entry ? t("relation.distance") : t("relation.relatedContent")}>{entry ? `d${entry.distance}` : counts.get(node.block.id) || ""}</span>
        <div className="relation-row-actions"><button className="relation-locate" title={t("relation.locate")} onClick={() => props.onLocate(node.block.id)}>↗</button><button className={`relation-mutate ${relation.existing ? "remove" : "add"}`} disabled={!!relation.disabledReason} title={relation.disabledReason ? t(`relation.invalid.${relation.disabledReason}`) : relation.existing ? t("relation.remove") : t("relation.add")} onClick={event => props.onToggleRelation(node.block.id, event)}>{relation.existing ? "−" : "+"}</button></div>
      </div>
      {expanded && <div role="group">{node.children.map(child => renderNode(child, depth + 1))}</div>}
    </div>;
  };

  return <div className={`relation-browser view-${props.viewMode} ${hasDisplayFilter ? "has-display-filter" : ""}`}>
    <div className="relation-browser-head">
      <h3>{t("relation.scopeTitle")}</h3>
      <div className="relation-focus-summary"><span>{t("relation.focus")}</span><strong title={focus ? blockName(focus) : undefined}>{focus ? <><EnvironmentDot block={focus} definitions={props.definitions}/><span className="relation-focus-title">{blockName(focus)}</span></> : t("relation.chooseFocus")}</strong></div>
      <RelationScopeControls segmented direction={props.direction} depth={props.depth} documentFiltered={props.documentFiltered} onDirection={props.onDirection} onDepth={props.onDepth} onDocumentFiltered={props.onDocumentFiltered}/>
      <details className="relation-refine"><summary>{t("relation.refine")}{refineCount > 0 && <span>{refineCount}</span>}</summary><div className="relation-controls-grid">
        <label><span>{t("relation.hierarchy")}</span><select value={props.filters.hierarchyScope} onChange={event => setFilter("hierarchyScope", event.target.value as HierarchyScope)}>{(["all", "same-parent", "ancestors", "descendants", "same-section"] as const).map((value, index) => <option key={value} value={value}>{t(`relation.${["all", "sameParent", "ancestors", "descendants", "sameSection"][index]}`)}</option>)}</select></label>
        <label><span>{t("relation.type")}</span><select value={props.filters.role} onChange={event => setFilter("role", event.target.value)}><option value="all">{t("relation.all")}</option>{roles.map(role => <option value={role} key={role}>{t(`environment.${role}`) === `environment.${role}` ? role : t(`environment.${role}`)}</option>)}</select></label>
        <label><span>{t("relation.origin")}</span><select value={props.filters.origin} onChange={event => setFilter("origin", event.target.value as RelationFilters["origin"])}>{["all", "environment", "user", "virtual"].map(value => <option key={value} value={value}>{t(`relation.origin.${value}`)}</option>)}</select></label>
        <label><span>{t("relation.label")}</span><select value={props.filters.label} onChange={event => setFilter("label", event.target.value)}><option value="all">{t("relation.all")}</option>{labels.map(label => <option value={label} key={label}>{label}</option>)}</select></label>
        <input aria-label={t("relation.search")} value={props.filters.textQuery} onChange={event => setFilter("textQuery", event.target.value)} placeholder={t("relation.search")}/>
      </div></details>
      <button className="relation-open-graph" onClick={() => window.dispatchEvent(new CustomEvent("texweave:relation-graph-open", { detail: { full: true } }))}><RelationGraphIcon/><span><strong>{t("relation.openGraph")}</strong><small>{t("relation.openGraphHint")}</small></span><b>↗</b></button>
    </div>
    <div className="relation-content-heading"><strong>{scoped && props.viewMode !== "original" && props.viewMode !== "dim" ? t("relation.relatedContent") : t("relation.allBlocks")}</strong><span>{visibleCount}</span></div>
    {!!props.scope.focusIds.length && <div className="relation-list-tabs"><button className={!showAll ? "active" : ""} onClick={() => setShowAll(false)}>{t("relation.relatedContent")}</button><button className={showAll ? "active" : ""} onClick={() => setShowAll(true)}>{t("relation.allBlocks")}</button></div>}
    <div className="relation-tree" role="tree" aria-label={t("relation.relatedContent")}>{projection.roots.map(node => renderNode(node, 0))}{(!totalCount || props.viewMode === "remove" && !visibleCount) && <p className="relation-empty">{t("relation.noMatches")}</p>}</div>
    {selected && <section className="relation-selection-card" style={blockColorStyle(selected, props.definitions)}><header><strong>{t("relation.selectedItem")}</strong><EnvironmentBadge block={selected} definitions={props.definitions}/></header><h4>{blockName(selected)}</h4>{section && <p title={blockName(section)}>{t("relation.section")}: {blockName(section)}</p>}<p>{t("relation.distance")}: {selectedEntry ? `d${selectedEntry.distance}` : "—"} · {t("relation.relations")}: {selectedRelations}</p><div><button className="primary" disabled={!isRelationCapableBlock(selected)} onClick={() => props.onFocus(selected.id)}>{t("relation.setFocusShort")}</button><button onClick={() => props.onLocate(selected.id)}>{t("relation.locateDocument")}</button></div></section>}
  </div>;
}
