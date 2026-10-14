import { maskLatexComments, readLatexGroup } from "@latex-editor/editor-core/latex-source";

export interface LatexFold { start: number; end: number }
const sectionLevels: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };
const rawEnvironments = new Set(["verbatim", "verbatim*", "Verbatim", "lstlisting", "minted", "comment", "filecontents", "filecontents*"]);

/** Matched LaTeX boundaries, independent of indentation, including custom environments. */
export function latexFoldingRanges(source: string): LatexFold[] {
  const masked = maskLatexComments(source);
  const lineStarts = [0];
  for (let index = 0; index < source.length; index++) if (source[index] === "\n") lineStarts.push(index + 1);
  const lineAt = (offset: number) => {
    let low = 0, high = lineStarts.length;
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (lineStarts[middle]! <= offset) low = middle; else high = middle; }
    return low + 1;
  };
  const folds: LatexFold[] = [];
  const add = (start: number, end: number) => { if (end > start) folds.push({ start, end }); };
  const environments: Array<{ name: string; line: number }> = [];
  const sections: Array<{ level: number; line: number; depth: number }> = [];
  const braces: number[] = [];
  let math: { delimiter: string; line: number } | undefined;
  const tokens = /\\(?:([A-Za-z@]+)\*?|[^A-Za-z@])|\$\$?|[{}]/g;
  for (let token = tokens.exec(masked); token; token = tokens.exec(masked)) {
    const text = token[0], name = token[1], line = lineAt(token.index);
    if (text === "$" || text === "$$" || text === "\\[" || text === "\\(" || text === "\\]" || text === "\\)") {
      if (math && ((math.delimiter.startsWith("$") && text === math.delimiter) || (math.delimiter === "\\[" && text === "\\]") || (math.delimiter === "\\(" && text === "\\)"))) {
        if (math.delimiter === "$$" || math.delimiter === "\\[") add(math.line, line);
        math = undefined;
      } else if (!math && (text === "$" || text === "$$" || text === "\\[" || text === "\\(")) math = { delimiter: text, line };
      continue;
    }
    if (math) continue;
    if (name === "verb") {
      const delimiter = source[tokens.lastIndex];
      const end = delimiter && !/\s/.test(delimiter) ? source.indexOf(delimiter, tokens.lastIndex + 1) : -1;
      const nextLine = source.indexOf("\n", tokens.lastIndex);
      if (end >= 0 && (nextLine < 0 || end < nextLine)) tokens.lastIndex = end + 1;
      continue;
    }
    if (text === "{") { braces.push(line); continue; }
    if (text === "}") { const start = braces.pop(); if (start !== undefined) add(start, line); continue; }
    if (!name) continue;
    if (name === "begin" || name === "end") {
      let opening = tokens.lastIndex;
      while (/\s/.test(masked[opening] ?? "") && opening < masked.length) opening++;
      const argument = readLatexGroup(masked, opening);
      if (!argument) continue;
      const environment = argument.value.trim();
      tokens.lastIndex = argument.end + 1;
      if (name === "begin") {
        if (rawEnvironments.has(environment)) {
          const closing = new RegExp(`\\\\end\\s*\\{${environment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}`, "g");
          closing.lastIndex = tokens.lastIndex;
          const end = closing.exec(source);
          if (!end) break;
          add(line, lineAt(end.index)); tokens.lastIndex = closing.lastIndex;
        } else environments.push({ name: environment, line });
      } else {
        const index = environments.map(item => item.name).lastIndexOf(environment);
        if (index < 0) continue;
        while (sections.length && sections.at(-1)!.depth > index) add(sections.pop()!.line, line - 1);
        add(environments[index]!.line, line);
        environments.splice(index);
      }
      continue;
    }
    const level = sectionLevels[name];
    if (level === undefined || braces.length) continue;
    while (sections.length && sections.at(-1)!.level >= level && sections.at(-1)!.depth >= environments.length) add(sections.pop()!.line, line - 1);
    sections.push({ level, line, depth: environments.length });
  }
  while (sections.length) add(sections.pop()!.line, lineStarts.length);
  const byStart = new Map<number, LatexFold>();
  for (const fold of folds) if (!byStart.has(fold.start) || byStart.get(fold.start)!.end < fold.end) byStart.set(fold.start, fold);
  return [...byStart.values()].sort((a, b) => a.start - b.start);
}
