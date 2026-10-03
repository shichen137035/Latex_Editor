import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NodeProjectFileService } from "../../packages/filesystem-node/src/index.js";
import type { TestBackend } from "../helpers/backend.js";
import { createTestBackend } from "../helpers/backend.js";

describe("Project Manager and file service", () => {
  let backend: TestBackend;

  beforeEach(async () => { backend = await createTestBackend(); });
  afterEach(async () => { await backend.cleanup(); });

  it("PM-001 PM-002 registers an existing folder once without changing it", async () => {
    const folder = resolve(backend.root, "existing");
    await mkdir(folder);
    await writeFile(resolve(folder, "keep.txt"), "unchanged", "utf8");
    const project = await backend.projects.registerExistingFolder(folder);
    expect(backend.registry.get(project.id)?.canonicalPath).toBe(project.canonicalPath);
    await expect(backend.projects.registerExistingFolder(folder)).rejects.toMatchObject({ code: "PROJECT_ALREADY_REGISTERED" });
    expect(await readFile(resolve(folder, "keep.txt"), "utf8")).toBe("unchanged");
  });

  it("PM-004 creates a project from the resource template and sets main.tex", async () => {
    const parent = resolve(backend.root, "projects");
    await mkdir(parent);
    const project = await backend.projects.createProject({ name: "paper", parentPath: parent });
    expect(project.mainFile).toBe("main.tex");
    expect(await readFile(resolve(parent, "paper", "main.tex"), "utf8")).toContain("\\documentclass{article}");
  });

  it("PM-007 PM-013 writes atomically and rejects traversal", async () => {
    const folder = resolve(backend.root, "project");
    await mkdir(folder);
    const project = await backend.projects.registerExistingFolder(folder);
    const result = await backend.files.writeText(project.id, "chapters/intro.tex", "hello");
    expect(result.hash).toHaveLength(64);
    expect(await backend.files.readText(project.id, "chapters/intro.tex")).toMatchObject({ content: "hello", encoding: "utf8" });
    await expect(backend.files.writeText(project.id, "../outside.tex", "bad")).rejects.toMatchObject({ code: "INVALID_RELATIVE_PATH" });
  });

  it("renames and removes project entries without leaving the project root", async () => {
    const folder = resolve(backend.root, "project");
    await mkdir(folder);
    const project = await backend.projects.registerExistingFolder(folder);
    await backend.files.createFile(project.id, "draft.tex", "draft");
    await backend.files.renameEntry(project.id, "draft.tex", "chapters/final.tex");
    expect((await backend.files.readText(project.id, "chapters/final.tex")).content).toBe("draft");
    await backend.files.removeEntry(project.id, "chapters/final.tex");
    await expect(backend.files.readText(project.id, "chapters/final.tex")).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
  });

  it("moves files and folders between project directories and rejects recursive folder moves", async () => {
    const folder = resolve(backend.root, "project");
    await mkdir(resolve(folder, "chapters", "nested"), { recursive: true });
    await mkdir(resolve(folder, "archive"));
    await writeFile(resolve(folder, "chapters", "nested", "intro.tex"), "chapter", "utf8");
    await writeFile(resolve(folder, "chapters", "nested", "appendix.tex"), "appendix", "utf8");
    const project = await backend.projects.registerExistingFolder(folder);

    await backend.files.renameEntry(project.id, "chapters/nested/intro.tex", "archive/intro.tex");
    expect((await backend.files.readText(project.id, "archive/intro.tex")).content).toBe("chapter");
    await backend.files.renameEntry(project.id, "chapters", "archive/chapters");
    expect((await backend.files.readText(project.id, "archive/chapters/nested/appendix.tex")).content).toBe("appendix");
    await expect(backend.files.renameEntry(project.id, "archive/chapters", "archive/chapters/nested/inside"))
      .rejects.toMatchObject({ code: "INVALID_MOVE_TARGET" });
  });

  it("creates, copies, imports, and sets the main TeX file through file operations", async () => {
    const folder = resolve(backend.root, "project");
    const external = resolve(backend.root, "external.txt");
    const externalFolder = resolve(backend.root, "external-folder");
    await mkdir(folder);
    await mkdir(resolve(externalFolder, "nested"), { recursive: true });
    await writeFile(external, "external", "utf8");
    await writeFile(resolve(externalFolder, "nested", "included.tex"), "included", "utf8");
    const project = await backend.projects.registerExistingFolder(folder);
    await backend.files.createDirectory(project.id, "chapters");
    await backend.files.createFile(project.id, "chapters/source.tex", "source");
    await backend.files.copyEntry(project.id, "chapters/source.tex", "chapters/copy.tex");
    await backend.files.importEntry(project.id, external, "chapters/imported.txt");
    await backend.files.importEntry(project.id, externalFolder, "vendor");
    expect((await backend.files.readText(project.id, "chapters/copy.tex")).content).toBe("source");
    expect((await backend.files.readText(project.id, "chapters/imported.txt")).content).toBe("external");
    expect((await backend.files.readText(project.id, "vendor/nested/included.tex")).content).toBe("included");
    await expect(backend.files.importEntry(project.id, project.canonicalPath, "project-copy")).rejects.toMatchObject({ code: "INVALID_IMPORT_SOURCE" });
    await expect(backend.projects.setMainFile(project.id, "chapters/imported.txt")).rejects.toMatchObject({ code: "INVALID_RELATIVE_PATH" });
    expect((await backend.projects.setMainFile(project.id, "chapters/source.tex")).mainFile).toBe("chapters/source.tex");
  });

  it("rejects every project mutation through a read-only project service", async () => {
    const folder = resolve(backend.root, "read-only-project");
    const external = resolve(backend.root, "external.txt");
    await mkdir(folder);
    await writeFile(resolve(folder, "source.tex"), "keep", "utf8");
    await writeFile(resolve(folder, "remove.tex"), "keep", "utf8");
    await writeFile(external, "external", "utf8");
    const project = await backend.projects.registerExistingFolder(folder);
    const files = new NodeProjectFileService({
      getProject: (id) => ({ ...backend.projects.getProject(id), writable: false }),
      touchEditedAt: (id) => backend.projects.touchEditedAt(id)
    });

    await expect(files.writeText(project.id, "source.tex", "changed")).rejects.toMatchObject({ code: "PROJECT_NOT_WRITABLE" });
    await expect(files.createFile(project.id, "new.tex")).rejects.toMatchObject({ code: "PROJECT_NOT_WRITABLE" });
    await expect(files.createDirectory(project.id, "new-folder")).rejects.toMatchObject({ code: "PROJECT_NOT_WRITABLE" });
    await expect(files.renameEntry(project.id, "source.tex", "renamed.tex")).rejects.toMatchObject({ code: "PROJECT_NOT_WRITABLE" });
    await expect(files.copyEntry(project.id, "source.tex", "copy.tex")).rejects.toMatchObject({ code: "PROJECT_NOT_WRITABLE" });
    await expect(files.importEntry(project.id, external, "imported.txt")).rejects.toMatchObject({ code: "PROJECT_NOT_WRITABLE" });
    await expect(files.removeEntry(project.id, "remove.tex")).rejects.toMatchObject({ code: "PROJECT_NOT_WRITABLE" });

    expect(await readFile(resolve(folder, "source.tex"), "utf8")).toBe("keep");
    expect(await readFile(resolve(folder, "remove.tex"), "utf8")).toBe("keep");
  });

  it("PM-009 removes only the registry record by default", async () => {
    const folder = resolve(backend.root, "project");
    await mkdir(folder);
    await writeFile(resolve(folder, "main.tex"), "source", "utf8");
    const project = await backend.projects.registerExistingFolder(folder);
    await backend.projects.remove({ projectId: project.id, mode: "registryOnly" });
    expect(backend.registry.get(project.id)).toBeUndefined();
    expect(await readFile(resolve(folder, "main.tex"), "utf8")).toBe("source");
  });

  it("PM-010 rejects a mismatched delete confirmation", async () => {
    const folder = resolve(backend.root, "project");
    await mkdir(folder);
    const project = await backend.projects.registerExistingFolder(folder);
    await expect(backend.projects.remove({ projectId: project.id, mode: "deleteLocalFolder", confirmedCanonicalPath: resolve(backend.root, "other") }))
      .rejects.toMatchObject({ code: "DELETE_CONFIRMATION_MISMATCH" });
    expect(backend.registry.get(project.id)).toBeDefined();
  });

  it("PM-014 rejects a directory junction that escapes the project", async () => {
    const folder = resolve(backend.root, "project");
    const outside = resolve(backend.root, "outside");
    await mkdir(folder);
    await mkdir(outside);
    await writeFile(resolve(outside, "secret.tex"), "secret", "utf8");
    await symlink(outside, resolve(folder, "linked"), process.platform === "win32" ? "junction" : "dir");
    const project = await backend.projects.registerExistingFolder(folder);
    await expect(backend.files.readText(project.id, "linked/secret.tex")).rejects.toMatchObject({ code: "PATH_OUTSIDE_PROJECT" });
  });
});
