import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { ProjectReferenceLink, ReferenceCollection, ReferenceImportResult, ReferenceLibraryEntry, ReferenceLibrarySnapshot, ReferenceTag } from "@latex-editor/contracts" with { "resolution-mode": "import" };

interface ParsedBibEntry { entryType: string; citationKey: string; fields: Record<string, string>; rawBibtex: string; start: number; end: number; }

function valueWithoutBraces(value: string): string {
  return value.trim().replace(/^\{([\s\S]*)\}$/, "$1").replace(/^"([\s\S]*)"$/, "$1").replace(/\s+/g, " ").trim();
}

function splitTopLevel(value: string, separator = ","): string[] {
  const result: string[] = [];
  let cursor = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && quoted) { index += 1; continue; }
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "{") depth += 1;
    else if (!quoted && character === "}") depth = Math.max(0, depth - 1);
    else if (!quoted && depth === 0 && character === separator) { result.push(value.slice(cursor, index)); cursor = index + 1; }
  }
  result.push(value.slice(cursor));
  return result;
}

function parseBibtex(source: string): { entries: ParsedBibEntry[]; invalid: ReferenceImportResult["invalid"] } {
  const entries: ParsedBibEntry[] = [];
  const invalid: ReferenceImportResult["invalid"] = [];
  const marker = /@([A-Za-z][\w-]*)\s*([({])/g;
  for (const match of source.matchAll(marker)) {
    const start = match.index ?? 0;
    const opener = match[2];
    if (!opener || !match[1]) continue;
    const closer = opener === "{" ? "}" : ")";
    let depth = 1;
    let quoted = false;
    let end = start + match[0].length;
    for (let index = end; index < source.length; index += 1) {
      const character = source[index];
      if (character === "\\" && quoted) { index += 1; continue; }
      if (character === '"') quoted = !quoted;
      if (!quoted && character === opener) depth += 1;
      if (!quoted && character === closer) { depth -= 1; if (depth === 0) { end = index + 1; break; } }
    }
    if (depth !== 0) { invalid.push({ raw: source.slice(start), message: `Unclosed @${match[1]} entry.`, start, end: source.length }); break; }
    const raw = source.slice(start, end);
    const body = raw.slice(match[0].length, -1);
    if (["comment", "preamble", "string"].includes(match[1].toLocaleLowerCase())) continue;
    const parts = splitTopLevel(body);
    const citationKey = parts.shift()?.trim();
    if (!citationKey) { invalid.push({ raw, message: `@${match[1]} is missing a citation key.`, start, end }); continue; }
    const fields: Record<string, string> = {};
    for (const part of parts) {
      const equal = part.indexOf("=");
      if (equal < 0) { if (part.trim()) invalid.push({ raw: part.trim(), message: `Invalid field in ${citationKey}.`, start, end }); continue; }
      const name = part.slice(0, equal).trim().toLocaleLowerCase();
      if (!name) continue;
      fields[name] = valueWithoutBraces(part.slice(equal + 1));
    }
    entries.push({ entryType: match[1].toLocaleLowerCase(), citationKey, fields, rawBibtex: raw, start, end });
  }
  return { entries, invalid };
}

function now(): string { return new Date().toISOString(); }

export class ReferenceLibraryRepository {
  private readonly db: DatabaseSync;
  constructor(private readonly root: string) { this.db = new DatabaseSync(join(root, "references.sqlite")); }

  async initialize(): Promise<void> {
    await mkdir(dirname(join(this.root, "references.sqlite")), { recursive: true });
    this.db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS library_entries (id TEXT PRIMARY KEY, citation_key TEXT NOT NULL UNIQUE, entry_type TEXT NOT NULL, fields_json TEXT NOT NULL, favorite INTEGER NOT NULL DEFAULT 0, raw_bibtex TEXT, source_file TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
      CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, parent_id TEXT REFERENCES collections(id) ON DELETE SET NULL);
      CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT);
      CREATE TABLE IF NOT EXISTS entry_collections (entry_id TEXT NOT NULL REFERENCES library_entries(id) ON DELETE CASCADE, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, PRIMARY KEY(entry_id, collection_id));
      CREATE TABLE IF NOT EXISTS entry_tags (entry_id TEXT NOT NULL REFERENCES library_entries(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(entry_id, tag_id));
      CREATE TABLE IF NOT EXISTS project_references (project_id TEXT NOT NULL, entry_id TEXT NOT NULL REFERENCES library_entries(id) ON DELETE CASCADE, citation_key TEXT NOT NULL, mode TEXT NOT NULL, target_bib_path TEXT, last_snapshot TEXT, PRIMARY KEY(project_id, entry_id));`);
    const columns = this.db.prepare("PRAGMA table_info(library_entries)").all() as Array<{ name: string }>;
    if (!columns.some((column) => column.name === "favorite")) this.db.exec("ALTER TABLE library_entries ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
  }

  private collectionsFor(entryId: string): string[] { return (this.db.prepare("SELECT c.name FROM collections c JOIN entry_collections ec ON ec.collection_id = c.id WHERE ec.entry_id = ? ORDER BY c.name").all(entryId) as Array<{ name: string }>).map((item) => item.name); }
  private tagsFor(entryId: string): string[] { return (this.db.prepare("SELECT t.name FROM tags t JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ? ORDER BY t.name").all(entryId) as Array<{ name: string }>).map((item) => item.name); }

  snapshot(projectId?: string): ReferenceLibrarySnapshot {
    const entries = (this.db.prepare("SELECT * FROM library_entries WHERE deleted_at IS NULL ORDER BY updated_at DESC, citation_key").all() as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), citationKey: String(row.citation_key), entryType: String(row.entry_type), fields: JSON.parse(String(row.fields_json)) as Record<string, string>, favorite: Number(row.favorite) === 1, ...(row.raw_bibtex ? { rawBibtex: String(row.raw_bibtex) } : {}), ...(row.source_file ? { sourceFile: String(row.source_file) } : {}), tags: this.tagsFor(String(row.id)), collections: this.collectionsFor(String(row.id)), createdAt: String(row.created_at), updatedAt: String(row.updated_at), ...(row.deleted_at ? { deletedAt: String(row.deleted_at) } : {}) } satisfies ReferenceLibraryEntry));
    const collections = this.db.prepare("SELECT id, name, parent_id FROM collections ORDER BY name").all().map((row) => { const item = row as { id: string; name: string; parent_id?: string | null }; return ({ id: item.id, name: item.name, ...(item.parent_id ? { parentId: item.parent_id } : {}) } satisfies ReferenceCollection); });
    const tags = this.db.prepare("SELECT id, name, color FROM tags ORDER BY name").all().map((row) => { const item = row as { id: string; name: string; color?: string | null }; return ({ id: item.id, name: item.name, ...(item.color ? { color: item.color } : {}) } satisfies ReferenceTag); });
    const projectLinkStatement = projectId
      ? this.db.prepare("SELECT project_id, entry_id, citation_key, mode, target_bib_path, last_snapshot FROM project_references WHERE project_id = ?")
      : this.db.prepare("SELECT project_id, entry_id, citation_key, mode, target_bib_path, last_snapshot FROM project_references");
    const projectLinks = (projectId ? projectLinkStatement.all(projectId) : projectLinkStatement.all()).map((row) => { const item = row as { project_id: string; entry_id: string; citation_key: string; mode: ProjectReferenceLink["mode"]; target_bib_path?: string | null; last_snapshot?: string | null }; return ({ projectId: item.project_id, libraryEntryId: item.entry_id, citationKeyInProject: item.citation_key, mode: item.mode, ...(item.target_bib_path ? { targetBibPath: item.target_bib_path } : {}), ...(item.last_snapshot ? { lastSnapshot: item.last_snapshot } : {}) } satisfies ProjectReferenceLink); });
    return { entries, collections, tags, projectLinks };
  }

  async importBibFile(path: string): Promise<ReferenceImportResult> {
    const source = await readFile(path, "utf8");
    const parsed = parseBibtex(source);
    const duplicates: string[] = [];
    const insert = this.db.prepare("INSERT INTO library_entries (id, citation_key, entry_type, fields_json, raw_bibtex, source_file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const timestamp = now();
    this.db.exec("BEGIN");
    try {
      for (const entry of parsed.entries) {
        const existing = this.db.prepare("SELECT id FROM library_entries WHERE citation_key = ? AND deleted_at IS NULL").get(entry.citationKey) as { id?: string } | undefined;
        if (existing?.id) { duplicates.push(entry.citationKey); continue; }
        insert.run(randomUUID(), entry.citationKey, entry.entryType, JSON.stringify(entry.fields), entry.rawBibtex, path, timestamp, timestamp);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { entries: this.snapshot().entries.filter((entry) => entry.sourceFile === path), invalid: parsed.invalid, duplicates };
  }

  async saveEntry(input: Partial<ReferenceLibraryEntry> & Pick<ReferenceLibraryEntry, "citationKey" | "entryType" | "fields">): Promise<ReferenceLibraryEntry> {
    const timestamp = now();
    const id = input.id ?? randomUUID();
    const existing = this.db.prepare("SELECT id FROM library_entries WHERE id = ?").get(id);
    if (existing) this.db.prepare("UPDATE library_entries SET citation_key = ?, entry_type = ?, fields_json = ?, raw_bibtex = ?, updated_at = ?, deleted_at = NULL WHERE id = ?").run(input.citationKey, input.entryType, JSON.stringify(input.fields), input.rawBibtex ?? null, timestamp, id);
    else this.db.prepare("INSERT INTO library_entries (id, citation_key, entry_type, fields_json, favorite, raw_bibtex, source_file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.citationKey, input.entryType, JSON.stringify(input.fields), input.favorite ? 1 : 0, input.rawBibtex ?? null, input.sourceFile ?? null, input.createdAt ?? timestamp, timestamp);
    return this.snapshot().entries.find((entry) => entry.id === id)!;
  }

  setFavorite(id: string, favorite: boolean): void { this.db.prepare("UPDATE library_entries SET favorite = ?, updated_at = ? WHERE id = ?").run(favorite ? 1 : 0, now(), id); }

  removeEntry(id: string): void { this.db.prepare("UPDATE library_entries SET deleted_at = ? WHERE id = ?").run(now(), id); }
  createCollection(name: string, parentId?: string): ReferenceCollection { const id = randomUUID(); this.db.prepare("INSERT INTO collections (id, name, parent_id) VALUES (?, ?, ?)").run(id, name.trim(), parentId ?? null); return { id, name: name.trim(), ...(parentId ? { parentId } : {}) }; }
  setProjectLink(link: ProjectReferenceLink): void { this.db.prepare("INSERT INTO project_references (project_id, entry_id, citation_key, mode, target_bib_path, last_snapshot) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, entry_id) DO UPDATE SET citation_key = excluded.citation_key, mode = excluded.mode, target_bib_path = excluded.target_bib_path, last_snapshot = excluded.last_snapshot").run(link.projectId, link.libraryEntryId, link.citationKeyInProject, link.mode, link.targetBibPath ?? null, link.lastSnapshot ?? null); }
  removeProjectLink(projectId: string, entryId: string): void { this.db.prepare("DELETE FROM project_references WHERE project_id = ? AND entry_id = ?").run(projectId, entryId); }
  close(): void { this.db.close(); }
}
