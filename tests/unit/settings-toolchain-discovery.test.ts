import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
  queueMicrotask(() => { child.stdout.write("Version 4.88"); child.emit("close", 0); }); return child;
}) }));
import { discoverToolchain, environmentWithToolRuntime } from "../../packages/compiler-latexmk/src/index.js";
const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
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
