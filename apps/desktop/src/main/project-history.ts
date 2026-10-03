import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { HistoryFileChange, HistoryPreferences, Project, ProjectHistoryDetails, ProjectHistoryEntry, ProjectHistoryStorage, ProjectHistoryType, SnapshotReason } from "@latex-editor/contracts" with { "resolution-mode": "import" };

type Manifest = Record<string, string>;
type EntryRow = { id: string; type: ProjectHistoryType; created_at: string; manifest_id: string; title: string | null; summary: string | null; version_number: string | null; reason: SnapshotReason | null; parent_history_id: string | null; file_count: number };
type Store = { root: string; historyRoot: string; db: DatabaseSync };

const ignoredDirectories = new Set(["node_modules", ".git", "dist", "release", "build", "coverage", "cache"]);
const ignoredSuffixes = [".aux", ".log", ".toc", ".out", ".synctex.gz", ".fls", ".fdb_latexmk", ".bbl", ".blg", ".nav", ".snm"];
const hash = (content: Buffer | string) => createHash("sha256").update(content).digest("hex");
function validateRelativePath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.includes("\0") || isAbsolute(path) || /^[A-Za-z]:/.test(path)
    || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid project history path");
  return normalized;
}
async function safeProjectPath(root: string, path: string, mustExist: boolean): Promise<string> {
  const { resolveSafeProjectPath } = await import("@latex-editor/filesystem-node");
  return resolveSafeProjectPath(root, path, mustExist);
}
const entryFromRow = (row: EntryRow): ProjectHistoryEntry => ({
  id: row.id, type: row.type, createdAt: row.created_at, manifestId: row.manifest_id, fileCount: row.file_count,
  ...(row.title !== null ? { title: row.title } : {}), ...(row.summary !== null ? { summary: row.summary } : {}),
  ...(row.version_number !== null ? { versionNumber: row.version_number } : {}), ...(row.reason !== null ? { reason: row.reason } : {}),
  ...(row.parent_history_id !== null ? { parentHistoryId: row.parent_history_id } : {})
});

function shouldKeep(path: string): boolean {
  const parts = path.toLowerCase().split("/");
  if (parts.some((part) => ignoredDirectories.has(part))) return false;
  if (parts[0] === ".texweave" && ["history", "cache"].includes(parts[1] ?? "")) return false;
  const name = parts.at(-1)!.toLowerCase();
  return !ignoredSuffixes.some((suffix) => name.endsWith(suffix)) && !name.endsWith(".tmp");
}

async function writeOnce(path: string, content: Buffer | string): Promise<void> {
  try { await stat(path); return; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: "wx" });
    try { await rename(temporary, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  } finally { await rm(temporary, { force: true }); }
}

