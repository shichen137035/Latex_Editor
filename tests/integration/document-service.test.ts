import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocumentService } from "../../packages/editor-core/src/index.js";
import type { TestBackend } from "../helpers/backend.js";
import { createTestBackend } from "../helpers/backend.js";

describe("DocumentService with the local filesystem", () => {
  let backend: TestBackend;

  beforeEach(async () => { backend = await createTestBackend(); });
  afterEach(async () => { await backend.cleanup(); });

  it("ED-001 ED-003 writes the edited buffer to the registered local project", async () => {
    const folder = resolve(backend.root, "paper");
    await mkdir(folder);
    await writeFile(resolve(folder, "main.tex"), "before", "utf8");
    const project = await backend.projects.registerExistingFolder(folder);
    const documents = new DocumentService(backend.files, { now: () => new Date("2026-01-01T00:00:00.000Z") });
    await documents.open({ projectId: project.id, relativePath: "main.tex" });
    await documents.applyChanges({ projectId: project.id, relativePath: "main.tex", expectedRevision: 1, changes: [{ text: "after" }] });
    await documents.save({ projectId: project.id, relativePath: "main.tex" });
    expect(await readFile(resolve(folder, "main.tex"), "utf8")).toBe("after");
    expect(backend.projects.getProject(project.id).lastEditedAt).toBeDefined();
  });

  it("ED-004 observes a real external modification and does not overwrite it", async () => {
    const folder = resolve(backend.root, "paper");
    await mkdir(folder);
    await writeFile(resolve(folder, "main.tex"), "before", "utf8");
    const project = await backend.projects.registerExistingFolder(folder);
    const documents = new DocumentService(backend.files, { now: () => new Date() });
    await documents.open({ projectId: project.id, relativePath: "main.tex" });
    await documents.applyChanges({ projectId: project.id, relativePath: "main.tex", expectedRevision: 1, changes: [{ text: "editor" }] });
    await writeFile(resolve(folder, "main.tex"), "external", "utf8");
    await expect(documents.save({ projectId: project.id, relativePath: "main.tex" })).rejects.toMatchObject({ code: "EXTERNAL_MODIFICATION_CONFLICT" });
    expect(await readFile(resolve(folder, "main.tex"), "utf8")).toBe("external");
  });
});
