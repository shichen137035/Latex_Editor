import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Project } from "@latex-editor/contracts";
import { normalizePathKey } from "@latex-editor/domain";

/** 迁移版本；新增字段必须通过 migration，而不是运行时猜测。 */
export const registrySchemaVersion = 1;

interface ProjectRow {
  id: string;
  name: string;
  canonical_path: string;
  created_at: string;
  registered_at: string;
  last_opened_at: string | null;
  last_edited_at: string | null;
  main_file: string | null;
  writable: number;
  missing: number;
  settings_json: string;
}

export interface ProjectRegistry {
  initialize(): void;
  insert(project: Project): void;
  get(id: string): Project | undefined;
  findByCanonicalPath(canonicalPath: string): Project | undefined;
  list(): Project[];
  update(project: Project): void;
  remove(id: string): void;
  close(): void;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    canonicalPath: row.canonical_path,
    createdAt: row.created_at,
    registeredAt: row.registered_at,
    ...(row.last_opened_at === null ? {} : { lastOpenedAt: row.last_opened_at }),
    ...(row.last_edited_at === null ? {} : { lastEditedAt: row.last_edited_at }),
    ...(row.main_file === null ? {} : { mainFile: row.main_file }),
    writable: row.writable === 1,
    missing: row.missing === 1,
    settings: JSON.parse(row.settings_json) as Record<string, unknown>
  };
}

/** 只存项目元数据的 SQLite adapter，源文件始终留在本地项目目录。 */
export class SQLiteProjectRegistry implements ProjectRegistry {
  readonly #database: DatabaseSync;
  readonly #caseInsensitivePaths: boolean;

  constructor(databasePath: string, options?: { caseInsensitivePaths?: boolean }) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.#database = new DatabaseSync(databasePath);
    this.#caseInsensitivePaths = options?.caseInsensitivePaths ?? process.platform === "win32";
  }

  initialize(): void {
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        canonical_path TEXT NOT NULL,
        path_key TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        last_opened_at TEXT,
        last_edited_at TEXT,
        main_file TEXT,
        writable INTEGER NOT NULL DEFAULT 1,
        missing INTEGER NOT NULL DEFAULT 0,
        settings_json TEXT NOT NULL DEFAULT '{}'
      );
    `);
    this.#database.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)")
      .run(registrySchemaVersion, new Date().toISOString());
  }

  insert(project: Project): void {
    this.#database.prepare(`
      INSERT INTO projects (
        id, name, canonical_path, path_key, created_at, registered_at, last_opened_at,
        last_edited_at, main_file, writable, missing, settings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      project.id, project.name, project.canonicalPath, this.#pathKey(project.canonicalPath),
      project.createdAt, project.registeredAt, project.lastOpenedAt ?? null,
      project.lastEditedAt ?? null, project.mainFile ?? null, project.writable ? 1 : 0,
      project.missing ? 1 : 0, JSON.stringify(project.settings)
    );
  }

  get(id: string): Project | undefined {
    const row = this.#database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row === undefined ? undefined : rowToProject(row);
  }

  findByCanonicalPath(canonicalPath: string): Project | undefined {
    const row = this.#database.prepare("SELECT * FROM projects WHERE path_key = ?")
      .get(this.#pathKey(canonicalPath)) as ProjectRow | undefined;
    return row === undefined ? undefined : rowToProject(row);
  }

  list(): Project[] {
    return (this.#database.prepare("SELECT * FROM projects ORDER BY registered_at, id").all() as unknown as ProjectRow[])
      .map(rowToProject);
  }

  update(project: Project): void {
    this.#database.prepare(`
      UPDATE projects SET name = ?, canonical_path = ?, path_key = ?, created_at = ?, registered_at = ?,
        last_opened_at = ?, last_edited_at = ?, main_file = ?, writable = ?, missing = ?, settings_json = ?
      WHERE id = ?
    `).run(
      project.name, project.canonicalPath, this.#pathKey(project.canonicalPath), project.createdAt,
      project.registeredAt, project.lastOpenedAt ?? null, project.lastEditedAt ?? null,
      project.mainFile ?? null, project.writable ? 1 : 0, project.missing ? 1 : 0,
      JSON.stringify(project.settings), project.id
    );
  }

  remove(id: string): void {
    this.#database.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  close(): void {
    this.#database.close();
  }

  #pathKey(canonicalPath: string): string {
    return normalizePathKey(canonicalPath, this.#caseInsensitivePaths);
  }
}
