import type { TablePreferences, TableStylePreset } from "@latex-editor/contracts";

export interface TableInsertOptions {
  rows: number;
  columns: number;
  style: TableStylePreset;
  headerRow: boolean;
  addCaption: boolean;
  addLabel: boolean;
}

export interface TableInsertion { text: string; cursorOffset: number; requiredPackages: string[] }

function alignmentCommand(alignment: TablePreferences["defaultInsert"]["alignment"]): string {
  return alignment === "center" ? "\\centering" : alignment === "left" ? "\\raggedright" : "\\raggedleft";
}

function columnSpec(columns: number, style: TableStylePreset): string {
  const base = Array.from({ length: columns }, (_, index) => index === 0 ? "l" : "c");
  return style === "grid" ? `|${base.join("|")}|` : base.join("");
}

export function tableInsertion(options: TableInsertOptions, preferences: TablePreferences): TableInsertion {
  const rows = Math.max(1, Math.min(100, Math.floor(options.rows)));
  const columns = Math.max(1, Math.min(30, Math.floor(options.columns)));
  const style = options.style;
  const lines = [`\\begin{table}[${preferences.defaultInsert.placement}]`, `  ${alignmentCommand(preferences.defaultInsert.alignment)}`];
  let cursorOffset = 0;
  if (options.addCaption) { lines.push("  \\caption{}"); cursorOffset = lines.join("\n").length - 1; }
  if (options.addLabel) lines.push(`  \\label{${preferences.labelPrefix}:table}`);
  lines.push("", `  \\begin{tabular}{${columnSpec(columns, style)}}`);
  if (style === "booktabs-three-line" || style === "header-bottom") lines.push("    \\toprule");
  else if (style === "grid" || style === "horizontal") lines.push("    \\hline");
  for (let row = 0; row < rows; row += 1) {
    const cells = Array.from({ length: columns }, (_, column) => options.headerRow && row === 0 ? `Column ${column + 1}` : "");
    lines.push(`    ${cells.join(" & ")} \\\\`);
    if (row === 0 && options.headerRow) {
      if (style === "booktabs-three-line") lines.push("    \\midrule");
      else if (style === "grid" || style === "horizontal" || style === "header-bottom") lines.push("    \\hline");
    } else if (style === "grid" || style === "horizontal") lines.push("    \\hline");
  }
  if (style === "booktabs-three-line" || style === "header-bottom") lines.push("    \\bottomrule");
  lines.push("  \\end{tabular}", "\\end{table}");
  const text = lines.join("\n");
  if (!cursorOffset) {
    const firstCell = text.indexOf(options.headerRow ? "Column 1" : "", text.indexOf("\\begin{tabular}"));
    cursorOffset = Math.max(0, firstCell);
  }
  return { text, cursorOffset, requiredPackages: style === "booktabs-three-line" || style === "header-bottom" ? ["booktabs"] : [] };
}

export function hasLatexPackage(source: string, packageName: string): boolean {
  return [...source.matchAll(/\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g)].some((match) => (match[1] ?? "").split(",").map((item) => item.trim()).includes(packageName));
}

export function addLatexPackage(source: string, packageName: string): { source: string; insertedAt: number; length: number } {
  if (hasLatexPackage(source, packageName)) return { source, insertedAt: 0, length: 0 };
  const documentClass = /\\documentclass(?:\[[^\]]*\])?\{[^}]+\}\s*/.exec(source);
  const insertedAt = documentClass ? (documentClass.index ?? 0) + documentClass[0].length : 0;
  const text = `\\usepackage{${packageName}}\n`;
  return { source: source.slice(0, insertedAt) + text + source.slice(insertedAt), insertedAt, length: text.length };
}

export function uniqueTableLabel(insertion: TableInsertion, documentSource: string): TableInsertion {
  const match = /\\label\{([^{}]+)\}/.exec(insertion.text);
  if (!match?.[1]) return insertion;
  const used = new Set([...documentSource.matchAll(/\\label\{([^{}]+)\}/g)].map((item) => item[1] ?? ""));
  const base = match[1];
  let label = base;
  let suffix = 2;
  while (used.has(label)) { label = `${base}-${suffix}`; suffix += 1; }
  return { ...insertion, text: insertion.text.replace(`\\label{${base}}`, `\\label{${label}}`) };
}
