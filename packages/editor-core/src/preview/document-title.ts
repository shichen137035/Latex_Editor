import { latexControlSequences, maskLatexComments, readLatexGroup } from "../latex-source.js";

const titleMetadata = new Set(["title", "author", "date", "subtitle", "affil", "affiliation", "institute", "address", "email", "thanks"]);

/** Preserve the raw title region; publisher-specific formatting stays in TeX. */
export function documentTitleRegion(source: string, documentStart: number, documentEnd: number) {
  const masked = maskLatexComments(source);
  const values = new Map<string, string>();
  let first: number | undefined, bodyStart: number | undefined;
  let cursor = 0, braces = 0;
  for (const token of latexControlSequences(masked)) {
    if (token.start >= documentEnd) break;
    while (cursor < token.start) {
      const character = masked[cursor++];
      if (character === "\\") cursor++;
      else if (character === "{") braces++;
      else if (character === "}") braces = Math.max(0, braces - 1);
    }
    cursor = token.end;
    if (braces || token.environmentDepth > 1) continue;
    if (token.name === "maketitle" && token.start >= documentStart) {
      let end = token.end;
      const optionalStart = end + (masked.slice(end).match(/^\s*/)?.[0].length ?? 0);
      if (masked[optionalStart] === "[") end = (readLatexGroup(masked, optionalStart, "[", "]")?.end ?? end - 1) + 1;
      return { start: first ?? token.start, end, bodyStart: bodyStart ?? token.start,
        ...(values.has("title") ? { title: values.get("title")! } : {}),
        ...(values.has("author") ? { author: values.get("author")! } : {}),
        date: values.get("date") ?? "\\today" };
    }
    if (!titleMetadata.has(token.name)) continue;
    first ??= token.start;
    if (token.start >= documentStart) bodyStart ??= token.start;
    let argumentStart = token.end;
    if (masked[argumentStart] === "*") argumentStart++;
    while (argumentStart < masked.length && /\s/.test(masked[argumentStart]!)) argumentStart++;
    if (masked[argumentStart] === "[") {
      const optional = readLatexGroup(masked, argumentStart, "[", "]");
      if (!optional) continue;
      argumentStart = optional.end + 1;
      while (argumentStart < masked.length && /\s/.test(masked[argumentStart]!)) argumentStart++;
    }
    const argument = readLatexGroup(masked, argumentStart);
    if (argument && ["title", "author", "date"].includes(token.name)) values.set(token.name, source.slice(argument.start, argument.end).trim());
  }
  return undefined;
}
