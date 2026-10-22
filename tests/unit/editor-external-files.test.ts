import { describe, expect, it, vi } from "vitest";
import { createExternalFileSync } from "../../apps/desktop/src/renderer/workbench/externalFileSync.js";
import { readFileVersions } from "../../apps/desktop/src/main/file-versions.js";
import type { EditorTab } from "../../apps/desktop/src/renderer/workbench/fileActions.js";

function fixture() {
  let tabs: EditorTab[] = [{ path: "main.tex", content: "old", dirty: false }, { path: "refs.bib", content: "bib", dirty: false }];
  const baselines = new Map(tabs.map(tab => [tab.path, tab.content]));
  const disk = new Map(tabs.map(tab => [tab.path, { content: tab.content, token: "1" }]));
  const onReload = vi.fn(), onConflicts = vi.fn();
  let draft = false;
  const versions = vi.fn(async (paths: string[]) => Object.fromEntries(paths.map(path => [path, disk.get(path)?.token ?? null])));
  const read = vi.fn(async (path: string) => { const file = disk.get(path); if (!file) throw new Error("missing"); return { content: file.content }; });
  const client = createExternalFileSync({ tabs: () => tabs, baseline: path => baselines.get(path), setBaseline: (path, content) => { baselines.set(path, content); }, versions, read, hasDraft: () => draft, update: value => { tabs = value; }, onReload, onConflicts });
  return { client, disk, baselines, read, versions, onReload, onConflicts, tabs: () => tabs, edit: (content = "local") => { tabs = tabs.map(tab => tab.path === "main.tex" ? { ...tab, content, dirty: true } : tab); }, setDraft: (value: boolean) => { draft = value; }, setTabs: (value: EditorTab[]) => { tabs = value; } };
}
describe("External source synchronization", () => {
  it("reloads clean open files and reads only metadata while idle", async () => {
    const f = fixture(); await f.client.sync(); f.read.mockClear();
    await f.client.sync(); expect(f.read).not.toHaveBeenCalled();
    f.disk.set("main.tex", { content: "external", token: "2" }); await f.client.sync();
    expect(f.tabs()[0]).toEqual({ path: "main.tex", content: "external", dirty: false });
    expect(f.baselines.get("main.tex")).toBe("external"); expect(f.onReload).toHaveBeenCalledOnce();
    expect(f.read).toHaveBeenCalledExactlyOnceWith("main.tex");
  });
  it("manual refresh forces a read even with unchanged metadata", async () => {
    const f = fixture(); await f.client.sync(); f.disk.set("main.tex", { content: "same-mtime replacement", token: "1" });
    await f.client.sync(true); expect(f.tabs()[0]!.content).toBe("same-mtime replacement");
  });
  it("acknowledges its own save without discarding the file's Undo history", async () => {
    const f = fixture(); await f.client.sync(); f.edit("saved locally"); f.disk.set("main.tex", { content: "saved locally", token: "2" });
    await f.client.sync(); expect(f.tabs()[0]!.dirty).toBe(false); expect(f.baselines.get("main.tex")).toBe("saved locally");
    expect(f.onReload).not.toHaveBeenCalled(); expect(f.client.conflicts()).toEqual([]);
  });
  it("preserves dirty contents, avoids repeated source reads and lets the user select either version", async () => {
    const f = fixture(); await f.client.sync(); f.edit(); f.disk.set("main.tex", { content: "external", token: "2" });
    await f.client.sync(); expect(f.tabs()[0]!.content).toBe("local"); expect(f.client.conflicts()).toEqual([{ path: "main.tex", missing: false }]);
    f.read.mockClear(); await f.client.sync(); expect(f.read).not.toHaveBeenCalled();
    await f.client.resolve("main.tex", true); expect(f.tabs()[0]).toMatchObject({ content: "local", dirty: true });
    expect(f.baselines.get("main.tex")).toBe("external"); expect(f.client.conflicts()).toEqual([]);
    f.disk.set("main.tex", { content: "newer external", token: "3" }); await f.client.sync(); await f.client.resolve("main.tex", false);
    expect(f.tabs()[0]).toMatchObject({ content: "newer external", dirty: false });
  });
  it("protects preview drafts and retries when a draft is canceled", async () => {
    const f = fixture(); await f.client.sync(); f.setDraft(true); f.disk.set("main.tex", { content: "external", token: "2" });
    await f.client.sync(); await f.client.resolve("main.tex", false); expect(f.tabs()[0]!.content).toBe("old");
    f.setDraft(false); await f.client.sync(); expect(f.tabs()[0]!.content).toBe("external");
  });
  it("does not overwrite typing or saving that occurred during an asynchronous read", async () => {
    const f = fixture(); await f.client.sync(); f.disk.set("main.tex", { content: "external", token: "2" });
    let release!: () => void;
    f.read.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return { content: "external" }; });
    const syncing = f.client.sync(); await vi.waitFor(() => expect(release).toBeTypeOf("function")); f.edit("typed during read"); release(); await syncing;
    expect(f.tabs()[0]!.content).toBe("typed during read");
    await f.client.sync(); expect(f.client.conflicts()).toHaveLength(1);
  });
  it("ignores unstable reads and handles deletion and atomic replacement", async () => {
    const f = fixture(); await f.client.sync(); f.disk.set("main.tex", { content: "intermediate", token: "2" });
    f.read.mockImplementationOnce(async () => { f.disk.set("main.tex", { content: "final", token: "3" }); return { content: "intermediate" }; });
    await f.client.sync(); expect(f.tabs()[0]!.content).toBe("old"); await f.client.sync(); expect(f.tabs()[0]!.content).toBe("final");
    f.disk.delete("main.tex"); await f.client.sync(); expect(f.client.conflicts()).toEqual([{ path: "main.tex", missing: true }]);
    expect(f.tabs()[0]!.content).toBe("final"); f.disk.set("main.tex", { content: "recreated", token: "4" });
    await f.client.sync(); expect(f.tabs()[0]!.content).toBe("recreated");
  });
  it("does not publish results after leaving a project", async () => {
    const f = fixture(); let release!: () => void;
    f.read.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); return { content: "external" }; });
    const pending = f.client.sync(); await vi.waitFor(() => expect(release).toBeTypeOf("function")); f.client.close(); release(); await pending;
    expect(f.onReload).not.toHaveBeenCalled(); expect(f.tabs()[0]!.content).toBe("old");
  });
  it("preserves local data on read errors and blocks saves until the file is readable", async () => {
    const f = fixture(); await f.client.sync(); f.disk.set("main.tex", { content: "external", token: "2" });
    f.read.mockRejectedValueOnce(new Error("sharing lock")); await f.client.sync();
    expect(f.client.conflicts()).toHaveLength(1); expect(f.tabs()[0]!.content).toBe("old");
    await f.client.sync(); expect(f.tabs()[0]!.content).toBe("external");
  });
  it("validates metadata requests and distinguishes missing files from denied access", async () => {
    const files = { getFileVersion: vi.fn(async (_id: string, path: string) => { if (path === "missing") throw Object.assign(new Error(), { code: "FILE_NOT_FOUND" }); if (path === "denied") throw Object.assign(new Error(), { code: "EACCES" }); return "v1"; }) };
    expect(await readFileVersions(files, "p", ["main.tex", "missing", "main.tex"])).toEqual({ "main.tex": "v1", missing: null });
    expect(files.getFileVersion).toHaveBeenCalledTimes(2);
    await expect(readFileVersions(files, "p", ["denied"])).rejects.toMatchObject({ code: "EACCES" });
    await expect(readFileVersions(files, "p", Array(129).fill("main.tex"))).rejects.toThrow("Invalid");
  });
});
