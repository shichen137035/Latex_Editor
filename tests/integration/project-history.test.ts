import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { defaultHistoryPreferences, suggestHistoryVersion, type Project } from "../../packages/contracts/src/index.js";
import { ProjectHistoryService } from "../../apps/desktop/src/main/project-history.js";

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
