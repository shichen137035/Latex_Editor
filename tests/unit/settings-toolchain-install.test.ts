import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { selectedPackages, validateSelection } from "../../apps/desktop/src/main/toolchain-components.js";
import { environmentWithToolRuntime } from "../../packages/compiler-latexmk/src/index.js";
import type { ToolchainInstallSelection } from "../../packages/contracts/src/toolchain-install.js";
import { allLatexToolsReady, latexTools, LatexToolchainInstaller, windowsTinyTexAsset } from "../../apps/desktop/src/main/toolchain-installer.js";
import type { LatexToolchain } from "../../packages/contracts/src/settings.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const payload = new TextEncoder().encode("fixture archive");
const asset = { name: "TinyTeX-1-windows-v2026.10.exe", browser_download_url: "https://github.com/rstudio/tinytex-releases/releases/download/v2026.10/TinyTeX-1-windows-v2026.10.exe", size: payload.length, digest: `sha256:${createHash("sha256").update(payload).digest("hex")}` };
async function fixture(options: { corrupt?: boolean; broken?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "texweave-latex-install-test-")); roots.push(root);
  const target = join(root, "selected folder", "TinyTeX");
  const fetcher = vi.fn(async () => new Response());
  fetcher.mockImplementation(async (url: unknown) => String(url).includes("api.github.com")
    ? new Response(JSON.stringify({ assets: [asset] }))
    : new Response(options.corrupt ? new TextEncoder().encode("bad download") : payload));
  const runner = vi.fn(async (executable: string, args: string[], cwd: string) => {
    if (!executable.endsWith("tinytex.exe")) return;
    const source = join(cwd, "TinyTeX");
    await mkdir(join(source, "tlpkg", "tlperl", "bin"), { recursive: true });
    await mkdir(join(source, "texmf-dist", "scripts", "texlive"), { recursive: true });
    await writeFile(join(source, "tlpkg", "tlperl", "bin", "perl.exe"), "fixture");
    await writeFile(join(source, "texmf-dist", "scripts", "texlive", "tlmgr.pl"), "fixture");
    expect(args).toEqual(["-y"]);
  });
  const tc = { distribution: "texlive", available: true, detectedAt: new Date().toISOString(), ...Object.fromEntries(latexTools.map(tool => [tool, join(target, "bin", "windows", `${tool}.exe`)])) } as LatexToolchain;
  if (options.broken) delete tc.biber;
  const activate = vi.fn(async () => undefined);
  const installer = new LatexToolchainInstaller({ defaultDirectory: target, supported: true, fetch: fetcher as typeof fetch, run: runner, detect: async () => tc, activate });
  return { root, target, installer, runner, fetcher, activate };
}
async function finish(installer: LatexToolchainInstaller) {
  await vi.waitFor(() => expect(installer.status().running).toBe(false));
  return installer.status();
}

