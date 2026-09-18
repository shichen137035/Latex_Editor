export interface TextSegment {
  text: string;
  sourceStart: number;
  sourceEnd: number;
}

export interface ExtractedLatexText {
  segments: TextSegment[];
  sample: string;
}

export interface ExtractedWord {
  word: string;
  sourceStart: number;
  sourceEnd: number;
}

const ignoredArgumentCommands = new Set([
  "label", "ref", "eqref", "autoref", "cite", "citep", "citet", "parencite", "textcite", "url", "path",
  "input", "include", "includegraphics", "bibliography", "addbibresource", "usepackage", "documentclass",
  "begin", "end", "newcommand", "renewcommand", "providecommand", "newenvironment", "newtheorem"
]);
const ignoredEnvironments = ["verbatim", "verbatim*", "lstlisting", "minted", "code"];

function mark(mask: Uint8Array, start: number, end: number): void {
  for (let index = Math.max(0, start); index < Math.min(mask.length, end); index += 1) mask[index] = 0;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function skipBraceArgument(source: string, start: number): number {
  const open = source.indexOf("{", start);
  if (open < 0) return start;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return source.length;
}

function markComments(mask: Uint8Array, source: string): void {
  let lineStart = 0;
  while (lineStart < source.length) {
    const lineEnd = source.indexOf("\n", lineStart);
    const end = lineEnd < 0 ? source.length : lineEnd;
    for (let index = lineStart; index < end; index += 1) {
      if (source[index] !== "%" || (index > lineStart && source[index - 1] === "\\")) continue;
      mark(mask, index, end);
      break;
    }
    lineStart = end + 1;
  }
}

function markMath(mask: Uint8Array, source: string): void {
  for (const pattern of [/\\\[[\s\S]*?\\\]/g, /\\\([\s\S]*?\\\)/g, /(?<!\\)\$[\s\S]*?(?<!\\)\$/g]) {
    for (const match of source.matchAll(pattern)) mark(mask, match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
  for (const environment of ["equation", "equation*", "align", "align*", "gather", "multline", "displaymath", "eqnarray"]) {
    const name = escapeRegex(environment);
    const pattern = new RegExp(`\\\\begin\\{${name}\\}[\\s\\S]*?\\\\end\\{${name}\\}`, "g");
    for (const match of source.matchAll(pattern)) mark(mask, match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
}

function markCommands(mask: Uint8Array, source: string): void {
  const commandPattern = /\\[A-Za-z@]+\*?/g;
  for (const match of source.matchAll(commandPattern)) {
    const start = match.index ?? 0;
    const command = match[0].slice(1).replace(/\*$/, "");
    mark(mask, start, start + match[0].length);
    if (ignoredArgumentCommands.has(command)) mark(mask, start + match[0].length, skipBraceArgument(source, start + match[0].length));
  }
}

function markCodeEnvironments(mask: Uint8Array, source: string): void {
  for (const environment of ignoredEnvironments) {
    const name = escapeRegex(environment);
    const pattern = new RegExp(`\\\\begin\\{${name}\\}[\\s\\S]*?\\\\end\\{${name}\\}`, "gi");
    for (const match of source.matchAll(pattern)) mark(mask, match.index ?? 0, (match.index ?? 0) + match[0].length);
  }
}

/** Extracts continuous natural-language source ranges without rewriting the TeX document. */
export function extractLatexText(source: string): ExtractedLatexText {
  const mask = new Uint8Array(source.length).fill(1);
  markComments(mask, source);
  markMath(mask, source);
  markCodeEnvironments(mask, source);
  markCommands(mask, source);
  const segments: TextSegment[] = [];
  let start = -1;
  for (let index = 0; index <= source.length; index += 1) {
    if (index < source.length && mask[index] === 1) {
      if (start < 0) start = index;
      continue;
    }
    if (start >= 0 && index > start) segments.push({ text: source.slice(start, index), sourceStart: start, sourceEnd: index });
    start = -1;
  }
  return { segments, sample: segments.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim().slice(0, 4000) };
}

export function extractWords(extracted: ExtractedLatexText): ExtractedWord[] {
  const words: ExtractedWord[] = [];
  const pattern = /[\p{L}][\p{L}\p{N}'’_-]*/gu;
  for (const segment of extracted.segments) {
    for (const match of segment.text.matchAll(pattern)) {
      const word = match[0];
      if (word.length < 2) continue;
      const sourceStart = segment.sourceStart + (match.index ?? 0);
      words.push({ word, sourceStart, sourceEnd: sourceStart + word.length });
    }
  }
  return words;
}
