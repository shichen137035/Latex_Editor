import { cp, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
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

  it("builds mutual xr-hyper references and republishes changed secondary labels", async context => {
    if (!(await compiler.detectToolchain()).available) context.skip();
    const project = await fixtureProject("compile-success"), root = project.canonicalPath;
    await mkdir(resolve(root, "supplement"));
    await writeFile(resolve(root, "main.tex"), String.raw`\documentclass{article}
\usepackage{xr-hyper}
\usepackage{hyperref}
\externaldocument[S-]{supplement/notes}[supplement/notes.pdf]
\begin{document}
\section{Primary}\label{sec:primary}
See section \ref{S-sec:notes}.
\typeout{XR-NUMBER=\getrefnumber{S-sec:notes}}
\end{document}`);
    const notes = String.raw`\documentclass{article}
\usepackage{xr-hyper}
\usepackage{hyperref}
\externaldocument[M-]{main}[../main.pdf]
\begin{document}
\section{Notes}\label{sec:notes}
See primary section \ref{M-sec:primary}.
\end{document}`;
    await writeFile(resolve(root, "supplement/notes.tex"), notes);
    const first = await compiler.compile({ projectId: project.id, timeoutMs: 120_000 });
    expect(first.status, first.stdoutTail + first.stderrTail).toBe("succeeded");
    expect(await readFile(resolve(root, "main.log"), "utf8")).toContain("XR-NUMBER=1");
    expect(await readFile(resolve(root, "supplement/notes.aux"), "utf8")).toContain("sec:notes");
    expect(existsSync(resolve(root, "supplement/notes.pdf"))).toBe(true);
    await writeFile(resolve(root, "supplement/notes.tex"), notes.replace("\\section{Notes}", "\\section{Preface}\n\\section{Notes}"));
    const updated = await compiler.compile({ projectId: project.id, timeoutMs: 120_000 });
    expect(updated.status, updated.stdoutTail + updated.stderrTail).toBe("succeeded");
    expect(await readFile(resolve(root, "main.log"), "utf8")).toContain("XR-NUMBER=2");
    expect(updated.diagnostics.some(item => item.category === "reference" && /undefined/i.test(item.message))).toBe(false);
  }, 150_000);

  it("compiles an independent nested document without overwriting same-named main artifacts", async context => {
    if (!(await compiler.detectToolchain()).available) context.skip();
    const project = await fixtureProject("compile-success"), root = project.canonicalPath;
    await mkdir(resolve(root, "supplement"));
    await writeFile(resolve(root, "shared.tex"), "Shared root resource.\n");
    await writeFile(resolve(root, "supplement/main.tex"), "\\documentclass{article}\n\\begin{document}\nSecondary document text.\n\\input{shared}\n\\end{document}\n");
    const primary = await compiler.compile({ projectId: project.id, timeoutMs: 120_000 });
    expect(primary.status).toBe("succeeded");
    const primaryPdf = await readFile(primary.pdfPath!);
    const primarySync = await readFile(resolve(root, "main.synctex.gz"));
    const secondary = await compiler.compile({ projectId: project.id, mainFile: "supplement/main.tex", timeoutMs: 120_000 });
    expect(secondary.status, secondary.stdoutTail + secondary.stderrTail).toBe("succeeded");
    expect(secondary.pdfPath).not.toBe(primary.pdfPath);
    expect(secondary.pdfPath).toContain("targets");
    expect(secondary.recorderInputs).toEqual(expect.arrayContaining(["supplement/main.tex", "shared.tex"]));
    expect(await readFile(primary.pdfPath!)).toEqual(primaryPdf);
    expect(await readFile(resolve(root, "main.synctex.gz"))).toEqual(primarySync);
    const input = { root, pdfPath: secondary.pdfPath!, mainFile: secondary.mainFile };
    const position = await forwardSync({ ...input, sourcePath: resolve(root, "supplement/main.tex"), line: 3, column: 1 });
    expect(await reverseSync({ ...input, ...position })).toMatchObject({ file: "supplement/main.tex", line: 3 });
    expect(backend.projects.getProject(project.id).mainFile).toBe("main.tex");
    await unlink(secondary.pdfPath!.replace(/\.pdf$/, ".synctex.gz"));
    await expect(reverseSync({ ...input, ...position })).rejects.toThrow("SYNCTEX_DATA_MISSING");
    expect((await compiler.compile({ projectId: project.id, mainFile: secondary.mainFile, timeoutMs: 120_000 })).status).toBe("succeeded");
    expect(existsSync(secondary.pdfPath!.replace(/\.pdf$/, ".synctex.gz"))).toBe(true);
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
