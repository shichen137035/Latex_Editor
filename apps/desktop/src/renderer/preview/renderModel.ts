import type { PreviewDocument, PreviewNode } from "./types.js";

export interface PreviewRenderEntry {
  id: string;
  parentId?: string;
  depth: number;
  node: PreviewNode;
}

export interface PreviewRenderIndex {
  entries: PreviewRenderEntry[];
  byId: Map<string, PreviewRenderEntry>;
  byParserId: Map<string, PreviewRenderEntry>;
}

function sameSpan(a: PreviewNode["source"], b: PreviewNode["source"]): boolean {
  return a.filePath === b.filePath && a.startOffset === b.startOffset && a.endOffset === b.endOffset
    && a.startLine === b.startLine && a.endLine === b.endLine
    && a.startColumn === b.startColumn && a.endColumn === b.endColumn;
}

function signature(node: PreviewNode, source: string): string {
  if (node.kind === "content") return `content:${node.contentType}:${node.raw}`;
  const text = source.slice(node.source.startOffset, node.source.endOffset);
  // A short prefix/suffix distinguishes equal-sized blocks without retaining a
  // second copy of every (possibly deeply nested) section in the render index.
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `block:${node.environmentId}:${text.length}:${hash >>> 0}`;
}

function sameNode(a: PreviewNode, b: PreviewNode, children: PreviewNode[]): boolean {
  if (a.kind !== b.kind || a.id !== b.id || a.parentId !== b.parentId || !sameSpan(a.source, b.source)) return false;
  if (a.kind === "content" && b.kind === "content") return a.raw === b.raw && a.contentType === b.contentType && a.origin === b.origin;
  if (a.kind !== "block" || b.kind !== "block") return false;
  return a.environmentId === b.environmentId && a.semanticKind === b.semanticKind && a.origin === b.origin
    && a.title === b.title && a.latexLabel === b.latexLabel && a.autoLabel === b.autoLabel
    && sameSpan(a.body, b.body)
    && ((!a.labelSource && !b.labelSource) || (!!a.labelSource && !!b.labelSource && sameSpan(a.labelSource, b.labelSource)))
    && a.children.length === children.length && a.children.every((child, index) => child === children[index]);
}

/** Keep renderer identities stable while leaving parser IDs and source ranges intact. */
export function reusePreviewDocument(
  previous: PreviewDocument | undefined,
  previousSource: string | undefined,
  parsed: PreviewDocument,
  source: string,
  nextId: () => string
): PreviewDocument {
  if (previous?.filePath !== parsed.filePath) previous = undefined;
  const oldByLabel = new Map<string, PreviewNode[]>();
  const used = new Set<string>();
  const collect = (nodes: PreviewNode[]) => {
    for (const node of nodes) {
      if (node.kind !== "block") continue;
      if (node.latexLabel) {
        const key = `${node.environmentId}:${node.latexLabel}`;
        const bucket = oldByLabel.get(key) ?? [];
        bucket.push(node);
        oldByLabel.set(key, bucket);
      }
      collect(node.children);
    }
  };
  if (previous) collect(previous.nodes);

  const reconcile = (oldNodes: PreviewNode[], newNodes: PreviewNode[], parentId?: string): PreviewNode[] => {
    const matched = new Map<number, PreviewNode>();
    const compatible = (old: PreviewNode, next: PreviewNode) => old.kind === next.kind
      && (old.kind === "content" || (next.kind === "block" && old.environmentId === next.environmentId));
    const take = (index: number, old: PreviewNode | undefined) => {
      if (old && !used.has(old.id) && compatible(old, newNodes[index]!)) { matched.set(index, old); used.add(old.id); }
    };
    // Explicit LaTeX labels survive moves across section boundaries.
    newNodes.forEach((node, index) => {
      if (node.kind !== "block" || !node.latexLabel) return;
      const candidates = oldByLabel.get(`${node.environmentId}:${node.latexLabel}`);
      if (candidates?.length === 1) take(index, candidates[0]);
    });
    // Exact content matches survive insertions and deletions before the node.
    const oldSignatures = new Map<string, PreviewNode[]>();
    for (const old of oldNodes) {
      if (used.has(old.id)) continue;
      const key = signature(old, previousSource ?? "");
      const bucket = oldSignatures.get(key) ?? [];
      bucket.push(old);
      oldSignatures.set(key, bucket);
    }
    newNodes.forEach((node, index) => {
      if (matched.has(index)) return;
      const key = signature(node, source);
      const candidates = oldSignatures.get(key);
      if (candidates?.length === 1) take(index, candidates[0]);
    });
    // An in-place edit keeps its identity when the sibling layout is unchanged.
    if (oldNodes.length === newNodes.length) newNodes.forEach((node, index) => {
      if (!matched.has(index)) take(index, oldNodes[index]);
    });

    return newNodes.map((node, index) => {
      const old = matched.get(index);
      const id = old?.id ?? nextId();
      const children = node.kind === "block" ? reconcile(old?.kind === "block" ? old.children : [], node.children, id) : undefined;
      const result: PreviewNode = node.kind === "block"
        ? { ...node, id, parserId: node.id, children: children! }
        : { ...node, id, parserId: node.id };
      if (parentId) result.parentId = parentId;
      else delete result.parentId;
      return old && sameNode(old, result, children ?? []) && old.parserId === node.id
        && signature(old, previousSource ?? "") === signature(node, source) ? old : result;
    });
  };
  return { ...parsed, nodes: reconcile(previous?.nodes ?? [], parsed.nodes) };
}

export function buildPreviewRenderIndex(nodes: PreviewNode[]): PreviewRenderIndex {
  const entries: PreviewRenderEntry[] = [];
  const byId = new Map<string, PreviewRenderEntry>();
  const byParserId = new Map<string, PreviewRenderEntry>();
  const visit = (children: PreviewNode[], depth: number, parentId?: string) => {
    for (const node of children) {
      const entry = { id: node.id, ...(parentId ? { parentId } : {}), depth, node };
      entries.push(entry);
      byId.set(node.id, entry);
      byParserId.set(node.parserId ?? node.id, entry);
      if (node.kind === "block") visit(node.children, depth + 1, node.id);
    }
  };
  visit(nodes, 0);
  return { entries, byId, byParserId };
}

export function previewPath(index: PreviewRenderIndex, id: string): Set<string> {
  const path = new Set<string>();
  let entry = index.byId.get(id);
  while (entry && !path.has(entry.id)) {
    path.add(entry.id);
    entry = entry.parentId ? index.byId.get(entry.parentId) : undefined;
  }
  return path;
}

/** A first-scroll estimate; ResizeObserver replaces it once the row is mounted. */
export function estimatedPreviewHeight(node: PreviewNode): number {
  if (node.kind === "content") return Math.max(48, 28 + Math.ceil(node.raw.length / 75) * 27);
  if (/^(itemize|enumerate|description)$/.test(node.environmentId)) {
    const itemCount = node.children.reduce((count, child) => count + (child.kind === "content" ? [...child.raw.matchAll(/\\item\b/g)].length : 0), 0);
    return 90 + Math.max(1, itemCount) * 47 + node.children.reduce((height, child) => height + (child.kind === "block" ? estimatedPreviewHeight(child) : 0), 0);
  }
  if (node.children.length) return 82 + node.children.reduce((height, child) => height + estimatedPreviewHeight(child), 0);
  if (/figure|image|table|tabular/.test(node.environmentId)) return 300;
  if (/equation|align|gather|multline|display-math/.test(node.environmentId)) return 135;
  return 100;
}
