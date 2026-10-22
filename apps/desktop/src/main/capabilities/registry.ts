import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { capabilityManifest, digest, registeredHandlerKeys } from "./manifest.js";
import { assertSupportedSchema } from "./schema.js";
import { capabilityTransportStatus, functionTool } from "./adapters.js";
import { CapabilityError, type Capability } from "./types.js";

export const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}_.]+/gu, " ").trim();
const versionedPath = (path: string, hash: string) => `${path}.${hash.slice(0, 16)}.sqlite`;

export function validateManifest(manifest: Capability[]): void {
  const ids = new Set<string>(), names = new Set<string>();
  for (const cap of manifest) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(cap.id) || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(cap.apiName) || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(cap.namespace) || ids.has(cap.id) || names.has(cap.apiName) || ["tw_search_capabilities", "tw_get_capability", "tw_get_state", "tw_plan_operation", "tw_execute_operation"].includes(cap.apiName)) throw new Error("Invalid or duplicate capability identifier");
    ids.add(cap.id); names.add(cap.apiName);
    if (!registeredHandlerKeys.has(cap.handlerKey) || !cap.permissions.length || !cap.scopes.length || !cap.aliases.en || !cap.aliases["zh-CN"] || !cap.aliases.ja) throw new Error(`Incomplete or unknown handler: ${cap.id}`);
    if (!["none", "reversible", "external"].includes(cap.sideEffect) || !["auto", "confirm", "restricted"].includes(cap.approvalPolicy)) throw new Error(`Invalid policy: ${cap.id}`);
    assertSupportedSchema(cap.inputSchema);
    // Build-time contract: every future capability must project to the native transport too.
    functionTool(cap);
    if (cap.schemaHash !== digest(cap.inputSchema)) throw new Error(`Invalid schema hash: ${cap.id}`);
  }
}

