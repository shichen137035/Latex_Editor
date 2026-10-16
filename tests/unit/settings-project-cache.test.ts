import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { Project } from "@latex-editor/contracts";
import { clearRegisteredProjectCaches } from "../../apps/desktop/src/main/project-cache-cleanup.js";
import { SQLiteProjectRegistry } from "../../packages/registry-sqlite/src/index.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-cache-cleanup-")); roots.push(root);
  const project: Project = { id: "test", name: "Paper", canonicalPath: join(root, "paper"), registeredAt: "", createdAt: "", writable: true, missing: false, settings: {} };
  await mkdir(join(project.canonicalPath, ".texweave/build"), { recursive: true });
  await mkdir(join(project.canonicalPath, ".texweave/history"));
  for (const path of ["main.tex", "main.pdf", ".texweave/history/snapshot", ".texweave/settings.json", ".texweave/structure.json"]) await writeFile(join(project.canonicalPath, path), "Keep");
  await writeFile(join(project.canonicalPath, ".texweave/build/cached.pdf"), "Cache");
  return { root, project };
}

it("clears only disposable builds and registry entries, retaining project data and reusable registration", async () => {
  const { root, project } = await fixture();
  const registry = new SQLiteProjectRegistry(join(root, "registry.sqlite")); registry.initialize(); registry.insert(project);
  try {
    const release = vi.fn(async () => undefined), clearBrowserCache = vi.fn(async () => undefined);
    await clearRegisteredProjectCaches(registry.list(), { release, clearBrowserCache, clearRegistry: () => registry.clear() });
    expect(registry.list()).toEqual([]);
    expect(release).toHaveBeenCalledWith(project.id);
    expect(clearBrowserCache).toHaveBeenCalledOnce();
    await expect(readFile(join(project.canonicalPath, ".texweave/build/cached.pdf"))).rejects.toMatchObject({ code: "ENOENT" });
    for (const path of ["main.tex", "main.pdf", ".texweave/history/snapshot", ".texweave/settings.json", ".texweave/structure.json"]) expect(await readFile(join(project.canonicalPath, path), "utf8")).toBe("Keep");
    registry.insert(project); expect(registry.list()).toHaveLength(1);
  } finally { registry.close(); }
});

it("rejects linked metadata before deleting any project's cache or registry", async () => {
  const { root, project } = await fixture();
  const other = join(root, "other"); await mkdir(other);
  await symlink(join(project.canonicalPath, ".texweave"), join(other, ".texweave"), process.platform === "win32" ? "junction" : "dir");
  const clearRegistry = vi.fn(), release = vi.fn(async () => undefined);
  await expect(clearRegisteredProjectCaches([project, { ...project, id: "linked", canonicalPath: other }], { release, clearRegistry, clearBrowserCache: async () => undefined })).rejects.toThrow("linked");
  expect(clearRegistry).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
  expect(await readFile(join(project.canonicalPath, ".texweave/build/cached.pdf"), "utf8")).toBe("Cache");
});

it("retains registrations when cleanup fails and permits missing project folders", async () => {
  const { project } = await fixture();
  const clearRegistry = vi.fn();
  await expect(clearRegisteredProjectCaches([project], { release: async () => { throw new Error("Busy"); }, clearRegistry, clearBrowserCache: async () => undefined })).rejects.toThrow("Busy");
  expect(clearRegistry).not.toHaveBeenCalled();
  expect(await readFile(join(project.canonicalPath, ".texweave/build/cached.pdf"), "utf8")).toBe("Cache");
  await clearRegisteredProjectCaches([{ ...project, canonicalPath: join(project.canonicalPath, "missing") }], { release: async () => undefined, clearRegistry, clearBrowserCache: async () => undefined });
  expect(clearRegistry).toHaveBeenCalledOnce();
});
