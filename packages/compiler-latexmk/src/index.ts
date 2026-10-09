import { consolidateProjectMetadata } from "@latex-editor/filesystem-node";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  AppError, type CompileInput, type CompileResult, type CompilerProfile, type Project, type ToolchainStatus, type LatexToolchain, type ToolStatus
} from "@latex-editor/contracts";
import { parseLatexDiagnostics } from "@latex-editor/diagnostics";
import type { Clock, IdGenerator } from "@latex-editor/domain";
import { findSyncTexData, syncTexDirectories } from "./synctex-data.js";
import { documentOutputDirectory, targetOutputArguments } from "./output.js";
export { findSyncTexData, syncTexDirectories, type SyncTexData } from "./synctex-data.js";

const maximumTailLength = 64 * 1024;
const maximumTimeoutMs = 300_000;
const maximumReadableLogBytes = 32 * 1024 * 1024;

const delimiter = process.platform === "win32" ? ";" : ":";

/** Common locations are needed because Windows GUI apps may keep the PATH
 * captured when Explorer started, even after MiKTeX/TeX Live updates it. */
export function windowsLatexPathCandidates(environment: NodeJS.ProcessEnv = process.env): string[] {
  const local = environment.LOCALAPPDATA;
  const roaming = environment.APPDATA;
  const programFiles = environment.ProgramFiles ?? environment.PROGRAMFILES ?? "C:\\Program Files";
  const programFilesX86 = environment["ProgramFiles(x86)"] ?? environment.PROGRAMFILES_X86 ?? "C:\\Program Files (x86)";
  const candidates = [
    ...(local ? [`${local}\\Programs\\MiKTeX\\miktex\\bin\\x64`, `${local}\\Programs\\MiKTeX\\miktex\\bin`] : []),
    `${programFiles}\\MiKTeX\\miktex\\bin\\x64`, `${programFiles}\\MiKTeX\\miktex\\bin`,
    `${programFilesX86}\\MiKTeX\\miktex\\bin\\x64`, `${programFilesX86}\\MiKTeX\\miktex\\bin`,
    ...(roaming ? [`${roaming}\\TinyTeX\\bin\\windows`] : []),
    "C:\\Strawberry\\perl\\bin", "C:\\Strawberry\\c\\bin"
  ];
  const texLiveRoot = "C:\\texlive";
  if (existsSync(texLiveRoot)) {
    try {
      const versions = readdirSync(texLiveRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d{4}$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left));
      candidates.push(...versions.map((version) => `${texLiveRoot}\\${version}\\bin\\windows`));
    } catch { /* An unreadable optional TeX Live root must not block compilation. */ }
  }
  return candidates;
}

export function compilerEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (process.platform !== "win32") return base;
  const pathKeys = Object.keys(base).filter((key) => key.toLocaleLowerCase() === "path");
  const inheritedPath = pathKeys.map((key) => base[key] ?? "").find(Boolean) ?? "";
  const discovered = windowsLatexPathCandidates(base).filter(existsSync);
  const unique = [...new Set([...discovered, ...inheritedPath.split(delimiter)].filter(Boolean).map((entry) => entry.replace(/[\\/]+$/, "")))];
  // Avoid differently-cased PATH keys: child_process may otherwise select a
  // stale value when converting the environment block on Windows.
  const result = { ...base };
  for (const key of pathKeys) delete result[key];
  result.PATH = unique.join(delimiter);
  return result;
}

export interface CompilerProjectPort {
  getProject(projectId: string): Project;
}

/** Resolve related tools together; returned machine paths never enter a project file. */
type DetectedTool = "latexmk" | "pdflatex" | "xelatex" | "lualatex" | "bibtex" | "biber" | "makeindex";