/** Built at package/dev build time. No user settings or executable source in this database. */
export async function buildCapabilityRegistry(path: string, appVersion: string): Promise<{ count: number; manifestHash: string }> {
  const manifest = await capabilityManifest(); validateManifest(manifest);
  const hash = digest(manifest);
  for (const candidate of [path, versionedPath(path, hash)]) if (existsSync(candidate)) {
    let previous: DatabaseSync | undefined;
    try {
      previous = new DatabaseSync(candidate, { readOnly: true });
      const row = previous.prepare("SELECT value FROM registry_meta WHERE key='manifest_hash'").get();
      const version = previous.prepare("SELECT value FROM registry_meta WHERE key='app_version'").get();
      const rows = previous.prepare("SELECT descriptor_json FROM capabilities").all().map(row => JSON.parse(String(row.descriptor_json)) as Capability).sort((a, b) => a.id.localeCompare(b.id));
      if (row?.value === hash && digest(rows) === hash && version?.value === appVersion && previous.prepare("PRAGMA quick_check").get()?.quick_check === "ok") return { count: manifest.length, manifestHash: hash };
    } catch { /* Rebuild only from compiled descriptors. */ }
    finally { previous?.close(); }
  }
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  rmSync(temp, { force: true });
  const db = new DatabaseSync(temp);
  try {
    db.exec(`PRAGMA foreign_keys=ON; BEGIN;
      CREATE TABLE registry_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE namespaces(id TEXT PRIMARY KEY,title TEXT NOT NULL);
      CREATE TABLE capabilities(id TEXT PRIMARY KEY,api_name TEXT UNIQUE NOT NULL,namespace_id TEXT NOT NULL REFERENCES namespaces(id),handler_key TEXT NOT NULL,schema_hash TEXT NOT NULL,descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json)));
      CREATE TABLE capability_aliases(capability_id TEXT REFERENCES capabilities(id),locale TEXT,alias TEXT,normalized_alias TEXT,UNIQUE(capability_id,locale,normalized_alias));
      CREATE INDEX aliases_lookup ON capability_aliases(normalized_alias);
      CREATE TABLE capability_search_doc(capability_id TEXT UNIQUE REFERENCES capabilities(id),search_text TEXT NOT NULL);
      CREATE INDEX capability_namespace ON capabilities(namespace_id);`);
    for (const [key, value] of Object.entries({ schema_version: "1", app_version: appVersion, manifest_hash: hash, catalog_version: hash, source_version: appVersion, search_index_version: "1" })) db.prepare("INSERT INTO registry_meta VALUES(?,?)").run(key, value);
    for (const namespace of new Set(manifest.map(cap => cap.namespace))) db.prepare("INSERT INTO namespaces VALUES(?,?)").run(namespace, namespace);
    for (const cap of manifest) {
      db.prepare("INSERT INTO capabilities VALUES(?,?,?,?,?,?)").run(cap.id, cap.apiName, cap.namespace, cap.handlerKey, cap.schemaHash, JSON.stringify(cap));
      for (const [locale, aliases] of Object.entries(cap.aliases)) for (const alias of aliases) db.prepare("INSERT OR IGNORE INTO capability_aliases VALUES(?,?,?,?)").run(cap.id, locale, alias, normalize(alias));
      db.prepare("INSERT INTO capability_search_doc VALUES(?,?)").run(cap.id, normalize([cap.id, cap.apiName, cap.title, cap.description, ...Object.values(cap.aliases).flat()].join(" ")));
    }
    try {
      db.exec("SAVEPOINT fts; CREATE VIRTUAL TABLE capability_fts_words USING fts5(search_text,content='capability_search_doc',content_rowid='rowid',tokenize='unicode61'); INSERT INTO capability_fts_words(capability_fts_words) VALUES('rebuild'); CREATE VIRTUAL TABLE capability_fts_trigram USING fts5(search_text,content='capability_search_doc',content_rowid='rowid',tokenize='trigram'); INSERT INTO capability_fts_trigram(capability_fts_trigram) VALUES('rebuild'); RELEASE fts;");
    } catch { db.exec("ROLLBACK TO fts; RELEASE fts;"); }
    db.exec("COMMIT; VACUUM;");
  } finally { db.close(); }
  try { renameSync(temp, path); }
  catch (error) {
    // Windows may keep the old catalog open in a running app. Preserve that app's
    // immutable database and let the next startup select this exact manifest.
    if (!["EPERM", "EBUSY", "EACCES"].includes(String((error as NodeJS.ErrnoException).code))) { rmSync(temp, { force: true }); throw error; }
    try { renameSync(temp, versionedPath(path, hash)); }
    catch (nextError) { rmSync(temp, { force: true }); throw nextError; }
  }
  return { count: manifest.length, manifestHash: hash };
}

