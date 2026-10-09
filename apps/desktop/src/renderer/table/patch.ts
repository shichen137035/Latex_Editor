import { canRestructureTable } from "./model.js";
import { latexCommandField, latexControlSequences, maskLatexComments, patchLatexCommand } from "@latex-editor/editor-core/latex-source";
import { parseTable } from "./parser.js";
import type { TablePatch } from "./model.js";
import type { TableCell, TableObject, TableStylePreset } from "./model.js";

function replaceRange(source: string, start: number, end: number, value: string): string {
  return source.slice(0, start) + value + source.slice(end);
}

/** Minimal patches preserve all unrecognised table source around the edited field. */
export function patchTableSource(source: string, patch: TablePatch): string {
  let result = source;
  let table = parseTable(result);
  if (!table) return source;
  if (patch.cell) {
    const cell = table.tabular.cells.find((item) => item.row === patch.cell?.row && item.column === patch.cell.column);
    if (cell) result = replaceRange(result, cell.sourceRange.start, cell.sourceRange.end, patch.cell.content);
  }
  table = parseTable(result);
  if (!table) return result;
  if (patch.placement !== undefined && table.environment !== "none") {
    const opening = /\\begin\{table\*?\}(?:\[([^\]]*)\])?/.exec(maskLatexComments(result));
    if (opening) {
      const current = opening[1];
      const at = (opening.index ?? 0) + opening[0].length;
      result = current !== undefined ? replaceRange(result, at - current.length - 1, at - 1, patch.placement) : replaceRange(result, at, at, patch.placement ? `[${patch.placement}]` : "");
    }
  }
  if (patch.alignment !== undefined && table.environment !== "none") {
    const desired = patch.alignment === "center" ? "\\centering" : patch.alignment === "left" ? "\\raggedright" : patch.alignment === "right" ? "\\raggedleft" : "";
    const existing = [...latexControlSequences(result)].find(token => token.environmentDepth <= 1 && ["centering", "raggedright", "raggedleft"].includes(token.name));
    if (existing) result = replaceRange(result, existing.start, existing.end, desired);
    else if (desired) {
      const opening = /\\begin\{table\*?\}(?:\[[^\]]*\])?/.exec(maskLatexComments(result));
      if (opening) { const at = opening.index + opening[0].length; result = replaceRange(result, at, at, `\n  ${desired}`); }
    }
  }
  const tabularStart = parseTable(result)?.tabular.sourceRange.start ?? result.length;
  result = patchLatexCommand(result, "caption", patch.caption, tabularStart);
  const nextTabularStart = parseTable(result)?.tabular.sourceRange.start ?? result.length;
  return patchLatexCommand(result, "label", patch.label, latexCommandField(result, "caption")?.end ?? nextTabularStart);
}

function cellSource(cell: Pick<TableCell, "content" | "colSpan" | "rowSpan" | "alignment">): string {
  let value = cell.content;
  if (cell.rowSpan > 1) value = `\\multirow{${cell.rowSpan}}{*}{${value}}`;
  if (cell.colSpan > 1) value = `\\multicolumn{${cell.colSpan}}{${cell.alignment || "c"}}{${value}}`;
  return value;
}

function styleRule(style: TableStylePreset, position: "top" | "header" | "row" | "bottom"): string | undefined {
  if (style === "booktabs-three-line") return position === "top" ? "\\toprule" : position === "header" ? "\\midrule" : position === "bottom" ? "\\bottomrule" : undefined;
  if (style === "header-bottom") return position === "top" ? "\\toprule" : position === "header" ? "\\midrule" : position === "bottom" ? "\\bottomrule" : undefined;
  if (style === "grid" || style === "horizontal") return "\\hline";
  return undefined;
}

function serializeBody(table: TableObject, rows: TableCell[][], style = table.tabular.style): string {
  const lines: string[] = [];
  const top = styleRule(style, "top");
  if (top) lines.push(`\n    ${top}`);
  rows.forEach((cells, index) => {
    lines.push(`    ${cells.map(cell => cellSource(style === "grid" && cell.colSpan > 1 ? { ...cell, alignment: `|${(cell.alignment || "c").replaceAll("|", "")}|` } : cell)).join(" & ")} \\\\`);
    const header = table.tabular.rows[index]?.role === "header";
    const rule = styleRule(style, header ? "header" : "row");
    if (rule && !(style === "header-bottom" && !header)) {
      const crossing = rows.flat().filter(cell => cell.row <= index && cell.row + cell.rowSpan > index + 1);
      if (!crossing.length) lines.push(`    ${rule}`);
      else {
        let start = -1;
        const width = cells.reduce((sum, cell) => sum + cell.colSpan, 0);
        for (let column = 0; column <= width; column += 1) {
          const free = column < width && !crossing.some(cell => cell.column <= column && cell.column + cell.colSpan > column);
          if (free && start < 0) start = column;
          if (!free && start >= 0) { lines.push(`    \\cline{${start + 1}-${column}}`); start = -1; }
        }
      }
    }
  });
  const bottom = styleRule(style, "bottom");
  if (bottom && lines.at(-1)?.trim() !== bottom) lines.push(`    ${bottom}`);
  return `${lines.join("\n")}\n  `;
}

