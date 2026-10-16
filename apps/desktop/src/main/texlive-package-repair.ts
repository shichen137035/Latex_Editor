import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { LatexToolchain } from "@latex-editor/contracts" with { "resolution-mode": "import" };

export interface PackageRepairRequest { executable: string; files: string[]; signal: AbortSignal; output: (text: string) => void }
export type PackageCommand = (executable: string, args: string[], cwd: string, signal: AbortSignal, output: (text: string) => void, env?: NodeJS.ProcessEnv) => Promise<void>;
export const packageFilePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.+-]{0,150}\.(?:sty|cls|bst|def|clo|fd|bbx|cbx|lbx|tfm|ofm|vf|enc)$/i;

/** Resolve the exact runtime filename; never assume a file and package share a name. */
export function packageForFile(output: string, filename: string): string {
  const matches = new Set<string>(); let current: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    const heading = /^([a-zA-Z0-9][a-zA-Z0-9.+-]*):\s*$/.exec(line);
    if (heading) { current = heading[1]; continue; }
    const file = line.trim().replaceAll("\\", "/");
    if (current && /^texmf-dist\/(?:tex|fonts|bibtex)\//.test(file) && file.endsWith("/" + filename)) matches.add(current);
  }
  if (matches.size !== 1) throw new Error(`Cannot identify one TeX Live package for ${filename}. Check the package installation log.`);
  return [...matches][0]!;
}

export async function repairTexLivePackages(request: PackageRepairRequest, toolchain: LatexToolchain | undefined, execute: PackageCommand): Promise<boolean> {
  if (toolchain?.distribution !== "texlive" || !toolchain.binDirectory || !toolchain.latexmk || !isAbsolute(request.executable)) return false;
  const key = (path: string) => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
  if (key(request.executable) !== key(toolchain.latexmk) || key(dirname(request.executable)) !== key(toolchain.binDirectory)) return false;
  const files = [...new Set(request.files.filter(file => packageFilePattern.test(file)))];
  if (!files.length) return false;
  if (files.length > 20) throw new Error("Too many missing TeX Live files in one automatic installation.");
  const bin = toolchain.binDirectory;
  const manager = join(bin, process.platform === "win32" ? "tlmgr.bat" : "tlmgr");
  const kpsewhich = join(bin, process.platform === "win32" ? "kpsewhich.exe" : "kpsewhich");
  if (!existsSync(manager) || !existsSync(kpsewhich)) throw new Error("The selected TeX Live environment has no tlmgr or kpsewhich. Repair or locate the environment in Settings.");
  const { compilerEnvironment, environmentWithToolRuntime } = await import("@latex-editor/compiler-latexmk");
  const env = environmentWithToolRuntime(request.executable, compilerEnvironment());
  const invoke = async (args: string[], output = request.output) => {
    request.signal.throwIfAborted();
    if (process.platform !== "win32") return execute(manager, args, bin, request.signal, output, env);
    const code = Buffer.from("$ErrorActionPreference='Stop'; $a=@(ConvertFrom-Json $env:TEXWEAVE_TLMGR_ARGS); & $env:TEXWEAVE_TLMGR @a; exit $LASTEXITCODE", "utf16le").toString("base64");
    const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    return execute(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", code], bin, request.signal, output, { ...env, TEXWEAVE_TLMGR: manager, TEXWEAVE_TLMGR_ARGS: JSON.stringify(args) });
  };
  const available = async (file: string) => {
    request.signal.throwIfAborted();
    try { await execute(kpsewhich, [file], bin, request.signal, () => undefined, env); return true; }
    catch (error) {
      request.signal.throwIfAborted();
      if (error instanceof Error && /command failed \(1\)/.test(error.message)) return false;
      throw error;
    }
  };
  const packages = new Set<string>(); const missing: string[] = [];
  for (const file of files) {
    if (await available(file)) continue;
    missing.push(file); request.output(`\n[TeXWeave] Looking up missing TeX Live file: ${file}\n`);
    let response = "";
    const pattern = "/" + file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$";
    await invoke(["search", "--global", "--file", pattern], text => { response = (response + text).slice(-1024 * 1024); request.output(text); });
    packages.add(packageForFile(response, file));
  }
  if (packages.size) {
    request.output(`\n[TeXWeave] Installing TeX Live packages: ${[...packages].join(", ")}\n`);
    // tlmgr skips installed packages and resolves transitive dependencies itself.
    await invoke(["install", ...packages]);
    for (const file of missing) if (!await available(file)) throw new Error(`TeX Live installed packages, but ${file} is still unavailable.`);
  }
  request.signal.throwIfAborted();
  return true;
}
