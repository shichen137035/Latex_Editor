import { maskLatexComments, readLatexGroup } from "@latex-editor/editor-core/latex-source";
import { t } from "../i18n/index.js";

export interface ListItemSource { commandStart: number; startOffset: number; endOffset: number; label?: string; labelStart?: number }
/** Explicit \item[label] does not increment LaTeX's automatic list counter. */
export function listItemOrdinals(items: ListItemSource[]): number[] {
  let counter = 0;
  return items.map(item => item.label === undefined ? ++counter : counter);
}
export interface ListHandler {
  id: string;
  kind: "list";
  parse(source: string, absoluteStart: number, itemCommand: string): ListItemSource[];
  append(source: string, itemCommand: string): string;
}
const handlers = new Map<string, ListHandler>();
/** Extension seam for trusted, packaged JS/TS handlers. Loading external scripts is a separate concern. */
export function registerBlockHandler(handler: ListHandler): () => void {
  if (handlers.has(handler.id)) throw new Error(t("preview.blockHandlerDuplicate", { id: handler.id }));
  handlers.set(handler.id, handler);
  return () => { if (handlers.get(handler.id) === handler) handlers.delete(handler.id); };
}
export function blockHandler(id: string): ListHandler | undefined { return handlers.get(id); }

function bodyRange(source: string): [number, number] {
  const masked = maskLatexComments(source), opening = /^\s*\\begin\s*/.exec(masked);
  if (!opening) return [0, source.length];
  const name = readLatexGroup(masked, opening[0].length);
  if (!name) return [0, source.length];
  let start = name.end + 1;
  while (/\s/.test(masked[start] ?? "") && start < masked.length) start++;
  if (masked[start] === "[") { const options = readLatexGroup(masked, start, "[", "]"); if (options) start = options.end + 1; }
  const closing = /\\end\s*\{[^{}]+\}\s*$/.exec(masked);
  return [start, closing?.index ?? source.length];
}

export const builtinListHandler: ListHandler = {
  id: "builtin.list", kind: "list",
  parse(source, absoluteStart, itemCommand) {
    const [bodyStart, bodyEnd] = bodyRange(source), masked = maskLatexComments(source);
    const items: ListItemSource[] = [];
    let braces = 0, environments = 0;
    for (let cursor = bodyStart; cursor < bodyEnd;) {
      const char = masked[cursor];
      if (char === "{") { braces++; cursor++; continue; }
      if (char === "}") { braces = Math.max(0, braces - 1); cursor++; continue; }
      if (char !== "\\") { cursor++; continue; }
      const token = /^\\([A-Za-z@]+|[^A-Za-z@])/.exec(masked.slice(cursor));
      if (!token) { cursor++; continue; }
      const commandStart = cursor, name = token[1]; cursor += token[0].length;
      if (name === "verb") {
        if (masked[cursor] === "*") cursor++;
        const delimiter = masked[cursor++];
        if (delimiter) { const end = masked.indexOf(delimiter, cursor); if (end >= 0) cursor = end + 1; }
        continue;
      }
      if (name === "begin" || name === "end") {
        while (cursor < bodyEnd && /\s/.test(masked[cursor]!)) cursor++;
        const group = readLatexGroup(masked, cursor);
        if (group) { environments = Math.max(0, environments + (name === "begin" ? 1 : -1)); cursor = group.end + 1; }
        continue;
      }
      if (name !== itemCommand || braces || environments) continue;
      while (cursor < bodyEnd && /\s/.test(masked[cursor]!)) cursor++;
      const label = masked[cursor] === "[" ? readLatexGroup(masked, cursor, "[", "]") : undefined;
      if (label) cursor = label.end + 1;
      const item: ListItemSource = { commandStart: absoluteStart + commandStart, startOffset: absoluteStart + cursor, endOffset: absoluteStart + bodyEnd };
      if (label) { item.label = source.slice(label.start, label.end); item.labelStart = absoluteStart + label.start; }
      if (items.length) items.at(-1)!.endOffset = item.commandStart;
      items.push(item);
    }
    return items;
  },
  append(source, itemCommand) {
    const [, end] = bodyRange(source);
    return `${source.slice(0, end).replace(/\s*$/, "")}\n  \\${itemCommand} \n${source.slice(end)}`;
  }
};
registerBlockHandler(builtinListHandler);
