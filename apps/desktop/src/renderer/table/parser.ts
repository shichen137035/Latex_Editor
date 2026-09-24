import type { TableBorder, TableCell, TableColumn, TableObject, TableRow, TableSourceRange, TabularObject } from "./model.js";

function balancedArgument(source: string, opening: number): { value: string; range: TableSourceRange; end: number } | undefined {
  if (source[opening] !== "{") return undefined;
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{" && source[index - 1] !== "\\") depth += 1;
    else if (character === "}" && source[index - 1] !== "\\") {
      depth -= 1;
      if (depth === 0) return { value: source.slice(opening + 1, index), range: { start: opening + 1, end: index }, end: index + 1 };
    }
  }
  return undefined;
}

function commandValue(source: string, command: string): string | undefined {
  return new RegExp(`\\\\${command}\\s*\\{([^{}]*)\\}`).exec(source)?.[1]?.trim();
}

function columnsFromSpec(spec: string): { columns: TableColumn[]; partial: boolean; vertical: number[] } {
  const columns: TableColumn[] = [];
  const vertical: number[] = [];
  let partial = false;
  let index = 0;
  while (index < spec.length) {
    const character = spec[index] ?? "";
    if (/\s/.test(character)) { index += 1; continue; }
    if (character === "|") { vertical.push(columns.length); index += 1; continue; }
    if ("lcr".includes(character)) {
      columns.push({ id: `column:${columns.length}`, index: columns.length, alignment: character === "l" ? "left" : character === "c" ? "center" : "right", rawSpec: character });
      index += 1; continue;
    }
    if ("pmb".includes(character) && spec[index + 1] === "{") {
      const argument = balancedArgument(spec, index + 1);
      if (!argument) { partial = true; break; }
      columns.push({ id: `column:${columns.length}`, index: columns.length, alignment: character === "p" ? "paragraph" : character === "m" ? "middle" : "bottom", width: argument.value, rawSpec: spec.slice(index, argument.end) });
      index = argument.end; continue;
    }
    if ((character === ">" || character === "<" || character === "@" || character === "!") && spec[index + 1] === "{") {
      const argument = balancedArgument(spec, index + 1);
      partial = true;
      index = argument?.end ?? spec.length; continue;
    }
    partial = true;
    const start = index;
    while (index < spec.length && !/\s|[|lcrpmb]/.test(spec[index] ?? "")) index += 1;
    if (index === start) index += 1;
    columns.push({ id: `column:${columns.length}`, index: columns.length, alignment: "custom", rawSpec: spec.slice(start, Math.max(start + 1, index)) });
  }
  return { columns, partial, vertical };
}

function splitTopLevel(source: string, separator: "&" | "row"): Array<TableSourceRange> {
  const ranges: TableSourceRange[] = [];
  let start = 0;
  let braces = 0;
  let math = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (character === "$" && source[index - 1] !== "\\") math = !math;
    if (!math && character === "{" && source[index - 1] !== "\\") braces += 1;
    else if (!math && character === "}" && source[index - 1] !== "\\") braces = Math.max(0, braces - 1);
    const ampersand = separator === "&" && character === "&" && source[index - 1] !== "\\" && braces === 0 && !math;
    const rowEnd = separator === "row" && character === "\\" && source[index + 1] === "\\" && braces === 0 && !math;
    if (!ampersand && !rowEnd) continue;
    ranges.push({ start, end: index });
    index += rowEnd ? 1 : 0;
    start = index + 1;
    if (rowEnd) while (start < source.length && source[start] === "[") {
      const close = source.indexOf("]", start + 1);
      if (close < 0) break;
      start = close + 1;
    }
  }
  if (separator === "&" || source.slice(start).trim() || !ranges.length) ranges.push({ start, end: source.length });
  return ranges;
}

const rulePattern = /\\(toprule|midrule|bottomrule|hline|cline\s*\{\d+\s*-\s*\d+\}|cmidrule(?:\([^)]*\))?\s*\{\d+\s*-\s*\d+\}|specialrule\s*\{[^}]*\}\s*\{[^}]*\}\s*\{[^}]*\})/g;

