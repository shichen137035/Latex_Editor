import { describe, expect, it, vi } from "vitest";
import { runSearchJob, type SearchWorker } from "../../apps/desktop/src/renderer/search/searchJob.js";
import { defaultSearchQuery } from "../../apps/desktop/src/renderer/search/types.js";
import { applySearchReplacements } from "../../apps/desktop/src/renderer/workbench/searchReplacement.js";
import type { EditorTab } from "../../apps/desktop/src/renderer/workbench/fileActions.js";

describe("disposable search jobs", () => {
  const job = { kind: "search" as const, query: defaultSearchQuery, documents: [] };
  function worker(): SearchWorker { return { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() }; }
  it("terminates on completion and cancellation and removes event handlers", async () => {
    const port = worker(), promise = runSearchJob(job, undefined, () => port);
    port.onmessage!({ data: { kind: "search", value: { results: [] } } } as MessageEvent);
    expect(await promise).toEqual({ kind: "search", value: { results: [] } });
    expect(port.terminate).toHaveBeenCalledOnce(); expect(port.onmessage).toBeNull();
    const controller = new AbortController(), cancelled = worker();
    const result = runSearchJob(job, controller.signal, () => cancelled);
    controller.abort(); await expect(result).rejects.toMatchObject({ name: "AbortError" }); expect(cancelled.terminate).toHaveBeenCalledOnce();
  });
  it("terminates a job that exceeds its deadline", async () => {
    const port = worker();
    await expect(runSearchJob(job, undefined, () => port, 10)).rejects.toThrow("timed out");
    expect(port.terminate).toHaveBeenCalledOnce();
  });
  it("releases the worker on synchronous postMessage failures", async () => {
    const port = worker(); port.postMessage = () => { throw new Error("clone failed"); };
    await expect(runSearchJob(job, undefined, () => port)).rejects.toThrow("clone failed"); expect(port.terminate).toHaveBeenCalledOnce();
  });
});

describe("replacement preflight", () => {
  const plan = (fileId: string) => ({ fileId, before: "old", after: "new", edits: [{ start: 0, end: 3, newLength: 3 }] });
  it("does not partially edit files if one disk file changed or cannot be read", async () => {
    const change = vi.fn(), open = vi.fn();
    await expect(applySearchReplacements({ plans: [plan("a"), plan("b")], tabs: () => [{ path: "a", content: "old", dirty: false }], read: async () => "changed", isCurrent: () => true, open, change })).rejects.toThrow("outdated");
    expect(change).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it("rechecks buffers after asynchronous reads and history snapshots", async () => {
    let tabs: EditorTab[] = [{ path: "a", content: "old", dirty: false }]; const change = vi.fn();
    await expect(applySearchReplacements({ plans: [plan("a"), plan("b")], tabs: () => tabs, read: async () => "old", beforeApply: async () => { tabs = [{ path: "a", content: "user edit", dirty: true }]; }, isCurrent: () => true, open: vi.fn(), change })).rejects.toThrow("outdated");
    expect(change).not.toHaveBeenCalled();
  });
  it("cancels the batch if the search or project changed while awaiting preflight", async () => {
    const open = vi.fn(), change = vi.fn();
    await expect(applySearchReplacements({ plans: [plan("a")], tabs: () => [], read: async () => "old", isCurrent: () => false, open, change })).rejects.toThrow("Search changed");
    expect(open).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  });
  it("deduplicates newly opened tabs and commits exact edit mappings synchronously", async () => {
    const tabs: EditorTab[] = []; const open = vi.fn((items: EditorTab[]) => { tabs.push(...items); }); const change = vi.fn();
    await applySearchReplacements({ plans: [plan("a"), plan("b")], tabs: () => tabs, read: async path => { if (path === "a") tabs.push({ path, content: "old", dirty: false }); return "old"; }, isCurrent: () => true, open, change });
    expect(tabs.map(tab => tab.path)).toEqual(["a", "b"]); expect(open).toHaveBeenCalledOnce(); expect(change).toHaveBeenCalledTimes(2);
    expect(change).toHaveBeenCalledWith(plan("a"));
  });
});
