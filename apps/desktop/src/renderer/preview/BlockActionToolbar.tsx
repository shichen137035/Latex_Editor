import { t } from "../i18n/index.js";

interface Props {
  count: number;
  canCollapse: boolean;
  hasExpanded: boolean;
  enabledCount: number;
  disabledCount: number;
  onMove(direction: "up" | "down" | "outdent" | "indent"): void;
  onCollapse(collapsed: boolean, scope?: "selected" | "children" | "siblings" | "all"): void;
  onCopy(): void;
  onCut(): void;
  onDuplicate(): void;
  onPaste(): void;
  onDisable(): void;
  onEnable(): void;
  onDelete(): void;
}

export function BlockActionToolbar(props: Props) {
  return <div className="preview-selection-toolbar" role="toolbar" aria-label={t("blockOperation.toolbar")} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
    <span className="preview-selection-count">{t("preview.selectedBlocks", { count: props.count })}</span>
    <div className="preview-selection-move">
      <button title={t("blockOperation.moveUp")} aria-label={t("blockOperation.moveUp")} onClick={() => props.onMove("up")}>↑</button>
      <button title={t("blockOperation.moveDown")} aria-label={t("blockOperation.moveDown")} onClick={() => props.onMove("down")}>↓</button>
      <button title={t("blockOperation.outdent")} aria-label={t("blockOperation.outdent")} onClick={() => props.onMove("outdent")}>←</button>
      <button title={t("blockOperation.indent")} aria-label={t("blockOperation.indent")} onClick={() => props.onMove("indent")}>→</button>
    </div>
    {props.canCollapse && <button onClick={() => props.onCollapse(props.hasExpanded)}>{t(props.hasExpanded ? "blockOperation.collapse" : "blockOperation.expand")}</button>}
    <button onClick={props.onCopy}>{t("editor.context.copy")}</button>
    <button onClick={props.onCut}>{t("editor.context.cut")}</button>
    <button onClick={props.onDuplicate}>{t("blockOperation.duplicate")}</button>
    <button onClick={props.onPaste}>{t("blockOperation.paste")}</button>
    {props.enabledCount > 0 && <button onClick={props.onDisable}>{t("blockOperation.disable")}</button>}
    {props.disabledCount > 0 && <button onClick={props.onEnable}>{t("blockOperation.enable")}</button>}
    <button className="danger" onClick={props.onDelete}>{t("files.delete")}</button>
    <details className="preview-selection-more"><summary aria-label={t("settings.moreActions")}>⋯</summary><div>
      <button onClick={() => props.onCollapse(true, "children")}>{t("blockOperation.collapseChildren")}</button>
      <button onClick={() => props.onCollapse(false, "children")}>{t("blockOperation.expandChildren")}</button>
      <button onClick={() => props.onCollapse(true, "siblings")}>{t("blockOperation.collapseSiblings")}</button>
      <button onClick={() => props.onCollapse(false, "all")}>{t("blockOperation.expandAll")}</button>
    </div></details>
  </div>;
}