function trimRange(source: string, range: TableSourceRange): TableSourceRange {
  let { start, end } = range;
  while (start < end && /\s/.test(source[start] ?? "")) start += 1;
  while (end > start && /\s/.test(source[end - 1] ?? "")) end -= 1;
  return { start, end };
}

function cellFrom(source: string, range: TableSourceRange, row: number, column: number): TableCell {
  const trimmed = trimRange(source, range);
  const raw = source.slice(trimmed.start, trimmed.end);
  let content = raw;
  let colSpan = 1;
  let rowSpan = 1;
  let alignment: string | undefined;
  // Both nesting orders occur in real documents. Repeatedly unwrap the outer
  // command so a rectangular merge survives a parse/edit/serialise cycle.
  for (let pass = 0; pass < 2; pass += 1) {
    const multicolumn = /^\\multicolumn\s*\{(\d+)\}\s*\{([^{}]*)\}\s*\{([\s\S]*)\}$/.exec(content);
    if (multicolumn) {
      colSpan = Math.max(1, Number(multicolumn[1]));
      alignment = multicolumn[2];
      content = multicolumn[3] ?? "";
      continue;
    }
    const multirow = /^\\multirow\s*\{(\d+)\}\s*\{([^{}]*)\}\s*\{([\s\S]*)\}$/.exec(content);
    if (multirow) {
      rowSpan = Math.max(1, Number(multirow[1]));
      content = multirow[3] ?? "";
      continue;
    }
    break;
  }
  const offset = content.length ? trimmed.start + raw.lastIndexOf(content) : (colSpan > 1 || rowSpan > 1) ? trimmed.start + raw.length - (colSpan > 1 && rowSpan > 1 ? 2 : 1) : trimmed.start;
  return { id: `cell:${row}:${column}`, row, column, rowSpan, colSpan, content, ...(alignment !== undefined ? { alignment } : {}), sourceRange: { start: offset, end: offset + content.length } };
}

