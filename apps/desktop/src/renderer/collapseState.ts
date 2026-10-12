import type { PreviewRenderIndex } from "./preview/renderModel.js";

type PreviewCollapseRecord = { key: string; fingerprint: string };
const memoryRecords = new Map<string, { records: unknown[]; characters: number }>();
let cachedCharacters = 0;
const maxCachedEntries = 128;
const maxCachedCharacters = 2 * 1024 * 1024;
type CollapseStorageKind = "preview" | "outline" | "file-tree";

function forgetRecords(key: string): void {
  cachedCharacters -= memoryRecords.get(key)?.characters ?? 0;
  memoryRecords.delete(key);
}

function rememberRecords(key: string, records: unknown[], serialized: string): void {
  forgetRecords(key);
  const characters = key.length + serialized.length;
  if (characters > maxCachedCharacters) return;
  memoryRecords.set(key, { records, characters });
  cachedCharacters += characters;
  while (memoryRecords.size > maxCachedEntries || cachedCharacters > maxCachedCharacters) forgetRecords(memoryRecords.keys().next().value!);
}

export function collapseStateCacheStats(): { entries: number; characters: number } { return { entries: memoryRecords.size, characters: cachedCharacters }; }

/** Persistent fold choices stay on disk when a project's in-memory copies leave. */
export function releaseCollapseStateCache(projectId: string): void {
  const identity = encodeURIComponent(projectId);
  for (const key of memoryRecords.keys()) if (key === `texweave.expanded.file-tree.v1:${identity}` || key.startsWith(`texweave.collapsed.preview.v1:${identity}:`) || key.startsWith(`texweave.collapsed.outline.v1:${identity}:`)) forgetRecords(key);
}

function storageKey(kind: CollapseStorageKind, projectId: string, filePath: string): string {
  if (kind === "file-tree") return `texweave.expanded.file-tree.v1:${encodeURIComponent(projectId)}`;
  return `texweave.collapsed.${kind}.v1:${encodeURIComponent(projectId)}:${encodeURIComponent(filePath)}`;
}

function readRecords(kind: CollapseStorageKind, projectId: string, filePath: string): unknown[] {
  const key = storageKey(kind, projectId, filePath);
  const cached = memoryRecords.get(key);
  if (cached) { memoryRecords.delete(key); memoryRecords.set(key, cached); return cached.records; }
  try {
    const serialized = localStorage.getItem(key) ?? "[]";
    const parsed: unknown = JSON.parse(serialized);
    const records = Array.isArray(parsed) ? parsed : [];
    rememberRecords(key, records, serialized);
    return records;
  } catch { return []; }
}

function writeRecords(kind: CollapseStorageKind, projectId: string, filePath: string, records: unknown[]): void {
  const key = storageKey(kind, projectId, filePath);
  const serialized = JSON.stringify(records);
  rememberRecords(key, records, serialized);
  try {
    if (records.length) localStorage.setItem(key, serialized);
    else localStorage.removeItem(key);
  } catch { /* Storage may be unavailable or full; collapse still works for this session. */ }
}

export function readCollapsedOutline(projectId: string, filePath: string): Set<string> {
  return new Set(readRecords("outline", projectId, filePath).filter((item): item is string => typeof item === "string" && item.length <= 2048));
}

export function writeCollapsedOutline(projectId: string, filePath: string, keys: ReadonlySet<string>): void {
  writeRecords("outline", projectId, filePath, [...keys]);
}

/** Store expanded paths so previously unseen directories always start closed. */
export function readExpandedFileTree(projectId: string): Set<string> {
  return new Set(readRecords("file-tree", projectId, "").filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 2048));
}

export function writeExpandedFileTree(projectId: string, paths: ReadonlySet<string>): void {
  writeRecords("file-tree", projectId, "", [...paths]);
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
