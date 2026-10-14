import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, open, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep, parse } from "node:path";
import type { LatexToolchain, ToolchainInstallStatus } from "@latex-editor/contracts" with { "resolution-mode": "import" };

const releaseApi = "https://api.github.com/repos/rstudio/tinytex-releases/releases/latest";
const markerName = ".texweave-toolchain.json";
export const latexTools = ["pdflatex", "xelatex", "lualatex", "latexmk", "bibtex", "biber", "makeindex"] as const;
const packages = ["latex-bin", "pdftex", "xetex", "luatex", "luahbtex", "latexmk", "bibtex", "biber", "makeindex"];
const tlmgrCommand = Buffer.from("$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; $a = @(ConvertFrom-Json $env:TEXWEAVE_TLMGR_ARGS); & $env:TEXWEAVE_TLMGR @a; exit $LASTEXITCODE", "utf16le").toString("base64");

export function allLatexToolsReady(toolchain: LatexToolchain): boolean {
  return latexTools.every(tool => toolchain.environment ? toolchain.environment[tool].status === "ready" : Boolean(toolchain[tool]));
}

interface ReleaseAsset { name: string; browser_download_url: string; size: number; digest: string }
export function windowsTinyTexAsset(release: unknown): ReleaseAsset {
  const assets = release && typeof release === "object" && "assets" in release ? release.assets : undefined;
  if (!Array.isArray(assets)) throw new Error("The TinyTeX release has no asset list.");
  const asset = assets.find((item: ReleaseAsset) => /^TinyTeX-1-windows(?:-v[\d.]+)?\.exe$/.test(item.name));
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
  #options: InstallerOptions;

  constructor(options: InstallerOptions) {
    this.#options = options;
    this.#state = { supported: options.supported ?? (process.platform === "win32" && process.arch === "x64"), defaultDirectory: options.defaultDirectory, directory: options.defaultDirectory, phase: "idle", running: false, downloadedBytes: 0, totalBytes: 0, log: "" };
  }
  status(): ToolchainInstallStatus { return { ...this.#state }; }
  start(directory: string): ToolchainInstallStatus {
    if (!this.#state.supported) throw new Error("Automatic LaTeX installation currently supports Windows x64.");
    if (this.#job) throw new Error("A LaTeX installation is already running.");
    if (typeof directory !== "string" || !directory.trim() || !isAbsolute(directory) || directory.includes("\0")) throw new Error("Choose an absolute installation folder.");
    const target = resolve(directory);
    if (target === parse(target).root) throw new Error("Choose a dedicated installation folder, not a drive root.");
    if (/[\r\n%"&|<>^!]/.test(target)) throw new Error("The installation folder cannot contain shell control characters such as %, &, or !.");
    this.#state = { supported: true, defaultDirectory: this.#state.defaultDirectory, directory: target, phase: "verifying", running: true, downloadedBytes: 0, totalBytes: 0, log: "" };
    this.#controller = new AbortController();
    this.#job = this.#install(target, this.#controller.signal).catch(error => {
      this.#state = { ...this.#state, phase: this.#controller?.signal.aborted ? "cancelled" : "error", error: error instanceof Error ? error.message : String(error) };
    }).finally(() => { this.#state.running = false; this.#controller = undefined; this.#job = undefined; });
    return this.status();
  }
  cancel(): ToolchainInstallStatus { this.#controller?.abort(); return this.status(); }
  async dispose(): Promise<void> { this.cancel(); await this.#job; }
  #log = (text: string) => { this.#state.log = (this.#state.log + text).slice(-8000); };
  #phase(phase: ToolchainInstallStatus["phase"]) { this.#state.phase = phase; }

  async #install(target: string, signal: AbortSignal): Promise<void> {
    const marker = join(target, markerName);
    let managed = false;
    if (existsSync(target)) {
      try {
        const info = JSON.parse(await readFile(marker, "utf8"));
        managed = info.schemaVersion === 1 && info.distribution === "tinytex";
      } catch { /* An arbitrary pre-existing folder must not be changed. */ }
      if (!managed && (await readdir(target)).length) throw new Error("The folder is not empty. Choose an empty folder or a TinyTeX installation previously created by TeXWeave.");
    }
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
      await invokeManager(["install", ...packages]);
      await invokeManager(["postaction", "install", "script", "xetex"]);
      this.#phase("verifying");
      signal.throwIfAborted();
      const detected = await this.#options.detect(bin);
      const belongsToInstall = latexTools.every(tool => {
        const file = detected[tool];
        if (!file) return false;
        const path = relative(bin, file);
        return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
      });
      if (!allLatexToolsReady(detected) || !belongsToInstall) throw new Error("Installation finished, but not every LaTeX tool passed verification. Review the log and retry installation.");
      signal.throwIfAborted();
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
