import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { unsavedChanges, useUnsavedChanges } from "../lifecycle/unsavedChanges.js";
import { t } from "../i18n/index.js";
import { TableEditorDialog } from "./TableEditorDialog.js";
import { FloatingTableToolbar } from "./FloatingTableToolbar.js";
import "./table-editor.css";
import { environmentPreview, previewSizingStyle } from "../preview/environment-preview.js";
import { defaultTablePreferences } from "@latex-editor/contracts";
import { parseTable } from "./parser.js";
import { deleteTableColumn, deleteTableRow, insertTableColumn, insertTableRow, mergeTableCells, patchTableSource, splitTableCells } from "./patch.js";
import type { TableCell } from "./model.js";

export interface TablePreviewSelection { kind: "table" | "cell" | "row" | "column"; row?: number; column?: number }
interface Point { row: number; column: number }
interface Range { anchor: Point; focus: Point }
interface Draft extends Point { value: string }
function bounds(range: Range) {
  return { top: Math.min(range.anchor.row, range.focus.row), bottom: Math.max(range.anchor.row, range.focus.row), left: Math.min(range.anchor.column, range.focus.column), right: Math.max(range.anchor.column, range.focus.column) };
}
function intersects(cell: TableCell, area: ReturnType<typeof bounds>) {
  return cell.row <= area.bottom && cell.row + cell.rowSpan > area.top && cell.column <= area.right && cell.column + cell.colSpan > area.left;
}
function cellRange(cell: TableCell): Range {
  return { anchor: { row: cell.row, column: cell.column }, focus: { row: cell.row + cell.rowSpan - 1, column: cell.column + cell.colSpan - 1 } };
}

function cellScrollbarHit(event: { target: EventTarget | null; clientX: number; clientY: number }): boolean {
  const content = event.target instanceof Element ? event.target.closest<HTMLElement>(".table-cell-content") : null;
  if (!content) return false;
  const rect = content.getBoundingClientRect();
  return (content.offsetWidth > content.clientWidth && event.clientX >= rect.left + content.clientWidth)
    || (content.offsetHeight > content.clientHeight && event.clientY >= rect.top + content.clientHeight);
}

