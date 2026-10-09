import { describe, expect, it } from "vitest";
import { defaultTablePreferences } from "@latex-editor/contracts";
import { addLatexPackage, hasLatexPackage, tableInsertion } from "../../apps/desktop/src/renderer/table/insert.js";
import { parseTable } from "../../apps/desktop/src/renderer/table/parser.js";
import { deleteTableColumn, deleteTableRow, insertTableColumn, insertTableRow, mergeTableCellRight, mergeTableCells, patchTableSource, setTableColumnAlignment, setTableStyle, splitTableCell, splitTableCells } from "../../apps/desktop/src/renderer/table/patch.js";

const threeLine = String.raw`\begin{table}[htbp]
  \centering
  \caption{Results}
  \label{tab:results}
  \begin{tabular}{lcp{3cm}}
    \toprule
    Model & RMSE & Note \\
    \midrule
    AR & 1.42 & $x+y$ \\
    PPAR & \multicolumn{2}{c}{Best} \\
    \bottomrule
  \end{tabular}
\end{table}`;

describe("v0.4.2 table system", () => {
  it("edits every cell in every standard preset without losing rules or empty rows", () => {
    for (const style of ["booktabs-three-line", "grid", "horizontal", "plain", "header-bottom"] as const) {
      for (const columns of [1, 3]) {
        let source = tableInsertion({ rows: 3, columns, style, headerRow: false, addCaption: false, addLabel: false }, defaultTablePreferences).text;
        expect(parseTable(source)?.tabular.rows).toHaveLength(3);
        expect(parseTable(source)?.tabular.cells.every(cell => cell.content === "")).toBe(true);
        for (let row = 0; row < 3; row += 1) for (let column = 0; column < columns; column += 1) {
          source = patchTableSource(source, { cell: { row, column, content: `r${row}c${column}` } });
          expect(parseTable(source)?.tabular.cells.find(cell => cell.row === row && cell.column === column)?.content).toBe(`r${row}c${column}`);
        }
        source = insertTableColumn(source, 0, true);
        source = deleteTableColumn(source, 1);
        source = insertTableRow(source, 0, true);
        source = deleteTableRow(source, 1);
        expect(parseTable(source)?.tabular.rows).toHaveLength(3);
        expect(parseTable(source)?.tabular.diagnostics).toEqual([]);
        expect(parseTable(source)?.tabular.cells[0]?.content).toBe("r0c0");
      }
    }
  });

  it("keeps a merged cell editable while rows and columns are inserted and deleted", () => {
    let source = tableInsertion({ rows: 3, columns: 3, style: "grid", headerRow: false, addCaption: false, addLabel: false }, defaultTablePreferences).text;
    source = mergeTableCells(source, 0, 0, 1, 1);
    source = patchTableSource(source, { cell: { row: 0, column: 0, content: "Merged" } });
    expect(parseTable(source)?.tabular.cells[0]).toMatchObject({ content: "Merged", rowSpan: 2, colSpan: 2 });
    source = insertTableRow(source, 0, true);
    source = insertTableColumn(source, 0, true);
    expect(parseTable(source)?.tabular.cells[0]).toMatchObject({ content: "Merged", rowSpan: 3, colSpan: 3 });
    source = deleteTableRow(source, 0);
    source = deleteTableColumn(source, 0);
    expect(parseTable(source)?.tabular.cells[0]).toMatchObject({ content: "Merged", rowSpan: 2, colSpan: 2 });
    source = splitTableCell(source, 0, 0);
    expect(parseTable(source)?.tabular.diagnostics).toEqual([]);
    expect(parseTable(source)?.tabular.cells[0]?.content).toBe("Merged");
  });
  it("parses table and tabular structure, spans, rules and metadata", () => {
    const table = parseTable(threeLine)!;
    expect(table.environment).toBe("table");
    expect(table.caption).toBe("Results");
    expect(table.tabular.columns.map((column) => column.alignment)).toEqual(["left", "center", "paragraph"]);
    expect(table.tabular.rows).toHaveLength(3);
    expect(table.tabular.rows[0]?.role).toBe("header");
    expect(table.tabular.cells.find((cell) => cell.content === "Best")?.colSpan).toBe(2);
    expect(table.tabular.style).toBe("booktabs-three-line");
  });

  it("patches one cell without rewriting unknown surrounding LaTeX", () => {
    const source = threeLine.replace("\\midrule", "\\midrule\n    \\mycustomrule");
    const result = patchTableSource(source, { cell: { row: 1, column: 1, content: "1.31" } });
    expect(result).toContain("AR & 1.31 & $x+y$");
    expect(result).toContain("\\mycustomrule");
  });

  it("generates selectable presets and handles booktabs explicitly", () => {
    const insertion = tableInsertion({ rows: 4, columns: 3, style: "booktabs-three-line", headerRow: true, addCaption: true, addLabel: true }, defaultTablePreferences);
    expect(insertion.text).toContain("\\toprule");
    expect(parseTable(insertion.text)?.tabular.rows).toHaveLength(4);
    expect(insertion.requiredPackages).toEqual(["booktabs"]);
    const document = "\\documentclass{article}\n\\begin{document}\n\\end{document}";
    const patched = addLatexPackage(document, "booktabs").source;
    expect(hasLatexPackage(patched, "booktabs")).toBe(true);
  });

  it("marks custom column definitions as partially editable", () => {
    const source = String.raw`\begin{tabular}{>{\raggedright}p{4cm}S[table-format=3.2]} A & 1.2 \\ \end{tabular}`;
    expect(parseTable(source)?.tabular.editableLevel).toBe("partial");
  });

  it("performs explicit structural regeneration for safe row, column, merge and style operations", () => {
    const inserted = tableInsertion({ rows: 3, columns: 3, style: "plain", headerRow: true, addCaption: false, addLabel: false }, defaultTablePreferences).text;
    const withRow = insertTableRow(inserted, 1, true);
    expect(parseTable(withRow)?.tabular.rows).toHaveLength(4);
    const fewerColumns = deleteTableColumn(withRow, 2);
    expect(parseTable(fewerColumns)?.tabular.columns).toHaveLength(2);
    const merged = mergeTableCellRight(fewerColumns, 0, 0);
    expect(parseTable(merged)?.tabular.cells[0]?.colSpan).toBe(2);
    expect(parseTable(splitTableCell(merged, 0, 0))?.tabular.rows[0]?.cells).toHaveLength(2);
    expect(parseTable(setTableStyle(fewerColumns, "grid"))?.tabular.style).toBe("grid");
  });

  it("round-trips an Excel-style rectangular merge and split", () => {
    const source = String.raw`\begin{tabular}{ccc}
      A & B & C \\
      D & E & F \\
      G & H & I \\
    \end{tabular}`;
    const merged = mergeTableCells(source, 0, 0, 1, 1);
    const parsed = parseTable(merged)!;
    expect(parsed.tabular.cells.find((cell) => cell.row === 0 && cell.column === 0)).toMatchObject({ colSpan: 2, rowSpan: 2, content: "A B D E" });
    expect(merged).toContain("\\multicolumn{2}{c}{\\multirow{2}{*}{A B D E}}");
    const split = parseTable(splitTableCells(merged, 0, 0, 1, 1))!;
    expect(split.tabular.rows[0]?.cells).toHaveLength(3);
    expect(split.tabular.cells[0]).toMatchObject({ colSpan: 1, rowSpan: 1, content: "A B D E" });
  });

  it("patches nested, short and empty float metadata without changing cell contents", () => {
    const source = String.raw`\begin{table}[]
% \caption{Comment}
\begin{tabular}{cc} A & B \\ \end{tabular}
\caption[Short]{A \textbf{bold} caption}\label{}
\end{table}`;
    expect(parseTable(source)?.caption).toBe(String.raw`A \textbf{bold} caption`);
    const result = patchTableSource(source, { caption: "Updated", label: "tab:new", placement: "H", alignment: "center" });
    expect(result).toContain(String.raw`\begin{table}[H]`);
    expect(result).toContain(String.raw`\caption[Short]{Updated}\label{tab:new}`);
    expect(result).toContain(String.raw`% \caption{Comment}`);
    expect(result).toContain(String.raw`\centering`);
    expect(parseTable(result)?.tabular.cells.map(cell => cell.content)).toEqual(["A", "B"]);
  });
  it("reads the width argument of tabular* separately from its column specification", () => {
    const source = String.raw`\begin{tabular*}{\textwidth}{lc} A & B \\ C & D \\ \end{tabular*}`;
    expect(parseTable(source)?.tabular).toMatchObject({ columnSpec: "lc", diagnostics: [] });
    const result = insertTableColumn(source, 0, true);
    expect(result).toContain(String.raw`\begin{tabular*}{\textwidth}{lcc}`);
  });
  it("refuses structural regeneration of malformed rows while allowing a targeted cell edit", () => {
    const source = String.raw`\begin{tabular}{cc} A & B & EXTRA \\ C & D \\ \end{tabular}`;
    expect(parseTable(source)?.tabular.diagnostics.length).toBeGreaterThan(0);
    for (const edit of [insertTableColumn(source, 0, true), deleteTableRow(source, 1), mergeTableCellRight(source, 0, 0), setTableStyle(source, "grid")]) expect(edit).toBe(source);
    expect(patchTableSource(source, { cell: { row: 0, column: 0, content: "Edited" } })).toContain("Edited & B & EXTRA");
  });
  it("changes column alignment without losing vertical borders, whitespace or row formatting", () => {
    const source = String.raw`\begin{tabular}{| l | c |} A & B \\ \hline C & D \\ \end{tabular}`;
    expect(setTableColumnAlignment(source, 0, "r")).toBe(source.replace("{| l | c |}", "{| r | c |}"));
    expect(parseTable(setTableColumnAlignment(source, 1, "r"))?.tabular.style).toBe("grid");
  });
  it("preserves comments and custom row spacing by restricting regeneration to source editing", () => {
    for (const source of [String.raw`\begin{tabular}{cc} A & B \\[2pt] C & D \\ \end{tabular}`, "\\begin{tabular}{cc} A & B \\\\\n% annotation\nC & D \\\\ \\end{tabular}"]) {
      expect(parseTable(source)?.tabular.editableLevel).toBe("partial");
      expect(insertTableColumn(source, 0, true)).toBe(source);
      expect(patchTableSource(source, { cell: { row: 0, column: 0, content: "Edited" } })).toContain("Edited & B");
    }
  });
});
