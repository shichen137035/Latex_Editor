import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
