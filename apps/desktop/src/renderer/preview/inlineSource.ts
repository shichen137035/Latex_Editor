/** Lossless, block-local presentation tokens. All offsets use Monaco's UTF-16 units. */
export interface InlineSourceToken {
  kind: "text" | "format" | "math" | "citation" | "reference" | "algorithm";
  value: string;
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  command?: string;
  display?: boolean;
  /** Generated spaces/punctuation and mathematical layouts are not character maps. */
  atomic?: boolean;
  children?: InlineSourceToken[];
}

const formatCommands = new Set(["textbf", "textit", "emph", "texttt", "textrm", "textnormal"]);
const argumentCommands = new Set(["caption", "section", "subsection", "subsubsection"]);
const algorithmCommands = new Set("IF ELSE ELSIF ENDIF FOR ENDFOR WHILE ENDWHILE REPEAT UNTIL STATE RETURN PRINT COMMENT REQUIRE ENSURE PROCEDURE ENDPROCEDURE FUNCTION ENDFUNCTION INPUT OUTPUT".split(" "));

function escaped(value: string, offset: number): boolean {
  let count = 0;
  while (offset > 0 && value[--offset] === "\\") count++;
  return count % 2 === 1;
}

function argumentAt(value: string, offset: number): { start: number; end: number; next: number } | undefined {
  while (/\s/.test(value[offset] ?? "") && offset < value.length) offset++;
  if (value[offset] !== "{") return undefined;
  const start = offset + 1;
  let depth = 1;
  for (let cursor = start; cursor < value.length; cursor++) {
    if (value[cursor] === "\\") { cursor++; continue; }
    if (value[cursor] === "%") { const newline = value.indexOf("\n", cursor); if (newline < 0) return undefined; cursor = newline; continue; }
    if (value[cursor] === "{") depth++;
    else if (value[cursor] === "}" && --depth === 0) return { start, end: cursor, next: cursor + 1 };
  }
  return undefined;
}

/** Tokenize only the clicked/rendered block slice, never search the document for its text. */
export function tokenizeInlineSource(value: string, sourceStart = 0, trim = true, depth = 0): InlineSourceToken[] {
  const tokens: InlineSourceToken[] = [];
  const from = trim ? value.length - value.trimStart().length : 0;
  const limit = trim ? value.trimEnd().length : value.length;
  let cursor = from;
  let textStart = cursor;
  const flush = (end: number) => {
    if (end > textStart) tokens.push({ kind: "text", value: value.slice(textStart, end), start: sourceStart + textStart, end: sourceStart + end, contentStart: sourceStart + textStart, contentEnd: sourceStart + end });
  };
  const emit = (kind: InlineSourceToken["kind"], end: number, contentStart: number, contentEnd: number, options: Partial<InlineSourceToken> = {}) => {
    flush(cursor);
    tokens.push({ kind, value: value.slice(contentStart, contentEnd), start: sourceStart + cursor, end: sourceStart + end, contentStart: sourceStart + contentStart, contentEnd: sourceStart + contentEnd, ...options });
    cursor = end;
    textStart = end;
  };
  while (cursor < limit) {
    if (value[cursor] === "%") {
      flush(cursor);
      const newline = value.indexOf("\n", cursor);
      cursor = newline < 0 ? limit : Math.min(limit, newline);
      textStart = cursor;
      continue;
    }
    const opening = value[cursor] === "$" ? (value[cursor + 1] === "$" ? "$$" : "$") : value.startsWith("\\(", cursor) ? "\\(" : value.startsWith("\\[", cursor) ? "\\[" : undefined;
    if (opening) {
      const closing = opening === "\\(" ? "\\)" : opening === "\\[" ? "\\]" : opening;
      let end = value.indexOf(closing, cursor + opening.length);
      while (end >= 0 && escaped(value, end)) end = value.indexOf(closing, end + closing.length);
      // Inline math may span source lines. TeX treats a newline as whitespace
      // here, and rejecting it leaves the delimiters rendered as plain text.
      if (end >= 0 && end < limit) {
        const inner = value.slice(cursor + opening.length, end);
        const left = inner.length - inner.trimStart().length;
        const right = Math.max(left, inner.trimEnd().length);
        emit("math", end + closing.length, cursor + opening.length + left, cursor + opening.length + right, { atomic: true, display: opening === "$$" || opening === "\\[" });
        continue;
      }
    }
    if (value[cursor] !== "\\") { cursor++; continue; }
    const symbol = value[cursor + 1];
    if (symbol && /[%&_#$]/.test(symbol)) {
      emit("text", cursor + 2, cursor + 1, cursor + 2);
      continue;
    }
    const commandMatch = /^\\([A-Za-z]+)\*?/.exec(value.slice(cursor));
    if (!commandMatch) {
      if (symbol === ",") emit("text", cursor + 2, cursor, cursor + 2, { value: " ", atomic: true });
      else cursor += Math.min(2, limit - cursor);
      continue;
    }
    const command = commandMatch[1]!;
    const argument = argumentAt(value, cursor + commandMatch[0].length);
    if (argument && ["label", "begin", "end"].includes(command)) {
      flush(cursor); cursor = argument.next; textStart = cursor; continue;
    }
    if (argument && (formatCommands.has(command) || argumentCommands.has(command)) && depth < 32) {
      const children = tokenizeInlineSource(value.slice(argument.start, argument.end), sourceStart + argument.start, false, depth + 1);
      emit("format", argument.next, argument.start, argument.end, { command, children });
      continue;
    }
    if (argument && /^(?:[A-Za-z]*cite[A-Za-z]*|[A-Za-z]*ref[A-Za-z]*)$/.test(command)) {
      emit(command.includes("cite") ? "citation" : "reference", argument.next, argument.start, argument.end, { command, atomic: true });
      continue;
    }
    if (algorithmCommands.has(command.toUpperCase())) {
      const children = argument && depth < 32 ? tokenizeInlineSource(value.slice(argument.start, argument.end), sourceStart + argument.start, false, depth + 1) : undefined;
      emit("algorithm", argument?.next ?? cursor + commandMatch[0].length, argument?.start ?? cursor, argument?.end ?? cursor, { command, ...(children ? { children } : {}), atomic: true });
      continue;
    }
    if (command === "quad" || command === "qquad") { emit("text", cursor + commandMatch[0].length, cursor, cursor + commandMatch[0].length, { value: "  ", atomic: true }); continue; }
    cursor += commandMatch[0].length;
  }
  flush(limit);
  return tokens;
}

/** Direct character offset for literal text; deterministic content anchor for atoms. */
export function inlineTokenSourceOffset(token: InlineSourceToken, textOffset: number): number {
  return token.atomic ? token.contentStart : Math.min(token.contentEnd, token.contentStart + Math.max(0, textOffset));
}
