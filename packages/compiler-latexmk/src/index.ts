import { consolidateProjectMetadata } from "@latex-editor/filesystem-node";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, readdirSync } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, realpath, rm, stat, utimes } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  AppError, type CompileInput, type CompileResult, type CompilerProfile, type Project, type ToolchainStatus, type LatexToolchain, type ToolStatus
} from "@latex-editor/contracts";
import { parseLatexDiagnostics } from "@latex-editor/diagnostics";
import type { Clock, IdGenerator } from "@latex-editor/domain";
import { findSyncTexData, syncTexDirectories } from "./synctex-data.js";
import { documentOutputDirectory, targetOutputArguments } from "./output.js";
import { externalDocumentPlan } from "./document-dependencies.js";
import { readRecorderInputs } from "./recorder.js";
export { readRecorderDependencies } from "./recorder.js";
export { findSyncTexData, syncTexDirectories, type SyncTexData } from "./synctex-data.js";
export { documentOutputDirectory, pruneStaleDocumentOutputs } from "./output.js";

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
    ...(roaming ? [`${roaming}\\TeXWeave\\tools\\TinyTeX\\bin\\windows`, `${roaming}\\TeXWeave\\tools\\TinyTeX\\tlpkg\\tlperl\\bin`] : []),
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
  env = environmentWithToolRuntime(executable, env);
  const output = await new Promise<{ code: number | null; text: string }>((done) => {
    const child = spawn(executable, ["--version"], { shell: false, windowsHide: true, env });
    let text = "";
    child.stdout.on("data", (chunk: Buffer) => { text = appendTail(text, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { text = appendTail(text, chunk); });
    const timer = setTimeout(() => { child.kill(); done({ code: null, text }); }, 5000);
    child.once("error", () => { clearTimeout(timer); done({ code: null, text }); });
    child.once("close", (code) => { clearTimeout(timer); done({ code, text }); });
  });
  const version = output.text.match(/\bVersion[ :]+(\d+(?:\.\d+)+)/i)?.[1] ?? output.text.match(/\b\d{4}(?:\.\d+)*\b|\b\d+\.\d+(?:\.\d+)*\b/)?.[0];
  // TeX Live MakeIndex has no --version option; its usage response confirms
  // that the executable runs. MiKTeX supports --version and returns zero.
  const makeindexUsage = /^(?:makeindex)(?:\.exe)?$/i.test(basename(executable)) && output.code === 1 && /Usage: makeindex\s/.test(output.text);
  return { ok: output.code === 0 || makeindexUsage, ...(version ? { version } : {}) };
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

/** Portable TeX Live carries the Perl runtime used by latexmk in its own tree. */
export function environmentWithToolRuntime(executable: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!isAbsolute(executable)) return env;
  const bin = dirname(executable);
  const perl = resolve(bin, "../../tlpkg/tlperl/bin");
  const result = { ...env };
  const inherited = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
  for (const key of Object.keys(result)) if (key.toLowerCase() === "path") delete result[key];
  result.PATH = [bin, ...(process.platform === "win32" && existsSync(perl) ? [perl] : []), inherited].join(delimiter);
  if (process.platform === "win32" && existsSync(perl)) {
    for (const key of Object.keys(result)) if (key === "LANG" || key.startsWith("LC_")) delete result[key];
  }
  return result;
}

function profileEnvironment(executable: string): NodeJS.ProcessEnv {
  return environmentWithToolRuntime(executable, compilerEnvironment());
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
  readonly #rootQueues = new Map<string, Promise<unknown>>();
  readonly #latestArtifacts = new Map<string, { root: string; logId: string; pdfId?: string }>();
  readonly #inFlightArtifacts = new Map<string, string>();

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
    return this.#compileAtRoot(project.canonicalPath, mainFile, { ...input, outputDirectory, ...(project.mainFile ? { projectMain: project.mainFile } : {}) });
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

  async retainPublishedLog(root: string, mainFile: string, compilationId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(compilationId)) return;
    const normalizedRoot = resolve(root), key = `${normalizedRoot}\0${mainFile}`;
    const previous = this.#latestArtifacts.get(key);
    this.#latestArtifacts.set(key, { root: normalizedRoot, logId: compilationId, ...(previous?.pdfId ? { pdfId: previous.pdfId } : {}) });
    if (previous && previous.logId !== compilationId) {
      try { await rm(resolve(normalizedRoot, ".texweave", "build", `${previous.logId}.log`), { force: true }); }
      catch { /* Removing a superseded log is best-effort. */ }
    }
  }

  async pruneBuildArtifacts(root: string): Promise<void> {
    const normalizedRoot = resolve(root), directory = resolve(normalizedRoot, ".texweave", "build");
    let names: string[];
    try { names = await readdir(directory); }
    catch { return; }
    const current = [...this.#latestArtifacts.values()].filter(item => item.root === normalizedRoot);
    const inFlightIds = [...this.#inFlightArtifacts].filter(([, artifactRoot]) => artifactRoot === normalizedRoot).map(([id]) => id);
    const retainedLogIds = new Set([...current.map(item => item.logId), ...inFlightIds]);
    const retainedPdfIds = new Set([...current.flatMap(item => item.pdfId ? [item.pdfId] : []), ...inFlightIds]);
    const logs = names.filter(name => /^[0-9a-f-]{36}\.log$/i.test(name) && !retainedLogIds.has(name.slice(0, -4)));
    await Promise.all(logs.map(name => rm(resolve(directory, name), { force: true }).catch(() => undefined)));
    const pdfs = await Promise.all(names.filter(name => /^[0-9a-f-]{36}\.pdf$/i.test(name) && !retainedPdfIds.has(name.slice(0, -4))).map(async name => {
      try { return { name, modified: (await stat(resolve(directory, name))).mtimeMs }; }
      catch { return undefined; }
    }));
    const stalePdfs = pdfs.filter((item): item is { name: string; modified: number } => item !== undefined)
      .sort((left, right) => right.modified - left.modified).slice(8);
    await Promise.all(stalePdfs.map(item => rm(resolve(directory, item.name), { force: true }).catch(() => undefined)));
  }

  async #compileAtRoot(root: string, mainFile: string, input: { engine?: CompileInput["engine"]; timeoutMs?: number; outputDirectory?: string; projectId?: string; projectMain?: string }): Promise<CompileResult> {
    const key = await realpath(root);
    const previous = this.#rootQueues.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const resolveLocal = async (path: string, exists = true) => {
        if (input.projectId) return this.#files.resolveFilePath(input.projectId, path, exists);
        const absolute = resolve(root, path), local = relative(root, absolute);
        if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) throw new Error("Document dependency is outside the workspace");
        // Resolve existing ancestors too, so a symlink cannot redirect outputs.
        let ancestor = exists ? absolute : dirname(absolute), canonical: string;
        for (;;) {
          try { canonical = await realpath(ancestor); break; }
          catch (error) {
            if (exists || (error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(ancestor) === ancestor) throw error;
            ancestor = dirname(ancestor);
          }
        }
        const canonicalLocal = relative(key, canonical);
        if (isAbsolute(canonicalLocal) || canonicalLocal === ".." || canonicalLocal.startsWith(`..${sep}`)) throw new Error("Document dependency is outside the workspace");
        return absolute;
      };
      const plan = await externalDocumentPlan(mainFile, async path => {
        try { return await readFile(await resolveLocal(path), "utf8"); }
        catch { return undefined; }
      });
      let result: CompileResult | undefined;
      for (const document of plan) {
        const outputDirectory = document === mainFile ? input.outputDirectory ?? root
          : documentOutputDirectory(root, document, input.projectMain ?? mainFile);
        if (outputDirectory !== root) await resolveLocal(relative(root, outputDirectory), false);
        result = await this.#runAtRoot(root, document, { ...input, outputDirectory });
        if (result.status !== "succeeded") return document === mainFile ? result : {
          ...result, mainFile,
          diagnostics: [{ severity: "error" as const, source: "system" as const, file: document, message: `External document could not be compiled: ${document}` }, ...result.diagnostics]
        };
        // xr reads the public .aux next to the referenced source. Keep all other
        // secondary build artifacts isolated, and publish its PDF alongside it.
        const stem = basename(document, extname(document));
        const sourceDirectory = dirname(document);
        const auxQueue = [`${stem}.aux`], seenAux = new Set<string>();
        while (auxQueue.length) {
          const aux = auxQueue.shift()!;
          if (seenAux.has(aux)) continue;
          seenAux.add(aux);
          const from = resolve(outputDirectory, aux);
          const local = relative(outputDirectory, from);
          if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) continue;
          let content: string;
          try { content = await readFile(from, "utf8"); } catch { continue; }
          const to = await resolveLocal(relative(root, resolve(root, aux === `${stem}.aux` ? `${sourceDirectory}/${aux}` : aux)), false);
          if (from !== to) await copyFile(from, to);
          for (const match of content.matchAll(/\\@input\{([^{}]+\.aux)\}/g)) auxQueue.push(match[1]!);
        }
        if (outputDirectory !== root && result.pdfPath) {
          const target = await resolveLocal(relative(root, resolve(root, sourceDirectory, `${stem}.pdf`)), false);
          await copyFile(result.pdfArtifactPath ?? result.pdfPath, target);
        }
      }
      return result!;
    });
    this.#rootQueues.set(key, next);
    try { return await next; }
    finally { if (this.#rootQueues.get(key) === next) this.#rootQueues.delete(key); }
  }

  async #runAtRoot(root: string, mainFile: string, input: { engine?: CompileInput["engine"]; timeoutMs?: number; outputDirectory?: string }): Promise<CompileResult> {
    const compilationId = this.#ids.next();
    this.#inFlightArtifacts.set(compilationId, resolve(root));
    try { return await this.#executeCompilation(root, mainFile, input, compilationId); }
    finally { this.#inFlightArtifacts.delete(compilationId); }
  }

  async #executeCompilation(root: string, mainFile: string, input: { engine?: CompileInput["engine"]; timeoutMs?: number; outputDirectory?: string }, compilationId: string): Promise<CompileResult> {
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

    const started = this.#clock.now();
    const buildLogDirectory = resolve(root, ".texweave", "build");
    await mkdir(buildLogDirectory, { recursive: true });
    const logPath = resolve(buildLogDirectory, `${compilationId}.log`);
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
    // Root-relative project resources retain priority; nested documents may
    // also import sibling resources/aux files. The empty tail keeps TeX defaults.
    const sourceDirectory = dirname(resolve(root, mainFile));
    environment.TEXINPUTS = [root, sourceDirectory, environment.TEXINPUTS ?? ""].join(delimiter) + delimiter;
    environment.BIBINPUTS = [root, sourceDirectory, environment.BIBINPUTS ?? ""].join(delimiter) + delimiter;
    const child = spawn(profile.executable, args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      env: environment
    });
    const logStream = createWriteStream(logPath, { encoding: "utf8", flags: "w" });
    let logError: Error | undefined;
    const logFinished = new Promise<void>((done) => {
      logStream.once("finish", done);
      logStream.once("error", (error) => { logError = error; done(); });
    });
    const writeLog = (chunk: Buffer) => {
      if (!logError && !logStream.destroyed && !logStream.writableEnded) logStream.write(chunk);
    };
    const active: ActiveCompilation = { child };
    this.#active.set(compilationId, active);
    let stdoutTail = "";
    let stderrTail = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutTail = appendTail(stdoutTail, chunk);
      writeLog(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = appendTail(stderrTail, chunk);
      writeLog(chunk);
    });

    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? profile.timeoutMs, 1_000), maximumTimeoutMs);
    const timer = setTimeout(() => {
      active.requestedState = "timedOut";
      void terminateProcessTree(child);
    }, timeoutMs);

    let exitCode: number | null;
    try {
      exitCode = await new Promise<number | null>((done, reject) => {
        let processError: NodeJS.ErrnoException | undefined;
        child.once("error", (error: NodeJS.ErrnoException) => { processError = error; });
        // exit may precede the last stdout/stderr data, especially for latexmk's
        // child tools. close confirms that both output pipes have drained.
        child.once("close", (code) => {
          if (processError?.code === "ENOENT") reject(new AppError("TOOLCHAIN_NOT_FOUND", `Compiler executable not found: ${profile.executable}`, { cause: processError }));
          else if (processError) reject(processError);
          else done(code);
        });
      });
    } finally {
      clearTimeout(timer);
      this.#active.delete(compilationId);
      if (!logStream.destroyed && !logStream.writableEnded) logStream.end();
      await logFinished;
    }
    if (logError) throw new AppError("COMPILATION_FAILED", `Could not write compilation log: ${logError.message}`, { cause: logError, details: { logPath } });

    const finished = this.#clock.now();
    const pdfPath = expectedPdf;
    let pdfExists = true;
    try { await access(pdfPath); } catch { pdfExists = false; }
    const status = active.requestedState ?? (exitCode === 0 && pdfExists ? "succeeded" : "failed");
    const pdfArtifactPath = status === "succeeded" ? resolve(buildLogDirectory, `${compilationId}.pdf`) : undefined;
    if (pdfArtifactPath) {
      await copyFile(pdfPath, pdfArtifactPath);
      // Windows copyFile preserves the source PDF's mtime, including when
      // latexmk reuses an unchanged PDF. Cache age belongs to this build.
      const captured = new Date();
      await utimes(pdfArtifactPath, captured, captured);
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

    // Keep the latest log and successful immutable PDF per TeX target. A later
    // failed build or an AI log must not evict the last successful project PDF.
    const normalizedRoot = resolve(root);
    const targetKey = `${normalizedRoot}\0${mainFile}`;
    const previous = this.#latestArtifacts.get(targetKey);
    this.#latestArtifacts.set(targetKey, { root: normalizedRoot, logId: compilationId,
      ...(pdfArtifactPath ? { pdfId: compilationId } : previous?.pdfId ? { pdfId: previous.pdfId } : {}) });
    if (previous && previous.logId !== compilationId) {
      try { await rm(resolve(buildLogDirectory, `${previous.logId}.log`), { force: true }); }
      catch { /* A stale log is harmless; cleanup must not fail a completed build. */ }
    }
    await this.pruneBuildArtifacts(normalizedRoot);

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
