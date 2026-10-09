export function commentedOnLine(line: string, index: number): boolean {
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (line[cursor] === "\\") cursor += 1;
    else if (line[cursor] === "%") return true;
  }
  return false;
}

/** Only expose a source reference as a link when an uncommented destination exists. */
export function sourceReferenceAtOffset(source: string, offset: number) {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const nextLine = source.indexOf("\n", offset);
  const line = source.slice(lineStart, nextLine < 0 ? source.length : nextLine);
  const local = offset - lineStart;
  for (const match of line.matchAll(/(?<!\\)\\(eqref|autoref|ref|pageref|nameref|cref|Cref|vref|Vref)\*?\s*\{([^}\n]+)\}/g)) {
    const start = match.index!;
    if (local < start || local >= start + match[0].length || commentedOnLine(line, start)) continue;
    const label = match[2]!.split(",")[0]!.trim();
    for (const target of source.matchAll(/(?<!\\)\\label\s*\{([^}\n]+)\}/g)) {
      if (target[1]?.trim() !== label) continue;
      const targetStart = target.index!;
      const targetLineStart = source.lastIndexOf("\n", targetStart - 1) + 1;
      if (commentedOnLine(source.slice(targetLineStart, targetStart), targetStart - targetLineStart)) continue;
      return { label, offset: lineStart + start, text: match[0], targetOffset: targetStart };
    }
  }
  return undefined;
}