function matrix(table: TableObject): TableCell[][] {
  return table.tabular.rows.map((row) => row.cells.map((cell) => ({ ...cell })));
}

function structuralPatch(source: string, transform: (table: TableObject, rows: TableCell[][]) => { rows: TableCell[][]; columnSpec?: string; style?: TableStylePreset } | undefined): string {
  const table = parseTable(source);
  if (!table || !canRestructureTable(table)) return source;
  const changed = transform(table, matrix(table));
  if (!changed) return source;
  let result = replaceRange(source, table.tabular.bodyRange.start, table.tabular.bodyRange.end, serializeBody(table, changed.rows, changed.style));
  if (changed.columnSpec !== undefined) {
    const reparsed = parseTable(result);
    if (reparsed) result = replaceRange(result, reparsed.tabular.columnSpecRange.start, reparsed.tabular.columnSpecRange.end, changed.columnSpec);
  }
  return result;
}

function emptyCell(row: number, column: number): TableCell {
  return { id: `cell:${row}:${column}`, row, column, rowSpan: 1, colSpan: 1, content: "", sourceRange: { start: 0, end: 0 } };
}

/** Work with visible anchors; covered TeX placeholders are rebuilt afterwards. */
function anchorsOf(table: TableObject): TableCell[] {
  return table.tabular.cells.filter(cell => !table.tabular.cells.some(other =>
    other.row < cell.row && other.row + other.rowSpan > cell.row &&
    other.column <= cell.column && other.column + other.colSpan > cell.column)).map(cell => ({ ...cell }));
}

function rowsFromAnchors(anchors: TableCell[], rowCount: number, columnCount: number): TableCell[][] {
  return Array.from({ length: rowCount }, (_, row) => {
    const cells: TableCell[] = [];
    for (let column = 0; column < columnCount;) {
      const anchor = anchors.find(cell => cell.row === row && cell.column === column);
      cells.push(anchor ?? emptyCell(row, column));
      column += anchor?.colSpan ?? 1;
    }
    return cells;
  });
}

function resizeTable(source: string, axis: "row" | "column", index: number, remove: boolean): string {
  return structuralPatch(source, table => {
    const count = axis === "row" ? table.tabular.rows.length : table.tabular.columns.length;
    if (index < 0 || index > count || (remove && (count <= 1 || index === count))) return undefined;
    const spanKey = axis === "row" ? "rowSpan" : "colSpan";
    const anchors = anchorsOf(table).filter(cell => {
      const start = cell[axis];
      const end = start + cell[spanKey];
      if (remove) {
        if (start === index && cell[spanKey] === 1) return false;
        if (start > index) cell[axis] -= 1;
        else if (end > index) cell[spanKey] -= 1;
      } else {
        if (start >= index) cell[axis] += 1;
        else if (end > index) cell[spanKey] += 1;
      }
      return true;
    });
    const delta = remove ? -1 : 1;
    const rows = rowsFromAnchors(anchors, table.tabular.rows.length + (axis === "row" ? delta : 0), table.tabular.columns.length + (axis === "column" ? delta : 0));
    if (axis === "row") return { rows };
    const specs = table.tabular.columns.map(column => column.rawSpec);
    if (remove) specs.splice(index, 1); else specs.splice(index, 0, "c");
    return { rows, columnSpec: table.tabular.style === "grid" ? `|${specs.join("|")}|` : specs.join("") };
  });
}

export function insertTableRow(source: string, rowIndex: number, after: boolean): string {
  return resizeTable(source, "row", rowIndex + (after ? 1 : 0), false);
}
export function deleteTableRow(source: string, rowIndex: number): string {
  return resizeTable(source, "row", rowIndex, true);
}
export function insertTableColumn(source: string, columnIndex: number, after: boolean): string {
  return resizeTable(source, "column", columnIndex + (after ? 1 : 0), false);
}
export function deleteTableColumn(source: string, columnIndex: number): string {
  return resizeTable(source, "column", columnIndex, true);
}

export function setTableColumnAlignment(source: string, columnIndex: number, alignment: "l" | "c" | "r"): string {
  const table = parseTable(source);
  if (!table || !canRestructureTable(table) || !Number.isInteger(columnIndex) || !table.tabular.columns[columnIndex]) return source;
  let cursor = 0;
  for (const column of table.tabular.columns) {
    const start = table.tabular.columnSpec.indexOf(column.rawSpec, cursor);
    if (start < 0) return source;
    if (column.index === columnIndex) return replaceRange(source, table.tabular.columnSpecRange.start + start, table.tabular.columnSpecRange.start + start + column.rawSpec.length, alignment);
    cursor = start + column.rawSpec.length;
  }
  return source;
}

