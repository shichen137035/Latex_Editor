/** Hide unescaped comments while preserving UTF-16 offsets and line endings. */
export function maskLatexComments(source: string): string {
  return source.replace(/\\[\s\S]|%[^\r\n]*/g, token => token.startsWith("%") ? " ".repeat(token.length) : token);
}

export interface LatexSourceField { start: number; end: number; value: string }

/** Read a balanced argument in comment-masked source, preserving offsets and escaped delimiters. */
export function readLatexGroup(source: string, opening: number, left = "{", right = "}"): LatexSourceField | undefined {
  if (source[opening] !== left) return;
  let depth = 1, braces = 0;
  for (let index = opening + 1; index < source.length; index++) {
    if (source[index] === "\\") { index++; continue; }
    if (left === "[" && source[index] === "{") braces++;
    if (left === "[" && source[index] === "}") braces--;
    if (braces > 0) continue;
    if (source[index] === left) depth++;
    if (source[index] === right && --depth === 0) return { start: opening + 1, end: index, value: source.slice(opening + 1, index) };
  }
}

export function* latexControlSequences(source: string): Generator<{ name: string; start: number; end: number; environmentDepth: number }> {
  const masked = maskLatexComments(source);
  let depth = 0;
  for (const match of masked.matchAll(/\\(?:([A-Za-z@]+)\*?|[^A-Za-z@])/g)) {
    const name = match[1];
    if (!name) continue;
    yield { name, start: match.index, end: match.index + match[0].length, environmentDepth: depth };
    if ((name === "begin" || name === "end") && /^\s*\{[^{}]+\}/.test(masked.slice(match.index + match[0].length))) depth = Math.max(0, depth + (name === "begin" ? 1 : -1));
  }
}

/** Metadata belongs to the outer float, not nested subfigures, tabular cells or commented examples. */
export function latexCommandField(source: string, command: string): (LatexSourceField & { body: LatexSourceField }) | undefined {
  const masked = maskLatexComments(source);
  for (const token of latexControlSequences(masked)) {
    if (token.name !== command || token.environmentDepth > 1) continue;
    let cursor = token.end;
    while (cursor < masked.length && /\s/.test(masked[cursor]!)) cursor++;
    if (masked[cursor] === "[") {
      const short = readLatexGroup(masked, cursor, "[", "]");
      if (!short) continue;
      cursor = short.end + 1;
      while (cursor < masked.length && /\s/.test(masked[cursor]!)) cursor++;
    }
    const body = readLatexGroup(masked, cursor);
    if (body) return { start: token.start, end: body.end + 1, value: source.slice(token.start, body.end + 1), body: { ...body, value: source.slice(body.start, body.end) } };
  }
}

export function patchLatexCommand(source: string, command: string, value: string | undefined, before: number): string {
  if (value === undefined) return source;
  const field = latexCommandField(source, command);
  if (field) return source.slice(0, field.body.start) + value + source.slice(field.body.end);
  return value ? source.slice(0, before) + `  \\${command}{${value}}\n` + source.slice(before) : source;
}
