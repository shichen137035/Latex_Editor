import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, open, writeFile, cp, lstat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep, parse } from "node:path";
import type { LatexToolchain, ToolchainInstallStatus, ToolchainInstallSelection } from "@latex-editor/contracts" with { "resolution-mode": "import" };

import { selectedFiles, selectedPackages, validateSelection } from "./toolchain-components.js";

import { repairTexLivePackages, type PackageRepairRequest } from "./texlive-package-repair.js";

const releaseApi = "https://api.github.com/repos/rstudio/tinytex-releases/releases/latest";
// Official MiKTeX Setup Utility, pinned to the published SHA-256.
export const miktexSetupAsset = {
  url: "https://miktex.org/download/ctan/systems/win32/miktex/setup/windows-x64/miktexsetup-5.5.0%2B1763023-x64.zip",
  sha256: "0571e90f6d94353089b4f189fd82a532f9fe559a388c7e7f1102b14b3c1ae27d"
};
const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const expandCommand = Buffer.from("$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:TEXWEAVE_ARCHIVE -DestinationPath $env:TEXWEAVE_EXTRACT", "utf16le").toString("base64");
const markerName = ".texweave-toolchain.json";
export const latexTools = ["pdflatex", "xelatex", "lualatex", "latexmk", "bibtex", "biber", "makeindex"] as const;
const packages = ["latex-bin", "pdftex", "xetex", "luatex", "luahbtex", "latexmk", "bibtex", "biber", "makeindex"];
const tlmgrCommand = Buffer.from("$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; $a = @(ConvertFrom-Json $env:TEXWEAVE_TLMGR_ARGS); & $env:TEXWEAVE_TLMGR @a; exit $LASTEXITCODE", "utf16le").toString("base64");

export function allLatexToolsReady(toolchain: LatexToolchain): boolean {
  return latexTools.every(tool => toolchain.environment ? toolchain.environment[tool].status === "ready" : Boolean(toolchain[tool]));
}

interface ReleaseAsset { name: string; browser_download_url: string; size: number; digest: string }
export function windowsTinyTexAsset(release: unknown, bundle: "TinyTeX-0" | "TinyTeX-1" = "TinyTeX-1"): ReleaseAsset {
  const assets = release && typeof release === "object" && "assets" in release ? release.assets : undefined;
  if (!Array.isArray(assets)) throw new Error("The TinyTeX release has no asset list.");
  const asset = assets.find((item: ReleaseAsset) => new RegExp(`^${bundle}-windows(?:-v[\\d.]+)?\\.exe$`).test(item.name));
  if (!asset || typeof asset.browser_download_url !== "string"
    || !asset.browser_download_url.startsWith("https://github.com/rstudio/tinytex-releases/releases/download/")
    || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")
    || !Number.isSafeInteger(asset.size) || asset.size < 1 || asset.size > 512 * 1024 * 1024) {
    throw new Error("No verified Windows TinyTeX-1 download is available in the official release.");
  }
  return asset;
}

type Run = (executable: string, args: string[], cwd: string, signal: AbortSignal, output: (text: string) => void, env?: NodeJS.ProcessEnv) => Promise<void>;

/** Commands are fixed executables and argument arrays, never user-built shell strings. */
async function run(executable: string, args: string[], cwd: string, signal: AbortSignal, output: (text: string) => void, env = process.env): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((done, reject) => {
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let tail = "";
    const capture = (chunk: Buffer) => { const text = chunk.toString(); tail = (tail + text).slice(-4000); output(text); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const abort = () => {
      if (child.pid && process.platform === "win32") {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
        killer.on("error", () => child.kill());
      } else child.kill();
    };
    const timeout = setTimeout(abort, 30 * 60 * 1000);
    signal.addEventListener("abort", abort, { once: true });
    const cleanup = () => { clearTimeout(timeout); signal.removeEventListener("abort", abort); };
    child.once("error", error => { cleanup(); reject(error); });
    child.once("close", code => {
      cleanup();
      if (signal.aborted) reject(new Error("Installation cancelled."));
      else if (code !== 0) reject(new Error(`Installation command failed (${code ?? "unknown"}). ${tail}`));
      else done();
    });
  });
}

