import type { editor } from "monaco-editor";
import { maskLatexComments } from "@latex-editor/editor-core/latex-source";

export interface SymbolPairAction {
  kind: "edit" | "skip";
  start: number;
  end: number;
  text?: string;
  cursor: number;
  selectionEnd?: number;
}

const ordinaryPairs: Record<string, string> = { "{": "}", "(": ")", "[": "]", "$": "$" };
const closingSymbols = new Set(["}", ")", "]"]);
function escapedAt(source: string, offset: number): boolean {
  let count = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) count += 1;
  return count % 2 === 1;
}

/** Pure pairing decision shared by the main and embedded Preview editors. */
export function symbolPairAction(source: string, start: number, end: number, key: string, newline = source.includes("\r\n") ? "\r\n" : "\n"): SymbolPairAction | undefined {
  if (start < 0 || end < start || end > source.length) return undefined;
  const selected = source.slice(start, end);
  if (key === "Backspace") {
    if (selected || start === 0) return;
    const open = source[start - 1]!;
    if (escapedAt(source, start - 1)) {
      if ((open === "[" || open === "(") && source.slice(start, start + 2) === `\\${open === "[" ? "]" : ")"}`) {
        return { kind: "edit", start: start - 2, end: start + 2, text: "", cursor: start - 2 };
      }
      return;
    }
    if (ordinaryPairs[open] && ordinaryPairs[open] === source[start]) return { kind: "edit", start: start - 1, end: start + 1, text: "", cursor: start - 1 };
    return;
  }
  if (key === "Enter") {
    if (selected) return;
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = source.indexOf("\n", start);
    const before = source.slice(lineStart, start);
    const after = source.slice(start, lineEnd < 0 ? source.length : lineEnd).replace(/\r$/, "");
    const opening = /^([\t ]*)\$\$$/.exec(before);
    if (!opening || !/^(?:\$\$)?[\t ]*$/.test(after)) return;
    const delimiters = maskLatexComments(source.slice(0, lineStart)).match(/\\[\s\S]|\$\$/g)?.filter(token => token === "$$").length ?? 0;
    if (delimiters % 2) return; // Enter after a closing delimiter remains an ordinary newline.
    if (!after.startsWith("$$") && /\$\$/.test(maskLatexComments(source.slice(start + after.length)))) return;
    const indent = opening[1]!;
    return { kind: "edit", start, end: start + after.length, text: `${newline}${indent}${newline}${indent}$$`, cursor: start + newline.length + indent.length };
  }
  const escaped = escapedAt(source, start);
  if (escaped && (key === "$" || key === "{" || key === "}")) return undefined;
  const escapedMath = (key === "[" || key === "(") && escaped;
  const close = escapedMath ? key === "[" ? "\\]" : "\\)" : ordinaryPairs[key];

  if (key === "$" && !selected && source[start] === "$") {
    if (source[start - 1] === "$" && source[start - 2] !== "$" && source[start + 1] !== "$" && !escapedAt(source, start - 1)) {
      return { kind: "edit", start: start - 1, end: start + 1, text: "$$$$", cursor: start + 1 };
    }
    return { kind: "skip", start, end, cursor: start + 1 };
  }
  if (close) {
    if (selected) {
      return { kind: "edit", start, end, text: `${key}${selected}${close}`, cursor: start + 1, selectionEnd: start + 1 + selected.length };
    }
    if (source.slice(start).startsWith(close)) {
      return { kind: "edit", start, end, text: key, cursor: start + key.length };
    }
    return { kind: "edit", start, end, text: `${key}${close}`, cursor: start + key.length };
  }

  if (!selected && closingSymbols.has(key) && source[start] === key) return { kind: "skip", start, end, cursor: start + 1 };
  return undefined;
}

