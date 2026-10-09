import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consolidateProjectMetadata } from "../../packages/filesystem-node/src/project-metadata.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-metadata-")); roots.push(root);
  await mkdir(join(root, ".latex-editor", "build"), { recursive: true });
  await writeFile(join(root, ".latex-editor", "build", "compile.log"), "old log");
  return root;
}
describe("project metadata consolidation", () => {
  it("moves build data without changing source or existing metadata and is idempotent", async () => {
    const root = await fixture();
    await mkdir(join(root, ".texweave"));
    await writeFile(join(root, ".texweave", "structure.json"), "structure");
    await writeFile(join(root, "main.tex"), "source");
    await Promise.all([consolidateProjectMetadata(root), consolidateProjectMetadata(root)]);
    expect(await readFile(join(root, ".texweave", "build", "compile.log"), "utf8")).toBe("old log");
    expect(await readFile(join(root, ".texweave", "structure.json"), "utf8")).toBe("structure");
    expect(await readFile(join(root, "main.tex"), "utf8")).toBe("source");
    await expect(readdir(join(root, ".latex-editor"))).rejects.toMatchObject({ code: "ENOENT" });
    await consolidateProjectMetadata(root);
  });
  it("preserves both files when names conflict", async () => {
    const root = await fixture();
    await mkdir(join(root, ".texweave", "build"), { recursive: true });
    await writeFile(join(root, ".texweave", "build", "compile.log"), "new log");
    await consolidateProjectMetadata(root);
    const names = await readdir(join(root, ".texweave", "build"));
    expect(names).toHaveLength(2);
    expect(await readFile(join(root, ".texweave", "build", "compile.log"), "utf8")).toBe("new log");
    expect(await readFile(join(root, ".texweave", "build", names.find(name => name.includes(".imported-"))!), "utf8")).toBe("old log");
  });
  it("rejects linked destination metadata without moving or deleting source data", async () => {
    const root = await fixture(), external = await mkdtemp(join(tmpdir(), "texweave-external-")); roots.push(external);
    await symlink(external, join(root, ".texweave"), process.platform === "win32" ? "junction" : "dir");
    await expect(consolidateProjectMetadata(root)).rejects.toThrow("Invalid");
    expect(await readFile(join(root, ".latex-editor", "build", "compile.log"), "utf8")).toBe("old log");
    expect(await readdir(external)).toEqual([]);
  });
});
