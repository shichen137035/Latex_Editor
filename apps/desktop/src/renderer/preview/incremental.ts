import type { EnvironmentDefinition, PreviewDocument, PreviewNode, SourceSpan } from "./types.js";
import { hasVisiblePreviewContent } from "./parser.js";
import { parsePreview } from "./parser.js";

export interface PreviewTextChange { from: number; to: number; insertedText: string }
export interface PreviewSourceTransaction { previousSource: string; nextSource: string; changes: PreviewTextChange[] }
export type PreviewFallbackReason = "file-or-definitions" | "diagnostics" | "custom-pattern" | "unchanged" | "invalid-transaction" | "multi-edit" | "large-edit" | "structural-change" | "ambiguous-target" | "unsafe-content" | "span-conflict";
export interface PreviewChangeSet {
  /** The edited leaf and its ancestors; suffix offset shifts are represented separately. */
  changedNodeIds: Set<string>;
  changedRanges: SourceSpan[];
  structureChanged: boolean;
  sourceDelta: number;
  shiftedSuffixFrom?: number;
  graphicPathsChanged: boolean;
}
export type PreviewIncrementalResult =
  | { document: PreviewDocument; changeSet: PreviewChangeSet; mode: "direct" | "local-reparse" }
  | { fallbackReason: PreviewFallbackReason };

/** Monaco offsets refer to the old model. Validate them before trusting a transaction. */
export function createPreviewTransaction(previousSource: string, nextSource: string, changes: PreviewTextChange[]): PreviewSourceTransaction | undefined {
  const ordered = [...changes].sort((a, b) => a.from - b.from);
  let cursor = 0;
  let delta = 0;
  for (const change of ordered) {
    if (!Number.isSafeInteger(change.from) || !Number.isSafeInteger(change.to) || change.from < cursor || change.to < change.from || change.to > previousSource.length) return undefined;
    if (nextSource.slice(change.from + delta, change.from + delta + change.insertedText.length) !== change.insertedText) return undefined;
    delta += change.insertedText.length - (change.to - change.from);
    cursor = change.to;
  }
  return previousSource.length + delta === nextSource.length
    ? { previousSource, nextSource, changes: ordered } : undefined;
}

interface SourceEdit {
  start: number;
  oldEnd: number;
  newEnd: number;
  removed: string;
  inserted: string;
}