/** Runtime authority is the read-only packaged database, checked against the compiled handler manifest. */
export class CapabilityRegistry {
  private db: DatabaseSync | undefined;
  private manifestHash = "";
  private count = 0;
  private fts = false;
  private failure = "Capability registry has not been initialized.";
  private readonly descriptorHashes = new Map<string, string>();
  readonly metrics = { searches: 0, definitionsLoaded: 0, searchMilliseconds: 0 };
  async initialize(path: string): Promise<void> {
    this.close(); this.descriptorHashes.clear(); this.count = 0; this.manifestHash = "";
    try {
      const expected = await capabilityManifest(); validateManifest(expected);
      const candidate = versionedPath(path, digest(expected));
      this.db = new DatabaseSync(existsSync(candidate) ? candidate : path, { readOnly: true });
      if (this.db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok" || this.db.prepare("SELECT value FROM registry_meta WHERE key='schema_version'").get()?.value !== "1") throw new Error("Invalid registry version or database integrity");
      const rows = this.db.prepare("SELECT descriptor_json FROM capabilities ORDER BY id").all();
      const actual = rows.map(row => JSON.parse(String(row.descriptor_json)) as Capability).sort((a, b) => a.id.localeCompare(b.id));
      // Compare complete descriptors, not only a modifiable hash column.
      if (digest(actual) !== digest(expected)) throw new Error("Registry and compiled handlers do not match");
      this.manifestHash = digest(expected); this.count = actual.length;
      expected.forEach(cap => this.descriptorHashes.set(cap.id, digest(cap)));
      this.fts = Boolean(this.db.prepare("SELECT name FROM sqlite_master WHERE name='capability_fts_trigram'").get());
      this.failure = "";
    } catch {
      this.db?.close(); this.db = undefined;
      this.failure = "The capability catalog is missing, corrupt, or incompatible. AI capability tools are disabled; rebuild or reinstall TeXWeave. Ordinary editing remains available.";
    }
  }
  status() { return { available: !!this.db, schemaVersion: 1, manifestHash: this.manifestHash, count: this.count, search: this.fts ? "fts5-and-aliases" : "bounded-scan-and-aliases", ...(this.failure ? { error: this.failure } : {}), metrics: { ...this.metrics }, transports: { ...capabilityTransportStatus } }; }
  get(id: string): Capability | undefined {
    if (!this.db) throw new CapabilityError("UNAVAILABLE", this.failure);
    const row = this.db.prepare("SELECT descriptor_json FROM capabilities WHERE id=? OR api_name=?").get(id, id);
    if (!row) return undefined;
    return this.validateDescriptor(JSON.parse(String(row.descriptor_json)) as Capability);
  }
  private validateDescriptor(cap: Capability): Capability {
    if (this.descriptorHashes.get(cap.id) !== digest(cap)) {
      this.failure = "Catalog changed after startup. Capability execution is disabled; rebuild or reinstall.";
      this.close();
      throw new CapabilityError("STALE_SCHEMA", this.failure);
    }
    return cap;
  }
  search(query: string, limit = 5, contextBoost?: (cap: Capability) => number): { candidates: Capability[]; hasMore: boolean } {
    if (!this.db) throw new CapabilityError("UNAVAILABLE", this.failure);
    const start = performance.now(); this.metrics.searches++;
    const normalized = normalize(query).slice(0, 500), words = normalized.split(/\s+/).filter(Boolean);
    if (!normalized) return { candidates: [], hasMore: false };
    const matches = new Map<string, number>();
    if (this.fts) for (const table of ["capability_fts_words", "capability_fts_trigram"]) {
      const expression = words.map(word => `"${word.replaceAll('"', '""')}"`).join(" OR ");
      try { for (const row of this.db.prepare(`SELECT d.capability_id,bm25(${table}) AS rank FROM ${table} JOIN capability_search_doc d ON d.rowid=${table}.rowid WHERE ${table} MATCH ? ORDER BY rank LIMIT 40`).all(expression)) matches.set(String(row.capability_id), (matches.get(String(row.capability_id)) ?? 0) + 10); } catch { /* Finite scan below is the offline fallback. */ }
    }
    // Also handles exact API names, aliases and short Chinese/Japanese strings.
    const ranked = this.db.prepare("SELECT c.descriptor_json,d.search_text FROM capabilities c JOIN capability_search_doc d ON c.id=d.capability_id LIMIT 1000").all().map(row => {
      const cap = this.validateDescriptor(JSON.parse(String(row.descriptor_json)) as Capability), text = String(row.search_text);
      const aliases = Object.values(cap.aliases).flat().map(normalize);
      const exact = [normalize(cap.id), normalize(cap.apiName), ...aliases].includes(normalized);
      let score = exact ? 1000 : matches.get(cap.id) ?? 0;
      for (const word of words) if (text.includes(word)) score += 3;
      for (const alias of aliases) if (alias.length >= 2 && normalized.includes(alias)) score += 15;
      // CJK queries often have no spaces. Substring aliases still match full sentences.
      return { cap, score: score > 0 ? score + (contextBoost?.(cap) ?? 0) : 0 };
    }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.cap.id.localeCompare(b.cap.id));
    this.metrics.searchMilliseconds += performance.now() - start;
    const size = Math.max(1, Math.min(10, limit));
    return { candidates: ranked.slice(0, size).map(row => row.cap), hasMore: ranked.length > size };
  }
  close(): void { this.db?.close(); this.db = undefined; }
}
