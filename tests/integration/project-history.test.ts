import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { defaultHistoryPreferences, suggestHistoryVersion, type Project } from "../../packages/contracts/src/index.js";
import { ProjectHistoryService } from "../../apps/desktop/src/main/project-history.js";
import { removeProjectData } from "../../apps/desktop/src/main/project-removal-data.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "texweave-history-test-"));
  roots.push(root);
  const project: Project = { id: "paper", name: "Paper", canonicalPath: root, createdAt: "2026-01-01", registeredAt: "2026-01-01", writable: true, missing: false, settings: {} };
  const config = { ...defaultHistoryPreferences };
  const service = new ProjectHistoryService(() => project, async () => config);
  await mkdir(join(root, "images"));
  await writeFile(join(root, "main.tex"), "first");
  await writeFile(join(root, "references.bib"), "@book{a,title={A}}");
  await writeFile(join(root, "images", "plot.png"), Buffer.from([0, 1, 2, 3]));
  await writeFile(join(root, "main.aux"), "generated");
  return { root, project, config, service };
}

describe("project history", () => {
  it("clears all snapshots while preserving versions, temporary saves and their objects", async () => {
    const { root, service } = await setup();
    const version = await service.createVersion("paper", { versionNumber: "1.0", title: "Baseline" });
    await writeFile(join(root, "main.tex"), "temporary text");
    const temporary = await service.createTemporary("paper", { title: "Draft" });
    await writeFile(join(root, "main.tex"), "snapshot-only text");
    await service.snapshot("paper", "manual");
    await service.snapshot("paper", "pre-restore");
    await service.clearSnapshots("paper");
    expect((await service.list("paper")).map(entry => entry.type).sort()).toEqual(["temporary", "version"]);
    expect(await service.readText("paper", version.id, "main.tex")).toBe("first");
    expect(await service.readText("paper", temporary.id, "main.tex")).toBe("temporary text");
    expect((await service.storage("paper")).snapshots).toBe(0);
    expect(await readFile(join(root, "main.tex"), "utf8")).toBe("snapshot-only text");
    await service.clearSnapshots("paper");
  });
  it("keeps restorable formal versions only when removing directory metadata", async () => {
    const { root, service } = await setup();
    const version = await service.createVersion("paper", { versionNumber: "1.0", title: "Baseline" });
    await writeFile(join(root, "main.tex"), "changed");
    await service.snapshot("paper", "manual");
    await service.createTemporary("paper", { title: "Temporary" });
    await mkdir(join(root, ".texweave", "cache"));
    await writeFile(join(root, ".texweave", "cache", "preview"), "cache");
    await removeProjectData(root, "paper", "versions", service);
    expect((await service.list("paper")).map(entry => entry.id)).toEqual([version.id]);
    expect(await service.readText("paper", version.id, "main.tex")).toBe("first");
    expect(await readdir(join(root, ".texweave"))).toEqual(["history"]);
    expect(await readFile(join(root, "main.tex"), "utf8")).toBe("changed");
    expect(await readFile(join(root, "images", "plot.png"))).toEqual(Buffer.from([0, 1, 2, 3]));
    expect((await service.storage("paper")).snapshots).toBe(0);
  });

  it("deletes only TeXWeave data and rejects linked metadata directories", async () => {
    const { root, service } = await setup();
    await service.snapshot("paper", "manual");
    await mkdir(join(root, ".latex-editor", "build"), { recursive: true });
    await writeFile(join(root, ".latex-editor", "build", "compile.log"), "old build");
    await removeProjectData(root, "paper", "none", service);
    await expect(readdir(join(root, ".latex-editor"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readdir(join(root, ".texweave"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, "main.tex"), "utf8")).toBe("first");
    expect(await readFile(join(root, "main.aux"), "utf8")).toBe("generated");
    const external = await mkdtemp(join(tmpdir(), "texweave-linked-test-")); roots.push(external);
    await writeFile(join(external, "keep"), "safe");
    await symlink(external, join(root, ".texweave"), process.platform === "win32" ? "junction" : "dir");
    await expect(removeProjectData(root, "paper", "none", service)).rejects.toThrow("linked");
    expect(await readFile(join(external, "keep"), "utf8")).toBe("safe");
  });
  it("deduplicates routine and deletion snapshots against the latest history entry, keeping manual captures explicit", async () => {
    const { root, service } = await setup();
    await service.createVersion("paper", { versionNumber: "1.0", title: "Baseline" });
    expect(await service.snapshot("paper", "project-close")).toBeUndefined();
    expect(await service.snapshot("paper", "interval")).toBeUndefined();
    expect(await service.snapshot("paper", "pre-delete")).toBeUndefined();
    expect(await service.snapshot("paper", "manual")).toBeDefined();
    await writeFile(join(root, "main.tex"), "changed");
    expect(await service.snapshot("paper", "project-close")).toBeDefined();
    expect(await service.snapshot("paper", "project-close")).toBeUndefined();
    const next = await service.snapshot("paper", "interval", undefined, [{ path: "main.tex", content: "new unsaved text" }]);
    expect(next).toBeDefined(); // A recent non-periodic snapshot does not suppress a due timer.
  });

  it("ignores passive structure index refreshes but retains semantic metadata and user-block changes", async () => {
    const { root, service } = await setup();
    await service.snapshot("paper", "manual");
    const objectsBefore = await readdir(join(root, ".texweave", "history", "objects"));
    const manifestsBefore = await readdir(join(root, ".texweave", "history", "manifests"));
    const structurePath = join(root, ".texweave", "structure.json");
    const block = { id: "A", type: "theorem", kind: "statement", origin: "environment", state: "active", parentId: null, childIds: [], revision: 1,
      source: { fileId: "main.tex", range: { start: 0, end: 5 } }, metadata: { parserFingerprint: "first" } };
    const structure = { schemaVersion: 2, structureRevision: 1, files: {}, roots: ["A"], blocks: { A: block }, dependencies: [], relations: [] };
    await writeFile(structurePath, JSON.stringify(structure));
    expect(await service.snapshot("paper", "project-close")).toBeUndefined();
    expect(await readdir(join(root, ".texweave", "history", "objects"))).toEqual(objectsBefore);
    expect(await readdir(join(root, ".texweave", "history", "manifests"))).toEqual(manifestsBefore);
    const summary = { text: "Important result", source: "ai", blockRevision: 1 };
    await writeFile(structurePath, JSON.stringify({ ...structure, blocks: { A: { ...block, semantic: { summary } } } }));
    const annotated = await service.snapshot("paper", "project-close");
    expect(annotated).toBeDefined();
    expect(await service.readText("paper", annotated!.id, ".texweave/structure.json")).toContain("Important result");
    await writeFile(structurePath, JSON.stringify({ ...structure, structureRevision: 90, indexDirty: true, blocks: { A: { ...block, revision: 90, metadata: { parserFingerprint: "refreshed" }, semantic: { summary: { ...summary, blockRevision: 90 } } } } }));
    expect(await service.snapshot("paper", "interval")).toBeUndefined();
    await writeFile(structurePath, JSON.stringify({ ...structure, blocks: { A: { ...block, origin: "user" } } }));
    expect(await service.snapshot("paper", "project-close")).toBeDefined();
  });

  it("honors automatic and deletion safety preferences in the service", async () => {
    const { service, config } = await setup();
    config.autoSnapshot = false; config.beforeLargeDelete = false;
    expect(await service.snapshot("paper", "interval")).toBeUndefined();
    expect(await service.snapshot("paper", "project-close")).toBeUndefined();
    expect(await service.snapshot("paper", "pre-delete")).toBeUndefined();
    expect(await service.snapshot("paper", "manual")).toBeDefined();
  });

  it("deduplicates files, promotes metadata, and restores selected files with a safety snapshot", async () => {
    const { root, config, service } = await setup();
    config.maxSnapshots = 1;
    const first = await service.createVersion("paper", { versionNumber: "1.0", title: "Draft" });
    await writeFile(join(root, "main.tex"), "second");
    const second = await service.createTemporary("paper", { title: "Experiment" });
    const promoted = await service.promote("paper", second.id, { versionNumber: "1.1", title: "Revision" });
    expect(promoted.manifestId).toBe(second.manifestId);
    expect(suggestHistoryVersion(await service.list("paper"))).toBe("1.2");
    expect((await readdir(join(root, ".texweave", "history", "objects"))).length).toBe(4);
    expect((await service.details("paper", first.id)).changes).toEqual([{ path: "main.tex", status: "modified", inHistory: true }]);
    const restored = await service.restore("paper", first.id, ["main.tex"]);
    expect(await readFile(join(root, "main.tex"), "utf8")).toBe("first");
    expect(restored.safetySnapshotId).toBeTruthy();
    expect((await service.list("paper")).some((entry) => entry.id === restored.safetySnapshotId)).toBe(true);
    await service.restore("paper", restored.safetySnapshotId!, ["main.tex"]);
    expect(await readFile(join(root, "main.tex"), "utf8")).toBe("second");
    expect(await readFile(join(root, "main.aux"), "utf8")).toBe("generated");
  });

  it("captures unsaved editor buffers and prunes only snapshots", async () => {
    const { root, config, service } = await setup();
    config.maxSnapshots = 1;
    const permanent = await service.createVersion("paper", { versionNumber: "1.0", title: "Draft" });
    const first = await service.snapshot("paper", "manual", undefined, [{ path: "main.tex", content: "unsaved" }]);
    expect(await service.readText("paper", first!.id, "main.tex")).toBe("unsaved");
    expect(await readFile(join(root, "main.tex"), "utf8")).toBe("first");
    await service.snapshot("paper", "manual", undefined, [{ path: "main.tex", content: "new buffer" }]);
    expect((await service.list("paper")).filter((entry) => entry.type === "snapshot")).toHaveLength(1);
    expect((await service.list("paper")).some((entry) => entry.id === permanent.id)).toBe(true);
    await service.optimize("paper");
    const objects = await readdir(join(root, ".texweave", "history", "objects"));
    expect(objects).toHaveLength(4);
    expect(objects).not.toContain(createHash("sha256").update("unsaved").digest("hex"));
  });

  it("rejects a damaged object before changing the current project", async () => {
    const { root, service } = await setup();
    const version = await service.createVersion("paper", { versionNumber: "1.0", title: "Safe" });
    const manifest = JSON.parse(await readFile(join(root, ".texweave", "history", "manifests", `${version.manifestId}.json`), "utf8")) as Record<string, string>;
    await writeFile(join(root, ".texweave", "history", "objects", manifest["main.tex"]!), "damaged");
    await writeFile(join(root, "main.tex"), "current");
    await expect(service.restore("paper", version.id)).rejects.toThrow("damaged");
    expect(await readFile(join(root, "main.tex"), "utf8")).toBe("current");
  });

  it("restores added and deleted project files without touching ignored build output", async () => {
    const { root, service } = await setup();
    const version = await service.createVersion("paper", { versionNumber: "1.10", title: "Baseline" });
    expect(suggestHistoryVersion(await service.list("paper"))).toBe("1.11");
    await expect(service.createVersion("paper", { versionNumber: "1.10", title: "Duplicate" })).rejects.toThrow("already exists");
    await rm(join(root, "references.bib"));
    await writeFile(join(root, "new.tex"), "new file");
    await writeFile(join(root, "main.aux"), "latest build artifact");
    const details = await service.details("paper", version.id);
    expect(details.changes.map((change) => change.path)).toEqual(["new.tex", "references.bib"]);
    await service.restore("paper", version.id);
    await expect(readFile(join(root, "new.tex"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(root, "references.bib"), "utf8")).toContain("@book");
    expect(await readFile(join(root, "main.aux"), "utf8")).toBe("latest build artifact");
  });
});
