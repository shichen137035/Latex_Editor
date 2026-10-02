import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { ProjectReferenceLink, ReferenceCollection, ReferenceImportResult, ReferenceLibraryEntry, ReferenceLibrarySnapshot, ReferenceTag } from "@latex-editor/contracts" with { "resolution-mode": "import" };

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
    const { parseBibtex, citationKeyIdentity } = await import("@latex-editor/editor-core/bibtex");
    const source = await readFile(path, "utf8");
    const parsed = parseBibtex(source);
    const duplicates: string[] = [];
    const insert = this.db.prepare("INSERT INTO library_entries (id, citation_key, entry_type, fields_json, raw_bibtex, source_file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const timestamp = now();
    const knownKeys = new Map((this.db.prepare("SELECT id, citation_key, deleted_at FROM library_entries").all() as Array<{ id: string; citation_key: string; deleted_at?: string | null }>).map((row) => [citationKeyIdentity(row.citation_key), row]));
    this.db.exec("BEGIN");
    try {
      for (const entry of parsed.entries.filter((item) => item.valid)) {
        const identity = citationKeyIdentity(entry.citationKey);
        const existing = knownKeys.get(identity);
        if (existing && !existing.deleted_at) { duplicates.push(entry.citationKey); continue; }
        if (existing) {
          this.db.prepare("UPDATE library_entries SET citation_key = ?, entry_type = ?, fields_json = ?, raw_bibtex = ?, source_file = ?, updated_at = ?, deleted_at = NULL WHERE id = ?")
            .run(entry.citationKey, entry.entryType, JSON.stringify(entry.fields), entry.rawBibtex, path, timestamp, existing.id);
          knownKeys.set(identity, { id: existing.id, citation_key: entry.citationKey, deleted_at: null });
          continue;
        }
        insert.run(randomUUID(), entry.citationKey, entry.entryType, JSON.stringify(entry.fields), entry.rawBibtex, path, timestamp, timestamp);
        knownKeys.set(identity, { id: "", citation_key: entry.citationKey, deleted_at: null });
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { entries: this.snapshot().entries.filter((entry) => entry.sourceFile === path), invalid: parsed.invalid, duplicates };
  }

  async saveEntry(input: Partial<ReferenceLibraryEntry> & Pick<ReferenceLibraryEntry, "citationKey" | "entryType" | "fields">): Promise<ReferenceLibraryEntry> {
    const { citationKeyIdentity } = await import("@latex-editor/editor-core/bibtex");
    const timestamp = now();
    const keyedRows = this.db.prepare("SELECT id, citation_key, deleted_at FROM library_entries").all() as Array<{ id: string; citation_key: string; deleted_at?: string | null }>;
    const identity = citationKeyIdentity(input.citationKey);
    const keyed = keyedRows.find((row) => citationKeyIdentity(row.citation_key) === identity);
    const conflictingKey = input.id ? keyedRows.find((row) => row.id !== input.id && citationKeyIdentity(row.citation_key) === identity) : undefined;
    if (conflictingKey) throw new Error(`Citation key already exists: ${input.citationKey}`);
    if (!input.id) {
      if (keyed && !keyed.deleted_at) {
        const existing = this.snapshot().entries.find((entry) => entry.id === keyed.id);
        if (existing) return existing;
      }
      // A soft-deleted row still owns its unique citation key; restore it instead
      // of letting an add-from-preview action fail with a SQLite constraint error.
      if (keyed?.deleted_at) {
        this.db.prepare("UPDATE library_entries SET entry_type = ?, fields_json = ?, raw_bibtex = ?, source_file = ?, updated_at = ?, deleted_at = NULL WHERE id = ?")
          .run(input.entryType, JSON.stringify(input.fields), input.rawBibtex ?? null, input.sourceFile ?? null, timestamp, keyed.id);
        if (input.tags !== undefined) this.syncEntryTags(keyed.id, input.tags);
        return this.snapshot().entries.find((entry) => entry.id === keyed.id)!;
      }
    }
    const id = input.id ?? randomUUID();
    const existing = this.db.prepare("SELECT id FROM library_entries WHERE id = ?").get(id);
    if (existing) this.db.prepare("UPDATE library_entries SET citation_key = ?, entry_type = ?, fields_json = ?, raw_bibtex = ?, updated_at = ?, deleted_at = NULL WHERE id = ?").run(input.citationKey, input.entryType, JSON.stringify(input.fields), input.rawBibtex ?? null, timestamp, id);
    else this.db.prepare("INSERT INTO library_entries (id, citation_key, entry_type, fields_json, favorite, raw_bibtex, source_file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.citationKey, input.entryType, JSON.stringify(input.fields), input.favorite ? 1 : 0, input.rawBibtex ?? null, input.sourceFile ?? null, input.createdAt ?? timestamp, timestamp);
    if (input.tags !== undefined) this.syncEntryTags(id, input.tags);
    return this.snapshot().entries.find((entry) => entry.id === id)!;
  }

  private syncEntryTags(entryId: string, names: string[]): void {
    const distinctNames = new Map<string, string>();
    for (const name of names) {
      if (typeof name !== "string") continue;
      const normalized = name.trim();
      if (normalized) distinctNames.set(normalized.toLocaleLowerCase(), normalized);
    }
    const tagIds = [...distinctNames.values()].map((name) => this.ensureTag(name));
    this.db.prepare("DELETE FROM entry_tags WHERE entry_id = ?").run(entryId);
    const insert = this.db.prepare("INSERT INTO entry_tags (entry_id, tag_id) VALUES (?, ?)");
    for (const tagId of tagIds) insert.run(entryId, tagId);
  }

  private ensureTag(name: string): string {
    const normalized = name.trim();
    if (!normalized) throw new Error("Tag names cannot be empty.");
    const existing = this.db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE").get(normalized) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = randomUUID();
    this.db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(id, normalized);
    return id;
  }

  setFavorite(id: string, favorite: boolean): void { this.db.prepare("UPDATE library_entries SET favorite = ?, updated_at = ? WHERE id = ?").run(favorite ? 1 : 0, now(), id); }

  removeEntry(id: string): void { this.db.prepare("UPDATE library_entries SET deleted_at = ? WHERE id = ?").run(now(), id); }
  createCollection(name: string, parentId?: string): ReferenceCollection { const id = randomUUID(); this.db.prepare("INSERT INTO collections (id, name, parent_id) VALUES (?, ?, ?)").run(id, name.trim(), parentId ?? null); return { id, name: name.trim(), ...(parentId ? { parentId } : {}) }; }
  createTag(name: string): ReferenceTag {
    const normalized = name.trim();
    if (!normalized) throw new Error("Tag names cannot be empty.");
    const existing = this.db.prepare("SELECT id, name, color FROM tags WHERE name = ? COLLATE NOCASE").get(normalized) as { id: string; name: string; color?: string | null } | undefined;
    if (existing) return { id: existing.id, name: existing.name, ...(existing.color ? { color: existing.color } : {}) };
    const tag = { id: randomUUID(), name: normalized };
    this.db.prepare("INSERT INTO tags (id, name) VALUES (?, ?)").run(tag.id, tag.name);
    return tag;
  }
  renameTag(id: string, name: string): ReferenceTag {
    const normalized = name.trim();
    if (!normalized) throw new Error("Tag names cannot be empty.");
    const conflict = this.db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id != ?").get(normalized, id);
    if (conflict) throw new Error(`A tag named “${normalized}” already exists.`);
    const result = this.db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(normalized, id);
    if (!result.changes) throw new Error("Tag was not found.");
    const tag = this.db.prepare("SELECT id, name, color FROM tags WHERE id = ?").get(id) as { id: string; name: string; color?: string | null };
    return { id: tag.id, name: tag.name, ...(tag.color ? { color: tag.color } : {}) };
  }
  removeTag(id: string): void { this.db.prepare("DELETE FROM tags WHERE id = ?").run(id); }
  setProjectLink(link: ProjectReferenceLink): void { this.db.prepare("INSERT INTO project_references (project_id, entry_id, citation_key, mode, target_bib_path, last_snapshot) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(project_id, entry_id) DO UPDATE SET citation_key = excluded.citation_key, mode = excluded.mode, target_bib_path = excluded.target_bib_path, last_snapshot = excluded.last_snapshot").run(link.projectId, link.libraryEntryId, link.citationKeyInProject, link.mode, link.targetBibPath ?? null, link.lastSnapshot ?? null); }
  removeProjectLink(projectId: string, entryId: string): void { this.db.prepare("DELETE FROM project_references WHERE project_id = ? AND entry_id = ?").run(projectId, entryId); }
  close(): void { this.db.close(); }
}