interface InstallerOptions {
  defaultDirectory: string;
  currentToolchain?: () => LatexToolchain | undefined;
  refresh?: (toolchain: LatexToolchain) => Promise<void>;
  detect: (binDirectory: string) => Promise<LatexToolchain>;
  activate: (toolchain: LatexToolchain, directory: string) => Promise<void>;
  fetch?: typeof globalThis.fetch;
  run?: Run;
  supported?: boolean;
}

/** One job belongs to the main process and survives closing the Settings panel. */
export class LatexToolchainInstaller {
  #state: ToolchainInstallStatus;
  #controller: AbortController | undefined;
  #job: Promise<void> | undefined;
  #repairQueue: Promise<unknown> = Promise.resolve();
  #disposing = false;
  #options: InstallerOptions;

  constructor(options: InstallerOptions) {
    this.#options = options;
    this.#state = { supported: options.supported ?? (process.platform === "win32" && process.arch === "x64"), defaultDirectory: options.defaultDirectory, directory: options.defaultDirectory, phase: "idle", running: false, downloadedBytes: 0, totalBytes: 0, log: "" };
  }
  status(): ToolchainInstallStatus { return structuredClone({ ...this.#state, defaultDirectories: { miktex: join(dirname(this.#options.defaultDirectory), "MiKTeX"), tinytex: this.#options.defaultDirectory } }); }
  start(directory: string, requested?: ToolchainInstallSelection): ToolchainInstallStatus {
    const selection = validateSelection(requested);
    if (!this.#state.supported) throw new Error("Automatic LaTeX installation currently supports Windows x64.");
    if (this.#job) throw new Error("A LaTeX installation is already running.");
    if (typeof directory !== "string" || !directory.trim() || !isAbsolute(directory) || directory.includes("\0")) throw new Error("Choose an absolute installation folder.");
    const target = resolve(directory);
    if (target === parse(target).root) throw new Error("Choose a dedicated installation folder, not a drive root.");
    if (/[\r\n%"&|<>^!]/.test(target)) throw new Error("The installation folder cannot contain shell control characters such as %, &, or !.");
    this.#state = { selection, supported: true, defaultDirectory: this.#state.defaultDirectory, directory: target, phase: "verifying", running: true, downloadedBytes: 0, totalBytes: 0, log: "" };
    this.#controller = new AbortController();
    this.#job = this.#perform(target, selection, this.#controller.signal).catch(error => {
      this.#state = { ...this.#state, phase: this.#controller?.signal.aborted ? "cancelled" : "error", error: error instanceof Error ? error.message : String(error) };
    }).finally(() => { this.#state.running = false; this.#controller = undefined; this.#job = undefined; });
    return this.status();
  }
  cancel(): ToolchainInstallStatus { this.#controller?.abort(); return this.status(); }
  async dispose(): Promise<void> { this.#disposing = true; this.cancel(); await this.#job; await this.#repairQueue.catch(() => undefined); }
  repairMissingPackages(request: PackageRepairRequest): Promise<boolean> {
    const task = this.#repairQueue.catch(() => undefined).then(async () => {
      await this.#job;
      request.signal.throwIfAborted();
      if (this.#disposing) throw new Error("LaTeX package installation cancelled.");
      const current = this.#options.currentToolchain?.();
      if (current?.distribution !== "texlive") return false;
      this.#controller = new AbortController();
      const signal = AbortSignal.any([request.signal, this.#controller.signal]);
      this.#state = { ...this.#state, selection: { distribution: "tinytex", components: [], customPackages: [], full: false, autoInstall: true, existing: true }, toolchain: current, directory: current.binDirectory ?? this.#state.directory, phase: "installing", running: true, log: "" };
      delete this.#state.error;
      const work = repairTexLivePackages({ ...request, signal, output: text => { this.#log(text); request.output(text); } }, current, this.#options.run ?? run);
      this.#job = work.then(() => undefined, () => undefined);
      try { const repaired = await work; this.#phase(repaired ? "complete" : "idle"); return repaired; }
      catch (error) { this.#state.phase = signal.aborted ? "cancelled" : "error"; this.#state.error = error instanceof Error ? error.message : String(error); if (signal.aborted) throw new Error("Installation cancelled."); throw error; }
      finally { this.#state.running = false; this.#job = undefined; this.#controller = undefined; }
    });
    this.#repairQueue = task;
    return task;
  }
  #log = (text: string) => { this.#state.log = (this.#state.log + text).slice(-8000); };
  #phase(phase: ToolchainInstallStatus["phase"]) { this.#state.phase = phase; }

  async #perform(target: string, selection: ToolchainInstallSelection, signal: AbortSignal): Promise<void> {
    if (selection.existing) {
      const current = this.#options.currentToolchain?.();
      const expected = selection.distribution === "miktex" ? "miktex" : "texlive";
      if (!current?.binDirectory || current.distribution !== expected) throw new Error("The selected existing LaTeX environment is no longer available. Detect it again.");
      this.#state.directory = current.binDirectory;
      await this.#configure(current.binDirectory, selection, signal, true);
    } else if (selection.distribution === "miktex") await this.#installMiktex(target, selection, signal);
    else await this.#install(target, selection, signal);
  }

  async #download(url: string, destination: string, digest: string, signal: AbortSignal): Promise<void> {
    this.#phase("downloading");
    this.#state.downloadedBytes = 0; this.#state.totalBytes = 0;
    const response = await (this.#options.fetch ?? globalThis.fetch)(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]) });
    if (!response.ok || !response.body) throw new Error(`Unable to download LaTeX tools (HTTP ${response.status}).`);
    const size = Number(response.headers.get("content-length")) || 0;
    this.#state.totalBytes = size;
    const file = await open(destination, "wx");
    const hash = createHash("sha256"); const reader = response.body.getReader();
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read(); if (done) break;
        this.#state.downloadedBytes += value.length;
        if (this.#state.downloadedBytes > 512 * 1024 * 1024) throw new Error("The download exceeded the allowed size.");
        hash.update(value); await file.writeFile(value);
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); await file.close(); }
    if ((size && size !== this.#state.downloadedBytes) || hash.digest("hex") !== digest) throw new Error("LaTeX download checksum verification failed.");
  }

  async #checkTarget(target: string, distribution: string): Promise<boolean> {
    if (!existsSync(target)) return false;
    if ((await lstat(target)).isSymbolicLink() || resolve(await realpath(target)).toLowerCase() !== resolve(target).toLowerCase()) throw new Error("Use a normal installation folder, not a junction or symbolic link.");
    let managed = false;
    try { const info = JSON.parse(await readFile(join(target, markerName), "utf8")); managed = info.schemaVersion === 1 && info.distribution === distribution; } catch { /* Protect unmarked folders. */ }
    if (!managed && (await readdir(target)).length) throw new Error("The folder is not empty. Choose an empty folder or the matching environment installed by TeXWeave.");
    return managed;
  }

  async #installMiktex(target: string, selection: ToolchainInstallSelection, signal: AbortSignal): Promise<void> {
    const managed = await this.#checkTarget(target, "miktex");
    await mkdir(dirname(target), { recursive: true });
    const staging = await mkdtemp(join(dirname(target), ".texweave-latex-"));
    const execute = this.#options.run ?? run;
    try {
      const bin = join(target, "texmfs", "install", "miktex", "bin", "x64");
      if (!managed || !existsSync(join(bin, "miktex.exe"))) {
        const archive = join(staging, "miktex.zip");
        await this.#download(miktexSetupAsset.url, archive, miktexSetupAsset.sha256, signal);
        this.#phase("extracting");
        const extract = join(staging, "setup");
        await execute(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", expandCommand], staging, signal, this.#log, { ...process.env, TEXWEAVE_ARCHIVE: archive, TEXWEAVE_EXTRACT: extract });
        const setup = join(extract, "miktexsetup_standalone.exe");
        if (!existsSync(setup)) throw new Error("MiKTeX setup utility is missing from the verified archive.");
        this.#phase("installing");
        const repository = join(staging, "repository");
        await execute(setup, ["--verbose", `--local-package-repository=${repository}`, "--package-set=basic", "download"], staging, signal, this.#log);
        // A portable tree keeps registration, configuration and data inside the chosen folder.
        await mkdir(target, { recursive: true });
        await writeFile(join(target, markerName), JSON.stringify({ schemaVersion: 1, distribution: "miktex", selection }, null, 2));
        await execute(setup, ["--verbose", `--local-package-repository=${repository}`, "--package-set=basic", `--portable=${target}`, "--use-registry=no", "--modify-path=no", "install"], staging, signal, this.#log);
      }
      // MiKTeX does not ship Perl; reuse TeX Live's self-contained runtime for latexmk.
      const perl = join(target, "tlpkg", "tlperl");
      if (!existsSync(join(perl, "bin", "perl.exe"))) {
        const fetcher = this.#options.fetch ?? globalThis.fetch;
        const metadata = await fetcher(releaseApi, { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
        if (!metadata.ok) throw new Error(`Unable to read Perl runtime metadata (HTTP ${metadata.status}).`);
        const asset = windowsTinyTexAsset(await metadata.json(), "TinyTeX-0");
        const archive = join(staging, "perl-runtime.exe");
        await this.#download(asset.browser_download_url, archive, asset.digest.slice(7), signal);
        this.#phase("extracting");
        const extract = join(staging, "runtime"); await mkdir(extract);
        await execute(archive, ["-y"], extract, signal, this.#log);
        const source = join(extract, "TinyTeX", "tlpkg", "tlperl");
        if (!existsSync(join(source, "bin", "perl.exe"))) throw new Error("The verified bundle has no Perl runtime.");
        await mkdir(dirname(perl), { recursive: true }); await cp(source, perl, { recursive: true });
      }
      await this.#configure(bin, selection, signal, false, target);
    } finally { await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(error => this.#log(String(error))); }
  }

  async #configure(bin: string, selection: ToolchainInstallSelection, signal: AbortSignal, existing: boolean, target = bin): Promise<void> {
    this.#phase("installing");
    const execute = this.#options.run ?? run;
    const { environmentWithToolRuntime, compilerEnvironment } = await import("@latex-editor/compiler-latexmk");
    const env = environmentWithToolRuntime(join(bin, "latexmk.exe"), compilerEnvironment());
    const extra = selectedPackages(selection);
    if (selection.distribution === "miktex") {
      const manager = join(bin, "miktex.exe");
      if (!existsSync(manager)) throw new Error("The selected MiKTeX package manager is missing.");
      await execute(manager, ["packages", "update-package-database"], bin, signal, this.#log, env);
      // Unlike tlmgr, MiKTeX rejects an install request containing an installed
      // package. Inventory first so retries and overlapping components work.
      let inventory = "";
      await execute(manager, ["packages", "list", "--template={id},{isInstalled}"], bin, signal, text => {
        inventory = (inventory + text).slice(-4 * 1024 * 1024);
      }, env);
      const installed = new Set(inventory.split(/\r?\n/).map(line => line.trim()).filter(line => line.endsWith(",true")).map(line => line.slice(0, -5)));
      const missing = [...new Set(["latexmk", "biber-windows-x64", ...extra])].filter(id => !installed.has(id));
      if (missing.length) await execute(manager, ["packages", "install", ...missing], bin, signal, this.#log, env);
      if (selection.full) await execute(manager, ["packages", "upgrade", "complete"], bin, signal, this.#log, env);
      await execute(join(bin, "initexmf.exe"), [`--set-config-value=[MPM]AutoInstall=${selection.autoInstall ? "1" : "0"}`], bin, signal, this.#log, env);
    } else {
      const manager = join(bin, "tlmgr.bat");
      if (!existsSync(manager)) throw new Error("The selected TeX Live package manager is missing.");
      const invoke = async (args: string[]) => execute(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", tlmgrCommand], bin, signal, this.#log, { ...env, TEXWEAVE_TLMGR: manager, TEXWEAVE_TLMGR_ARGS: JSON.stringify(args) });
      await invoke(["update", "--self"]);
      await invoke(["install", ...packages, ...extra, ...(selection.full ? ["scheme-full"] : [])]);
    }
    this.#phase("verifying");
    for (const file of selectedFiles(selection)) await execute(join(bin, "kpsewhich.exe"), [file], bin, signal, this.#log, env);
    const detected = await this.#options.detect(bin);
    const within = latexTools.every(tool => { const path = detected[tool] && relative(bin, detected[tool]!); return path !== undefined && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path); });
    if (!allLatexToolsReady(detected) || !within) throw new Error("Installation finished, but not every LaTeX tool passed verification. Review the log and retry installation.");
    signal.throwIfAborted();
    if (!existing) await writeFile(join(target, markerName), JSON.stringify({ schemaVersion: 1, distribution: selection.distribution, selection }, null, 2));
    // Adding packages to a user's external environment must not claim ownership of it.
    if (!existing) await this.#options.activate(detected, target);
    else await this.#options.refresh?.(detected);
    this.#state.toolchain = detected; this.#phase("complete");
  }

  async #install(target: string, selection: ToolchainInstallSelection, signal: AbortSignal): Promise<void> {
    const marker = join(target, markerName);
    const managed = await this.#checkTarget(target, "tinytex");
    let staging: string | undefined;
    const execute = this.#options.run ?? run;
    try {
      if (!managed) {
        await mkdir(dirname(target), { recursive: true });
        staging = await mkdtemp(join(dirname(target), ".texweave-latex-"));
        this.#phase("downloading");
        const fetcher = this.#options.fetch ?? globalThis.fetch;
        const networkSignal = AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]);
        const metadata = await fetcher(releaseApi, { signal: networkSignal, headers: { "User-Agent": "TeXWeave", Accept: "application/vnd.github+json" } });
        if (!metadata.ok) throw new Error(`Unable to read TinyTeX release metadata (HTTP ${metadata.status}).`);
        const asset = windowsTinyTexAsset(await metadata.json());
        this.#state.totalBytes = asset.size;
        const response = await fetcher(asset.browser_download_url, { signal: networkSignal });
        if (!response.ok || !response.body) throw new Error(`Unable to download TinyTeX (HTTP ${response.status}).`);
        const archive = join(staging, "tinytex.exe");
        const file = await open(archive, "wx");
        const hash = createHash("sha256");
        const reader = response.body.getReader();
        try {
          while (true) {
            signal.throwIfAborted();
            const { done, value } = await reader.read();
            if (done) break;
            this.#state.downloadedBytes += value.length;
            if (this.#state.downloadedBytes > asset.size) throw new Error("The download exceeded its declared size.");
            hash.update(value);
            await file.writeFile(value);
          }
        } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); await file.close(); }
        if (this.#state.downloadedBytes !== asset.size || `sha256:${hash.digest("hex")}` !== asset.digest) throw new Error("TinyTeX download checksum verification failed.");
        this.#phase("extracting");
        const extract = join(staging, "extract");
        await mkdir(extract);
        await execute(archive, ["-y"], extract, signal, this.#log);
        const source = join(extract, "TinyTeX");
        if (!existsSync(join(source, "tlpkg", "tlperl", "bin", "perl.exe")) || !existsSync(join(source, "texmf-dist", "scripts", "texlive", "tlmgr.pl"))) throw new Error("The downloaded bundle is missing its package manager or Perl runtime.");
        signal.throwIfAborted();
        if (existsSync(target)) await rmdir(target); // Only succeeds for an empty folder.
        await rename(source, target);
        await writeFile(marker, JSON.stringify({ schemaVersion: 1, distribution: "tinytex", source: asset.browser_download_url, digest: asset.digest }, null, 2));
      }
      this.#phase("installing");
      const bin = join(target, "bin", "windows");
      const perl = join(target, "tlpkg", "tlperl", "bin");
      const env = { ...process.env };
      const inherited = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
      for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
      env.PATH = [bin, perl, inherited].join(";");
      // Windows tlmgr.bat also runs the infrastructure updater prepared by Perl.
      // Passing paths and arguments through environment data keeps the PS code fixed.
      env.TEXWEAVE_TLMGR = join(bin, "tlmgr.bat");
      for (const key of Object.keys(env)) if (key === "LANG" || key.startsWith("LC_")) delete env[key];
      const fetcher = this.#options.fetch ?? globalThis.fetch;
      const metadataUrl = "https://mirror.ctan.org/systems/texlive/tlnet/tlpkg/texlive.tlpdb.xz";
      const mirror = await fetcher(metadataUrl, { method: "HEAD", signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
      if (!mirror.ok) throw new Error(`Unable to select a TeX Live mirror (HTTP ${mirror.status}).`);
      const repositoryUrl = mirror.url ? mirror.url.replace(/\/tlpkg\/texlive\.tlpdb\.xz$/, "") : "https://mirror.ctan.org/systems/texlive/tlnet";
      if (!repositoryUrl.startsWith("https://") || repositoryUrl === mirror.url) throw new Error("The TeX Live mirror returned an invalid repository URL.");
      const invokeManager = async (args: string[]) => {
        const powershell = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        await execute(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", tlmgrCommand], target, signal, this.#log,
          { ...env, TEXWEAVE_TLMGR_ARGS: JSON.stringify(["--repository", repositoryUrl, ...args]) });
      };
      // TeX Live supplies executable launchers and format registrations together.
      // Existing packages are skipped by tlmgr; dependencies are installed with them.
      await invokeManager(["update", "--self"]);
      await invokeManager(["install", ...packages, ...selectedPackages(selection), ...(selection.full ? ["scheme-full"] : [])]);
      await invokeManager(["postaction", "install", "script", "xetex"]);
      this.#phase("verifying");
      signal.throwIfAborted();
      for (const file of selectedFiles(selection)) await execute(join(bin, "kpsewhich.exe"), [file], target, signal, this.#log, env);
      const detected = await this.#options.detect(bin);
      const belongsToInstall = latexTools.every(tool => {
        const file = detected[tool];
        if (!file) return false;
        const path = relative(bin, file);
        return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
      });
      if (!allLatexToolsReady(detected) || !belongsToInstall) throw new Error("Installation finished, but not every LaTeX tool passed verification. Review the log and retry installation.");
      signal.throwIfAborted();
      await writeFile(marker, JSON.stringify({ schemaVersion: 1, distribution: "tinytex", selection }, null, 2));
      await this.#options.activate(detected, target);
      this.#state.toolchain = detected;
      this.#phase("complete");
    } finally {
      // Delete only our freshly created sibling staging directory, never the install.
      if (staging && dirname(staging) === dirname(target) && staging.startsWith(join(dirname(target), ".texweave-latex-"))) {
        await rm(staging, { recursive: true, force: true, maxRetries: 3 }).catch(error => this.#log(`\nTemporary files could not be removed: ${String(error)}\n`));
      }
    }
  }
}