describe("managed LaTeX installation", () => {
  it("validates the official asset, digest and download size before execution", () => {
    expect(windowsTinyTexAsset({ assets: [asset] })).toEqual(asset);
    for (const invalid of [{ ...asset, digest: null }, { ...asset, browser_download_url: "https://example.com/tool.exe" }, { ...asset, size: -1 }]) {
      expect(() => windowsTinyTexAsset({ assets: [invalid] })).toThrow("verified");
    }
  });
  it("installs into the selected directory, activates only verified tools, and repairs without another download", async () => {
    const f = await fixture();
    f.installer.start(f.target);
    expect(() => f.installer.start(f.target)).toThrow("already running");
    expect((await finish(f.installer)).phase).toBe("complete");
    expect(f.activate).toHaveBeenCalledOnce();
    expect(f.runner).toHaveBeenCalledTimes(4);
    expect(JSON.parse(await readFile(join(f.target, ".texweave-toolchain.json"), "utf8")).distribution).toBe("tinytex");
    f.installer.start(f.target);
    expect((await finish(f.installer)).phase).toBe("complete");
    expect(f.fetcher).toHaveBeenCalledTimes(4);
  });
  it("leaves an existing unrelated directory unchanged", async () => {
    const f = await fixture();
    await mkdir(f.target, { recursive: true });
    await writeFile(join(f.target, "important.tex"), "keep");
    f.installer.start(f.target);
    expect((await finish(f.installer)).error).toContain("not empty");
    expect(await readFile(join(f.target, "important.tex"), "utf8")).toBe("keep");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("never executes a corrupt archive or activates an incomplete toolchain", async () => {
    const corrupt = await fixture({ corrupt: true });
    corrupt.installer.start(corrupt.target);
    expect((await finish(corrupt.installer)).phase).toBe("error");
    expect(corrupt.runner).not.toHaveBeenCalled();
    const broken = await fixture({ broken: true });
    broken.installer.start(broken.target);
    expect((await finish(broken.installer)).error).toContain("not every");
    expect(broken.activate).not.toHaveBeenCalled();
  });
  it("cancels without executing or enabling downloaded tools", async () => {
    const f = await fixture();
    f.installer.start(f.target);
    f.installer.cancel();
    expect((await finish(f.installer)).phase).toBe("cancelled");
    expect(f.runner).not.toHaveBeenCalled();
    expect(f.activate).not.toHaveBeenCalled();
  });
  it("treats broken engine status as missing even when its path exists", () => {
    const tools = Object.fromEntries(latexTools.map(tool => [tool, { status: "ready", source: "detected" }]));
    const tc = { environment: tools } as unknown as LatexToolchain;
    expect(allLatexToolsReady(tc)).toBe(true);
    tc.environment!.xelatex.status = "broken";
    expect(allLatexToolsReady(tc)).toBe(false);
  });
});

const plan = (values: Partial<ToolchainInstallSelection> = {}): ToolchainInstallSelection => ({ distribution: "miktex", components: ["tables"], customPackages: [], full: false, existing: false, autoInstall: true, ...values });

describe("selectable LaTeX components", () => {
  it("installs only selected groups, resolves caption/subcaption together, and validates custom IDs", () => {
    expect(selectedPackages(plan())).toEqual(["caption", "booktabs", "multirow"]);
    expect(selectedPackages(plan({ components: [] }))).toEqual([]);
    expect(selectedPackages(plan({ components: ["tables", "math"], customPackages: ["caption", "geometry"] }))).toContain("geometry");
    expect(selectedPackages(plan())).not.toContain("ctex");
    expect(selectedPackages(plan())).not.toContain("scheme-full");
    for (const id of ["--all", "bad package", "../caption", "caption;whoami", ""]) expect(() => validateSelection(plan({ customPackages: [id] }))).toThrow("Invalid");
    expect(() => validateSelection(plan({ components: ["unknown" as never] }))).toThrow("Invalid");
    expect(() => validateSelection({ ...plan(), full: "true" } as never)).toThrow("Invalid");
  });

  it("adds selected packages to the current MiKTeX without downloading or claiming ownership", async () => {
    const f = await fixture();
    const bin = join(f.root, "external MiKTeX", "miktex", "bin", "x64");
    await mkdir(bin, { recursive: true }); await writeFile(join(bin, "miktex.exe"), "fixture");
    const current = { distribution: "miktex", available: true, detectedAt: "now", binDirectory: bin, ...Object.fromEntries(latexTools.map(tool => [tool, join(bin, tool + ".exe")])) } as LatexToolchain;
    const runner = vi.fn(async (_exe: string, args: string[], _cwd: string, _signal: AbortSignal, output: (text: string) => void) => { if (args.includes("list")) output("biber-windows-x64,true\nlatexmk,true\ncaption,false\n"); }); const refresh = vi.fn(async () => undefined);
    const installer = new LatexToolchainInstaller({ defaultDirectory: f.target, supported: true, fetch: f.fetcher as typeof fetch, run: runner, detect: async () => current, currentToolchain: () => current, activate: f.activate, refresh });
    installer.start(f.target, plan({ existing: true, autoInstall: false }));
    expect((await finish(installer)).phase).toBe("complete");
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.activate).not.toHaveBeenCalled(); expect(refresh).toHaveBeenCalledOnce();
    const calls = runner.mock.calls as unknown as [string, string[]][];
    expect(calls.some(([, args]) => args.includes("caption"))).toBe(true);
    expect(calls.some(([, args]) => args.includes("install") && (args.includes("latexmk") || args.includes("biber-windows-x64")))).toBe(false);
    expect(calls.some(([, args]) => args.includes("ctex") || args.includes("complete"))).toBe(false);
    expect(calls.some(([, args]) => args.includes("--set-config-value=[MPM]AutoInstall=0"))).toBe(true);
    expect(calls.some(([, args]) => args[0] === "caption.sty")).toBe(true);
    await expect(readFile(join(bin, ".texweave-toolchain.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("repairs a managed portable MiKTeX and uses its bundled Perl after restarting", async () => {
    const f = await fixture(); const target = join(f.root, "MiKTeX");
    const bin = join(target, "texmfs", "install", "miktex", "bin", "x64");
    await mkdir(bin, { recursive: true }); await writeFile(join(bin, "miktex.exe"), "fixture");
    const perl = join(target, "tlpkg", "tlperl", "bin"); await mkdir(perl, { recursive: true }); await writeFile(join(perl, "perl.exe"), "fixture");
    await writeFile(join(target, ".texweave-toolchain.json"), JSON.stringify({ schemaVersion: 1, distribution: "miktex" }));
    const tc = { distribution: "miktex", available: true, detectedAt: "now", ...Object.fromEntries(latexTools.map(tool => [tool, join(bin, tool + ".exe")])) } as LatexToolchain;
    const runner = vi.fn(async () => undefined);
    const installer = new LatexToolchainInstaller({ defaultDirectory: f.target, supported: true, fetch: f.fetcher as typeof fetch, run: runner, detect: async () => tc, activate: f.activate });
    installer.start(target, plan({ components: ["chinese"], full: true }));
    expect((await finish(installer)).phase).toBe("complete"); expect(f.fetcher).not.toHaveBeenCalled();
    expect((runner.mock.calls as unknown as [string, string[]][]).some(([, args]) => args.join(" ") === "packages upgrade complete")).toBe(true);
    expect(f.activate).toHaveBeenCalledWith(tc, target);
    if (process.platform === "win32") expect(environmentWithToolRuntime(join(bin, "latexmk.exe"), { Path: "system" }).PATH?.split(";").slice(0, 2)).toEqual([bin, perl]);
    expect(JSON.parse(await readFile(join(target, ".texweave-toolchain.json"), "utf8")).selection.components).toEqual(["chinese"]);
  });

  it("rejects a changed current distribution before touching either environment", async () => {
    const f = await fixture();
    f.installer.start(f.target, plan({ existing: true }));
    expect((await finish(f.installer)).error).toContain("no longer available");
    expect(f.runner).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("passes custom TeX Live components without forcing a full scheme", async () => {
    const f = await fixture();
    f.installer.start(f.target, plan({ distribution: "tinytex", customPackages: ["geometry"] }));
    expect((await finish(f.installer)).phase).toBe("complete");
    const calls = f.runner.mock.calls as unknown as [string, string[], string, AbortSignal, unknown, NodeJS.ProcessEnv][];
    const installArgs = calls.map(call => JSON.parse(call[5]?.TEXWEAVE_TLMGR_ARGS ?? "[]") as string[]).find(args => args.includes("install") && args.includes("caption"));
    expect(installArgs).toContain("geometry"); expect(installArgs).not.toContain("scheme-full"); expect(installArgs).not.toContain("subcaption");
    f.installer.start(f.target, plan({ distribution: "tinytex", full: true }));
    expect((await finish(f.installer)).phase).toBe("complete");
    expect(calls === f.runner.mock.calls).toBe(true);
    expect(calls.some(call => call[5]?.TEXWEAVE_TLMGR_ARGS?.includes("scheme-full"))).toBe(true);
  });

  it("rejects corrupt MiKTeX downloads before extraction or activation", async () => {
    const f = await fixture(); f.installer.start(f.target, plan());
    expect((await finish(f.installer)).error).toContain("checksum"); expect(f.runner).not.toHaveBeenCalled(); expect(f.activate).not.toHaveBeenCalled();
  });

  it("does not enable a toolchain if selected package verification fails", async () => {
    const f = await fixture();
    f.runner.mockImplementation(async (exe: string) => { if (exe.endsWith("kpsewhich.exe")) throw new Error("caption.sty missing"); });
    // Seed an already managed TinyTeX so this test targets package verification.
    await mkdir(f.target, { recursive: true }); await writeFile(join(f.target, ".texweave-toolchain.json"), JSON.stringify({ schemaVersion: 1, distribution: "tinytex" }));
    f.installer.start(f.target, plan({ distribution: "tinytex" }));
    expect((await finish(f.installer)).error).toContain("caption.sty"); expect(f.activate).not.toHaveBeenCalled();
  });
});

it("cancels a running existing-environment component task without activation", async () => {
  const f = await fixture(); const bin = join(f.root, "existing-MiKTeX"); await mkdir(bin); await writeFile(join(bin,"miktex.exe"),"fixture");
  const current = { distribution: "miktex", binDirectory: bin } as LatexToolchain;
  const runner = vi.fn(async (_exe: string, _args: string[], _cwd: string, signal: AbortSignal) => {
    await new Promise<void>((_done, reject) => { if (signal.aborted) reject(new Error("Cancelled")); else signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }); });
  });
  const installer = new LatexToolchainInstaller({ defaultDirectory: f.target, supported: true, run: runner, detect: async () => current, currentToolchain: () => current, activate: f.activate });
  installer.start(f.target, plan({ existing: true })); await vi.waitFor(() => expect(runner).toHaveBeenCalledOnce()); installer.cancel();
  expect((await finish(installer)).phase).toBe("cancelled"); expect(f.activate).not.toHaveBeenCalled();
});
