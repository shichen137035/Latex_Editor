import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, cp, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { AppError, type FileWriteResult, type Project, type ProjectTreeNode, type TextFileContent } from "@latex-editor/contracts";

export interface DirectoryInspection {
  canonicalPath: string;
  name: string;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  writable: boolean;
  empty: boolean;
}

export interface ProjectLookup {
  getProject(projectId: string): Project;
  touchEditedAt(projectId: string): void;
}

export function hashText(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/** 拒绝绝对路径和 . / .. 段，第一道项目边界校验。 */
export function validateRelativePath(relativePath: string): string {
  if (relativePath.length === 0 || relativePath.includes("\0") || isAbsolute(relativePath)) {
    throw new AppError("INVALID_RELATIVE_PATH", `Invalid project-relative path: ${relativePath}`);
  }
  const normalized = relativePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new AppError("INVALID_RELATIVE_PATH", `Invalid project-relative path: ${relativePath}`);
  }
  return normalized;
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    try {
      await lstat(current);
      return realpath(current);
    } catch (error: unknown) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

/**
 * 通过 realpath 检查最终目标及新文件的最近存在父目录，防止 symlink/junction 逃逸。
 */
export async function resolveSafeProjectPath(rootPath: string, relativePath: string, mustExist: boolean): Promise<string> {
  const normalized = validateRelativePath(relativePath);
  const canonicalRoot = await realpath(rootPath);
  const candidate = resolve(canonicalRoot, ...normalized.split("/"));
  if (!isWithin(canonicalRoot, candidate)) {
    throw new AppError("PATH_OUTSIDE_PROJECT", `Path escapes project root: ${relativePath}`);
  }

  try {
    const target = await realpath(candidate);
    if (!isWithin(canonicalRoot, target)) {
      throw new AppError("PATH_OUTSIDE_PROJECT", `Resolved path escapes project root: ${relativePath}`);
    }
    return target;
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (code !== "ENOENT") throw error;
    if (mustExist) throw new AppError("FILE_NOT_FOUND", `File not found: ${relativePath}`);
    const ancestor = await nearestExistingAncestor(dirname(candidate));
    if (!isWithin(canonicalRoot, ancestor)) {
      throw new AppError("PATH_OUTSIDE_PROJECT", `Parent path escapes project root: ${relativePath}`);
    }
    return candidate;
  }
}

export class NodeProjectEnvironment {
  async inspectDirectory(folderPath: string): Promise<DirectoryInspection> {
    const absolute = resolve(folderPath);
    try {
      const canonicalPath = await realpath(absolute);
      const info = await stat(canonicalPath);
      if (!info.isDirectory()) {
        return { canonicalPath, name: basename(canonicalPath), exists: true, isDirectory: false, readable: false, writable: false, empty: true };
      }
      let readable = true;
      let writable = true;
      try { await access(canonicalPath, constants.R_OK); } catch { readable = false; }
      try { await access(canonicalPath, constants.W_OK); } catch { writable = false; }
      const entries = await readdir(canonicalPath);
      return { canonicalPath, name: basename(canonicalPath), exists: true, isDirectory: true, readable, writable, empty: entries.length === 0 };
    } catch (error: unknown) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") {
        return { canonicalPath: absolute, name: basename(absolute), exists: false, isDirectory: false, readable: false, writable: false, empty: true };
      }
      throw error;
    }
  }

  async createProjectDirectory(parentPath: string, directoryName: string): Promise<string> {
    validateRelativePath(directoryName);
    if (directoryName.includes("/")) throw new AppError("INVALID_RELATIVE_PATH", "Project name must be a single directory name");
    const parent = await realpath(resolve(parentPath));
    const target = resolve(parent, directoryName);
    if (!isWithin(parent, target)) throw new AppError("PATH_OUTSIDE_PROJECT", "Project directory escapes parent");
    try {
      await mkdir(target, { recursive: false });
      return realpath(target);
    } catch (error: unknown) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "EEXIST") throw new AppError("FILE_ALREADY_EXISTS", `Project directory already exists: ${target}`);
      throw error;
    }
  }

  async removeDirectory(canonicalPath: string): Promise<void> {
    await rm(canonicalPath, { recursive: true, force: false });
  }

  async writeProjectText(rootPath: string, relativePath: string, content: string): Promise<void> {
    const filePath = await resolveSafeProjectPath(rootPath, relativePath, false);
    await mkdir(dirname(filePath), { recursive: true });
    const tempPath = resolve(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
    try {
      const handle = await open(tempPath, "wx", 0o600);
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tempPath, filePath);
    } catch (error: unknown) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async projectFileExists(rootPath: string, relativePath: string): Promise<boolean> {
    try {
      const filePath = await resolveSafeProjectPath(rootPath, relativePath, true);
      return (await stat(filePath)).isFile();
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === "FILE_NOT_FOUND") return false;
      throw error;
    }
  }

  isUnsafeDeleteTarget(canonicalPath: string): boolean {
    const resolved = resolve(canonicalPath);
    const root = parse(resolved).root;
    const userHome = process.env.USERPROFILE ?? process.env.HOME;
    return resolved === root || (userHome !== undefined && resolved.toLocaleLowerCase("en-US") === resolve(userHome).toLocaleLowerCase("en-US"));
  }

  pathsEqual(left: string, right: string): boolean {
    const normalizedLeft = resolve(left);
    const normalizedRight = resolve(right);
    return process.platform === "win32"
      ? normalizedLeft.toLocaleLowerCase("en-US") === normalizedRight.toLocaleLowerCase("en-US")
      : normalizedLeft === normalizedRight;
  }
}