function parseTabular(source: string): TabularObject | undefined {
  const opening = /\\begin\{(tabular\*?|tabularx|longtable|array)\}/.exec(source);
  if (!opening) return undefined;
  const environment = opening[1] as TabularObject["environment"];
  let argumentStart = (opening.index ?? 0) + opening[0].length;
  while (/\s/.test(source[argumentStart] ?? "")) argumentStart += 1;
  if (source[argumentStart] === "[") { const close = source.indexOf("]", argumentStart); argumentStart = close < 0 ? argumentStart : close + 1; }
  while (/\s/.test(source[argumentStart] ?? "")) argumentStart += 1;
  let first = balancedArgument(source, argumentStart);
  if (!first) return undefined;
  if (environment === "tabularx") {
    argumentStart = first.end;
    while (/\s/.test(source[argumentStart] ?? "")) argumentStart += 1;
    first = balancedArgument(source, argumentStart);
    if (!first) return undefined;
  }
  const closingText = `\\end{${environment}}`;
  const bodyStart = first.end;
  const closing = source.indexOf(closingText, bodyStart);
  if (closing < 0) return undefined;
  const body = source.slice(bodyStart, closing);
  const parsedColumns = columnsFromSpec(first.value);
  const borders: TableBorder[] = parsedColumns.vertical.map((position, index) => ({ id: `border:v:${index}`, orientation: "vertical", position, start: 0, end: Number.MAX_SAFE_INTEGER, semanticRole: "custom", preferredSyntax: "custom", command: "|" }));
  const rows: TableRow[] = [];
  const cells: TableCell[] = [];
  const rowRanges = splitTopLevel(body, "row");
  for (const rawRow of rowRanges) {
    let local = body.slice(rawRow.start, rawRow.end);
    for (const match of local.matchAll(rulePattern)) {
      const command = match[1] ?? "";
      const range = { start: bodyStart + rawRow.start + (match.index ?? 0), end: bodyStart + rawRow.start + (match.index ?? 0) + match[0].length };
      const partial = /(?:c|cmid)rule/.test(command) ? /\{(\d+)\s*-\s*(\d+)\}/.exec(command) : undefined;
      const role = command.startsWith("toprule") ? "top" : command.startsWith("midrule") ? "header-separator" : command.startsWith("bottomrule") ? "bottom" : rows.length ? "body" : "top";
      borders.push({ id: `border:h:${borders.length}`, orientation: "horizontal", position: rows.length, start: partial ? Number(partial[1]) - 1 : 0, end: partial ? Number(partial[2]) : parsedColumns.columns.length, semanticRole: role, preferredSyntax: /rule/.test(command) && !command.startsWith("hline") && !command.startsWith("cline") ? "booktabs" : command.startsWith("cline") ? "cline" : "hline", command: `\\${command}`, sourceRange: range });
    }
    local = local.replace(rulePattern, (match) => " ".repeat(match.length));
    if (!local.trim() && body.slice(rawRow.end, rawRow.end + 2) !== "\\\\") continue;
    const cleanOffset = rawRow.start;
    const cellRanges = splitTopLevel(local, "&");
    const rowIndex = rows.length;
    let logicalColumn = 0;
    const rowCells = cellRanges.map((range) => {
      // Trim the masked row, not the original source containing rule commands.
      const cleanRange = trimRange(local, range);
      const cell = cellFrom(source, { start: bodyStart + cleanOffset + cleanRange.start, end: bodyStart + cleanOffset + cleanRange.end }, rowIndex, logicalColumn);
      logicalColumn += cell.colSpan;
      return cell;
    });
    const sourceRange = { start: bodyStart + rawRow.start, end: bodyStart + rawRow.end };
    rows.push({ id: `row:${rowIndex}`, index: rowIndex, role: borders.some((border) => border.position === rowIndex + 1 && border.semanticRole === "header-separator") ? "header" : "body", sourceRange, cells: rowCells });
    cells.push(...rowCells);
  }
  if (rows.length && borders.some((border) => border.semanticRole === "header-separator")) rows[0]!.role = "header";
  const diagnostics: string[] = [];
  for (const row of rows) if (row.cells.reduce((sum, cell) => sum + cell.colSpan, 0) !== parsedColumns.columns.length) diagnostics.push(`Row ${row.index + 1} has a different column count.`);
  const booktabs = borders.some((border) => border.preferredSyntax === "booktabs");
  const horizontal = borders.some((border) => border.orientation === "horizontal");
  const vertical = borders.some((border) => border.orientation === "vertical");
  const style = booktabs ? "booktabs-three-line" : vertical ? "grid" : horizontal ? "horizontal" : "plain";
  return { id: `tabular:${opening.index ?? 0}`, environment, columnSpec: first.value, columnSpecRange: first.range, columns: parsedColumns.columns, rows, cells, borders, style, sourceRange: { start: opening.index ?? 0, end: closing + closingText.length }, bodyRange: { start: bodyStart, end: closing }, editableLevel: parsedColumns.partial ? "partial" : diagnostics.length > 3 ? "source-only" : "full", diagnostics };
}

export function parseTable(source: string): TableObject | undefined {
  const outer = /\\begin\{(table\*?)\}(?:\[([^\]]*)\])?/.exec(source);
  const tabular = parseTabular(source);
  if (!tabular) return undefined;
  const environment = outer ? outer[1] as "table" | "table*" : "none";
  const endText = outer ? `\\end{${environment}}` : "";
  const endIndex = outer ? source.lastIndexOf(endText) : source.length;
  const caption = commandValue(source, "caption");
  const label = commandValue(source, "label");
  return {
    id: `table:${outer?.index ?? tabular.sourceRange.start}`,
    environment,
    ...(outer?.[2] !== undefined ? { placement: outer[2].trim() } : {}),
    alignment: /\\centering\b/.test(source) ? "center" : /\\raggedright\b/.test(source) ? "left" : /\\raggedleft\b/.test(source) ? "right" : "custom",
    ...(caption !== undefined ? { caption } : {}),
    ...(label !== undefined ? { label } : {}),
    sourceRange: { start: outer?.index ?? tabular.sourceRange.start, end: outer ? endIndex + endText.length : tabular.sourceRange.end },
    tabular
  };
}
