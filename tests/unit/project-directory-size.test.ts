import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projectDirectorySize } from "../../apps/desktop/src/main/project-directory-size.js";
import { formatProjectBytes } from "../../apps/desktop/src/renderer/useProjectDirectorySizes.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("project directory size", () => {
  it("counts actual nested, binary, build and history files without traversing linked folders", async () => {
    const root = await mkdtemp(join(tmpdir(), "texweave-directory-size-")); roots.push(root);
    const external = await mkdtemp(join(tmpdir(), "texweave-external-size-")); roots.push(external);
    await mkdir(join(root, "images"));
    await mkdir(join(root, ".texweave", "history"), { recursive: true });
    await writeFile(join(root, "main.tex"), "你好");
    await writeFile(join(root, "images", "plot.png"), Buffer.alloc(2048));
    await writeFile(join(root, "main.pdf"), Buffer.alloc(100));
    await writeFile(join(root, ".texweave", "history", "object"), Buffer.alloc(20));
    await writeFile(join(root, "empty.tex"), "");
    await writeFile(join(external, "excluded"), Buffer.alloc(8192));
    await symlink(external, join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect(await projectDirectorySize(root)).toEqual({ bytes: 2174, fileCount: 5, partial: false });
  });
  it("distinguishes a missing project from a zero-byte project and formats large sizes", async () => {
    const root = await mkdtemp(join(tmpdir(), "texweave-empty-size-")); roots.push(root);
    expect(await projectDirectorySize(root)).toEqual({ bytes: 0, fileCount: 0, partial: false });
    await expect(projectDirectorySize(join(root, "missing"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(formatProjectBytes(0, "en")).toBe("0 B");
    expect(formatProjectBytes(1536, "en")).toBe("1.5 KB");
    expect(formatProjectBytes(1024 ** 4, "en")).toBe("1 TB");
  });
});
