import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectImageService } from "../../apps/desktop/src/main/images.js";
import type { TestBackend } from "../helpers/backend.js";
import { createTestBackend } from "../helpers/backend.js";

describe("project image folder import", () => {
  let backend: TestBackend;
  beforeEach(async () => { backend = await createTestBackend(); });
  afterEach(async () => { await backend.cleanup(); });

  it("copies a dropped directory recursively and allows deleting it", async () => {
    const projectRoot = resolve(backend.root, "project");
    const sourceFolder = resolve(backend.root, "charts");
    await mkdir(projectRoot);
    await mkdir(sourceFolder);
    await writeFile(resolve(sourceFolder, "plot.png"), "image");
    const project = await backend.projects.registerExistingFolder(projectRoot);
    const service = new ProjectImageService(backend.files);
    const [imported] = await service.importImages(project.id, [sourceFolder], "figures");
    expect(imported).toMatchObject({ relativePath: "figures/charts", kind: "directory" });
    expect((await backend.files.listTree(project.id))[0]?.children?.[0]?.relativePath).toBe("figures/charts");
    await backend.files.removeEntry(project.id, "figures/charts");
    expect((await backend.files.listTree(project.id))[0]?.children).toEqual([]);
  });
});
