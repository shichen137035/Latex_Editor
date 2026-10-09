import { cp, mkdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LatexmkCompilerService, windowsLatexPathCandidates } from "../../packages/compiler-latexmk/src/index.js";
import type { TestBackend } from "../helpers/backend.js";
import { createTestBackend } from "../helpers/backend.js";
import { forwardSync, reverseSync } from "../../apps/desktop/src/main/synctex.js";

describe("real latexmk compilation", () => {
  let backend: TestBackend;
  let compiler: LatexmkCompilerService;

  beforeEach(async () => {
    backend = await createTestBackend();
    compiler = new LatexmkCompilerService({ projects: backend.projects, files: backend.files, profiles: backend.resources, clock: { now: () => new Date() } });
  });
  afterEach(async () => { await backend.cleanup(); });

  async function fixtureProject(name: string) {
    const target = resolve(backend.root, `work-${name}`);
    await mkdir(target);
    await cp(resolve(process.cwd(), "tests", "fixtures", name), target, { recursive: true });
    const project = await backend.projects.registerExistingFolder(target);
    return backend.projects.setMainFile(project.id, "main.tex");
  }

  it("CO-001 compiles a minimal article and verifies the PDF exists", async (context) => {
    if (!(await compiler.detectToolchain()).available) context.skip();
    const project = await fixtureProject("compile-success");
    const result = await compiler.compile({ projectId: project.id, timeoutMs: 120_000 });
    expect(result).toMatchObject({ status: "succeeded", exitCode: 0, mainFile: "main.tex" });
    expect(result.pdfPath).toMatch(/main\.pdf$/);
    expect(result.logPath).toBeDefined();
    expect(result.recorderInputs).toContain("main.tex");
  }, 150_000);

  it("CO-002 returns a structured error for an undefined control sequence", async (context) => {
    if (!(await compiler.detectToolchain()).available) context.skip();
    const project = await fixtureProject("compile-syntax-error");
    const result = await compiler.compile({ projectId: project.id, timeoutMs: 120_000 });
    expect(result.status).toBe("failed");
    expect(result.diagnostics.some((item) => item.severity === "error" && item.line !== undefined)).toBe(true);
  }, 150_000);

  it("regenerates missing SyncTeX even when latexmk considers the PDF up to date", async (context) => {
    if (!(await compiler.detectToolchain()).available) context.skip();
    const project = await fixtureProject("compile-success");
    expect((await compiler.compile({ projectId: project.id, timeoutMs: 120_000 })).status).toBe("succeeded");
    const sidecar = resolve(project.canonicalPath, "main.synctex.gz");
    await unlink(sidecar);
    expect((await compiler.compile({ projectId: project.id, timeoutMs: 120_000 })).status).toBe("succeeded");
    expect(existsSync(sidecar)).toBe(true);
  }, 150_000);

  it("round trips both columns through the real SyncTeX tool", async (context) => {
    if (!(await compiler.detectToolchain()).available) context.skip();
    const project = await fixtureProject("compile-success");
    const root = project.canonicalPath;
    await writeFile(resolve(root, "main.tex"), "\\documentclass[twocolumn]{article}\n\\begin{document}\n\\input{left}\n\\newpage\n\\input{right}\n\\end{document}\n");
    for (const side of ["left", "right"]) await writeFile(resolve(root, side + ".tex"), `\\section*{${side}}\n${side} column text: ` + "This paragraph provides a distinct column source location. ".repeat(10) + "\n");
    const result = await compiler.compile({ projectId: project.id, timeoutMs: 120_000 });
    expect(result.status).toBe("succeeded");
    const input = { root, pdfPath: resolve(root, "main.pdf"), mainFile: "main.tex" };
    const left = await forwardSync({ ...input, sourcePath: resolve(root, "left.tex"), line: 2, column: 1 });
    const right = await forwardSync({ ...input, sourcePath: resolve(root, "right.tex"), line: 2, column: 1 });
    expect(left.page).toBe(right.page);
    expect(left.x).toBeLessThan(right.x);
    expect(await reverseSync({ ...input, ...left })).toMatchObject({ file: "left.tex", line: 2 });
    expect(await reverseSync({ ...input, ...right })).toMatchObject({ file: "right.tex", line: 2 });
    await unlink(resolve(root, "main.synctex.gz"));
    await expect(reverseSync({ ...input, ...right })).rejects.toThrow("SYNCTEX_DATA_MISSING");
  }, 150_000);

  it("CO-003 succeeds with a structured undefined-reference warning", async (context) => {
    if (!(await compiler.detectToolchain()).available) context.skip();
    const project = await fixtureProject("compile-warning-reference");
    const result = await compiler.compile({ projectId: project.id, timeoutMs: 120_000 });
    expect(result.status).toBe("succeeded");
    expect(result.diagnostics.some((item) => item.code === "UNDEFINED_REFERENCE")).toBe(true);
  }, 150_000);

  it("CO-004 reports a missing package as a readable diagnostic", async (context) => {
    if (!(await compiler.detectToolchain()).available) context.skip();
    const project = await fixtureProject("compile-missing-package");
    const result = await compiler.compile({ projectId: project.id, timeoutMs: 120_000 });
    expect(result.status).toBe("failed");
    expect(result.diagnostics.some((item) => item.code === "MISSING_FILE" || /not found/i.test(item.message))).toBe(true);
  }, 150_000);

  it("CO-005 discovers a Windows GUI MiKTeX install even when inherited PATH is stale", async (context) => {
    if (process.platform !== "win32") context.skip();
    const hasKnownInstall = windowsLatexPathCandidates().some((directory) => existsSync(resolve(directory, "latexmk.exe")));
    if (!hasKnownInstall) context.skip();
    const originalPath = process.env.PATH;
    try {
      process.env.PATH = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32;${process.env.SystemRoot ?? "C:\\Windows"}`;
      await expect(compiler.detectToolchain()).resolves.toMatchObject({ available: true });
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });
});
