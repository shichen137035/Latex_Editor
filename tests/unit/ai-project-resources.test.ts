import { mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createProjectResources } from "../../apps/desktop/src/main/ai/project-resources.js";
import { collectGraphicDependencies } from "../../apps/desktop/src/main/ai/tex-dependencies.js";
import { describeProjectSnapshot } from "../../apps/desktop/src/main/ai/workspaceFiles.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-resources-")); roots.push(root);
  const project = join(root, "project"), workspace = join(root, "workspace");
  await mkdir(join(project, "plots"), { recursive: true }); await mkdir(workspace);
  const paths = ["main.tex", "plots/referenced.png", "plots/unreferenced.png", "data/results.csv", "fonts/custom.otf", ".git/private"];
  await writeFile(join(project, "plots/unreferenced.png"), "real image bytes");
  const resources = createProjectResources({ resolveFilePath: async (_id, path) => join(project, path), listTree: async () => paths.map(path => ({ name: path, relativePath: path, kind: "file" })) }, "project", workspace);
  return { resources, project, workspace };
}

it("lists and searches unreferenced resources without implying that they are already copied", async () => {
  const f = await fixture();
  const first = await f.resources.list({ limit: 2 });
  expect(first.total).toBe(5); expect(first.nextOffset).toBe(2);
  const found = await f.resources.list({ query: "UNREFERENCED" });
  expect(found.files).toEqual([{ path: "plots/unreferenced.png", inProject: true, inWorkingCopy: false, canMaterialize: true }]);
  expect((await f.resources.list({ query: ".otf" })).files[0]?.path).toBe("fonts/custom.otf");
  await mkdir(join(f.project, "fonts")); await writeFile(join(f.project, "fonts/custom.otf"), "font bytes");
  expect((await f.resources.materialize(["fonts/custom.otf"])).copied).toEqual(["fonts/custom.otf"]);
  expect((await f.resources.materialize(["main.bbl"])).failures[0]?.reason).toContain("byproducts");
  const result = await f.resources.materialize(["plots/unreferenced.png"]);
  expect(result).toEqual({ copied: ["plots/unreferenced.png"], existing: [], failures: [] });
  expect(await readFile(join(f.workspace, "plots/unreferenced.png"), "utf8")).toBe("real image bytes");
  await writeFile(join(f.workspace, "plots/unreferenced.png"), "AI's edited copy");
  expect((await f.resources.materialize(["plots/unreferenced.png"])).existing).toEqual(["plots/unreferenced.png"]);
  expect(await readFile(join(f.workspace, "plots/unreferenced.png"), "utf8")).toBe("AI's edited copy");
  const context = describeProjectSnapshot([], f.workspace, [], 0, [], ["plots/unreferenced.png"]);
  expect(context).toContain("plots/unreferenced.png"); expect(context).toContain("texweave_list_project_files");
});

it("reports size and traversal failures and refuses workspace directory junctions", async () => {
  const f = await fixture();
  await truncate(join(f.project, "plots/unreferenced.png"), 21 * 1024 * 1024);
  const result = await f.resources.materialize(["plots/unreferenced.png", "../outside.png", ".git/private"]);
  expect(result.copied).toEqual([]); expect(result.failures).toHaveLength(3);
  await truncate(join(f.project, "plots/unreferenced.png"), 4);
  await symlink(join(f.project, "plots"), join(f.workspace, "plots"), process.platform === "win32" ? "junction" : "dir");
  const linked = await f.resources.materialize(["plots/unreferenced.png"]);
  expect(linked.failures[0]?.reason).toContain("symbolic link");
});

it("resolves graphicspath in another file and project-contained parent-relative references", () => {
  const result = collectGraphicDependencies([
    { path: "main.tex", content: "\\graphicspath{{figures/}}\\input{chapters/intro}" },
    { path: "chapters/intro.tex", content: "\\includegraphics{angle}\\includegraphics{../plots/result}\\includegraphics{../../outside}" }
  ], ["figures/angle.png", "plots/result.pdf"]);
  expect(result.resolved).toEqual(["figures/angle.png", "plots/result.pdf"]);
  expect(result.unresolved).toEqual(["../../outside"]);
});