async function inspectExecutable(executable: string, env: NodeJS.ProcessEnv): Promise<{ ok: boolean; version?: string }> {
  const output = await new Promise<{ code: number | null; text: string }>((done) => {
    const child = spawn(executable, ["--version"], { shell: false, windowsHide: true, env });
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => { text = appendTail(text, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { text = appendTail(text, chunk); });
    const timer = setTimeout(() => { child.kill(); done({ code: null, text }); }, 5000);
    child.once("error", () => { clearTimeout(timer); done({ code: null, text }); });
    child.once("close", (code) => { clearTimeout(timer); done({ code, text }); });
  });
  const version = output.text.match(/\b\d{4}(?:\.\d+)*\b|\b\d+\.\d+(?:\.\d+)*\b/)?.[0];
  return { ok: output.code === 0, ...(version ? { version } : {}) };
}

function toolDirectories(preferred: string | undefined, env: NodeJS.ProcessEnv): string[] {
  const pathValue = env.PATH ?? env.Path ?? "";
  const preferredDirectory = preferred && isAbsolute(preferred)
    ? (existsSync(preferred) && extname(preferred).toLowerCase() !== "" ? dirname(preferred) : preferred)
    : undefined;
  return [...new Set([
    ...(preferredDirectory ? [preferredDirectory] : []),
    ...pathValue.split(delimiter),
    ...(process.platform === "win32" ? windowsLatexPathCandidates(env) : [])
  ].filter((value) => value && isAbsolute(value)).map((value) => value.replace(/[\\/]+$/, "")))];
}

/** Detect every useful LaTeX capability independently; latexmk is no longer the only success condition. */
export async function discoverToolchain(preferred?: string): Promise<LatexToolchain> {
  const env = compilerEnvironment();
  const pathValue = env.PATH ?? env.Path ?? "";
  const extension = process.platform === "win32" ? ".exe" : "";
  const names: DetectedTool[] = ["latexmk", "pdflatex", "xelatex", "lualatex", "bibtex", "biber", "makeindex"];
  const directories = toolDirectories(preferred, env);
  const paths = Object.fromEntries(names.map((name) => {
    const directory = directories.find((candidate) => existsSync(resolve(candidate, `${name}${extension}`)));
    return [name, directory ? resolve(directory, `${name}${extension}`) : undefined];
  })) as Partial<Record<DetectedTool, string>>;
  const checks = await Promise.all(names.map(async (name) => [name, paths[name] ? await inspectExecutable(paths[name]!, { ...env, PATH: [dirname(paths[name]!), pathValue].join(delimiter) }) : { ok: false }] as const));
  const results = new Map(checks);
  const versions = new Map(checks.map(([name, result]) => [name, result.version]));
  const compiler = paths.pdflatex ?? paths.xelatex ?? paths.lualatex;
  const compilerUsable = (["pdflatex", "xelatex", "lualatex"] as const).some((name) => results.get(name)?.ok);
  const overallStatus = !compilerUsable ? "unavailable" : !results.get("latexmk")?.ok ? "limited" : "ready";
  const sourceDirectory = paths.latexmk ?? compiler ?? paths.bibtex ?? paths.biber ?? paths.makeindex;
  const distribution = sourceDirectory && /miktex/i.test(sourceDirectory) ? "miktex" : sourceDirectory && /texlive|tinytex/i.test(sourceDirectory) ? "texlive" : "unknown";
  const version = versions.get("latexmk") ?? (compiler === paths.pdflatex ? versions.get("pdflatex") : compiler === paths.xelatex ? versions.get("xelatex") : versions.get("lualatex"));
  const toolStatus = (name: DetectedTool): ToolStatus => {
    const executablePath = paths[name];
    if (executablePath === undefined) return { status: "missing", source: "unknown" };
    const result = results.get(name);
    if (!result?.ok) return { status: "broken", executablePath, source: "detected" };
    return { status: "ready", executablePath, ...(result.version === undefined ? {} : { version: result.version }), source: "detected" };
  };
  return {
    distribution,
    ...(version ? { version } : {}),
    ...(sourceDirectory ? { binDirectory: dirname(sourceDirectory) } : {}),
    ...Object.fromEntries(names.filter((name) => paths[name] !== undefined).map((name) => [name, paths[name]])),
    available: overallStatus === "ready",
    overallStatus,
    environment: {
      distribution: sourceDirectory ? { type: distribution, ...(version ? { version } : {}) } : null,
      pdflatex: toolStatus("pdflatex"), xelatex: toolStatus("xelatex"), lualatex: toolStatus("lualatex"),
      latexmk: toolStatus("latexmk"), bibtex: toolStatus("bibtex"), biber: toolStatus("biber"), makeindex: toolStatus("makeindex"),
      overallStatus
    },
    detectedAt: new Date().toISOString()
  };
}

function profileEnvironment(executable: string): NodeJS.ProcessEnv {
  const env = compilerEnvironment();
  return isAbsolute(executable) ? { ...env, PATH: [dirname(executable), env.PATH ?? env.Path ?? ""].join(delimiter) } : env;
}

export interface CompilerFilePort {
  resolveFilePath(projectId: string, relativePath: string, mustExist?: boolean): Promise<string>;
}

export interface CompilerProfilePort {
  getCompilerProfile(profileId?: string): CompilerProfile;
}

interface ActiveCompilation {
  child: ChildProcessWithoutNullStreams;
  requestedState?: "cancelled" | "timedOut";
}

function appendTail(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  return next.length <= maximumTailLength ? next : next.slice(-maximumTailLength);
}

async function readRecorderInputs(root: string, mainFile: string, args: string[], isolated = false): Promise<string[]> {
  const sourcePath = resolve(root, mainFile);
  const jobName = basename(sourcePath, extname(sourcePath));
  const readDirectory = (flags: string[]): string | undefined => {
    for (let index = 0; index < args.length; index++) {
      const argument = args[index]!;
      const inline = flags.find((flag) => argument.toLowerCase().startsWith(`${flag}=`));
      if (inline) return argument.slice(inline.length + 1);
      if (flags.some((flag) => argument.toLowerCase() === flag) && args[index + 1]) return args[index + 1];
    }
    return undefined;
  };
  const outputDirectory = readDirectory(["-outdir", "--outdir", "-output-directory", "--output-directory"]);
  const auxiliaryDirectory = readDirectory(["-auxdir", "--auxdir", "-aux-directory", "--aux-directory"]);
  const candidateDirectories = [...(auxiliaryDirectory ? [resolve(root, auxiliaryDirectory)] : []), ...(outputDirectory ? [resolve(root, outputDirectory)] : []), ...(isolated ? [] : [dirname(sourcePath), root])];
  let contents: string | undefined;
  for (const directory of candidateDirectories) {
    try { contents = await readFile(resolve(directory, `${jobName}.fls`), "utf8"); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (!contents) return [];
  const inputs = new Set<string>();
  for (const line of contents.split(/\r?\n/)) {
    if (!line.startsWith("INPUT ")) continue;
    const path = line.slice(6).trim();
    if (!path) continue;
    const absolutePath = isAbsolute(path) ? resolve(path) : resolve(root, path);
    const relativePath = relative(root, absolutePath);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) continue;
    inputs.add(relativePath.split(sep).join("/"));
  }
  return [...inputs].sort();
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.pid === undefined || child.killed) return;
  if (process.platform === "win32") {
    await new Promise<void>((done) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: false, windowsHide: true });
      killer.once("exit", () => done());
      killer.once("error", () => { child.kill("SIGKILL"); done(); });
    });
  } else {
    child.kill("SIGTERM");
    setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 2_000).unref();
  }
}