/** Plan all cursors against the same source, then map their positions through every edit. */
export function symbolPairActions(source: string, selections: Array<{ start: number; end: number }>, key: string, newline = source.includes("\r\n") ? "\r\n" : "\n"): SymbolPairAction[] | undefined {
  const proposed = selections.map(range => symbolPairAction(source, range.start, range.end, key, newline));
  if (!proposed.some(Boolean)) return undefined;
  const actions = proposed.map((action, index) => {
    const range = selections[index]!;
    const indent = /^[\t ]*/.exec(source.slice(source.lastIndexOf("\n", range.start - 1) + 1, range.start))?.[0] ?? "";
    const text = key === "Enter" ? newline + indent : key;
    if (!action && key === "Backspace") {
      const preceding = source.slice(Math.max(0, range.start - 2), range.start);
      const count = preceding === "\r\n" || /^[\uD800-\uDBFF][\uDC00-\uDFFF]$/.test(preceding) ? 2 : 1;
      const start = range.end > range.start ? range.start : Math.max(0, range.start - count);
      return { kind: "edit" as const, start, end: range.end, text: "", cursor: start };
    }
    return action ?? { kind: "edit" as const, ...range, text, cursor: range.start + text.length };
  });
  return actions.map(action => {
    const shift = actions.filter(other => other !== action && other.kind === "edit" && other.end <= action.start)
      .reduce((sum, other) => sum + (other.text?.length ?? 0) - (other.end - other.start), 0);
    return { ...action, cursor: action.cursor + shift, ...(action.selectionEnd === undefined ? {} : { selectionEnd: action.selectionEnd + shift }) };
  });
}

/** Installs deterministic LaTeX-aware pairing without relying on language defaults. */
export function installSymbolPairing(target: editor.IStandaloneCodeEditor, enabled: () => boolean): { dispose(): void } {
  return target.onKeyDown((event) => {
    if (!enabled() || target.getRawOptions().readOnly || event.browserEvent.ctrlKey || event.browserEvent.metaKey || event.browserEvent.altKey || event.browserEvent.isComposing) return;
    const key = event.browserEvent.key;
    if (!(key in ordinaryPairs) && !closingSymbols.has(key) && key !== "Enter" && key !== "Backspace") return;
    if (key === "Enter" && event.browserEvent.shiftKey) return;
    const model = target.getModel();
    const selections = target.getSelections();
    if (!model || !selections?.length) return;
    if (key === "Backspace" && !selections.some(selection => {
      if (!selection.isEmpty()) return false;
      const position = selection.getStartPosition();
      const line = model.getLineContent(position.lineNumber);
      return symbolPairAction(line, position.column - 1, position.column - 1, key) !== undefined;
    })) return;
    // Ordinary Enter should not read the entire document, particularly in long files.
    if (key === "Enter" && !selections.some(selection => {
      if (!selection.isEmpty()) return false;
      const position = selection.getStartPosition();
      const line = model.getLineContent(position.lineNumber);
      return /^[\t ]*\$\$$/.test(line.slice(0, position.column - 1)) && /^(?:\$\$)?[\t ]*$/.test(line.slice(position.column - 1));
    })) return;
    const actions = symbolPairActions(model.getValue(), selections.map(selection => ({ start: model.getOffsetAt(selection.getStartPosition()), end: model.getOffsetAt(selection.getEndPosition()) })), key, model.getEOL());
    if (!actions) return;
    event.preventDefault();
    event.stopPropagation();
    const edits = actions.flatMap(action => {
      if (action.kind !== "edit") return [];
      const start = model.getPositionAt(action.start), end = model.getPositionAt(action.end);
      return [{ range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, text: action.text ?? "", forceMoveMarkers: true }];
    });
    if (edits.length) {
      if (key === "Backspace" || key === "Enter") target.pushUndoStop();
      target.executeEdits("texweave-symbol-pairing", edits);
    }
    target.setSelections(actions.map(action => {
      const cursor = model.getPositionAt(action.cursor);
      const end = model.getPositionAt(action.selectionEnd ?? action.cursor);
      return { selectionStartLineNumber: cursor.lineNumber, selectionStartColumn: cursor.column, positionLineNumber: end.lineNumber, positionColumn: end.column };
    }));
    if (edits.length && (key === "Backspace" || key === "Enter")) target.pushUndoStop();
  });
}