export function setTableStyle(source: string, style: TableStylePreset): string {
  return structuralPatch(source, (table, rows) => {
    const plainSpecs = table.tabular.columns.map((column) => column.rawSpec.replaceAll("|", ""));
    return { rows, style, columnSpec: style === "grid" ? `|${plainSpecs.join("|")}|` : plainSpecs.join("") };
  });
}

export function mergeTableCellRight(source: string, rowIndex: number, columnIndex: number): string {
  return structuralPatch(source, (_table, rows) => {
    const row = rows[rowIndex];
    const at = row?.findIndex(cell => cell.column === columnIndex) ?? -1;
    const cell = row?.[at];
    const next = row?.[at + 1];
    if (!row || !cell || !next || cell.rowSpan > 1 || next.rowSpan > 1) return undefined;
    cell.content = [cell.content, next.content].filter(Boolean).join(" "); cell.colSpan += next.colSpan; row.splice(at + 1, 1);
    return { rows };
  });
}

/** Merge a rectangular Preview selection without discarding cell contents. */
export function mergeTableCells(source: string, startRow: number, startColumn: number, endRow: number, endColumn: number): string {
  return structuralPatch(source, (table, rows) => {
    const top = Math.min(startRow, endRow);
    const bottom = Math.max(startRow, endRow);
    const left = Math.min(startColumn, endColumn);
    const right = Math.max(startColumn, endColumn);
    if (top === bottom && left === right) return undefined;
    if (table.tabular.cells.some(cell => (cell.colSpan > 1 || cell.rowSpan > 1) && cell.row <= bottom && cell.row + cell.rowSpan > top && cell.column <= right && cell.column + cell.colSpan > left)) return undefined;
    const selected: TableCell[] = [];
    for (let rowIndex = top; rowIndex <= bottom; rowIndex += 1) {
      for (let columnIndex = left; columnIndex <= right; columnIndex += 1) {
        const cell = rows[rowIndex]?.find((candidate) => candidate.column === columnIndex);
        if (!cell || cell.colSpan !== 1 || cell.rowSpan !== 1) return undefined;
        selected.push(cell);
      }
    }
    const anchorRow = rows[top];
    const anchorIndex = anchorRow?.findIndex((cell) => cell.column === left) ?? -1;
    if (!anchorRow || anchorIndex < 0) return undefined;
    const anchor = anchorRow[anchorIndex]!;
    anchor.content = selected.map((cell) => cell.content.trim()).filter(Boolean).join(" ");
    anchor.colSpan = right - left + 1;
    anchor.rowSpan = bottom - top + 1;
    anchor.alignment ||= "c";
    anchorRow.splice(anchorIndex + 1, right - left);
    // Lower rows keep empty placeholders because TeX still needs their '&'
    // separators. Preview suppresses those positions underneath the multirow.
    for (let rowIndex = top + 1; rowIndex <= bottom; rowIndex += 1) {
      for (let columnIndex = left; columnIndex <= right; columnIndex += 1) {
        const cell = rows[rowIndex]?.find((candidate) => candidate.column === columnIndex);
        if (cell) cell.content = "";
      }
    }
    return { rows };
  });
}

export function splitTableCell(source: string, rowIndex: number, columnIndex: number): string {
  return structuralPatch(source, (_table, rows) => {
    const row = rows[rowIndex];
    const cellIndex = row?.findIndex((candidate) => candidate.column === columnIndex) ?? -1;
    const cell = cellIndex >= 0 ? row?.[cellIndex] : undefined;
    if (!row || !cell || (cell.colSpan <= 1 && cell.rowSpan <= 1)) return undefined;
    const columnSpan = cell.colSpan;
    cell.colSpan = 1;
    cell.rowSpan = 1;
    row.splice(cellIndex + 1, 0, ...Array.from({ length: columnSpan - 1 }, (_, offset) => emptyCell(rowIndex, columnIndex + offset + 1)));
    return { rows };
  });
}

/** Split every merged anchor intersecting a selected rectangle. */
export function splitTableCells(source: string, startRow: number, startColumn: number, endRow: number, endColumn: number): string {
  let result = source;
  const top = Math.min(startRow, endRow);
  const bottom = Math.max(startRow, endRow);
  const left = Math.min(startColumn, endColumn);
  const right = Math.max(startColumn, endColumn);
  const table = parseTable(source);
  if (!table || table.tabular.editableLevel !== "full") return source;
  const anchors = table.tabular.cells.filter((cell) => cell.row >= top && cell.row <= bottom && cell.column >= left && cell.column <= right && (cell.colSpan > 1 || cell.rowSpan > 1));
  for (const cell of anchors.reverse()) result = splitTableCell(result, cell.row, cell.column);
  return result;
}
