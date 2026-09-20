import { Fragment, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { BlockGraphSnapshot, BlockId, RelationDirection } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import {
  blockName,
  blockRole,
  candidateRelationState,
  projectRelationCandidates,
  type HierarchyScope,
  type RelationFilters,
  type RelationTreeNode,
  type UnmatchedBehavior
} from "./model.js";

export interface RelationBrowserProps {
  snapshot: BlockGraphSnapshot;
  focusId: BlockId | null;
  direction: RelationDirection;
  depth: number | "all";
  filters: RelationFilters;
  unmatchedBehavior: UnmatchedBehavior;
  canGoBack: boolean;
  onBack(): void;
  onFocus(id: BlockId): void;
  onLocate(id: BlockId): void;
  onDirection(direction: RelationDirection): void;
  onDepth(depth: number | "all"): void;
  onFilters(filters: RelationFilters): void;
  onUnmatchedBehavior(value: UnmatchedBehavior): void;
  onToggleRelation(id: BlockId, event: MouseEvent<HTMLButtonElement>): void;
}

function relationActionText(state: ReturnType<typeof candidateRelationState>): string {
  if (!state.existing) return "+";
  if (state.existingDirection === "prerequisite") return "← −";
  if (state.existingDirection === "consequence") return "→ −";
  return "−";
}

export function RelationBrowser(props: RelationBrowserProps) {
  const projection = useMemo(
    () => projectRelationCandidates(props.snapshot, props.focusId, props.filters),
    [props.snapshot, props.focusId, props.filters]
  );
  const [manualExpanded, setManualExpanded] = useState<Set<BlockId>>(new Set());
  const expansionInitialized = useRef(false);
  useEffect(() => {
    if (expansionInitialized.current || props.snapshot.blocks.length === 0) return;
    expansionInitialized.current = true;
    setManualExpanded(new Set(props.snapshot.structuralParents.map((edge) => edge.parent)));
  }, [props.snapshot.structuralParents]);
  const effectiveExpanded = useMemo(() => new Set([...manualExpanded, ...projection.autoExpandedIds]), [manualExpanded, projection.autoExpandedIds]);
  const roles = useMemo(() => [...new Set(props.snapshot.blocks.map(blockRole).filter((role) => role.toLocaleLowerCase() !== "paragraph"))].sort(), [props.snapshot.blocks]);
  const labels = useMemo(() => [...new Set(props.snapshot.blocks.map((block) => block.label).filter((label): label is string => !!label))].sort(), [props.snapshot.blocks]);
  const focus = props.snapshot.blocks.find((block) => block.id === props.focusId);
  const setFilter = <K extends keyof RelationFilters>(key: K, value: RelationFilters[K]) => props.onFilters({ ...props.filters, [key]: value });

  const renderNode = (node: RelationTreeNode, depth: number) => {
    if (blockRole(node.block).toLocaleLowerCase() === "paragraph") {
      return <Fragment key={node.block.id}>{node.children.map((child) => renderNode(child, depth))}</Fragment>;
    }
    const matches = projection.matchIds.has(node.block.id);
    const context = projection.contextIds.has(node.block.id);
    if (props.unmatchedBehavior === "hide" && !matches && !context) return null;
    const expanded = effectiveExpanded.has(node.block.id);
    const relation = candidateRelationState(props.snapshot, props.focusId, node.block.id, props.direction);
    const isFocus = node.block.id === props.focusId;
    return <div className="relation-tree-node" key={node.block.id}>
      <div className={`relation-row ${matches ? "match" : "unmatched"} ${context && !matches ? "context" : ""} ${isFocus ? "focus" : ""}`} style={{ paddingLeft: 7 + depth * 13 }}>
        <button className="relation-expand" disabled={!node.children.length} aria-label={expanded ? t("relation.collapse") : t("relation.expand")} onClick={() => setManualExpanded((current) => {
          const next = new Set(current);
          if (next.has(node.block.id)) next.delete(node.block.id); else next.add(node.block.id);
          return next;
        })}>{node.children.length ? (expanded ? "⌄" : "›") : ""}</button>
        <button className="relation-focus-name" title={blockName(node.block)} onClick={() => props.onFocus(node.block.id)}>
          <small>{blockRole(node.block)}</small><span>{blockName(node.block)}</span>{node.block.state !== "active" && <i title={node.block.state}>!</i>}
        </button>
        <button className="relation-locate" title={t("relation.locate")} onClick={() => props.onLocate(node.block.id)}>◎</button>
        <button className={`relation-mutate ${relation.existing ? "remove" : "add"}`} disabled={!!relation.disabledReason} title={relation.disabledReason ? t(`relation.invalid.${relation.disabledReason}`) : relation.existing ? t("relation.remove") : t("relation.add")} onClick={(event) => props.onToggleRelation(node.block.id, event)}>{relationActionText(relation)}</button>
      </div>
      {expanded && node.children.map((child) => renderNode(child, depth + 1))}
    </div>;
  };

  return <div className={`relation-browser unmatched-${props.unmatchedBehavior}`}>
    <div className="relation-browser-head">
      <button className="relation-back" disabled={!props.canGoBack} onClick={props.onBack}>← {t("relation.back")}</button>
      <label><span>{t("relation.focus")}</span><strong>{focus ? blockName(focus) : t("relation.noFocus")}</strong></label>
      <div className="relation-direction" aria-label={t("relation.direction")}>
        {(["prerequisite", "both", "consequence"] as const).map((direction) => <button key={direction} className={props.direction === direction ? "active" : ""} onClick={() => props.onDirection(direction)}>{t(`relation.${direction}`)}</button>)}
      </div>
      <div className="relation-controls-grid">
        <label><span>{t("relation.hierarchy")}</span><select value={props.filters.hierarchyScope} onChange={(event) => setFilter("hierarchyScope", event.target.value as HierarchyScope)}><option value="all">{t("relation.all")}</option><option value="same-parent">{t("relation.sameParent")}</option><option value="ancestors">{t("relation.ancestors")}</option><option value="descendants">{t("relation.descendants")}</option><option value="same-section">{t("relation.sameSection")}</option></select></label>
        <label><span>{t("relation.depth")}</span><select value={String(props.depth)} onChange={(event) => props.onDepth(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="1">1</option><option value="2">2</option><option value="all">{t("relation.all")}</option></select></label>
        <label><span>{t("relation.type")}</span><select value={props.filters.role} onChange={(event) => setFilter("role", event.target.value)}><option value="all">{t("relation.all")}</option>{roles.map((role) => <option value={role} key={role}>{role}</option>)}</select></label>
        <label><span>{t("relation.origin")}</span><select value={props.filters.origin} onChange={(event) => setFilter("origin", event.target.value as RelationFilters["origin"])}><option value="all">{t("relation.all")}</option><option value="environment">Environment</option><option value="user">User</option><option value="virtual">Virtual</option></select></label>
        <label><span>{t("relation.label")}</span><select value={props.filters.label} onChange={(event) => setFilter("label", event.target.value)}><option value="all">{t("relation.all")}</option>{labels.map((label) => <option value={label} key={label}>{label}</option>)}</select></label>
        <label><span>{t("relation.unmatched")}</span><select value={props.unmatchedBehavior} onChange={(event) => props.onUnmatchedBehavior(event.target.value as UnmatchedBehavior)}><option value="dim">{t("relation.dim")}</option><option value="hide">{t("relation.hide")}</option></select></label>
      </div>
      <input value={props.filters.textQuery} onChange={(event) => setFilter("textQuery", event.target.value)} placeholder={t("relation.search")}/>
      <button className="relation-open-graph" onClick={() => window.dispatchEvent(new CustomEvent("texweave:relation-graph-open", { detail: { full: true } }))}>{t("relation.openFullView")}</button>
    </div>
    <div className="relation-tree" role="tree">{projection.roots.map((node) => renderNode(node, 0))}</div>
  </div>;
}
