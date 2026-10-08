import { randomUUID } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AIAttachmentStore, attachmentLimits } from "../../apps/desktop/src/main/ai/attachment-store.js";

const roots: string[] = [], stores: AIAttachmentStore[] = [];
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.dispose())); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function setup(limits = attachmentLimits) {
  const root = await mkdtemp(join(tmpdir(), "texweave-attachment-cache-")); roots.push(root);
  const store = new AIAttachmentStore(root, limits); stores.push(store); await store.initialize();
  const scope = { projectId: "project", draftId: randomUUID() }; store.open(scope.projectId, scope.draftId);
  return { root, store, scope };
}

describe("draft attachment staging and release", () => {
  it("stages an immutable copy and removes only its owned copy", async () => {
    const { root, store, scope } = await setup();
    const original = join(root, "original.txt"); await writeFile(original, "original");
    const [item] = await store.addFiles(scope, [original]);
    await writeFile(original, "changed outside app");
    const lease = store.acquire(scope, [item!.id]);
    expect(await readFile(lease.entries[0]!.path, "utf8")).toBe("original");
    await lease.release(); await store.remove(scope, [item!.id]);
    expect(store.usage()).toMatchObject({ count: 0, bytes: 0 });
    await expect(access(lease.entries[0]!.path)).rejects.toThrow();
    expect(await readFile(original, "utf8")).toBe("changed outside app");
  });

  it("holds removed attachments only until the last active copy lease is released", async () => {
    const { store, scope } = await setup();
    const item = await store.addData(scope, "image.bin", Buffer.from("image data"));
    const first = store.acquire(scope, [item.id]), second = store.acquire(scope, [item.id]);
    await store.close(scope);
    expect(store.usage()).toMatchObject({ count: 1, drafts: 0 });
    expect(await readFile(first.entries[0]!.path, "utf8")).toBe("image data");
    await first.release(); expect(store.usage().count).toBe(1);
    await second.release(); await second.release();
    expect(store.usage()).toEqual({ count: 0, drafts: 0, bytes: 0 });
    await expect(access(first.entries[0]!.path)).rejects.toThrow();
  });

  it("allows retry before consumption and never reuses a consumed attachment", async () => {
    const { store, scope } = await setup();
    const item = await store.addData(scope, "retry.txt", Buffer.from("retry"));
    await store.acquire(scope, [item.id]).release();
    const lease = store.acquire(scope, [item.id]); await lease.consume();
    expect(() => store.acquire(scope, [item.id])).toThrow("again");
    expect(store.usage().count).toBe(1);
    await lease.release(); expect(store.usage().count).toBe(0);
  });

  it("enforces aggregate limits across drafts including pending reservations", async () => {
    const { store, scope } = await setup({ ...attachmentLimits, draftBytes: 10, totalBytes: 12, totalCount: 3 });
    const other = { projectId: "other", draftId: randomUUID() }; store.open(other.projectId, other.draftId);
    const first = await store.addData(scope, "one.txt", Buffer.alloc(8));
    await expect(store.addData(scope, "too-big.txt", Buffer.alloc(3))).rejects.toThrow("totaling 50 MB");
    await expect(store.addData(other, "global.txt", Buffer.alloc(5))).rejects.toThrow("cache is full");
    await store.remove(scope, [first.id]);
    const requests = await Promise.allSettled([store.addData(scope, "a.txt", Buffer.alloc(8)), store.addData(other, "b.txt", Buffer.alloc(8))]);
    expect(requests.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(store.usage().bytes).toBe(8);
  });

  it("rejects cross-draft access and rolls back all reservations when a selection exceeds limits", async () => {
    const { root, store, scope } = await setup({ ...attachmentLimits, draftCount: 1 });
    const original = join(root, "a.txt"), otherFile = join(root, "b.txt");
    await writeFile(original, "one"); await writeFile(otherFile, "two");
    await expect(store.addFiles(scope, [original, otherFile])).rejects.toThrow("at most 20");
    expect(store.usage()).toMatchObject({ count: 0, bytes: 0 });
    const item = await store.addData(scope, "one.txt", Buffer.from("one"));
    const other = { projectId: scope.projectId, draftId: randomUUID() }; store.open(other.projectId, other.draftId);
    expect(() => store.acquire(other, [item.id])).toThrow("again");
    await expect(store.remove(other, [item.id])).rejects.toThrow("another draft");
    await expect(store.close({ projectId: "different", draftId: scope.draftId })).rejects.toThrow("another project");
    expect(store.usage().count).toBe(1);
  });

  it("does not resurrect a draft when asynchronous staging completes after it closes", async () => {
    const { store, scope } = await setup();
    const staging = store.addData(scope, "late.txt", Buffer.alloc(1024));
    await store.close(scope);
    await expect(staging).rejects.toThrow("closed");
    expect(store.usage()).toEqual({ count: 0, bytes: 0, drafts: 0 });
    expect(() => store.open(scope.projectId, scope.draftId)).toThrow("closed");
  });

  it("dispose drains staging work and deletes abandoned copies from a prior run on initialize", async () => {
    const { root, store, scope } = await setup();
    const pending = store.addData(scope, "dispose.txt", Buffer.alloc(1024));
    const result = pending.catch(error => error);
    await store.dispose(); await result;
    expect(store.usage()).toEqual({ bytes: 0, count: 0, drafts: 0 });
    const abandoned = join(store.root, "old-run", "data.txt"); await mkdir(join(store.root, "old-run"), { recursive: true }); await writeFile(abandoned, "stale");
    const fresh = new AIAttachmentStore(root); stores.push(fresh); await fresh.initialize();
    expect(await readdir(fresh.root)).toEqual([]);
  });
});
