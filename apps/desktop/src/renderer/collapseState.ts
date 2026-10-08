import type { PreviewRenderIndex } from "./preview/renderModel.js";

type PreviewCollapseRecord = { key: string; fingerprint: string };
const memoryRecords = new Map<string, unknown[]>();

function storageKey(kind: "preview" | "outline", projectId: string, filePath: string): string {
  return `texweave.collapsed.${kind}.v1:${encodeURIComponent(projectId)}:${encodeURIComponent(filePath)}`;
}

function readRecords(kind: "preview" | "outline", projectId: string, filePath: string): unknown[] {
  const key = storageKey(kind, projectId, filePath);
  const cached = memoryRecords.get(key);
  if (cached) return cached;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    const records = Array.isArray(parsed) ? parsed : [];
    memoryRecords.set(key, records);
    return records;
  } catch { return []; }
}

function writeRecords(kind: "preview" | "outline", projectId: string, filePath: string, records: unknown[]): void {
  const key = storageKey(kind, projectId, filePath);
  memoryRecords.set(key, records);
  try {
    if (records.length) localStorage.setItem(key, JSON.stringify(records));
    else localStorage.removeItem(key);
  } catch { /* Storage may be unavailable or full; collapse still works for this session. */ }
}

export function readCollapsedOutline(projectId: string, filePath: string): Set<string> {
  return new Set(readRecords("outline", projectId, filePath).filter((item): item is string => typeof item === "string" && item.length <= 2048));
}

export function writeCollapsedOutline(projectId: string, filePath: string, keys: ReadonlySet<string>): void {
  writeRecords("outline", projectId, filePath, [...keys]);
}

export function previewCollapseKeys(index: PreviewRenderIndex): Map<string, string> {
  const keys = new Map<string, string>();
  const siblingCounts = new Map<string, number>();
  const labelCounts = new Map<string, number>();
  for (const entry of index.entries) {
    if (entry.node.kind === "block" && entry.node.latexLabel) {
      const label = JSON.stringify([entry.node.environmentId, entry.node.latexLabel]);
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
  }
  for (const entry of index.entries) {
    if (entry.node.kind !== "block") continue;
    const node = entry.node;
    const label = node.latexLabel && JSON.stringify([node.environmentId, node.latexLabel]);
    if (label && labelCounts.get(label) === 1) {
      keys.set(entry.id, `label:${label}`);
      continue;
    }
    const parent = entry.parentId ? keys.get(entry.parentId) ?? "root" : "root";
    const base = JSON.stringify([parent, node.environmentId, node.title ?? ""]);
    const occurrence = siblingCounts.get(base) ?? 0;
    siblingCounts.set(base, occurrence + 1);
    keys.set(entry.id, `position:${base}:${occurrence}`);
  }
  return keys;
}

function fingerprint(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16777619);
  return `${source.length}:${hash >>> 0}`;
}

function previewRecords(index: PreviewRenderIndex, source: string, ids: ReadonlySet<string>): PreviewCollapseRecord[] {
  const keys = previewCollapseKeys(index);
  const records: PreviewCollapseRecord[] = [];
  for (const id of ids) {
    const entry = index.byId.get(id);
    const key = keys.get(id);
    if (entry?.node.kind !== "block" || !key) continue;
    records.push({ key, fingerprint: fingerprint(source.slice(entry.node.source.startOffset, entry.node.source.endOffset)) });
  }
  return records;
}

export function readCollapsedPreview(projectId: string, filePath: string, index: PreviewRenderIndex, source: string): Set<string> {
  const stored = readRecords("preview", projectId, filePath).filter((item): item is PreviewCollapseRecord =>
    !!item && typeof item === "object" && "key" in item && "fingerprint" in item
      && typeof item.key === "string" && typeof item.fingerprint === "string");
  if (stored.length === 0) return new Set();
  const byKey = new Map(stored.map((record) => [record.key, record.fingerprint]));
  const keys = previewCollapseKeys(index);
  const ids = new Set<string>();
  for (const [id, key] of keys) {
    const expected = byKey.get(key);
    if (!expected) continue;
    const node = index.byId.get(id)?.node;
    if (node?.kind === "block" && expected === fingerprint(source.slice(node.source.startOffset, node.source.endOffset))) ids.add(id);
  }
  if (ids.size !== stored.length) writeRecords("preview", projectId, filePath, previewRecords(index, source, ids));
  return ids;
}

export function writeCollapsedPreview(projectId: string, filePath: string, index: PreviewRenderIndex, source: string, ids: ReadonlySet<string>): void {
  writeRecords("preview", projectId, filePath, previewRecords(index, source, ids));
}
