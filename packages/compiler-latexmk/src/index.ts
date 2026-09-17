import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import {
  AppError, type CompileInput, type CompileResult, type CompilerProfile, type Project, type ToolchainStatus, type LatexToolchain
} from "@latex-editor/contracts";
import { parseLatexDiagnostics } from "@latex-editor/diagnostics";
import type { Clock, IdGenerator } from "@latex-editor/domain";

const maximumTailLength = 64 * 1024;
const maximumTimeoutMs = 300_000;

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
export async function discoverToolchain(preferred?: string): Promise<LatexToolchain> {
  const env = compilerEnvironment();
  const pathValue = env.PATH ?? env.Path ?? "";
  const directories = [...new Set([...(preferred ? [extname(preferred).toLowerCase() === ".exe" || basename(preferred) === "latexmk" ? dirname(preferred) : preferred] : []), ...pathValue.split(delimiter)].filter((v) => v && isAbsolute(v)))];
  const extension = process.platform === "win32" ? ".exe" : "";
  const directory = directories.find((dir) => existsSync(resolve(dir, `latexmk${extension}`)));
  const result: LatexToolchain = { distribution: "unknown", available: false, detectedAt: new Date().toISOString() };
  if (!directory) return result;
  result.binDirectory = directory;
  result.distribution = /miktex/i.test(directory) ? "miktex" : /texlive|tinytex/i.test(directory) ? "texlive" : "unknown";
  for (const name of ["latexmk", "pdflatex", "xelatex", "lualatex", "bibtex", "biber"] as const) {
    const path = resolve(directory, `${name}${extension}`);
    if (existsSync(path)) result[name] = path;
  }
  if (result.latexmk) result.available = await new Promise<boolean>((done) => {
    const child = spawn(result.latexmk!, ["-v"], { shell: false, windowsHide: true, env: { ...env, PATH: [directory, pathValue].join(delimiter) } });
    child.stdout.resume(); child.stderr.resume();
    const timer = setTimeout(() => { child.kill(); done(false); }, 8000);
    child.once("error", () => { clearTimeout(timer); done(false); });
    child.once("close", (code) => { clearTimeout(timer); done(code === 0); });
  });
  return result;
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
    // profile 的普通参数已在 ResourceCatalog 校验，这里仍再次拒绝 shell escape 作为纵深防御。
    const project = this.#projects.getProject(input.projectId);
    if (project.missing) throw new AppError("PROJECT_PATH_MISSING", `Project folder is missing: ${project.canonicalPath}`);
    const mainFile = input.mainFile ?? project.mainFile;
    if (mainFile === undefined) throw new AppError("MAIN_FILE_NOT_SET", "No LaTeX main file is configured");
    await this.#files.resolveFilePath(project.id, mainFile, true);

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
    const buildLogDirectory = resolve(project.canonicalPath, ".latex-editor", "build");
    await mkdir(buildLogDirectory, { recursive: true });
    const logPath = resolve(buildLogDirectory, `${compilationId}.log`);
    const logStream = createWriteStream(logPath, { encoding: "utf8", flags: "w" });
    const engineFlag = input.engine === "xelatex" ? "-xelatex" : input.engine === "lualatex" ? "-lualatex" : "-pdf";
    const args = [...profile.arguments.filter((arg) => !["-pdf", "-xelatex", "-lualatex"].includes(arg)), engineFlag, mainFile];
    const child = spawn(profile.executable, args, {
      cwd: project.canonicalPath,
      shell: false,
      windowsHide: true,
      env: profileEnvironment(profile.executable)
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

    const finished = this.#clock.now();
    const pdfPath = resolve(project.canonicalPath, `${basename(mainFile, extname(mainFile))}.pdf`);
    let pdfExists = true;
    try { await access(pdfPath); } catch { pdfExists = false; }
    const status = active.requestedState ?? (exitCode === 0 && pdfExists ? "succeeded" : "failed");
    const diagnostics = parseLatexDiagnostics(`${stdoutTail}\n${stderrTail}`, project.canonicalPath);
    if (status === "failed" && diagnostics.every((item) => item.severity !== "error")) {
      diagnostics.push({
        severity: "error", source: "latexmk", code: "COMPILATION_FAILED",
        message: pdfExists ? `latexmk exited with code ${exitCode ?? "unknown"}` : "Compilation did not produce the expected PDF"
      });
    }
    if (status === "timedOut") diagnostics.push({ severity: "error", source: "system", code: "COMPILATION_TIMEOUT", message: `Compilation exceeded ${timeoutMs} ms` });
    if (status === "cancelled") diagnostics.push({ severity: "info", source: "system", code: "COMPILATION_CANCELLED", message: "Compilation was cancelled" });

    return {
      compilationId,
      status,
      exitCode,
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: Math.max(0, finished.getTime() - started.getTime()),
      mainFile,
      ...(pdfExists ? { pdfPath } : {}),
      logPath,
      diagnostics,
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
