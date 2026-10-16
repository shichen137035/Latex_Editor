import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  queueMicrotask(() => { child.stdout.write("Version 4.88"); child.emit("close", 0); }); return child;
}) }));
import { discoverToolchain, rediscoverToolchain, environmentWithToolRuntime, LatexmkCompilerService } from "../../packages/compiler-latexmk/src/index.js";
const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const extension = process.platform === "win32" ? ".exe" : "";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-toolchain-isolation-")); roots.push(root);
  const first = join(root, "first"); const second = join(root,"second"); await mkdir(first); await mkdir(second);
  await writeFile(join(first, "pdflatex" + extension), "fixture"); await writeFile(join(first,"latexmk" + extension), "fixture"); await writeFile(join(first,"miktex.exe"), "fixture");
  await writeFile(join(second,"xelatex" + extension), "fixture"); await writeFile(join(second,"biber" + extension), "fixture");
  return { root,first,second };
}
it("keeps every detected tool in the explicitly selected environment", async () => {
  const f = await fixture(); vi.stubEnv("PATH", f.second);
  const result = await discoverToolchain(f.first);
  expect(result.pdflatex).toBe(join(f.first,"pdflatex" + extension)); expect(result.distribution).toBe("miktex");
  if (process.platform === "win32") {
    const env = environmentWithToolRuntime(join(f.first,"latexmk.exe"), { PATH: [f.first,f.second,join(f.root,"system")].join(";") });
    expect(env.PATH?.split(";")).not.toContain(f.second);
    expect(env.PATH?.split(";")).toContain(join(f.root,"system"));
  }
  expect(result.xelatex).toBeUndefined(); expect(result.biber).toBeUndefined(); expect(result.environment?.biber.status).toBe("missing");
});
it("does not mask an incomplete selected environment with another distribution", async () => {
  const f = await fixture(); const empty = join(f.root,"empty"); await mkdir(empty); vi.stubEnv("PATH",f.first);
  const result = await discoverToolchain(empty);
  expect(result.available).toBe(false); expect(result.latexmk).toBeUndefined(); expect(result.pdflatex).toBeUndefined();
});
it("finds one coherent environment when no preferred path is given", async () => {
  const f = await fixture();
  // Empty platform search roots keep this independent of the developer's installations.
  vi.stubEnv("APPDATA",f.root); vi.stubEnv("LOCALAPPDATA",f.root); vi.stubEnv("ProgramFiles",f.root); vi.stubEnv("ProgramFiles(x86)",f.root);
  vi.stubEnv("PATH",[f.first,f.second].join(process.platform === "win32" ? ";" : ":"));
  const result = await discoverToolchain();
  expect(result.binDirectory).toBe(f.first); expect(result.biber).toBeUndefined(); expect(result.xelatex).toBeUndefined();
});

it.each(["bin/windows", "miktex/bin/x64", "texmfs/install/miktex/bin/x64", "2026/bin/windows"])("accepts a selected installation root containing %s", async layout => {
  const root = await mkdtemp(join(tmpdir(), "texweave-root.with.dots-")); roots.push(root);
  const bin = join(root, layout); await mkdir(bin, { recursive: true });
  for (const tool of ["pdflatex", "latexmk"]) await writeFile(join(bin, tool + extension), "fixture");
  expect((await discoverToolchain(root)).binDirectory).toBe(bin);
  expect((await discoverToolchain(bin)).binDirectory).toBe(bin);
  expect((await discoverToolchain(join(bin, "pdflatex" + extension))).binDirectory).toBe(bin);
});

it("recovers a path copied from another machine but preserves an explicitly chosen incomplete installation", async () => {
  const f = await fixture();
  vi.stubEnv("APPDATA", f.root); vi.stubEnv("LOCALAPPDATA", f.root); vi.stubEnv("ProgramFiles", f.root); vi.stubEnv("ProgramFiles(x86)", f.root);
  vi.stubEnv("PATH", f.first);
  expect((await rediscoverToolchain(join(f.root, "old-machine", "latexmk" + extension))).binDirectory).toBe(f.first);
  expect((await rediscoverToolchain(f.second)).binDirectory).toBe(f.second);
  expect((await rediscoverToolchain(f.second)).overallStatus).toBe("limited");
});

it("reports a broken latexmk runtime and selects a working alternative during automatic detection", async () => {
  const f = await fixture(); await writeFile(join(f.second, "latexmk" + extension), "fixture");
  vi.stubEnv("APPDATA", f.root); vi.stubEnv("LOCALAPPDATA", f.root); vi.stubEnv("ProgramFiles", f.root); vi.stubEnv("ProgramFiles(x86)", f.root);
  vi.stubEnv("PATH", [f.first, f.second].join(process.platform === "win32" ? ";" : ":"));
  const fail = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    queueMicrotask(() => { child.stderr.write("Perl runtime was not found"); child.emit("close", 1); }); return child;
  };
  vi.mocked(spawn).mockImplementationOnce(fail as typeof spawn);
  const broken = await discoverToolchain(f.first);
  expect(broken.environment?.latexmk).toMatchObject({ status: "broken", error: "Perl runtime was not found" });
  vi.mocked(spawn).mockImplementationOnce(fail as typeof spawn);
  expect((await discoverToolchain()).binDirectory).toBe(f.second);
});

it("bounds compiler runtime detection instead of hanging a compile on an unresponsive installation", async () => {
  vi.useFakeTimers();
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  vi.mocked(spawn).mockImplementationOnce((() => child) as typeof spawn);
  const compiler = new LatexmkCompilerService({ projects: {} as never, files: {} as never,
    profiles: { getCompilerProfile: () => ({ id: "test", executable: process.execPath, arguments: [], timeoutMs: 5000 }) }, clock: { now: () => new Date() } });
  const result = compiler.detectToolchain();
  await vi.advanceTimersByTimeAsync(5001);
  expect(await result).toMatchObject({ available: false, error: expect.stringContaining("timed out") });
  expect(child.kill).toHaveBeenCalledOnce();
});
