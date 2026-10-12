import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { LatexmkCompilerService } from "../../packages/compiler-latexmk/src/index.js";

vi.mock("node:child_process", async importOriginal => {
  const original = await importOriginal<{ spawn: typeof spawn }>();
  return { ...original, spawn: vi.fn(original.spawn) };
});

it("publishes secondary PDFs before cache eviction, regardless of other artifact timestamps", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-secondary-pdf-"));
  try {
    await mkdir(join(root, "supplement"));
    await writeFile(join(root, "main.pdf"), "Primary PDF");
    await writeFile(join(root, "supplement/main.tex"), "Secondary input");
    // A copied PDF may have an older source timestamp than cached runs.
    // Even eight newer cached artifacts must not evict the result being published.
    await seedPdfArtifacts(root, 8, new Date(Date.now() + 60_000));
    const script = join(root, "compiler.cjs");
    await writeFile(script, `const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), dir = args.find(arg => arg.startsWith('-outdir=')).slice(8);
fs.writeFileSync(path.join(dir, 'main.pdf'), 'Secondary PDF');
fs.writeFileSync(path.join(dir, 'main.aux'), 'Auxiliary data');
fs.writeFileSync(path.join(dir, 'main.fls'), '');`);
    const compiler = new LatexmkCompilerService({
      projects: { getProject: () => ({ id: "project", canonicalPath: root, mainFile: "main.tex" }) } as never,
      files: { resolveFilePath: async (_id: string, path: string) => resolve(root, path) } as never,
      profiles: { getCompilerProfile: () => ({ id: "fake", executable: process.execPath, arguments: [script], timeoutMs: 5000 }) },
      clock: { now: () => new Date() }
    });
    const result = await compiler.compile({ projectId: "project", mainFile: "supplement/main.tex" });
    expect(result.status).toBe("succeeded");
    expect(await readFile(join(root, "supplement/main.pdf"), "utf8")).toBe("Secondary PDF");
    expect(await readFile(join(root, "main.pdf"), "utf8")).toBe("Primary PDF");
    expect(basename(result.pdfPath!)).toBe("main.pdf");
    expect(result.pdfPath).not.toBe(join(root, "supplement/main.pdf"));
    expect(await readFile(result.pdfArtifactPath!, "utf8")).toBe("Secondary PDF");
    expect(await readFile(join(root, "supplement/main.aux"), "utf8")).toBe("Auxiliary data");
    await expect(readFile(join(root, "supplement/main.fls"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("keeps the last successful PDF per target beyond the history limit and after failed builds", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-compile-retention-"));
  try {
    await seedPdfArtifacts(root, 12, new Date(Date.now() - 60_000));
    const compiler = await fakeWorkspaceCompiler(root, `
const fs = require('node:fs'), path = require('node:path');
const file = process.argv.at(-1);
if (fs.readFileSync(file, 'utf8') === 'fail') process.exit(1);
fs.writeFileSync(path.basename(file, '.tex') + '.pdf', file);`);
    const results = [];
    for (let index = 0; index < 10; index++) {
      const mainFile = `document-${index}.tex`;
      await writeFile(join(root, mainFile), "source");
      results.push(await compiler.compileWorkspace({ workspaceRoot: root, mainFile }));
    }
    await writeFile(join(root, "document-0.tex"), "fail");
    const failed = await compiler.compileWorkspace({ workspaceRoot: root, mainFile: "document-0.tex" });
    expect(failed.status).toBe("failed");
    await compiler.retainPublishedLog(root, "document-0.tex", randomUUID());
    await compiler.pruneBuildArtifacts(root);
    for (const result of results) expect(await readFile(result.pdfArtifactPath!, "utf8")).toBe(result.mainFile);
    const pdfs = (await readdir(join(root, ".texweave/build"))).filter(file => file.endsWith(".pdf"));
    expect(pdfs).toHaveLength(18); // Ten current targets plus eight superseded artifacts.
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("does not clean an active compilation log while PDF discovery runs concurrently", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-compile-active-cleanup-"));
  try {
    const compilationId = randomUUID();
    const compiler = await fakeWorkspaceCompiler(root, `
const fs = require('node:fs');
process.stdout.write('active compiler output');
fs.writeFileSync('ready', 'ready');
const timer = setInterval(() => {
  if (!fs.existsSync('continue')) return;
  clearInterval(timer);
  fs.writeFileSync('main.pdf', 'PDF');
}, 10);`, { next: () => compilationId });
    const running = compiler.compileWorkspace({ workspaceRoot: root, mainFile: "main.tex" });
    try {
      await vi.waitFor(async () => {
        expect(await readFile(join(root, "ready"), "utf8")).toBe("ready");
        expect(await readFile(join(root, ".texweave/build", `${compilationId}.log`), "utf8")).toContain("active compiler output");
      });
      await compiler.pruneBuildArtifacts(root);
    } finally {
      await writeFile(join(root, "continue"), "continue");
      await running;
    }
    const result = await running;
    expect(result.status).toBe("succeeded");
    expect(await readFile(result.logPath!, "utf8")).toContain("active compiler output");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("serializes the same build directory and keeps immutable per-run PDF results", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-compile-artifacts-"));
  try {
    const script = join(root, "compiler.cjs");
    await writeFile(join(root, "main.tex"), "test input");
    await writeFile(script, `const fs = require('node:fs');
const step = fs.existsSync('step.txt') ? Number(fs.readFileSync('step.txt','utf8')) + 1 : 1;
fs.writeFileSync('step.txt',String(step)); fs.appendFileSync('timeline.txt','start'+step+'\\n');
setTimeout(() => { fs.writeFileSync('main.pdf','PDF result '+step); fs.appendFileSync('timeline.txt','end'+step+'\\n'); },80);`);
    const compiler = new LatexmkCompilerService({ projects: {} as never, files: {} as never, profiles: { getCompilerProfile: () => ({ id: "fake", executable: process.execPath, arguments: [script], timeoutMs: 5000 }) }, clock: { now: () => new Date() } });
    const [first, second] = await Promise.all([compiler.compileWorkspace({ workspaceRoot: root, mainFile: "main.tex" }), compiler.compileWorkspace({ workspaceRoot: root, mainFile: "main.tex" })]);
    expect(first.status).toBe("succeeded"); expect(second.status).toBe("succeeded");
    expect(await readFile(join(root, "timeline.txt"), "utf8")).toBe("start1\nend1\nstart2\nend2\n");
    const artifacts = await Promise.all([first.pdfArtifactPath!, second.pdfArtifactPath!].map(path => readFile(path, "utf8")));
    expect(new Set(artifacts)).toEqual(new Set(["PDF result 1", "PDF result 2"]));
    expect(await readFile(first.pdfPath!, "utf8")).toBe("PDF result 2");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("drains stdout and stderr arriving after exit but before the process pipes close", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-compile-output-"));
  try {
    const compiler = await fakeWorkspaceCompiler(root, "");
    await writeFile(join(root, "main.pdf"), "PDF");
    vi.spyOn(compiler, "detectToolchain").mockResolvedValue({ available: true, executable: process.execPath });
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcessWithoutNullStreams;
    vi.mocked(spawn).mockImplementationOnce(() => {
      setImmediate(() => {
        child.emit("exit", 0, null);
        setImmediate(() => {
          child.stdout.emit("data", Buffer.from("late stdout\n"));
          child.stderr.emit("data", Buffer.from("late stderr\n"));
          child.stdout.emit("end");
          child.stderr.emit("end");
          child.emit("close", 0, null);
        });
      });
      return child;
    });
    const result = await compiler.compileWorkspace({ workspaceRoot: root, mainFile: "main.tex" });
    expect(result.status).toBe("succeeded");
    expect(result.stdoutTail).toContain("late stdout");
    expect(result.stderrTail).toContain("late stderr");
    expect(await readFile(result.logPath, "utf8")).toContain("late stdout");
    expect(await readFile(result.logPath, "utf8")).toContain("late stderr");
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("reports log write errors without an unhandled stream error or a hanging build", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-compile-log-error-"));
  try {
    const compilationId = "66c83dbd-9bf6-4910-9d69-5c6f26e5bb5d";
    await mkdir(join(root, ".texweave", "build", `${compilationId}.log`), { recursive: true });
    const compiler = await fakeWorkspaceCompiler(root, "process.stdout.write('compiler output');", { next: () => compilationId });
    await expect(compiler.compileWorkspace({ workspaceRoot: root, mainFile: "main.tex" })).rejects.toMatchObject({ code: "COMPILATION_FAILED", message: expect.stringContaining("Could not write compilation log") });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it("closes the compilation log when the compiler fails to spawn", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-compile-spawn-error-"));
  try {
    await writeFile(join(root, "main.tex"), "test input");
    const missingExecutable = join(root, "missing-compiler.exe");
    const compiler = new LatexmkCompilerService({
      projects: {} as never, files: {} as never,
      profiles: { getCompilerProfile: () => ({ id: "fake", executable: missingExecutable, arguments: [], timeoutMs: 5000 }) },
      clock: { now: () => new Date() }
    });
    // Detection can succeed before an executable is removed or replaced.
    vi.spyOn(compiler, "detectToolchain").mockResolvedValue({ available: true, executable: missingExecutable });
    await expect(compiler.compileWorkspace({ workspaceRoot: root, mainFile: "main.tex" })).rejects.toMatchObject({ code: "TOOLCHAIN_NOT_FOUND" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

async function fakeWorkspaceCompiler(root: string, scriptBody: string, ids?: { next(): string }): Promise<LatexmkCompilerService> {
  const script = join(root, "compiler.cjs");
  await writeFile(join(root, "main.tex"), "test input");
  await writeFile(script, scriptBody);
  return new LatexmkCompilerService({
    projects: {} as never, files: {} as never,
    profiles: { getCompilerProfile: () => ({ id: "fake", executable: process.execPath, arguments: [script], timeoutMs: 5000 }) },
    clock: { now: () => new Date() }, ...(ids ? { ids } : {})
  });
}

async function seedPdfArtifacts(root: string, count: number, modified: Date): Promise<void> {
  const directory = join(root, ".texweave/build");
  await mkdir(directory, { recursive: true });
  for (let index = 0; index < count; index++) {
    const path = join(directory, `${randomUUID()}.pdf`);
    await writeFile(path, "superseded PDF");
    await utimes(path, modified, modified);
  }
}