/**
 * latexmk 进程 adapter：参数数组 + shell:false，编译发生在 CLI/main 侧而非 renderer。
 */
export class LatexmkCompilerService {
  readonly #projects: CompilerProjectPort;
  readonly #files: CompilerFilePort;
  readonly #profiles: CompilerProfilePort;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #active = new Map<string, ActiveCompilation>();
  readonly #rootQueues = new Map<string, Promise<unknown>>();

  constructor(dependencies: {
    projects: CompilerProjectPort;
    files: CompilerFilePort;
    profiles: CompilerProfilePort;
    clock: Clock;
    ids?: IdGenerator;
  }) {
    this.#projects = dependencies.projects;
    this.#files = dependencies.files;
    this.#profiles = dependencies.profiles;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids ?? { next: randomUUID };
  }

  async detectToolchain(): Promise<ToolchainStatus> {
    const profile = this.#profiles.getCompilerProfile();
    const environment = profileEnvironment(profile.executable);
    const locator = process.platform === "win32" ? "where.exe" : "which";
    const located = isAbsolute(profile.executable) ? existsSync(profile.executable) : await new Promise<boolean>((done) => {
      const child = spawn(locator, [profile.executable], { shell: false, windowsHide: true, env: environment });
      child.once("error", () => done(false));
      child.once("exit", (code) => done(code === 0));
    });
    if (!located) return { available: false, executable: profile.executable, error: "Executable was not found on PATH" };
    const versionCheck = await new Promise<{ code: number | null; output: string }>((done) => {
      const child = spawn(profile.executable, ["-v"], { shell: false, windowsHide: true, env: environment });
      let output = "";
      child.stdout.on("data", (chunk: Buffer) => { output = appendTail(output, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { output = appendTail(output, chunk); });
      child.once("error", (error) => done({ code: null, output: error.message }));
      child.once("exit", (code) => done({ code, output }));
    });
    const version = versionCheck.output.split(/\r?\n/).find((line) => /Latexmk|Version/i.test(line))?.trim();
    if (versionCheck.code !== 0) {
      return {
        available: false,
        executable: profile.executable,
        error: versionCheck.output.trim() || `Version check exited with code ${versionCheck.code ?? "unknown"}`
      };
    }
    return { available: true, executable: profile.executable, ...(version === undefined ? {} : { version }) };
  }

  async compile(input: CompileInput): Promise<CompileResult> {
    const project = this.#projects.getProject(input.projectId);
    if (project.missing) throw new AppError("PROJECT_PATH_MISSING", `Project folder is missing: ${project.canonicalPath}`);
    const mainFile = input.mainFile ?? project.mainFile;
    if (mainFile === undefined) throw new AppError("MAIN_FILE_NOT_SET", "No LaTeX main file is configured");
    await this.#files.resolveFilePath(project.id, mainFile, true);
    await consolidateProjectMetadata(project.canonicalPath);
    const outputDirectory = documentOutputDirectory(project.canonicalPath, mainFile, project.mainFile);
    if (outputDirectory !== project.canonicalPath) await this.#files.resolveFilePath(project.id, relative(project.canonicalPath, outputDirectory), false);
    return this.#compileAtRoot(project.canonicalPath, mainFile, { ...input, outputDirectory });
  }

  /** Compile an AI snapshot with the same configured engine and diagnostics, without registering it as a user project. */
  async compileWorkspace(input: { workspaceRoot: string; mainFile: string; engine?: CompileInput["engine"]; timeoutMs?: number }): Promise<CompileResult> {
    const root = resolve(input.workspaceRoot);
    const mainFile = input.mainFile.replaceAll("\\", "/");
    const sourcePath = resolve(root, mainFile);
    const relativePath = relative(root, sourcePath);
    if (!mainFile || isAbsolute(mainFile) || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      throw new AppError("INVALID_RELATIVE_PATH", "The main TeX file must be inside the AI working copy.");
    }
    if (extname(sourcePath).toLowerCase() !== ".tex") throw new AppError("MAIN_FILE_NOT_SET", "The AI working-copy main file must be a .tex file.");
    try {
      const [rootPath, sourceRealPath] = await Promise.all([realpath(root), realpath(sourcePath)]);
      const realRelative = relative(rootPath, sourceRealPath);
      if (!realRelative || realRelative === ".." || realRelative.startsWith(`..${sep}`) || isAbsolute(realRelative)) {
        throw new AppError("INVALID_RELATIVE_PATH", "The main TeX file resolves outside the AI working copy.");
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("FILE_NOT_FOUND", `Could not open the AI working-copy main file: ${mainFile}`, { cause: error });
    }
    return this.#compileAtRoot(root, mainFile, input);
  }

  async readLog(projectId: string, compilationId: string): Promise<string> {
    if (!/^[0-9a-f-]{36}$/i.test(compilationId)) throw new AppError("INVALID_RELATIVE_PATH", "Invalid compilation id");
    const logPath = await this.#files.resolveFilePath(projectId, `.texweave/build/${compilationId}.log`, true);
    const metadata = await stat(logPath);
    if (!metadata.isFile()) throw new AppError("FILE_NOT_FOUND", "Compilation log is unavailable");
    if (metadata.size > maximumReadableLogBytes) throw new AppError("RESOURCE_SCHEMA_INVALID", "Compilation log is larger than the 32 MB viewing limit");
    return readFile(logPath, "utf8");
  }

  async #compileAtRoot(root: string, mainFile: string, input: { engine?: CompileInput["engine"]; timeoutMs?: number; outputDirectory?: string }): Promise<CompileResult> {
    const key = await realpath(root);
    const previous = this.#rootQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => this.#runAtRoot(root, mainFile, input));
    this.#rootQueues.set(key, next);
    try { return await next; }
    finally { if (this.#rootQueues.get(key) === next) this.#rootQueues.delete(key); }
  }

  async #runAtRoot(root: string, mainFile: string, input: { engine?: CompileInput["engine"]; timeoutMs?: number; outputDirectory?: string }): Promise<CompileResult> {
    // Reject shell escape even if a profile was edited outside the resource manager.

    const profile = this.#profiles.getCompilerProfile();
    if (profile.arguments.some((argument) => argument === "-shell-escape" || argument === "--shell-escape")) {
      throw new AppError("RESOURCE_SCHEMA_INVALID", "Shell escape is forbidden in compiler profiles");
    }
    const toolchain = await this.detectToolchain();
    if (!toolchain.available) {
      throw new AppError("TOOLCHAIN_NOT_FOUND", toolchain.error ?? `latexmk was not found: ${profile.executable}`, {
        details: { executable: profile.executable }
      });
    }

    const compilationId = this.#ids.next();
    const started = this.#clock.now();
    const buildLogDirectory = resolve(root, ".texweave", "build");
    await mkdir(buildLogDirectory, { recursive: true });
    const logPath = resolve(buildLogDirectory, `${compilationId}.log`);
    const logStream = createWriteStream(logPath, { encoding: "utf8", flags: "w" });
    const logFinished = new Promise<void>((done) => logStream.once("finish", () => done()));
    const engineFlag = input.engine === "xelatex" ? "-xelatex" : input.engine === "lualatex" ? "-lualatex" : "-pdf";
    const outputDirectory = input.outputDirectory ?? root;
    await mkdir(outputDirectory, { recursive: true });
    const profileArguments = outputDirectory !== root ? targetOutputArguments(profile.arguments, outputDirectory) : profile.arguments;
    const args = profileArguments.filter((arg) => !["-pdf", "-xelatex", "-lualatex"].includes(arg) && !/^--?synctex=/i.test(arg));
    if (!args.some((arg) => arg.toLowerCase() === "-file-line-error")) args.push("-file-line-error");
    if (!args.some((arg) => arg.toLowerCase().startsWith("-interaction="))) args.push("-interaction=nonstopmode");
    args.push("-synctex=1");
    const expectedPdf = resolve(outputDirectory, `${basename(mainFile, extname(mainFile))}.pdf`);
    // latexmk does not track missing SyncTeX output as a reason to rerun TeX.
    // -g preserves bibliography/aux files while regenerating this build result.
    if (existsSync(expectedPdf) && (await findSyncTexData(expectedPdf, outputDirectory !== root ? [] : syncTexDirectories(root, mainFile, args))).state !== "ready" && !args.includes("-g") && !args.includes("-gg")) args.push("-g");
    if (!args.some((arg) => arg.toLowerCase() === "-recorder")) args.push("-recorder");
    args.push(engineFlag, mainFile);
    const environment = profileEnvironment(profile.executable);
    const child = spawn(profile.executable, args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: environment
    });
    const active: ActiveCompilation = { child };
    this.#active.set(compilationId, active);
    let stdoutTail = "";
    let stderrTail = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutTail = appendTail(stdoutTail, chunk);
      logStream.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = appendTail(stderrTail, chunk);
      logStream.write(chunk);
    });

    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? profile.timeoutMs, 1_000), maximumTimeoutMs);
    const timer = setTimeout(() => {
      active.requestedState = "timedOut";
      void terminateProcessTree(child);
    }, timeoutMs);

    const exitCode = await new Promise<number | null>((done, reject) => {
      child.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") reject(new AppError("TOOLCHAIN_NOT_FOUND", `Compiler executable not found: ${profile.executable}`, { cause: error }));
        else reject(error);
      });
      child.once("exit", (code) => done(code));
    }).finally(() => {
      clearTimeout(timer);
      this.#active.delete(compilationId);
      logStream.end();
    });
    await logFinished;

    const finished = this.#clock.now();
    const pdfPath = expectedPdf;
    let pdfExists = true;
    try { await access(pdfPath); } catch { pdfExists = false; }
    const status = active.requestedState ?? (exitCode === 0 && pdfExists ? "succeeded" : "failed");
    const pdfArtifactPath = status === "succeeded" ? resolve(buildLogDirectory, `${compilationId}.pdf`) : undefined;
    if (pdfArtifactPath) await copyFile(pdfPath, pdfArtifactPath);
    // Preview artifacts are transient; bound their disk footprint independently of logs.
    if (pdfArtifactPath) {
      const candidates = (await readdir(buildLogDirectory)).filter(name => /^[0-9a-f-]{36}\.pdf$/i.test(name));
      const artifacts = await Promise.all(candidates.map(async name => ({ path: resolve(buildLogDirectory, name), modified: (await stat(resolve(buildLogDirectory, name))).mtimeMs })));
      const older = artifacts.filter(item => item.path !== pdfArtifactPath).sort((a, b) => b.modified - a.modified).slice(7);
      await Promise.all(older.map(item => rm(item.path, { force: true })));
    }
    const rawLog = await readFile(logPath, "utf8");
    const processDiagnostics = parseLatexDiagnostics(rawLog, root, mainFile);
    const sourcePath = resolve(root, mainFile);
    const jobName = basename(sourcePath, extname(sourcePath));
    const componentLogs = await Promise.all([".log", ".blg"].map(async (extension) => {
      for (const directory of outputDirectory !== root ? [outputDirectory] : [...new Set([root, dirname(sourcePath)])]) {
        try { return await readFile(resolve(directory, `${jobName}${extension}`), "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      return "";
    }));
    const hasFinalToolLogs = componentLogs.some(Boolean);
    const recorderInputs = await readRecorderInputs(root, mainFile, args, outputDirectory !== root);
    const finalDiagnostics = hasFinalToolLogs ? parseLatexDiagnostics(componentLogs.join("\n"), root, mainFile) : processDiagnostics;
    const toolDiagnostics = hasFinalToolLogs ? processDiagnostics.filter((item) => ["latexmk", "bibtex", "biber", "system", "filesystem", "external"].includes(item.source)) : [];
    const diagnostics = [...new Map([...finalDiagnostics, ...toolDiagnostics].map((item) => [`${item.severity}|${item.source}|${item.code ?? ""}|${item.message}|${item.file ?? ""}|${item.line ?? ""}`, item])).values()];
    if (status === "failed" && diagnostics.every((item) => item.severity !== "error" && item.severity !== "fatal")) {
      diagnostics.push({
        severity: "error", source: "latexmk", category: "build", code: "COMPILATION_FAILED",
        message: pdfExists ? `latexmk exited with code ${exitCode ?? "unknown"}` : "Compilation did not produce the expected PDF"
      });
    }
    if (status === "timedOut") diagnostics.push({ severity: "fatal", source: "system", category: "build", code: "COMPILATION_TIMEOUT", message: `Compilation exceeded ${timeoutMs} ms` });
    if (status === "cancelled") diagnostics.push({ severity: "info", source: "system", category: "build", code: "COMPILATION_CANCELLED", message: "Compilation was cancelled" });

    return {
      compilationId,
      status,
      exitCode,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
      mainFile,
      ...(pdfExists ? { pdfPath } : {}),
      ...(pdfArtifactPath ? { pdfArtifactPath } : {}),
      logPath,
      diagnostics,
      ...(recorderInputs.length ? { recorderInputs } : {}),
      stdoutTail,
      stderrTail
    };
  }

  async cancel(compilationId: string): Promise<{ cancelled: boolean }> {
    const active = this.#active.get(compilationId);
    if (active === undefined) return { cancelled: false };
    active.requestedState = "cancelled";
    await terminateProcessTree(active.child);
    return { cancelled: true };
  }
}