function sourceEdit(previous: string, next: string): SourceEdit | undefined {
  if (previous === next) return undefined;
  let start = 0;
  const commonLength = Math.min(previous.length, next.length);
  while (start < commonLength && previous.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  let suffix = 0;
  while (suffix < previous.length - start && suffix < next.length - start
    && previous.charCodeAt(previous.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)) suffix += 1;
  const oldEnd = previous.length - suffix;
  const newEnd = next.length - suffix;
  return { start, oldEnd, newEnd, removed: previous.slice(start, oldEnd), inserted: next.slice(start, newEnd) };
}

function editFromTransaction(previous: string, next: string, transaction: PreviewSourceTransaction | undefined): SourceEdit | "invalid" | "multi" | undefined {
  if (!transaction) return sourceEdit(previous, next);
  if (transaction.previousSource !== previous || transaction.nextSource !== next || !createPreviewTransaction(previous, next, transaction.changes)) return "invalid";
  if (transaction.changes.length !== 1) return "multi";
  const change = transaction.changes[0]!;
  return { start: change.from, oldEnd: change.to, newEnd: change.from + change.insertedText.length,
    removed: previous.slice(change.from, change.to), inserted: change.insertedText };
}

function isPlainTextChange(edit: SourceEdit): boolean {
  const structural = new Set(["\\", "{", "}", "[", "]", "$", "%", "&", "#", "_", "^", "~", "\r", "\n"]);
  for (const value of [edit.removed, edit.inserted]) {
    for (const character of value) {
      const code = character.charCodeAt(0);
      // These code points are intentionally rejected before entering the incremental parser path.
      // eslint-disable-next-line no-control-regex
      if (structural.has(character) || code >= 0xd800 && code <= 0xdfff || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(character)) return false;
    }
  }
  return true;
}

function hasLexicalBoundaryRisk(source: string, from: number, to: number): boolean {
  const lineStart = source.lastIndexOf("\n", from - 1) + 1;
  const lineEnd = source.indexOf("\n", to);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
  const localFrom = from - lineStart;
  const localTo = to - lineStart;
  // A plain letter can complete a structural command or a virtual block directive.
  for (const match of line.matchAll(/\\[A-Za-z@]+/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (localFrom === localTo ? start <= localFrom && localFrom <= end : start < localTo && end > localFrom) return true;
  }
  for (const match of line.matchAll(/\\(?:begin|end|label|ref|cite|includegraphics|graphicspath)\s*\{[^}]*\}/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (localFrom === localTo ? start < localFrom && localFrom < end : start < localTo && end > localFrom) return true;
  }
  // The parser treats TeXWeave comment directives as structural markers.
  if (line.includes("%") && localFrom >= line.indexOf("%")) return true;
  return false;
}

function collectEditablePath(nodes: PreviewNode[], edit: SourceEdit, source: string): { node: PreviewNode; path: Set<string> } | undefined {
  const contentMatches: Array<{ node: PreviewNode; path: Set<string> }> = [];
  const blockMatches: Array<{ node: PreviewNode; path: Set<string> }> = [];
  const ancestors: string[] = [];
  const visit = (siblings: PreviewNode[]) => {
    // Parser siblings are source ordered and disjoint. Only the nodes touching
    // the edit can contain its owner; this avoids a full-tree search per key.
    let low = 0;
    let high = siblings.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (siblings[middle]!.source.endOffset < edit.start) low = middle + 1;
      else high = middle;
    }
    for (let index = low; index < siblings.length; index += 1) {
      const node = siblings[index]!;
      if (node.source.startOffset > edit.oldEnd) break;
      ancestors.push(node.id);
      if (node.kind === "content") {
        if (node.contentType === "paragraph" && node.origin === "source" && node.source.startOffset <= edit.start && node.source.endOffset >= edit.oldEnd
          && node.raw === source.slice(node.source.startOffset, node.source.endOffset)) {
          contentMatches.push({ node, path: new Set(ancestors) });
        }
      } else {
        if (node.children.length === 0 && edit.start >= node.body.startOffset && edit.oldEnd <= node.body.endOffset
          && !(node.labelSource && edit.start <= node.labelSource.endOffset && edit.oldEnd >= node.labelSource.startOffset)) {
          blockMatches.push({ node, path: new Set(ancestors) });
        }
        visit(node.children);
      }
      ancestors.pop();
    }
  };
  visit(nodes);
  if (contentMatches.length === 1) return contentMatches[0];
  if (contentMatches.length > 1) return undefined;
  return blockMatches.length === 1 ? blockMatches[0] : undefined;
}

function parserId(node: PreviewNode, span: SourceSpan): string {
  return node.kind === "content"
    ? `content:${span.filePath}:${span.startOffset}:${span.endOffset}`
    : `block:${span.filePath}:${span.startOffset}:${span.endOffset}:${node.environmentId}`;
}

const locallyReparseable = /^(?:equation\*?|align\*?|gather\*?|multline\*?|display-math)$/;
const globalSyntax = /\\(?:begin|end|chapter|section|subsection|subsubsection|paragraph|includegraphics|graphicspath|maketitle|title|author|date|label|newcommand|renewcommand|providecommand|def)\b|\\(?:\[|\])|%\s*tw:block-/;

function canReparseLeaf(node: PreviewNode, edit: SourceEdit, nextSource: string, definitions: EnvironmentDefinition[]): boolean {
  if (node.kind !== "block" || node.children.length || !locallyReparseable.test(node.environmentId)
    || edit.start < node.body.startOffset || edit.oldEnd > node.body.endOffset
    || /[\r\n]/.test(edit.removed + edit.inserted)) return false;
  const delta = edit.newEnd - edit.oldEnd;
  const fragment = nextSource.slice(node.source.startOffset, node.source.endOffset + delta);
  // These commands may alter the document outside this block or own metadata.
  if (globalSyntax.test(fragment.slice(node.body.startOffset - node.source.startOffset, node.body.endOffset - node.source.startOffset + delta))) return false;
  const parsed = parsePreview(fragment, node.source.filePath, definitions);
  const replacement = parsed.nodes[0];
  return !parsed.diagnostics.length && !parsed.title && parsed.nodes.length === 1 && replacement?.kind === "block"
    && replacement.environmentId === node.environmentId && replacement.children.length === 0
    && replacement.source.startOffset === 0 && replacement.source.endOffset === fragment.length
    && replacement.body.startOffset === node.body.startOffset - node.source.startOffset
    && replacement.body.endOffset === node.body.endOffset - node.source.startOffset + delta
    && replacement.latexLabel === node.latexLabel;
}

/**
 * Fast-path edits that can only change the text inside one existing preview leaf.
 * Structural ambiguity returns a reason so the caller can use parsePreview.
 */
export function tryIncrementalPreviewUpdate(
  previousDocument: PreviewDocument,
  previousSource: string,
  nextSource: string,
  filePath: string,
  definitions: EnvironmentDefinition[],
  transaction?: PreviewSourceTransaction
): PreviewIncrementalResult {
  if (previousDocument.filePath !== filePath) return { fallbackReason: "file-or-definitions" };
  if (previousDocument.diagnostics.length) return { fallbackReason: "diagnostics" };
  if (previousSource === nextSource) return { fallbackReason: "unchanged" };
  if (definitions.some((definition) => definition.enabled && definition.match.kind === "custom-pattern")) return { fallbackReason: "custom-pattern" };
  const edit = editFromTransaction(previousSource, nextSource, transaction);
  if (edit === "invalid") return { fallbackReason: "invalid-transaction" };
  if (edit === "multi") return { fallbackReason: "multi-edit" };
  if (!edit) return { fallbackReason: "unchanged" };
  if (Math.max(edit.removed.length, edit.inserted.length) > Math.max(512, previousSource.length * 0.2)) return { fallbackReason: "large-edit" };
  const target = collectEditablePath(previousDocument.nodes, edit, previousSource);
  if (!target) return { fallbackReason: "ambiguous-target" };
  const direct = isPlainTextChange(edit)
    && !hasLexicalBoundaryRisk(previousSource, edit.start, edit.oldEnd)
    && !hasLexicalBoundaryRisk(nextSource, edit.start, edit.newEnd);
  if (!direct && !canReparseLeaf(target.node, edit, nextSource, definitions)) return { fallbackReason: "structural-change" };
  const targetSource = target.node.source;
  const updatedTargetRaw = nextSource.slice(targetSource.startOffset, targetSource.endOffset + (edit.newEnd - edit.oldEnd));
  if (target.node.kind === "content" && (!hasVisiblePreviewContent(updatedTargetRaw) || updatedTargetRaw.trim() !== updatedTargetRaw)) return { fallbackReason: "unsafe-content" };

  // Newlines are excluded from the fast path, so existing line numbers remain valid.
  let editLine = targetSource.startLine;
  for (let index = targetSource.startOffset; index < edit.start; index += 1) if (previousSource.charCodeAt(index) === 10) editLine += 1;
  const delta = edit.newEnd - edit.oldEnd;
  const mapSpan = (span: SourceSpan, isPath: boolean): SourceSpan | undefined => {
    if (span.filePath !== filePath) return undefined;
    let startOffset = span.startOffset;
    let endOffset = span.endOffset;
    if (isPath && startOffset <= edit.start && endOffset >= edit.oldEnd) endOffset += delta;
    else if (startOffset >= edit.oldEnd) { startOffset += delta; endOffset += delta; }
    else if (endOffset <= edit.start) { /* This span is before the edited text. */ }
    else if (startOffset < edit.start && endOffset > edit.oldEnd) endOffset += delta;
    else return undefined;

    const startColumn = span.startLine === editLine && startOffset !== span.startOffset && span.startOffset >= edit.oldEnd
      ? span.startColumn + delta : span.startColumn;
    const endColumn = span.endLine === editLine && endOffset !== span.endOffset && span.endOffset >= edit.oldEnd
      ? span.endColumn + delta : span.endColumn;
    return startOffset === span.startOffset && endOffset === span.endOffset
      ? span
      : { ...span, startOffset, endOffset, startColumn, endColumn };
  };

  let failed = false;
  const changedNodeIds = new Set<string>();
  const changedRanges: SourceSpan[] = [];
  const patchNodes = (nodes: PreviewNode[]): PreviewNode[] => {
    const patched = nodes.map((node) => {
      const inPath = target.path.has(node.id);
      // With no source shift, siblings outside the target path are immutable.
      if (delta === 0 && !inPath) return node;
      const source = mapSpan(node.source, inPath);
      if (!source) { failed = true; return node; }
      let body: SourceSpan | undefined;
      let labelSource: SourceSpan | undefined;
      let children: PreviewNode[] | undefined;
      if (node.kind === "block") {
        body = mapSpan(node.body, inPath);
        if (!body) { failed = true; return node; }
        if (node.labelSource) {
          labelSource = mapSpan(node.labelSource, false);
          if (!labelSource) { failed = true; return node; }
        }
        children = patchNodes(node.children);
        if (failed) return node;
      }
      const raw = node === target.node && node.kind === "content" ? nextSource.slice(source.startOffset, source.endOffset) : undefined;
      const changed = node === target.node || source !== node.source || node.kind === "block" && (body !== node.body || labelSource !== node.labelSource || children !== node.children)
        || node.kind === "content" && raw !== undefined && raw !== node.raw;
      if (!changed) return node;
      const updated = node.kind === "content"
        ? { ...node, source, ...(raw !== undefined ? { raw } : {}) }
        : { ...node, source, body: body!, children: children!, ...(labelSource ? { labelSource } : {}) };
      if (source.startOffset !== node.source.startOffset || source.endOffset !== node.source.endOffset) updated.parserId = parserId(node, source);
      if (inPath) {
        changedNodeIds.add(updated.id);
        changedRanges.push(source);
      }
      return updated;
    });
    return patched.every((node, index) => node === nodes[index]) ? nodes : patched;
  };
  const nodes = patchNodes(previousDocument.nodes);
  if (failed) return { fallbackReason: "span-conflict" };
  return {
    document: { ...previousDocument, nodes },
    changeSet: { changedNodeIds, changedRanges, structureChanged: false, sourceDelta: delta,
      ...(delta ? { shiftedSuffixFrom: edit.oldEnd } : {}), graphicPathsChanged: false },
    mode: direct ? "direct" : "local-reparse"
  };
}