/** Node 文件系统 adapter；所有公开操作都从 projectId + 相对路径开始。 */
export class NodeProjectFileService {
  readonly #projects: ProjectLookup;

  constructor(projects: ProjectLookup) {
    this.#projects = projects;
  }

  #assertWritable(project: Project): void {
    if (!project.writable) throw new AppError("PROJECT_NOT_WRITABLE", `Project is not writable: ${project.name}`);
  }

  async listTree(projectId: string): Promise<ProjectTreeNode[]> {
    const project = this.#projects.getProject(projectId);
    return this.#listDirectory(project.canonicalPath, project.canonicalPath);
  }

  /** Cheap cache token. Checked resolution preserves normal symlink/path policy. */
  async getFileVersion(projectId: string, relativePath: string): Promise<string> {
    const project = this.#projects.getProject(projectId);
    const filePath = await resolveSafeProjectPath(project.canonicalPath, relativePath, true);
    const metadata = await stat(filePath, { bigint: true });
    if (!metadata.isFile()) throw new AppError("FILE_NOT_FOUND", `Not a regular file: ${relativePath}`);
    return `${metadata.mtimeNs}:${metadata.ctimeNs}:${metadata.size}`;
  }

  async readText(projectId: string, relativePath: string): Promise<TextFileContent> {
    const project = this.#projects.getProject(projectId);
    const filePath = await resolveSafeProjectPath(project.canonicalPath, relativePath, true);
    const info = await stat(filePath);
    if (!info.isFile()) throw new AppError("FILE_NOT_FOUND", `Not a regular file: ${relativePath}`);
    const buffer = await readFile(filePath);
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
    catch (error: unknown) {
      throw new AppError("UNSUPPORTED_ENCODING", `File is not valid UTF-8: ${relativePath}`, { cause: error });
    }
    return {
      projectId,
      relativePath: validateRelativePath(relativePath),
      content,
      encoding: "utf8",
      hash: hashText(content),
      modifiedAt: info.mtime.toISOString()
    };
  }

  async writeText(projectId: string, relativePath: string, content: string): Promise<FileWriteResult> {
    const project = this.#projects.getProject(projectId);
    this.#assertWritable(project);
    const filePath = await resolveSafeProjectPath(project.canonicalPath, relativePath, false);
    await mkdir(dirname(filePath), { recursive: true });
    // 同目录临时文件 + rename，避免写入中断留下截断的源文件。
    const tempPath = resolve(dirname(filePath), `.${basename(filePath)}.${randomUUID()}.tmp`);
    try {
      const handle = await open(tempPath, "wx", 0o600);
      try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tempPath, filePath);
    } catch (error: unknown) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
    this.#projects.touchEditedAt(projectId);
    const info = await stat(filePath);
    return { projectId, relativePath: validateRelativePath(relativePath), hash: hashText(content), modifiedAt: info.mtime.toISOString() };
  }

  async createFile(projectId: string, relativePath: string, content = ""): Promise<void> {
    const project = this.#projects.getProject(projectId);
    this.#assertWritable(project);
    const filePath = await resolveSafeProjectPath(project.canonicalPath, relativePath, false);
    await mkdir(dirname(filePath), { recursive: true });
    try { await writeFile(filePath, content, { encoding: "utf8", flag: "wx" }); }
    catch (error: unknown) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "EEXIST") throw new AppError("FILE_ALREADY_EXISTS", `File already exists: ${relativePath}`);
      throw error;
    }
    this.#projects.touchEditedAt(projectId);
  }

  async createDirectory(projectId: string, relativePath: string): Promise<void> {
    const project = this.#projects.getProject(projectId);
    this.#assertWritable(project);
    const directoryPath = await resolveSafeProjectPath(project.canonicalPath, relativePath, false);
    await mkdir(directoryPath, { recursive: false });
    this.#projects.touchEditedAt(projectId);
  }

  async renameEntry(projectId: string, fromRelativePath: string, toRelativePath: string): Promise<void> {
    const project = this.#projects.getProject(projectId);
    this.#assertWritable(project);
    const source = await resolveSafeProjectPath(project.canonicalPath, fromRelativePath, true);
    const target = await resolveSafeProjectPath(project.canonicalPath, toRelativePath, false);
    const sourceInfo = await lstat(source);
    if (sourceInfo.isDirectory() && isWithin(await realpath(source), target)) {
      throw new AppError("INVALID_MOVE_TARGET", "Cannot move a folder into itself or one of its descendants.");
    }
    await mkdir(dirname(target), { recursive: true });
    try { await lstat(target); throw new AppError("FILE_ALREADY_EXISTS", `Target already exists: ${toRelativePath}`); }
    catch (error: unknown) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (error instanceof AppError) throw error;
      if (code !== "ENOENT") throw error;
    }
    await rename(source, target);
    this.#projects.touchEditedAt(projectId);
  }

  async copyEntry(projectId: string, fromRelativePath: string, toRelativePath: string): Promise<void> {
    const project = this.#projects.getProject(projectId);
    this.#assertWritable(project);
    const source = await resolveSafeProjectPath(project.canonicalPath, fromRelativePath, true);
    const target = await resolveSafeProjectPath(project.canonicalPath, toRelativePath, false);
    await mkdir(dirname(target), { recursive: true });
    try { await lstat(target); throw new AppError("FILE_ALREADY_EXISTS", `Target already exists: ${toRelativePath}`); }
    catch (error: unknown) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (error instanceof AppError) throw error;
      if (code !== "ENOENT") throw error;
    }
    await cp(source, target, { errorOnExist: true, force: false, recursive: false });
    this.#projects.touchEditedAt(projectId);
  }

  async importEntry(projectId: string, sourcePath: string, destinationRelativePath: string): Promise<void> {
    const project = this.#projects.getProject(projectId);
    this.#assertWritable(project);
    const source = resolve(sourcePath);
    const target = await resolveSafeProjectPath(project.canonicalPath, destinationRelativePath, false);
    const sourceInfo = await lstat(source);
    if (sourceInfo.isDirectory() && isWithin(await realpath(source), target)) {
      throw new AppError("INVALID_IMPORT_SOURCE", "Cannot import a folder into itself or one of its descendants.");
    }
    await mkdir(dirname(target), { recursive: true });
    try { await lstat(target); throw new AppError("FILE_ALREADY_EXISTS", `Target already exists: ${destinationRelativePath}`); }
    catch (error: unknown) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (error instanceof AppError) throw error;
      if (code !== "ENOENT") throw error;
    }
    await cp(source, target, { errorOnExist: true, force: false, recursive: sourceInfo.isDirectory() });
    this.#projects.touchEditedAt(projectId);
  }

  async removeEntry(projectId: string, relativePath: string): Promise<void> {
    const project = this.#projects.getProject(projectId);
    this.#assertWritable(project);
    const target = await resolveSafeProjectPath(project.canonicalPath, relativePath, true);
    await rm(target, { recursive: true, force: false });
    this.#projects.touchEditedAt(projectId);
  }

  async resolveFilePath(projectId: string, relativePath: string, mustExist = true): Promise<string> {
    const project = this.#projects.getProject(projectId);
    return resolveSafeProjectPath(project.canonicalPath, relativePath, mustExist);
  }

  async #listDirectory(root: string, directory: string): Promise<ProjectTreeNode[]> {
    const entries = await readdir(directory, { withFileTypes: true });
    const nodes: ProjectTreeNode[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = resolve(directory, entry.name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      if (entry.isSymbolicLink()) {
        nodes.push({ name: entry.name, relativePath, kind: "symlink" });
      } else if (entry.isDirectory()) {
        nodes.push({ name: entry.name, relativePath, kind: "directory", children: await this.#listDirectory(root, absolutePath) });
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, relativePath, kind: "file" });
      }
    }
    return nodes;
  }
}