async function replaceFile(path: string, content: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { flag: "wx" }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

/** Local project-file history. Electron IPC is only a transport around this service. */
export class ProjectHistoryService {
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(private readonly project: (id: string) => Project, private readonly preferences: (id: string) => Promise<HistoryPreferences>) {}

  private run<T>(projectId: string, work: (store: Store) => Promise<T>): Promise<T> {
    const previous = this.pending.get(projectId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const project = this.project(projectId);
      const root = await realpath(project.canonicalPath);
      const historyRoot = join(root, ".texweave", "history");
      await mkdir(historyRoot, { recursive: true });
      const db = new DatabaseSync(join(historyRoot, "history.db"));
      try {
        db.exec(`PRAGMA journal_mode = WAL;
          CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, type TEXT NOT NULL, created_at TEXT NOT NULL, manifest_id TEXT NOT NULL, title TEXT, summary TEXT, version_number TEXT, reason TEXT, parent_history_id TEXT, file_count INTEGER NOT NULL);
          CREATE UNIQUE INDEX IF NOT EXISTS unique_version_number ON entries(version_number) WHERE type = 'version';
          CREATE INDEX IF NOT EXISTS entries_recent ON entries(created_at DESC);
          CREATE TABLE IF NOT EXISTS file_index (path TEXT PRIMARY KEY, size TEXT NOT NULL, mtime_ns TEXT NOT NULL, ctime_ns TEXT NOT NULL, hash TEXT NOT NULL);`);
        return await work({ root, historyRoot, db });
      } finally { db.close(); }
    });
    this.pending.set(projectId, next);
    void next.finally(() => { if (this.pending.get(projectId) === next) this.pending.delete(projectId); }).catch(() => undefined);
    return next;
  }

  private rows(store: Store): EntryRow[] {
    return store.db.prepare("SELECT * FROM entries ORDER BY created_at DESC, rowid DESC").all() as EntryRow[];
  }

  private row(store: Store, id: string): EntryRow {
    const row = store.db.prepare("SELECT * FROM entries WHERE id = ?").get(id) as EntryRow | undefined;
    if (!row) throw new Error("History entry was not found");
    return row;
  }

  private async walk(root: string): Promise<Array<{ path: string; absolute: string }>> {
    const files: Array<{ path: string; absolute: string }> = [];
    const visit = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const absolute = join(directory, entry.name);
        const path = relative(root, absolute).split(sep).join("/");
        if (!shouldKeep(path) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) files.push({ path, absolute });
      }
    };
    await visit(root);
    const paths = new Set(files.map((file) => file.path.toLowerCase()));
    return files.filter((file) => !file.path.toLowerCase().endsWith(".pdf") || !paths.has(file.path.slice(0, -4).toLowerCase() + ".tex"))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private objectPath(store: Store, id: string): string { return join(store.historyRoot, "objects", id); }
  private manifestPath(store: Store, id: string): string { return join(store.historyRoot, "manifests", `${id}.json`); }

  private async capture(store: Store, overrides: Array<{ path: string; content: string }> = []): Promise<{ id: string; files: Manifest }> {
    const files: Manifest = Object.create(null) as Manifest;
    const overrideMap = new Map(overrides.map((entry) => [validateRelativePath(entry.path), entry.content]));
    for (const path of overrideMap.keys()) if (!shouldKeep(path)) throw new Error("Cannot snapshot an excluded project file");
    const indexed = store.db.prepare("SELECT size, mtime_ns, ctime_ns, hash FROM file_index WHERE path = ?");
    const update = store.db.prepare("INSERT INTO file_index(path, size, mtime_ns, ctime_ns, hash) VALUES (?, ?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size=excluded.size, mtime_ns=excluded.mtime_ns, ctime_ns=excluded.ctime_ns, hash=excluded.hash");
    for (const file of await this.walk(store.root)) {
      const override = overrideMap.get(file.path);
      if (override !== undefined) {
        const content = Buffer.from(override, "utf8");
        const id = hash(content);
        await writeOnce(this.objectPath(store, id), content);
        files[file.path] = id;
        overrideMap.delete(file.path);
        continue;
      }
      const info = await stat(file.absolute, { bigint: true });
      const cached = indexed.get(file.path) as { size: string; mtime_ns: string; ctime_ns: string; hash: string } | undefined;
      const size = String(info.size), mtime = String(info.mtimeNs), ctime = String(info.ctimeNs);
      if (cached?.size === size && cached.mtime_ns === mtime && cached.ctime_ns === ctime) {
        try { await stat(this.objectPath(store, cached.hash)); files[file.path] = cached.hash; continue; }
        catch { /* Rebuild a missing cached object. */ }
      }
      const content = await readFile(file.absolute);
      const id = hash(content);
      await writeOnce(this.objectPath(store, id), content);
      update.run(file.path, size, mtime, ctime, id);
      files[file.path] = id;
    }
    for (const [path, content] of overrideMap) {
      await safeProjectPath(store.root, path, false);
      const bytes = Buffer.from(content, "utf8");
      const id = hash(bytes);
      await writeOnce(this.objectPath(store, id), bytes);
      files[path] = id;
    }
    const serialized = JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
    const id = hash(serialized);
    await writeOnce(this.manifestPath(store, id), serialized);
    return { id, files };
  }

  private async manifest(store: Store, id: string): Promise<Manifest> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid history manifest");
    const content = await readFile(this.manifestPath(store, id), "utf8");
    if (hash(content) !== id) throw new Error("History manifest is damaged");
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid history manifest");
    const files: Manifest = Object.create(null) as Manifest;
    for (const [path, objectId] of Object.entries(parsed)) {
      validateRelativePath(path);
      if (!shouldKeep(path) || typeof objectId !== "string" || !/^[a-f0-9]{64}$/.test(objectId)) throw new Error("History manifest contains an invalid file");
      files[path] = objectId;
    }
    return files;
  }

  private add(store: Store, input: { type: ProjectHistoryType; manifestId: string; fileCount: number; title?: string; summary?: string; versionNumber?: string; reason?: SnapshotReason }): ProjectHistoryEntry {
    const previous = this.rows(store)[0];
    const row: EntryRow = { id: randomUUID(), type: input.type, created_at: new Date().toISOString(), manifest_id: input.manifestId,
      title: input.title ?? null, summary: input.summary ?? null, version_number: input.versionNumber ?? null,
      reason: input.reason ?? null, parent_history_id: previous?.id ?? null, file_count: input.fileCount };
    store.db.prepare("INSERT INTO entries(id, type, created_at, manifest_id, title, summary, version_number, reason, parent_history_id, file_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(row.id, row.type, row.created_at, row.manifest_id, row.title, row.summary, row.version_number, row.reason, row.parent_history_id, row.file_count);
    return entryFromRow(row);
  }

  private async snapshotInStore(store: Store, reason: SnapshotReason, description: string | undefined, config: HistoryPreferences, overrides?: Array<{ path: string; content: string }>): Promise<ProjectHistoryEntry | undefined> {
    if (reason === "interval" && !config.autoSnapshot) return undefined;
    const latest = this.rows(store).find((row) => row.type === "snapshot");
    if (reason === "interval" && latest && Date.now() - Date.parse(latest.created_at) < config.intervalMinutes * 60_000) return undefined;
    const captured = await this.capture(store, overrides);
    if (reason === "interval" && latest?.manifest_id === captured.id) return undefined;
    const entry = this.add(store, { type: "snapshot", manifestId: captured.id, fileCount: Object.keys(captured.files).length, reason, ...(description ? { title: description.trim().slice(0, 200) } : {}) });
    // A restore must not evict either its source snapshot or its undo point.
    // Retention runs on the next routine snapshot or explicit optimization.
    if (reason !== "pre-restore") this.prune(store, config);
    return entry;
  }

  private prune(store: Store, config: HistoryPreferences): void {
    const snapshots = this.rows(store).filter((row) => row.type === "snapshot");
    const cutoff = Date.now() - config.retentionDays * 86_400_000;
    for (const [index, row] of snapshots.entries()) {
      if (index >= config.maxSnapshots || Date.parse(row.created_at) < cutoff)
        store.db.prepare("DELETE FROM entries WHERE id = ?").run(row.id);
    }
  }

  list(projectId: string): Promise<ProjectHistoryEntry[]> { return this.run(projectId, async (store) => this.rows(store).map(entryFromRow)); }

  createVersion(projectId: string, input: { versionNumber: string; title: string; summary?: string }): Promise<ProjectHistoryEntry> {
    return this.run(projectId, async (store) => {
      const versionNumber = input.versionNumber.trim();
      if (!/^[0-9]+(?:\.[0-9]+){1,5}$/.test(versionNumber)) throw new Error("Enter a numeric version such as 1.0 or 2.3.1");
      if (this.rows(store).some((row) => row.type === "version" && row.version_number === versionNumber)) throw new Error("This version number already exists");
      const captured = await this.capture(store);
      return this.add(store, { type: "version", manifestId: captured.id, fileCount: Object.keys(captured.files).length, versionNumber, title: input.title.trim().slice(0, 200), ...(input.summary ? { summary: input.summary.trim().slice(0, 4000) } : {}) });
    });
  }

  createTemporary(projectId: string, input: { title: string; summary?: string }): Promise<ProjectHistoryEntry> {
    return this.run(projectId, async (store) => {
      const captured = await this.capture(store);
      return this.add(store, { type: "temporary", manifestId: captured.id, fileCount: Object.keys(captured.files).length, title: input.title.trim().slice(0, 200), ...(input.summary ? { summary: input.summary.trim().slice(0, 4000) } : {}) });
    });
  }

  snapshot(projectId: string, reason: SnapshotReason, description?: string, overrides?: Array<{ path: string; content: string }>): Promise<ProjectHistoryEntry | undefined> {
    return this.run(projectId, async (store) => this.snapshotInStore(store, reason, description, await this.preferences(projectId), overrides));
  }

  details(projectId: string, entryId: string): Promise<ProjectHistoryDetails> {
    return this.run(projectId, async (store) => {
      const entry = entryFromRow(this.row(store, entryId));
      const historical = await this.manifest(store, entry.manifestId);
      const current = (await this.capture(store)).files;
      const changes: HistoryFileChange[] = [...new Set([...Object.keys(historical), ...Object.keys(current)])].sort().flatMap((path) => {
        if (historical[path] === current[path]) return [];
        return [{ path, status: historical[path] === undefined ? "added" : current[path] === undefined ? "removed" : "modified", inHistory: historical[path] !== undefined }];
      });
      return { entry, files: Object.keys(historical), changes };
    });
  }

  readText(projectId: string, entryId: string, path: string): Promise<string | undefined> {
    return this.run(projectId, async (store) => {
      const manifest = await this.manifest(store, this.row(store, entryId).manifest_id);
      const id = manifest[validateRelativePath(path)];
      if (!id) return undefined;
      const content = await readFile(this.objectPath(store, id));
      if (hash(content) !== id) throw new Error("History object is damaged");
      if (content.length > 4_000_000) return undefined;
      try { return new TextDecoder("utf-8", { fatal: true }).decode(content); } catch { return undefined; }
    });
  }

  private async apply(store: Store, historical: Manifest, paths: string[]): Promise<void> {
    const writes: Array<{ path: string; content: Buffer }> = [];
    for (const path of paths) {
      validateRelativePath(path);
      if (!shouldKeep(path)) throw new Error("This file is excluded from project history");
      const id = historical[path];
      if (!id) continue;
      const content = await readFile(this.objectPath(store, id));
      if (hash(content) !== id) throw new Error(`History object is damaged: ${path}`);
      writes.push({ path, content });
    }
    for (const { path, content } of writes) await replaceFile(await safeProjectPath(store.root, path, false), content);
    for (const path of paths) if (!historical[path]) {
      try { await rm(await safeProjectPath(store.root, path, true), { force: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    store.db.prepare("DELETE FROM file_index").run();
  }

  restore(projectId: string, entryId: string, selectedPaths?: string[]): Promise<{ restored: string[]; safetySnapshotId?: string }> {
    return this.run(projectId, async (store) => {
      if (!this.project(projectId).writable) throw new Error("Project is not writable");
      const target = this.row(store, entryId);
      const historical = await this.manifest(store, target.manifest_id);
      const current = (await this.capture(store)).files;
      const available = new Set([...Object.keys(current), ...Object.keys(historical)]);
      const paths = selectedPaths ? [...new Set(selectedPaths.map(validateRelativePath))] : [...available];
      if (paths.some((path) => !available.has(path))) throw new Error("Selected file is not part of the project history");
      // Verify every object and destination before creating the safety point or changing files.
      for (const path of paths) {
        await safeProjectPath(store.root, path, historical[path] === undefined && current[path] !== undefined);
        if (historical[path]) {
          const content = await readFile(this.objectPath(store, historical[path]));
          if (hash(content) !== historical[path]) throw new Error(`History object is damaged: ${path}`);
        }
      }
      const config = await this.preferences(projectId);
      const safety = config.beforeRestore ? await this.snapshotInStore(store, "pre-restore", `Before restoring ${target.version_number ?? target.title ?? target.type}`, config) : undefined;
      try { await this.apply(store, historical, paths); }
      catch (error) {
        await this.apply(store, current, paths).catch(() => undefined);
        throw error;
      }
      return { restored: paths, ...(safety ? { safetySnapshotId: safety.id } : {}) };
    });
  }

  promote(projectId: string, entryId: string, input: { versionNumber: string; title: string; summary?: string }): Promise<ProjectHistoryEntry> {
    return this.run(projectId, async (store) => {
      const original = this.row(store, entryId);
      if (original.type === "version") throw new Error("This entry is already a version");
      const versionNumber = input.versionNumber.trim();
      if (!/^[0-9]+(?:\.[0-9]+){1,5}$/.test(versionNumber)) throw new Error("Enter a numeric version number");
      if (this.rows(store).some((row) => row.type === "version" && row.version_number === versionNumber)) throw new Error("This version number already exists");
      return this.add(store, { type: "version", manifestId: original.manifest_id, fileCount: original.file_count, versionNumber, title: input.title.trim().slice(0, 200), ...(input.summary ? { summary: input.summary.trim().slice(0, 4000) } : {}) });
    });
  }

  editVersion(projectId: string, entryId: string, input: { title: string; summary?: string }): Promise<ProjectHistoryEntry> {
    return this.run(projectId, async (store) => {
      if (this.row(store, entryId).type !== "version") throw new Error("Only version metadata can be edited");
      store.db.prepare("UPDATE entries SET title = ?, summary = ? WHERE id = ?").run(input.title.trim().slice(0, 200), input.summary?.trim().slice(0, 4000) ?? null, entryId);
      return entryFromRow(this.row(store, entryId));
    });
  }

  remove(projectId: string, entryId: string): Promise<void> {
    return this.run(projectId, async (store) => { this.row(store, entryId); store.db.prepare("DELETE FROM entries WHERE id = ?").run(entryId); });
  }

  private async storageInStore(store: Store): Promise<ProjectHistoryStorage> {
    const rows = this.rows(store);
    let bytes = 0;
    for (const name of ["history.db", "history.db-wal", "history.db-shm"]) {
      try { bytes += Number((await stat(join(store.historyRoot, name))).size); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    for (const folder of ["objects", "manifests"]) {
      try { for (const entry of await readdir(join(store.historyRoot, folder))) bytes += Number((await stat(join(store.historyRoot, folder, entry))).size); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return { bytes, versions: rows.filter((row) => row.type === "version").length, snapshots: rows.filter((row) => row.type === "snapshot").length, temporary: rows.filter((row) => row.type === "temporary").length };
  }

  storage(projectId: string): Promise<ProjectHistoryStorage> { return this.run(projectId, (store) => this.storageInStore(store)); }

  optimize(projectId: string): Promise<ProjectHistoryStorage> {
    return this.run(projectId, async (store) => {
      this.prune(store, await this.preferences(projectId));
      const manifests = new Set(this.rows(store).map((row) => row.manifest_id));
      const objects = new Set<string>();
      for (const id of manifests) for (const objectId of Object.values(await this.manifest(store, id))) objects.add(objectId);
      for (const [folder, keep, suffix] of [["manifests", manifests, ".json"], ["objects", objects, ""]] as const) {
        try { for (const name of await readdir(join(store.historyRoot, folder))) {
          const id = suffix ? name.replace(/\.json$/, "") : name;
          if (!keep.has(id) && /^[a-f0-9]{64}$/.test(id)) await rm(join(store.historyRoot, folder, name));
        } } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      store.db.prepare("DELETE FROM file_index").run();
      store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
      return this.storageInStore(store);
    });
  }
}
