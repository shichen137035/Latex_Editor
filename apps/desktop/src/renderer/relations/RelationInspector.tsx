import type { BlockGraphSnapshot, BlockId, RelationDirection, StructuralHistoryState } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { blockName, blockRole } from "./model.js";

export function RelationInspector({ snapshot, focusId, direction, depth, history, onDirection, onDepth, onFocus, onRemove, onUndo, onRedo, onClose }: {
  snapshot: BlockGraphSnapshot;
  focusId: BlockId | null;
  direction: RelationDirection;
  depth: number | "all";
  history: StructuralHistoryState;
  onDirection(value: RelationDirection): void;
  onDepth(value: number | "all"): void;
  onFocus(id: BlockId): void;
  onRemove(from: BlockId, to: BlockId): void;
  onUndo(): void;
  onRedo(): void;
  onClose(): void;
}) {
  const blocks = new Map(snapshot.blocks.map((block) => [block.id, block]));
  const focus = focusId ? blocks.get(focusId) : undefined;
  const prerequisites = focusId ? snapshot.dependencies.filter((edge) => edge.to === focusId) : [];
  const consequences = focusId ? snapshot.dependencies.filter((edge) => edge.from === focusId) : [];
  const warnings = snapshot.blocks.filter((block) => block.state && block.state !== "active").length;
  const relationList = (title: string, edges: typeof snapshot.dependencies, target: (edge: typeof snapshot.dependencies[number]) => BlockId) => <section className="relation-inspector-list">
    <header><strong>{title}</strong><span>{edges.length}</span></header>
    {edges.length ? edges.map((edge) => {
      const block = blocks.get(target(edge));
      return <div key={`${edge.from}:${edge.to}`}><button onClick={() => block && onFocus(block.id)}><small>{block ? blockRole(block) : t("relation.missingBlock")}</small><span>{block ? blockName(block) : target(edge)}</span></button><button title={t("relation.remove")} onClick={() => onRemove(edge.from, edge.to)}>−</button></div>;
    }) : <p>{t("relation.none")}</p>}
  </section>;
  return <aside className="relation-inspector" aria-label={t("relation.inspector")}>
    <header><div><small>{t("relation.inspector")}</small><strong>{focus ? blockName(focus) : t("relation.globalState")}</strong></div><button onClick={onClose} title={t("common.close")}>×</button></header>
    <div className="relation-history-controls"><button disabled={!history.canUndo} onClick={onUndo}>{t("menu.undo")}</button><button disabled={!history.canRedo} onClick={onRedo}>{t("menu.redo")}</button></div>
    {!focus ? <div className="relation-global-state">
      <label><span>{t("relation.defaultPerspective")}</span><select value={direction} onChange={(event) => onDirection(event.target.value as RelationDirection)}><option value="prerequisite">{t("relation.prerequisite")}</option><option value="both">{t("relation.both")}</option><option value="consequence">{t("relation.consequence")}</option></select></label>
      <label><span>{t("relation.defaultDepth")}</span><select value={String(depth)} onChange={(event) => onDepth(event.target.value === "all" ? "all" : Number(event.target.value))}><option value="1">1</option><option value="2">2</option><option value="all">{t("relation.all")}</option></select></label>
      <dl><div><dt>{t("relation.blocks")}</dt><dd>{snapshot.blocks.length}</dd></div><div><dt>{t("relation.relations")}</dt><dd>{snapshot.dependencies.length}</dd></div><div><dt>{t("relation.warnings")}</dt><dd>{warnings}</dd></div></dl>
      <button onClick={() => window.dispatchEvent(new CustomEvent("texweave:relation-graph-open"))}>{t("relation.openFullView")}</button>
    </div> : <div className="relation-block-state">
      <dl><div><dt>{t("block.type")}</dt><dd>{blockRole(focus)}</dd></div><div><dt>{t("block.label")}</dt><dd>{focus.label || "—"}</dd></div><div><dt>{t("block.origin")}</dt><dd>{focus.origin ?? "environment"}</dd></div></dl>
      {relationList(t("relation.prerequisites"), prerequisites, (edge) => edge.from)}
      {relationList(t("relation.consequences"), consequences, (edge) => edge.to)}
      <button onClick={() => window.dispatchEvent(new CustomEvent("texweave:relation-graph-open"))}>{t("relation.openFocusedView")}</button>
    </div>}
  </aside>;
}
