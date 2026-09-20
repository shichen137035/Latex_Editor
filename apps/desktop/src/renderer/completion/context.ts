/** The deterministic completion modes supported by v0.2.5. */
import { parseMathNodes } from "../math/MathNodeLocator.js";

export type CompletionMode = "command" | "environment" | "reference" | "citation" | "tex-file" | "image-file" | "bib-file" | "document-word" | "math-symbol" | "unknown";

export interface CompletionContext {
  mode: CompletionMode;
  prefix: string;
  startColumn: number;
  command?: string;
}

interface LineModel {
  getLineContent(lineNumber: number): string;
  getValue?(): string;
  getOffsetAt?(position: CursorPosition): number;
  getVersionId?(): number;
}

interface CursorPosition {
  lineNumber: number;
  column: number;
}

function tokenContext(mode: CompletionMode, command: string | undefined, line: string, prefix: string): CompletionContext {
  return { mode, prefix, startColumn: line.length - prefix.length + 1, ...(command === undefined ? {} : { command }) };
}

/**
 * Reads only the text immediately before the cursor. This intentionally does
 * not attempt to parse all of TeX; it keeps completion predictable while
 * covering the argument forms needed by the first completion release.
 */
export function analyzeCompletionContext(model: LineModel, position: CursorPosition): CompletionContext {
  const line = model.getLineContent(position.lineNumber);
  const before = line.slice(0, Math.max(0, position.column - 1));

  const fileMatch = /\\(input|include|includegraphics|bibliography|addbibresource)\{([^{}]*)$/.exec(before);
  if (fileMatch) {
    const command = fileMatch[1];
    const mode: CompletionMode = command === "includegraphics" ? "image-file" : command === "bibliography" || command === "addbibresource" ? "bib-file" : "tex-file";
    return tokenContext(mode, command, before, fileMatch[2] ?? "");
  }

  const citationMatch = /\\([A-Za-z]*cite[A-Za-z]*)\{([^{}]*)$/.exec(before);
  if (citationMatch) {
    const segment = citationMatch[2] ?? "";
    const comma = segment.lastIndexOf(",");
    const afterComma = comma >= 0 ? segment.slice(comma + 1) : segment;
    const prefix = afterComma.trimStart();
    return tokenContext("citation", citationMatch[1], before, prefix);
  }

  const referenceMatch = /\\(eqref|autoref|ref)\{([^{}]*)$/.exec(before);
  if (referenceMatch) {
    const segment = referenceMatch[2] ?? "";
    const comma = segment.lastIndexOf(",");
    const afterComma = comma >= 0 ? segment.slice(comma + 1) : segment;
    return tokenContext("reference", referenceMatch[1], before, afterComma.trimStart());
  }

  const environmentMatch = /\\begin\{([^{}]*)$/.exec(before);
  if (environmentMatch) return tokenContext("environment", "begin", before, environmentMatch[1] ?? "");

  const commandMatch = /\\([A-Za-z@]*)$/.exec(before);
  if (commandMatch) return tokenContext("command", undefined, before, commandMatch[1] ?? "");

  return { mode: "unknown", prefix: "", startColumn: position.column };
}

function isInsideMath(before: string): boolean {
  let dollarCount = 0;
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] === "$" && before[index - 1] !== "\\") dollarCount += 1;
  }
  if (dollarCount % 2 === 1) return true;
  const mathStart = Math.max(before.lastIndexOf("\\("), before.lastIndexOf("\\["));
  const mathEnd = Math.max(before.lastIndexOf("\\)"), before.lastIndexOf("\\]"));
  return mathStart > mathEnd;
}

const mathNodeCache = new WeakMap<object, { version: number; source: string; nodes: ReturnType<typeof parseMathNodes> }>();

function cachedMathNodes(model: LineModel, source: string): ReturnType<typeof parseMathNodes> {
  const cacheKey = model as object;
  const version = model.getVersionId?.() ?? -1;
  const cached = mathNodeCache.get(cacheKey);
  if (cached && cached.version === version && cached.source === source) return cached.nodes;
  const nodes = parseMathNodes(source);
  mathNodeCache.set(cacheKey, { version, source, nodes });
  return nodes;
}

function mathAtPosition(model: LineModel, position: CursorPosition): boolean {
  if (model.getValue && model.getOffsetAt) {
    const source = model.getValue();
    const offset = model.getOffsetAt(position);
    if (cachedMathNodes(model, source).some((node) => node.contentStart <= offset && offset <= node.contentEnd)) return true;
  }
  const line = model.getLineContent(position.lineNumber);
  return isInsideMath(line.slice(0, Math.max(0, position.column - 1)));
}

/** Chooses exactly one lightweight lexical completion domain at the cursor. */
export function analyzeLexicalCompletionContext(model: LineModel, position: CursorPosition, documentWordsEnabled = true): CompletionContext {
  const line = model.getLineContent(position.lineNumber);
  const before = line.slice(0, Math.max(0, position.column - 1));
  const math = mathAtPosition(model, position);
  const token = /([\p{L}][\p{L}\p{N}_]*)$/u.exec(before)?.[1];
  if (math) return token ? tokenContext("math-symbol", undefined, before, token) : { mode: "unknown", prefix: "", startColumn: position.column };
  if (!documentWordsEnabled) return { mode: "unknown", prefix: "", startColumn: position.column };
  const word = /([\p{L}\p{N}][\p{L}\p{N}'’_-]*)$/u.exec(before)?.[1];
  return word ? tokenContext("document-word", undefined, before, word) : { mode: "unknown", prefix: "", startColumn: position.column };
}

/** Identifies a natural-language word only after semantic LaTeX contexts fail. */
export function analyzeDocumentWordContext(model: LineModel, position: CursorPosition): CompletionContext {
  const context = analyzeLexicalCompletionContext(model, position, true);
  return context.mode === "document-word" ? context : { mode: "unknown", prefix: "", startColumn: position.column };
}

export function analyzeMathSymbolContext(model: LineModel, position: CursorPosition): CompletionContext {
  const context = analyzeLexicalCompletionContext(model, position, false);
  return context.mode === "math-symbol" ? context : { mode: "unknown", prefix: "", startColumn: position.column };
}
