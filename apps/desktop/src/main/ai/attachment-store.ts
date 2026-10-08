import { randomUUID } from "node:crypto";
import { copyFile, lstat, mkdir, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AIAttachment } from "@latex-editor/contracts" with { "resolution-mode": "import" };

export const attachmentLimits = { fileBytes: 20 * 1024 * 1024, draftBytes: 50 * 1024 * 1024, draftCount: 20, totalBytes: 128 * 1024 * 1024, totalCount: 200, drafts: 32 };
type Scope = { projectId: string; draftId: string };
type Draft = Scope & { count: number; bytes: number; closed: boolean };
type Entry = AIAttachment & { draft: Draft; path: string; pins: number; ready: boolean; removed: boolean };
export interface AttachmentLease {
  readonly projectId: string;
  readonly draftId: string;
  readonly entries: ReadonlyArray<AIAttachment & { path: string }>;
  consume(): Promise<void>;
  release(): Promise<void>;
}

/** Draft-owned immutable files: no pasted Buffer is retained between requests. */
export class AIAttachmentStore {
  readonly root: string;
  readonly #drafts = new Map<string, Draft>();
  readonly #entries = new Map<string, Entry>();
  readonly #retired = new Set<string>();
  #bytes = 0;
  #closed = false;
  readonly #cleanup = new Set<Promise<void>>();
  readonly #staging = new Set<Promise<AIAttachment>>();
  readonly #retryTimer: ReturnType<typeof setInterval>;
  constructor(userDataPath: string, readonly limits = attachmentLimits) {
    this.root = resolve(userDataPath, "ai", "attachment-cache");
    this.#retryTimer = setInterval(() => { for (const entry of this.#entries.values()) if (entry.removed && !entry.pins) void this.#collect(entry); }, 60_000);
    this.#retryTimer.unref?.();
  }
  async initialize(): Promise<void> {
    // This dedicated app-owned directory contains only disposable draft copies.
    try { if ((await lstat(this.root)).isSymbolicLink()) throw new Error("Attachment cache must not be a symbolic link."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.root, { recursive: true });
  }
  open(projectId: string, draftId: string): void {
    if (this.#closed || !projectId || !/^[0-9a-f-]{36}$/i.test(draftId) || this.#retired.has(draftId)) throw new Error("This attachment draft is closed. Attach files again.");
    const existing = this.#drafts.get(draftId);
    if (existing) { this.#draft({ projectId, draftId }); return; }
    if (this.#drafts.size >= this.limits.drafts) throw new Error("Too many attachment drafts are open. Close an unused draft first.");
    this.#drafts.set(draftId, { projectId, draftId, count: 0, bytes: 0, closed: false });
  }
  async addData(scope: Scope, name: string, data: Uint8Array): Promise<AIAttachment> {
    const entry = this.#reserve(scope, name, data.byteLength);
    return this.#stage(entry, () => writeFile(entry.path, data));
  }
  async addFiles(scope: Scope, paths: string[]): Promise<AIAttachment[]> {
    this.#draft(scope);
    const inputs = await Promise.all([...new Set(paths)].map(async path => {
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size > this.limits.fileBytes) throw new Error("Attachments must be files smaller than 20 MB.");
      return { path, size: metadata.size };
    }));
    const reserved: Entry[] = [];
    try {
      for (const input of inputs) reserved.push(this.#reserve(scope, input.path.split(/[\\/]/).at(-1)!, input.size));
      const results = await Promise.allSettled(reserved.map((entry, index) => this.#stage(entry, async () => {
        await copyFile(inputs[index]!.path, entry.path);
        if ((await stat(entry.path)).size !== entry.size) throw new Error(`Attachment changed; choose ${entry.name} again.`);
      })));
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      return results.map(result => (result as PromiseFulfilledResult<AIAttachment>).value);
    } catch (error) {
      // Reservations that never started copying must release their staging pin too.
      for (const entry of reserved) { if (!entry.ready && !entry.removed) entry.pins = 0; entry.removed = true; }
      await Promise.all(reserved.map(entry => this.#collect(entry)));
      throw error;
    }
  }
  acquire(scope: Scope, ids: string[]): AttachmentLease {
    const draft = this.#draft(scope);
    if (!Array.isArray(ids) || ids.length > this.limits.draftCount || ids.some(id => typeof id !== "string")) throw new Error("Invalid attachment selection.");
    const entries = [...new Set(ids)].map(id => {
      const entry = this.#entries.get(id);
      if (!entry || entry.draft !== draft || entry.removed || !entry.ready) throw new Error("Choose the attachments again for this project.");
      return entry;
    });
    entries.forEach(entry => entry.pins++);
    let released = false;
    return {
      ...scope, entries: entries.map(({ id, name, size, path }) => ({ id, name, size, path })),
      consume: async () => { entries.forEach(entry => { entry.removed = true; }); await Promise.all(entries.map(entry => this.#collect(entry))); },
      release: async () => {
        if (released) return;
        released = true;
        entries.forEach(entry => entry.pins--);
        await Promise.all(entries.map(entry => this.#collect(entry)));
      }
    };
  }
  async remove(scope: Scope, ids: string[]): Promise<void> {
    const draft = this.#draft(scope);
    if (!Array.isArray(ids) || ids.length > this.limits.draftCount) throw new Error("Invalid attachment selection.");
    const selected = ids.map(id => this.#entries.get(id)).filter((entry): entry is Entry => !!entry);
    if (selected.some(entry => entry.draft !== draft)) throw new Error("Attachments belong to another draft.");
    selected.forEach(entry => { entry.removed = true; });
    await Promise.all(selected.map(entry => this.#collect(entry)));
  }
  async close(scope: Scope): Promise<void> {
    const draft = this.#drafts.get(scope.draftId);
    if (draft && draft.projectId !== scope.projectId) throw new Error("Attachments belong to another project.");
    this.#retired.add(scope.draftId);
    if (this.#retired.size > 256) this.#retired.delete(this.#retired.values().next().value!);
    if (!draft) return;
    draft.closed = true;
    this.#drafts.delete(scope.draftId);
    const entries = [...this.#entries.values()].filter(entry => entry.draft === draft);
    entries.forEach(entry => { entry.removed = true; });
    await Promise.all(entries.map(entry => this.#collect(entry)));
    if (!draft.count) await rmdir(join(this.root, draft.draftId)).catch(() => undefined);
  }
  async dispose(): Promise<void> {
    this.#closed = true;
    clearInterval(this.#retryTimer);
    await Promise.all([...this.#drafts.values()].map(draft => this.close(draft)));
    await Promise.allSettled([...this.#staging]);
    await Promise.all([...this.#cleanup]);
  }
  usage() { return { bytes: this.#bytes, count: this.#entries.size, drafts: this.#drafts.size }; }
  #draft(scope: Scope): Draft {
    const draft = this.#drafts.get(scope.draftId);
    if (this.#closed || !draft || draft.closed || draft.projectId !== scope.projectId) throw new Error("Choose the attachments again for this project.");
    return draft;
  }
  #reserve(scope: Scope, name: string, size: number): Entry {
    const draft = this.#draft(scope);
    if (!Number.isSafeInteger(size) || size < 0 || size > this.limits.fileBytes) throw new Error("Attachments must be files smaller than 20 MB.");
    if (draft.count >= this.limits.draftCount || draft.bytes + size > this.limits.draftBytes) throw new Error("Use at most 20 attachments totaling 50 MB.");
    if (this.#entries.size >= this.limits.totalCount || this.#bytes + size > this.limits.totalBytes) throw new Error("Attachment cache is full. Remove unused attachments first.");
    if (!name || name.includes("/") || name.includes("\\") || name === "." || name === "..") throw new Error("Invalid attachment name.");
    const id = randomUUID();
    const entry: Entry = { id, name, size, path: join(this.root, draft.draftId, id, name), draft, pins: 1, ready: false, removed: false };
    draft.count++; draft.bytes += size; this.#bytes += size;
    this.#entries.set(id, entry);
    return entry;
  }
  #stage(entry: Entry, write: () => Promise<void>): Promise<AIAttachment> {
    const task = this.#writeStage(entry, write);
    this.#staging.add(task);
    void task.then(() => this.#staging.delete(task), () => this.#staging.delete(task));
    return task;
  }
  async #writeStage(entry: Entry, write: () => Promise<void>): Promise<AIAttachment> {
    try {
      await mkdir(dirname(entry.path), { recursive: true });
      await write();
      if (entry.draft.closed || this.#closed) throw new Error("This attachment draft was closed.");
      entry.ready = true;
      return { id: entry.id, name: entry.name, size: entry.size };
    } catch (error) { entry.removed = true; throw error; }
    finally { entry.pins--; await this.#collect(entry); }
  }
  #collect(entry: Entry): Promise<void> {
    if (!entry.removed || entry.pins || !this.#entries.has(entry.id)) return Promise.resolve();
    const cleanup = (async () => {
      try {
        await rm(dirname(entry.path), { recursive: true, force: true });
        if (!this.#entries.delete(entry.id)) return;
        this.#bytes -= entry.size; entry.draft.bytes -= entry.size; entry.draft.count--;
        if (!entry.draft.count && entry.draft.closed) await rmdir(join(this.root, entry.draft.draftId)).catch(() => undefined);
      } catch (error) { console.warn("Attachment cleanup will be retried", error); }
    })();
    this.#cleanup.add(cleanup);
    void cleanup.finally(() => this.#cleanup.delete(cleanup));
    return cleanup;
  }
}