export function TablePreview({ source, renderCell, onChange, onSelect, captionContent, active = false, editorId, onExpandedChange, onEditSource, autoAddRowOnTab = defaultTablePreferences.editing.autoAddRowOnTab, configuration = environmentPreview("") }: { source: string; renderCell(content: string): ReactNode; onChange(source: string): void; onSelect(selection: TablePreviewSelection): void; captionContent?: ReactNode; active?: boolean; editorId?: string; onExpandedChange?(active: boolean): void; onEditSource?: (() => void) | undefined; autoAddRowOnTab?: boolean; configuration?: ReturnType<typeof environmentPreview> }) {
  const table = useMemo(() => parseTable(source), [source]);
  const [selection, setSelection] = useState<Range>();
  const [editing, setEditing] = useState<Draft>();
  const draft = useRef<Draft | undefined>(undefined);
  const currentSource = useRef(source);
  currentSource.current = source;
  const drag = useRef<Point | undefined>(undefined);
  const dragged = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const shell = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState(false);
  const onExpandedChangeRef = useRef(onExpandedChange);
  onExpandedChangeRef.current = onExpandedChange;
  const expandButton = useRef<HTMLButtonElement>(null);
  const [inlineHeight, setInlineHeight] = useState(180);
  useEffect(() => {
    if (!expanded) return;
    const notify = onExpandedChangeRef.current;
    notify?.(true);
    return () => notify?.(false);
  }, [expanded, editorId]);
  const edit = (value?: Draft) => { draft.current = value; setEditing(value); };
  // Clear the draft before emitting. Blur and toolbar clicks can arrive together.
  const flush = () => {
    const value = draft.current;
    draft.current = undefined;
    setEditing(undefined);
    const next = value ? patchTableSource(currentSource.current, { cell: { ...value, content: value.value } }) : currentSource.current;
    return next;
  };
  const publish = (next: string) => {
    if (next === currentSource.current) return;
    currentSource.current = next;
    onChange(next);
  };
  const commit = () => publish(flush());
  useUnsavedChanges({ hasChanges: () => !!draft.current && patchTableSource(currentSource.current, { cell: { ...draft.current, content: draft.current.value } }) !== currentSource.current, commit });
  useEffect(() => {
    input.current?.focus();
  }, [editing?.row, editing?.column]);
  useEffect(() => {
    const release = () => { drag.current = undefined; };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => { window.removeEventListener("pointerup", release); window.removeEventListener("pointercancel", release); };
  }, []);
  if (!table) return <div className="table-preview-failed">Table preview unavailable. Edit this table in source mode.</div>;
  const visible = table.tabular.cells.filter(cell => !table.tabular.cells.some(other => other.row < cell.row && other.row + other.rowSpan > cell.row && other.column <= cell.column && other.column + other.colSpan > cell.column));
  const area = selection ? bounds(selection) : undefined;
  const merged = !!area && visible.some(cell => intersects(cell, area) && (cell.colSpan > 1 || cell.rowSpan > 1));
  const structuralEditable = table.tabular.editableLevel === "full" && !table.tabular.diagnostics.length;
  const full = configuration.behavior.inlineEditable && !onEditSource && structuralEditable;
  const navigate = (backwards: boolean, vertical: boolean) => {
    const value = draft.current;
    if (!value) return;
    const next = vertical
      ? visible.find(cell => cell.row === value.row + (backwards ? -1 : 1) && cell.column <= value.column && cell.column + cell.colSpan > value.column)
      : visible[visible.findIndex(cell => cell.row === value.row && cell.column === value.column) + (backwards ? -1 : 1)];
    if (!next && !vertical && !backwards && autoAddRowOnTab && full) {
      const base = flush();
      const updatedSource = insertTableRow(base, table.tabular.rows.length - 1, true);
      publish(updatedSource);
      const updated = parseTable(updatedSource);
      const firstCell = updated?.tabular.cells.find(cell => cell.row === updated.tabular.rows.length - 1 && cell.column === 0);
      if (firstCell) { setSelection(cellRange(firstCell)); edit({ row: firstCell.row, column: firstCell.column, value: firstCell.content }); onSelect({ kind: "cell", row: firstCell.row, column: firstCell.column }); }
      return;
    }
    commit();
    if (next) { setSelection(cellRange(next)); edit({ row: next.row, column: next.column, value: next.content }); }
  };
  const run = (operation: (source: string) => string) => {
    const base = flush();
    const next = operation(base);
    setNotice(next === base ? "This selection cannot be changed. Select complete cells." : "");
    publish(next);
    const updated = parseTable(next);
    if (updated && area) {
      const point = { row: Math.min(area.top, updated.tabular.rows.length - 1), column: Math.min(area.left, updated.tabular.columns.length - 1) };
      const cell = updated.tabular.cells.find(cell => cell.row === point.row && cell.column === point.column);
      setSelection(cell ? cellRange(cell) : { anchor: point, focus: point });
    }
  };
  const open = () => {
    unsavedChanges.commitDrafts(flushSync);
    commit();
    setInlineHeight(shell.current?.getBoundingClientRect().height ?? 180);
    setExpanded(true);
  };
  const close = () => {
    unsavedChanges.commitDrafts(flushSync);
    commit();
    setExpanded(false);
    requestAnimationFrame(() => expandButton.current?.focus());
  };
  const toolbar = <div className="table-preview-toolbar" role="toolbar" aria-label="Table editing" onPointerDown={event => event.preventDefault()}>
      <button disabled={!full || !area} onClick={() => area && run(value => insertTableRow(value, area.top, false))}>Row above</button>
      <button disabled={!full || !area} onClick={() => area && run(value => insertTableRow(value, area.bottom, true))}>Row below</button>
      <button disabled={!full || !area || table.tabular.rows.length <= 1} onClick={() => area && run(value => deleteTableRow(value, area.top))}>Delete row</button>
      <button disabled={!full || !area} onClick={() => area && run(value => insertTableColumn(value, area.left, false))}>Column left</button>
      <button disabled={!full || !area} onClick={() => area && run(value => insertTableColumn(value, area.right, true))}>Column right</button>
      <button disabled={!full || !area || table.tabular.columns.length <= 1} onClick={() => area && run(value => deleteTableColumn(value, area.left))}>Delete column</button>
      <button disabled={!full || !area || merged || (area.top === area.bottom && area.left === area.right)} onClick={() => area && run(value => mergeTableCells(value, area.top, area.left, area.bottom, area.right))}>Merge</button>
      <button disabled={!full || !area || !merged} onClick={() => area && run(value => splitTableCells(value, area.top, area.left, area.bottom, area.right))}>Split</button>
      {!expanded && configuration.behavior.allowExpandedEditor && <button type="button" onClick={open}>{t("table.expand")}</button>}
    </div>;
  const content = <figure ref={shell} style={previewSizingStyle(configuration.sizing)} className={`structured-table style-${table.tabular.style} alignment-${table.alignment}${expanded ? " table-expanded" : ""}`}
    onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    {!expanded && configuration.behavior.allowExpandedEditor && <button ref={expandButton} type="button" className="table-expand-button" aria-label={t("table.expand")} title={t("table.expand")} onPointerDown={event => event.preventDefault()} onClick={open}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"/></svg></button>}
    {notice && <small role="status">{notice}</small>}
    <div className="structured-table-scroll"><table>
      <thead className="table-column-selectors"><tr>{table.tabular.columns.map(column => <th key={column.id}><button onPointerDown={event => event.preventDefault()} onClick={() => { commit(); setSelection({ anchor: { row: 0, column: column.index }, focus: { row: table.tabular.rows.length - 1, column: column.index } }); }}>{column.index + 1}</button></th>)}</tr></thead>
      <tbody>{table.tabular.rows.map(row => <tr key={row.id} className={row.role === "header" ? "header-row" : ""}>{row.cells.filter(cell => visible.includes(cell)).map(cell => <td key={cell.id}
        colSpan={cell.colSpan} rowSpan={cell.rowSpan} aria-selected={!!area && intersects(cell, area)}
        className={area && intersects(cell, area) ? "table-cell-selected" : ""}
        style={{ textAlign: table.tabular.columns[cell.column]?.alignment === "right" ? "right" : table.tabular.columns[cell.column]?.alignment === "left" ? "left" : "center" }}
        onPointerDown={event => {
          if (event.button !== 0 || (event.target as Element).closest("textarea,button")) return;
          if (cellScrollbarHit(event)) return;
          event.preventDefault(); event.stopPropagation();
          commit();
          dragged.current = event.shiftKey && !!selection;
          const anchor = event.shiftKey && selection ? selection.anchor : { row: cell.row, column: cell.column };
          drag.current = event.shiftKey ? undefined : anchor;
          setSelection({ anchor, focus: cellRange(cell).focus });
          setNotice("");
        }}
        onPointerEnter={event => { if (!drag.current || event.buttons !== 1) return; dragged.current = true; setSelection({ anchor: drag.current, focus: cellRange(cell).focus }); }}
        onClick={event => {
          event.stopPropagation();
          if (cellScrollbarHit(event)) return;
          if (dragged.current) return;
          if (!configuration.behavior.inlineEditable) return;
          if (onEditSource) { commit(); onEditSource(); return; }
          if (table.tabular.editableLevel === "source-only") return;
          setSelection(cellRange(cell));
          edit({ row: cell.row, column: cell.column, value: cell.content });
          onSelect({ kind: "cell", row: cell.row, column: cell.column });
        }}>
        {cell.column === 0 && <button className="table-row-selector" title="Select row" onPointerDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); commit(); setSelection({ anchor: { row: row.index, column: 0 }, focus: { row: row.index, column: table.tabular.columns.length - 1 } }); }}>{row.index + 1}</button>}
        {editing?.row === cell.row && editing.column === cell.column
          ? <textarea ref={input} autoFocus wrap="off" rows={Math.min(5, Math.max(2, editing.value.split("\n").length))} aria-label={`Row ${cell.row + 1}, column ${cell.column + 1}`} value={editing.value}
            onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
            onChange={event => edit({ ...editing, value: event.target.value })}
            onBlur={() => { if (draft.current?.row === cell.row && draft.current.column === cell.column) commit(); }}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") { event.preventDefault(); edit(); }
              if (event.key === "Tab") { event.preventDefault(); navigate(event.shiftKey, false); }
              if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); navigate(false, true); }
            }}/>
          : <span className="table-cell-content">{cell.content ? renderCell(cell.content) : "\u00a0"}</span>}
      </td>)}</tr>)}</tbody>
    </table></div>
    {configuration.behavior.showCaption && (captionContent ?? table.caption) && <figcaption>{captionContent ?? renderCell(table.caption!)}</figcaption>}
    {!structuralEditable && <small>Custom table: structural editing is unavailable; use source mode.</small>}
  </figure>;
  return expanded ? <><div className="table-expanded-placeholder" style={{ minHeight: inlineHeight }}>{t("table.editingExpanded")}</div><TableEditorDialog toolbar={configuration.behavior.expandedToolbar ? toolbar : null} onClose={close} style={previewSizingStyle(configuration.sizing)}>{content}</TableEditorDialog></> : <>{content}{(configuration.behavior.tableToolbar === "always" || configuration.behavior.tableToolbar === "selected" && active) && <FloatingTableToolbar anchor={shell}>{toolbar}</FloatingTableToolbar>}</>;
}
