import { sourceLabelOffset, type ReferenceTarget } from "./ProjectReferenceIndex.js";

export function commentedOnLine(line: string, index: number): boolean {
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (line[cursor] === "\\") cursor += 1;
    else if (line[cursor] === "%") return true;
  }
  return false;
}

/** Only expose a source reference as a link when an uncommented destination exists. */
export function sourceReferenceAtOffset(source: string, offset: number, resolve?: (label: string) => ReferenceTarget | undefined) {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const nextLine = source.indexOf("\n", offset);
  const line = source.slice(lineStart, nextLine < 0 ? source.length : nextLine);
  const local = offset - lineStart;
  for (const match of line.matchAll(/(?<!\\)\\(eqref|autoref|ref|pageref|nameref|cref|Cref|vref|Vref)\*?\s*\{([^}\n]+)\}/g)) {
    const start = match.index!;
    if (local < start || local >= start + match[0].length || commentedOnLine(line, start)) continue;
    const values = match[2]!.split(",");
    const bodyStart = start + match[0].indexOf("{") + 1;
    let cursor = bodyStart;
    const chosen = values.find(value => { const end = cursor + value.length; const contains = local >= cursor && local <= end; cursor = end + 1; return contains; });
    const label = (chosen ?? values[0])!.trim();
    const target = resolve?.(label);
    const targetOffset = resolve ? target?.offset : sourceLabelOffset(source, label);
    if (targetOffset !== undefined) return { label, offset: lineStart + start, text: match[0], targetOffset, ...(target ? { targetPath: target.path, targetLabel: target.label } : {}) };
  }
  return undefined;
}
