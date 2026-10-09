import { maskLatexComments } from "@latex-editor/editor-core/latex-source";

export interface PreviewSourceField { start: number; end: number; value: string }

function group(source: string, opening: number, left: string, right: string): PreviewSourceField | undefined {
  if (source[opening] !== left) return;
  let depth = 1, braces = 0;
  for (let index = opening + 1; index < source.length; index++) {
    if (source[index] === "\\") { index++; continue; }
    if (left === "[" && source[index] === "{") braces++;
    if (left === "[" && source[index] === "}") braces--;
    if (braces > 0) continue;
    if (source[index] === left) depth++;
    if (source[index] === right && --depth === 0) return { start: opening + 1, end: index, value: "" };
  }
}

export function environmentOptionField(source: string): PreviewSourceField | undefined {
  if (!/^\s*\\begin\b/.test(source)) return;
  const masked = maskLatexComments(source);
  const begin = /^\s*\\begin\s*\{[^{}]+\}\s*/.exec(masked);
  const field = begin && group(masked, begin[0].length, "[", "]");
  return field ? { ...field, value: source.slice(field.start, field.end) } : undefined;
}

/** A caption is a source command, not a semantic block; skip captions of nested subfigures. */
export function captionSourceField(source: string): (PreviewSourceField & { body: PreviewSourceField }) | undefined {
  const masked = maskLatexComments(source);
  let depth = 0;
  for (const match of masked.matchAll(/\\(begin|end)\s*\{[^{}]+\}|\\caption\*?(?![A-Za-z@])/g)) {
    if (match[1]) { depth += match[1] === "begin" ? 1 : -1; continue; }
    if (depth > 1) continue;
    let cursor = match.index + match[0].length;
    while (/\s/.test(masked[cursor] ?? "") && cursor < masked.length) cursor++;
    if (masked[cursor] === "[") {
      const short = group(masked, cursor, "[", "]");
      if (!short) continue;
      cursor = short.end + 1;
      while (/\s/.test(masked[cursor] ?? "") && cursor < masked.length) cursor++;
    }
    const body = group(masked, cursor, "{", "}");
    if (body) return { start: match.index, end: body.end + 1, value: source.slice(match.index, body.end + 1), body: { ...body, value: source.slice(body.start, body.end) } };
  }
}

export function replaceSourceField(source: string, field: PreviewSourceField, value: string): string | undefined {
  if (source.slice(field.start, field.end) !== field.value) return;
  return source.slice(0, field.start) + value + source.slice(field.end);
}
