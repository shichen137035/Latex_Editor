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
function escapedAt(source: string, offset: number): boolean {
  let count = 0;
  for (let index = offset - 1; index >= 0 && source[index] === "\\"; index -= 1) count += 1;
  return count % 2 === 1;
}

/** Pure pairing decision shared by the main and embedded Preview editors. */
export function symbolPairAction(source: string, start: number, end: number, key: string): SymbolPairAction | undefined {
  if (start < 0 || end < start || end > source.length) return undefined;
  const selected = source.slice(start, end);
  const escaped = escapedAt(source, start);
  if (escaped && (key === "$" || key === "{" || key === "}")) return undefined;
  const escapedMath = (key === "[" || key === "(") && escaped;
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

  if (!selected && closingSymbols.has(key) && source[start] === key) return { kind: "skip", start, end, cursor: start + 1 };
  return undefined;
}

/** Plan all cursors against the same source, then map their positions through every edit. */
export function symbolPairActions(source: string, selections: Array<{ start: number; end: number }>, key: string): SymbolPairAction[] | undefined {
  const proposed = selections.map(range => symbolPairAction(source, range.start, range.end, key));
  if (!proposed.some(Boolean)) return undefined;
  const actions = proposed.map((action, index) => action ?? { kind: "edit" as const, ...selections[index]!, text: key, cursor: selections[index]!.start + key.length });
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
    if (!(key in ordinaryPairs) && !closingSymbols.has(key)) return;
    const model = target.getModel();
    const selections = target.getSelections();
    if (!model || !selections?.length) return;
    const actions = symbolPairActions(model.getValue(), selections.map(selection => ({ start: model.getOffsetAt(selection.getStartPosition()), end: model.getOffsetAt(selection.getEndPosition()) })), key);
    if (!actions) return;
    event.preventDefault();
    event.stopPropagation();
    const edits = actions.flatMap((action, index) => action.kind === "edit" ? [{ range: selections[index]!, text: action.text ?? "", forceMoveMarkers: true }] : []);
    if (edits.length) target.executeEdits("texweave-symbol-pairing", edits);
    target.setSelections(actions.map(action => {
      const cursor = model.getPositionAt(action.cursor);
      const end = model.getPositionAt(action.selectionEnd ?? action.cursor);
      return { selectionStartLineNumber: cursor.lineNumber, selectionStartColumn: cursor.column, positionLineNumber: end.lineNumber, positionColumn: end.column };
    }));
  });
}
