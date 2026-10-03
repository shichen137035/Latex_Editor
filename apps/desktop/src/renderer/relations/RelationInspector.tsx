import { useMemo } from "react";
import { isRelationCapableBlock, type BlockGraphSnapshot, type BlockId, type RelationDirection, type RelationScope, type StructuralHistoryState } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { blockName, blockSection } from "./model.js";
import { blockColorStyle, EnvironmentBadge, EnvironmentDot, RelationGraphIcon, RelationScopeControls } from "./presentation.js";

export function RelationInspector({ snapshot, definitions, focusId, selectedId, scope, direction, depth, documentFiltered, history, onDirection, onDepth, onDocumentFiltered, onSelect, onFocus, onLocate, onRemove, onUndo, onRedo, onClose }: {
  snapshot: BlockGraphSnapshot; definitions: EnvironmentDefinition[]; focusId: BlockId | null; selectedId: BlockId | null; scope: RelationScope;
  direction: RelationDirection; depth: number | "all"; documentFiltered: boolean; history: StructuralHistoryState;
  onDirection(value: RelationDirection): void; onDepth(value: number | "all"): void; onDocumentFiltered(enabled: boolean): void;
  onSelect(id: BlockId): void; onFocus(id: BlockId): void; onLocate(id: BlockId): void;
  onRemove(from: BlockId, to: BlockId): void; onUndo(): void; onRedo(): void; onClose(): void;
}) {
  const blocks = useMemo(() => new Map(snapshot.blocks.map(block => [block.id, block])), [snapshot.blocks]);
  const focus = focusId ? blocks.get(focusId) : undefined;
  const selected = selectedId ? blocks.get(selectedId) ?? focus : focus;
  const prerequisites = focusId ? snapshot.dependencies.filter(edge => edge.to === focusId) : [];
  const consequences = focusId ? snapshot.dependencies.filter(edge => edge.from === focusId) : [];
  const related = scope.entries.filter(entry => entry.direction !== "focus");
  const focusSection = focus ? blockSection(snapshot, focus.id) : undefined;
  const sameSection = related.filter(entry => focusSection && blockSection(snapshot, entry.blockId)?.id === focusSection.id).length;
  const section = selected ? blockSection(snapshot, selected.id) : undefined;
  const selectedEntry = scope.entries.find(entry => entry.blockId === selected?.id);
  const warnings = snapshot.blocks.filter(block => block.state && block.state !== "active").length;
  const graphButton = <button className="relation-inspector-graph" onClick={() => window.dispatchEvent(new CustomEvent("texweave:relation-graph-open", { detail: { full: true } }))}><RelationGraphIcon/>{t("relation.openGraph")}</button>;
  const relationList = (title: string, edges: typeof snapshot.dependencies, target: (edge: typeof snapshot.dependencies[number]) => BlockId) => <section className="relation-inspector-list">
    <header><strong>{title}</strong><span>{edges.length}</span></header>
    {edges.length ? edges.map(edge => {
      const block = blocks.get(target(edge));
      return <div key={`${edge.from}:${edge.to}`}><button onClick={() => block && onSelect(block.id)}>{block && <EnvironmentDot block={block} definitions={definitions}/>}<span>{block ? blockName(block) : target(edge)}</span></button><button title={t("relation.remove")} onClick={() => onRemove(edge.from, edge.to)}>−</button></div>;
    }) : <p>{t("relation.none")}</p>}
  </section>;
  return <aside className="relation-inspector" aria-label={t("relation.inspector")}>
    <header><small>{t("relation.inspector")}</small><button onClick={onClose} title={t("common.close")}>×</button></header>
    <div className="relation-history-controls"><button disabled={!history.canUndo} onClick={onUndo}>{t("menu.undo")}</button><button disabled={!history.canRedo} onClick={onRedo}>{t("menu.redo")}</button></div>
    <section className="relation-inspector-section">
      <h3>{t("relation.focusSettings")}</h3>
      <div className="relation-focus-summary"><span>{t("relation.focusBlock")}</span><strong title={focus ? blockName(focus) : undefined}>{focus ? <><EnvironmentDot block={focus} definitions={definitions}/><span className="relation-focus-title">{blockName(focus)}</span></> : t("relation.chooseFocus")}</strong></div>
      <RelationScopeControls direction={direction} depth={depth} documentFiltered={documentFiltered} onDirection={onDirection} onDepth={onDepth} onDocumentFiltered={onDocumentFiltered}/>
    </section>
    <section className="relation-inspector-section">
      <h3>{t("relation.relatedContent")}</h3>
      <dl>{focus ? <>
        <div><dt>{t("relation.totalRelated")}</dt><dd>{related.length}</dd></div>
        <div><dt>{t("relation.prerequisites")}</dt><dd>{related.filter(entry => entry.direction === "prerequisite").length}</dd></div>
        <div><dt>{t("relation.consequences")}</dt><dd>{related.filter(entry => entry.direction === "dependent").length}</dd></div>
        <div><dt>{t("relation.sameSection")}</dt><dd>{sameSection}</dd></div>
        <div><dt>{t("relation.otherSections")}</dt><dd>{related.length - sameSection}</dd></div>
      </> : <>
        <div><dt>{t("relation.blocks")}</dt><dd>{snapshot.blocks.filter(isRelationCapableBlock).length}</dd></div>
        <div><dt>{t("relation.relations")}</dt><dd>{snapshot.dependencies.length}</dd></div>
        <div><dt>{t("relation.warnings")}</dt><dd>{warnings}</dd></div>
      </>}</dl>{graphButton}
    </section>
    {selected && <section className="relation-inspector-section relation-selected-details" style={blockColorStyle(selected, definitions)}>
      <div className="relation-selected-heading"><h3>{t("relation.selectedItem")}</h3><EnvironmentBadge block={selected} definitions={definitions}/></div>
      <h4>{blockName(selected)}</h4>
      <dl><div><dt>{t("relation.section")}</dt><dd>{section ? <button title={blockName(section)} onClick={() => onLocate(section.id)}>{blockName(section)}</button> : "—"}</dd></div>
        <div><dt>{t("relation.distance")}</dt><dd><span className="relation-distance-badge">{selectedEntry ? `d${selectedEntry.distance}` : "—"}</span></dd></div>
        {selected.label && <div><dt>{t("block.label")}</dt><dd title={selected.label}>{selected.label}</dd></div>}
        <div><dt>{t("relation.relations")}</dt><dd>{snapshot.dependencies.filter(edge => edge.from === selected.id || edge.to === selected.id).length}</dd></div>
      </dl>
      <div className="relation-selected-actions"><button disabled={!isRelationCapableBlock(selected)} onClick={() => onFocus(selected.id)}>{t("relation.setFocusShort")}</button><button onClick={() => onLocate(selected.id)}>{t("relation.locateDocument")}</button></div>
    </section>}
    {focus && <details className="relation-inspector-section relation-direct-relations"><summary>{t("relation.directRelations")}</summary>{relationList(t("relation.prerequisites"), prerequisites, edge => edge.from)}{relationList(t("relation.consequences"), consequences, edge => edge.to)}</details>}
  </aside>;
}
