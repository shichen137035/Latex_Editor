import { t } from "../i18n/index.js";
import { useEffect, useState } from "react";
import type { TableStylePreset } from "@latex-editor/contracts";
import { hasLatexPackage } from "./insert.js";

export interface TableInsertChoice {
  rows: number;
  columns: number;
  style: TableStylePreset;
  headerRow: boolean;
  addCaption: boolean;
  addLabel: boolean;
  addBooktabs: boolean;
}

const styles: Array<[TableStylePreset, string]> = [
  ["booktabs-three-line", "table.style.booktabs"], ["grid", "table.style.grid"], ["horizontal", "table.style.horizontal"], ["plain", "table.style.plain"], ["header-bottom", "table.style.headerBottom"]
];

export function TableInsertDialog({ documentSource, defaults, onChoose, onClose }: { documentSource: string; defaults: Omit<TableInsertChoice, "rows" | "columns" | "addBooktabs">; onChoose(choice: TableInsertChoice): void; onClose(): void }) {
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [hover, setHover] = useState<{ rows: number; columns: number }>();
  const [style, setStyle] = useState(defaults.style);
  const [headerRow, setHeaderRow] = useState(defaults.headerRow);
  const [addCaption, setAddCaption] = useState(defaults.addCaption);
  const [addLabel, setAddLabel] = useState(defaults.addLabel);
  const [addBooktabs, setAddBooktabs] = useState(false);
  const needsBooktabs = (style === "booktabs-three-line" || style === "header-bottom") && !hasLatexPackage(documentSource, "booktabs");
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape);
  }, [onClose]);
  const submit = (nextRows = rows, nextColumns = columns) => {
    if (needsBooktabs && !addBooktabs) return;
    onChoose({ rows: Math.max(1, Math.min(100, nextRows)), columns: Math.max(1, Math.min(30, nextColumns)), style, headerRow, addCaption, addLabel, addBooktabs: needsBooktabs && addBooktabs });
  };
  return <div className="table-insert-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="table-insert-dialog" role="dialog" aria-modal="true" aria-label={t("ui.TableInsertDialog.insert_table")}>
    <header><div><small>{t("ui.TableInsertDialog.table")}</small><h2>{t("ui.TableInsertDialog.insert_table")}</h2></div><button onClick={onClose} aria-label={t("ai.history.close")}>×</button></header>
    <div className="table-insert-body"><div className="table-grid-title"><strong>{hover?.rows ?? rows} × {hover?.columns ?? columns}</strong><span>{t("ui.TableInsertDialog.rows_columns")}</span></div><div className="table-grid-selector" onMouseLeave={() => setHover(undefined)}>{Array.from({ length: 64 }, (_, index) => { const row = Math.floor(index / 8) + 1; const column = index % 8 + 1; const active = row <= (hover?.rows ?? rows) && column <= (hover?.columns ?? columns); return <button className={active ? "active" : ""} key={index} aria-label={t("ui.TableInsertDialog.by", { value1: row, value2: column })} onMouseEnter={() => setHover({ rows: row, columns: column })} onClick={() => { setRows(row); setColumns(column); submit(row, column); }}/>; })}</div>
      <div className="table-size-inputs"><label><span>{t("ui.ImageInsertDialog.rows")}</span><input type="number" min={1} max={100} value={rows} onChange={(event) => setRows(Number(event.target.value) || 1)}/></label><b>×</b><label><span>{t("ui.ImageInsertDialog.columns")}</span><input type="number" min={1} max={30} value={columns} onChange={(event) => setColumns(Number(event.target.value) || 1)}/></label></div>
      <label className="table-style-field"><span>{t("ui.TableInsertDialog.style")}</span><select value={style} onChange={(event) => setStyle(event.target.value as TableStylePreset)}>{styles.map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label>
      <div className="table-insert-options"><label><input type="checkbox" checked={headerRow} onChange={(event) => setHeaderRow(event.target.checked)}/>{t("ui.TableInsertDialog.header_row")}</label><label><input type="checkbox" checked={addCaption} onChange={(event) => setAddCaption(event.target.checked)}/>{t("ui.FigureInspector.caption")}</label><label><input type="checkbox" checked={addLabel} onChange={(event) => setAddLabel(event.target.checked)}/>{t("relation.label")}</label></div>
      {needsBooktabs && <label className="table-package-warning"><input type="checkbox" checked={addBooktabs} onChange={(event) => setAddBooktabs(event.target.checked)}/><span><strong>{t("ui.TableInsertDialog.package_booktabs_is_required")}</strong><small>{t("ui.ReferenceLibraryPage.add")}<code>\\usepackage{"{booktabs}"}</code> {t("ui.TableInsertDialog.to_the_preamble")}</small></span></label>}
      <button className="table-create-button" disabled={needsBooktabs && !addBooktabs} onClick={() => submit()}>{t("ui.ImageInsertDialog.create")}{rows} × {columns} {t("ui.TableInsertDialog.table_2")}</button>
    </div>
  </section></div>;
}
