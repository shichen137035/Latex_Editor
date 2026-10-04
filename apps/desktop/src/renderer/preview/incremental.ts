import type { EnvironmentDefinition, PreviewDocument, PreviewNode, SourceSpan } from "./types.js";
import { hasVisiblePreviewContent } from "./parser.js";

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

function collectEditablePath(nodes: PreviewNode[], edit: SourceEdit, source: string): { node: PreviewNode; path: Set<string> } | undefined {
  const contentMatches: Array<{ node: PreviewNode; path: Set<string> }> = [];
  const blockMatches: Array<{ node: PreviewNode; path: Set<string> }> = [];
  const ancestors: string[] = [];
  const visit = (siblings: PreviewNode[]) => {
    for (const node of siblings) {
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

/**
 * Fast-path edits that can only change the text inside one existing preview leaf.
 * Any structural ambiguity returns undefined so the caller can use parsePreview.
 */
export function tryIncrementalPreviewUpdate(
  previousDocument: PreviewDocument,
  previousSource: string,
  nextSource: string,
  filePath: string,
  definitions: EnvironmentDefinition[]
): PreviewDocument | undefined {
  if (previousDocument.filePath !== filePath || previousDocument.diagnostics.length || previousSource === nextSource
    || definitions.some((definition) => definition.enabled && definition.match.kind === "custom-pattern")) return undefined;
  const edit = sourceEdit(previousSource, nextSource);
  if (!edit || !isPlainTextChange(edit)) return undefined;
  const target = collectEditablePath(previousDocument.nodes, edit, previousSource);
  if (!target) return undefined;
  const targetSource = target.node.source;
  const updatedTargetRaw = nextSource.slice(targetSource.startOffset, targetSource.endOffset + (edit.newEnd - edit.oldEnd));
  if (target.node.kind === "content" && (!hasVisiblePreviewContent(updatedTargetRaw) || updatedTargetRaw.trim() !== updatedTargetRaw)) return undefined;

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
  const patchNodes = (nodes: PreviewNode[]): PreviewNode[] => {
    const patched = nodes.map((node) => {
      const inPath = target.path.has(node.id);
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
      return updated;
    });
    return patched.every((node, index) => node === nodes[index]) ? nodes : patched;
  };
  const nodes = patchNodes(previousDocument.nodes);
  if (failed) return undefined;
  return { ...previousDocument, nodes };
}
