import type { editor } from "monaco-editor";

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

/** Pure pairing decision shared by the main and embedded Preview editors. */
export function symbolPairAction(source: string, start: number, end: number, key: string): SymbolPairAction | undefined {
  if (start < 0 || end < start || end > source.length) return undefined;
  const selected = source.slice(start, end);
  const escapedMath = (key === "[" || key === "(") && source[start - 1] === "\\";
  const close = escapedMath ? key === "[" ? "\\]" : "\\)" : ordinaryPairs[key];

  if (key === "$" && !selected && source[start] === "$") return { kind: "skip", start, end, cursor: start + 1 };
  if (close) {
    if (selected) {
      return { kind: "edit", start, end, text: `${key}${selected}${close}`, cursor: start + 1, selectionEnd: start + 1 + selected.length };
    }
    if (source.slice(start).startsWith(close)) {
      return { kind: "edit", start, end, text: key, cursor: start + key.length };
    }
    return { kind: "edit", start, end, text: `${key}${close}`, cursor: start + key.length };
  }

  if (closingSymbols.has(key) && source[start] === key) return { kind: "skip", start, end, cursor: start + 1 };
  return undefined;
}

/** Installs deterministic LaTeX-aware pairing without relying on language defaults. */
export function installSymbolPairing(target: editor.IStandaloneCodeEditor, enabled: () => boolean): { dispose(): void } {
  return target.onKeyDown((event) => {
    if (!enabled() || event.browserEvent.ctrlKey || event.browserEvent.metaKey || event.browserEvent.altKey || event.browserEvent.isComposing) return;
    const key = event.browserEvent.key;
    if (!(key in ordinaryPairs) && !closingSymbols.has(key)) return;
    const model = target.getModel();
    const selection = target.getSelection();
    if (!model || !selection) return;
    const start = model.getOffsetAt(selection.getStartPosition());
    const end = model.getOffsetAt(selection.getEndPosition());
    const action = symbolPairAction(model.getValue(), start, end, key);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === "edit") {
      target.executeEdits("texweave-symbol-pairing", [{ range: selection, text: action.text ?? "", forceMoveMarkers: true }]);
    }
    const cursor = model.getPositionAt(action.cursor);
    if (action.selectionEnd !== undefined) {
      const selectionEnd = model.getPositionAt(action.selectionEnd);
      target.setSelection({ startLineNumber: cursor.lineNumber, startColumn: cursor.column, endLineNumber: selectionEnd.lineNumber, endColumn: selectionEnd.column });
    } else target.setPosition(cursor);
  });
}
