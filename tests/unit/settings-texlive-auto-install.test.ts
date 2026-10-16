import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { LatexToolchain } from "../../packages/contracts/src/settings.js";
import { preferenceDefaults, sanitizePreferences } from "../../packages/contracts/src/settings.js";
import { packageForFile, repairTexLivePackages, type PackageCommand, type PackageRepairRequest } from "../../apps/desktop/src/main/texlive-package-repair.js";
import { LatexToolchainInstaller } from "../../apps/desktop/src/main/toolchain-installer.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(),"texweave-tl-repair-")); roots.push(root);
  const bin = join(root,"bin"); await mkdir(bin);
  const suffix = process.platform === "win32" ? ".exe" : "";
  const executable = join(bin,"latexmk" + suffix);
  await Promise.all([executable, join(bin,process.platform === "win32" ? "tlmgr.bat" : "tlmgr"), join(bin,"kpsewhich" + suffix)].map(path => writeFile(path,"fixture")));
  const toolchain = { distribution: "texlive", available: true, binDirectory: bin, latexmk: executable, detectedAt: "now" } as LatexToolchain;
  const installed = new Set<string>(); const commands: string[][] = [];
  const command: PackageCommand = async (exe,args,_cwd,signal,output,env) => {
    signal.throwIfAborted();
    if (exe.includes("kpsewhich")) { if (!installed.has(args[0]!)) throw new Error("Installation command failed (1)."); return; }
    const command = env?.TEXWEAVE_TLMGR_ARGS ? JSON.parse(env.TEXWEAVE_TLMGR_ARGS) as string[] : args;
    commands.push(command);
    if (command[0] === "search") {
      const file = command.at(-1)!.slice(1,-1).replaceAll("\\.",".");
      output(`caption:\n    texmf-dist/tex/latex/caption/${file}\n`);
    } else if (command[0] === "install") { installed.add("caption.sty"); installed.add("subcaption.sty"); }
  };
  const request: PackageRepairRequest = { executable, files: ["caption.sty"], signal: new AbortController().signal, output: vi.fn() };
  return {root,bin,toolchain,installed,commands,command,request};
}
it("maps an exact runtime file to its owning package and refuses ambiguous or documentation-only matches", () => {
  expect(packageForFile("caption:\n texmf-dist/tex/latex/caption/subcaption.sty\n", "subcaption.sty")).toBe("caption");
  for (const output of ["caption:\n texmf-dist/doc/latex/caption/caption.sty", "evil:\n texmf-dist/tex/latex/evil/notcaption.sty", "a:\n texmf-dist/tex/a/caption.sty\nb:\n texmf-dist/tex/b/caption.sty"]) expect(() => packageForFile(output,"caption.sty")).toThrow("identify one");
});
it("deduplicates requested files and package dependencies before installing into the selected environment", async () => {
  const f = await fixture(); f.request.files = ["subcaption.sty","caption.sty","caption.sty"];
  expect(await repairTexLivePackages(f.request,f.toolchain,f.command)).toBe(true);
  expect(f.commands.filter(args => args[0] === "search")).toHaveLength(2);
  expect(f.commands.filter(args => args[0] === "install")).toEqual([["install","caption"]]);
  f.commands.length = 0;
  expect(await repairTexLivePackages(f.request,f.toolchain,f.command)).toBe(true);
  expect(f.commands).toEqual([]);
});
it("never installs for MiKTeX, another executable, or local project files", async () => {
  const f = await fixture();
  expect(await repairTexLivePackages(f.request,{...f.toolchain,distribution:"miktex"},f.command)).toBe(false);
  expect(await repairTexLivePackages({...f.request,executable:join(f.root,"another.exe")},f.toolchain,f.command)).toBe(false);
  for (const file of ["chapter.tex","photo.pdf","../caption.sty","--shell.sty","x.sty;evil"]) expect(await repairTexLivePackages({...f.request,files:[file]},f.toolchain,f.command)).toBe(false);
  expect(f.commands).toEqual([]);
});
it("verifies missing files after installation and preserves manager errors", async () => {
  const f = await fixture();
  const noInstall: PackageCommand = async (...args) => { const command = args[5]?.TEXWEAVE_TLMGR_ARGS ? JSON.parse(args[5].TEXWEAVE_TLMGR_ARGS) as string[] : args[1]; if(command[0] !== "install") await f.command(...args); };
  await expect(repairTexLivePackages(f.request,f.toolchain,noInstall)).rejects.toThrow("still unavailable");
  const offline: PackageCommand = async () => { throw new Error("Repository is offline"); };
  await expect(repairTexLivePackages(f.request,f.toolchain,offline)).rejects.toThrow("offline");
});
it("serializes concurrent compilation repairs and skips the packages installed by the preceding job", async () => {
  const f = await fixture();
  const installer = new LatexToolchainInstaller({defaultDirectory: f.root, currentToolchain:()=>f.toolchain,run:f.command,detect:async()=>f.toolchain,activate:async()=>undefined});
  expect(await Promise.all([installer.repairMissingPackages(f.request),installer.repairMissingPackages(f.request)])).toEqual([true,true]);
  expect(f.commands.filter(args => args[0] === "install")).toHaveLength(1);
  expect(installer.status().running).toBe(false);
});
it("honors cancellation before touching the package manager", async () => {
  const f = await fixture(); const controller = new AbortController(); controller.abort();
  await expect(repairTexLivePackages({...f.request,signal:controller.signal},f.toolchain,f.command)).rejects.toThrow();
  expect(f.commands).toEqual([]);
});
it("persists the automatic-install toggle as a global boolean setting", () => {
  expect(preferenceDefaults.texLiveAutoInstall).toBe(true);
  expect(sanitizePreferences({texLiveAutoInstall:false})).toEqual({texLiveAutoInstall:false});
  expect(sanitizePreferences({texLiveAutoInstall:"yes"})).toEqual({});
  expect(sanitizePreferences({texLiveAutoInstall:true},true)).toEqual({});
});
