import { basename, extname, posix } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { ImportedImage, ProjectTreeNode, ResolvedGraphic } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { ProjectCacheReclamationManager } from "@latex-editor/application" with { "resolution-mode": "import" };

const formats = ["png", "jpg", "jpeg", "webp", "svg", "pdf"] as const;
const mime: Record<(typeof formats)[number], string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf" };

type FilePort = {
  listTree(projectId: string): Promise<unknown>;
  resolveFilePath(projectId: string, relativePath: string, mustExist?: boolean): Promise<string>;
  createDirectory(projectId: string, relativePath: string): Promise<void>;
  importEntry(projectId: string, sourcePath: string, destinationRelativePath: string): Promise<void>;
};

function treePaths(nodes: ProjectTreeNode[], result = new Set<string>()): Set<string> {
  for (const node of nodes) { result.add(node.relativePath.toLocaleLowerCase()); if (node.children) treePaths(node.children, result); }
  return result;
}

function safeDirectory(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return normalized && !normalized.split("/").includes("..") ? normalized : "figures";
}

function safeResolutionBase(value: string): string | undefined {
  const normalized = posix.normalize(value.replaceAll("\\", "/")).replace(/^\.\//, "");
  return !normalized || normalized === "." ? "" : normalized.startsWith("../") || posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized) ? undefined : normalized;
}

function safeName(sourcePath: string): string {
  return basename(sourcePath).replace(/[^A-Za-z0-9._-]+/g, "-") || "image.png";
}

/** Main-process image I/O keeps absolute paths and file bytes out of React. */
export class ProjectImageService {
  readonly #files: FilePort;
  readonly #cache = new Map<string, ResolvedGraphic>();
  readonly #reclamation: ProjectCacheReclamationManager | undefined;
  readonly #limits: { entries: number; characters: number };
  #characters = 0;
  #generation = 0;
  constructor(files: FilePort, options: { reclamation?: ProjectCacheReclamationManager; cacheEntries?: number; cacheCharacters?: number } = {}) {
    this.#files = files;
    this.#reclamation = options.reclamation;
    this.#limits = { entries: options.cacheEntries ?? 64, characters: options.cacheCharacters ?? 16 * 1024 * 1024 };
    options.reclamation?.register("project-images", projectId => this.releaseProjectCache(projectId));
  }
  get cacheStats(): { entries: number; characters: number } { return { entries: this.#cache.size, characters: this.#characters }; }
  releaseProjectCache(projectId: string): void {
    this.#generation++;
    for (const [key, value] of this.#cache) if (key.startsWith(`${projectId}\0`)) {
      this.#characters -= value.dataUrl?.length ?? 0;
      this.#cache.delete(key);
    }
  }
  #remember(key: string, value: ResolvedGraphic, prefix: string): void {
    for (const [oldKey, oldValue] of this.#cache) if (oldKey.startsWith(prefix)) {
      this.#characters -= oldValue.dataUrl?.length ?? 0; this.#cache.delete(oldKey);
    }
    const characters = value.dataUrl?.length ?? 0;
    if (characters > this.#limits.characters || this.#limits.entries < 1) return;
    this.#cache.set(key, value); this.#characters += characters;
    while (this.#cache.size > this.#limits.entries || this.#characters > this.#limits.characters) {
      const oldest = this.#cache.entries().next().value;
      if (!oldest) break;
      this.#characters -= oldest[1].dataUrl?.length ?? 0; this.#cache.delete(oldest[0]);
    }
  }

  async importImages(projectId: string, sourcePaths: string[], directory: string): Promise<ImportedImage[]> {
    const targetDirectory = safeDirectory(directory);
    const paths = treePaths(await this.#files.listTree(projectId) as ProjectTreeNode[]);
    if (targetDirectory && !paths.has(targetDirectory.toLocaleLowerCase())) {
      await this.#files.createDirectory(projectId, targetDirectory).catch(() => undefined);
      paths.add(targetDirectory.toLocaleLowerCase());
    }
    const imported: ImportedImage[] = [];
    for (const sourcePath of sourcePaths) {
      const sourceInfo = await stat(sourcePath);
      const original = safeName(sourcePath);
      const suffix = extname(original);
      const stem = suffix ? original.slice(0, -suffix.length) : original;
      let name = original;
      let counter = 2;
      let relativePath = posix.join(targetDirectory, name);
      while (paths.has(relativePath.toLocaleLowerCase())) {
        name = `${stem}_${counter}${suffix}`;
        relativePath = posix.join(targetDirectory, name);
        counter += 1;
      }
      await this.#files.importEntry(projectId, sourcePath, relativePath);
      paths.add(relativePath.toLocaleLowerCase());
      imported.push({ sourcePath, relativePath, renamed: name !== original, kind: sourceInfo.isDirectory() ? "directory" : "file" });
    }
    return imported;
  }

  async resolve(projectId: string, texPath: string, requestedPath: string, graphicPaths: string[] = []): Promise<ResolvedGraphic> {
    this.#reclamation?.track(projectId);
    const generation = this.#generation;
    const request = requestedPath.trim().replaceAll("\\", "/");
    if (!request || /^[A-Za-z]:/.test(request) || request.startsWith("/")) return { requestedPath, exists: false, error: "PATH_OUTSIDE_PROJECT" };
    const texDirectory = posix.dirname(texPath) === "." ? "" : posix.dirname(texPath);
    const graphicBases = graphicPaths.flatMap((entry) => {
      const direct = safeResolutionBase(entry);
      const besideTex = safeResolutionBase(posix.join(texDirectory, entry));
      return [besideTex, direct].filter((item): item is string => item !== undefined);
    });
    const bases = [...new Set([texDirectory, "", ...graphicBases])];
    const suppliedExtension = extname(request).slice(1).toLocaleLowerCase();
    const suffixes = suppliedExtension ? [""] : ["", ...formats.map((format) => `.${format}`)];
    for (const base of bases) for (const suffix of suffixes) {
      const relativePath = posix.normalize(posix.join(base, `${request}${suffix}`));
      if (relativePath === ".." || relativePath.startsWith("../")) continue;
      try {
        const absolutePath = await this.#files.resolveFilePath(projectId, relativePath, true);
        const extension = extname(relativePath).slice(1).toLocaleLowerCase();
        if (!formats.includes(extension as (typeof formats)[number])) return { requestedPath, resolvedPath: relativePath, exists: true, error: "UNSUPPORTED_FORMAT" };
        const metadata = await stat(absolutePath);
        const prefix = `${projectId}\0${absolutePath}\0`;
        const key = `${prefix}${metadata.mtimeMs}:${metadata.size}`;
        const resolutionSource = base !== texDirectory && base !== "" ? "graphicspath" : suffix ? "extension-search" : "direct";
        const cached = this.#cache.get(key);
        if (cached) {
          this.#cache.delete(key); this.#cache.set(key, cached);
          return { ...cached, requestedPath, resolvedPath: relativePath, resolutionSource };
        }
        const format = extension as (typeof formats)[number];
        const result: ResolvedGraphic = {
          requestedPath, resolvedPath: relativePath, exists: true, format,
          resolutionSource,
          dataUrl: `data:${mime[format]};base64,${(await readFile(absolutePath)).toString("base64")}`,
          modifiedAt: metadata.mtime.toISOString(), size: metadata.size
        };
        if (generation === this.#generation) this.#remember(key, result, prefix);
        return result;
      } catch (reason) {
        const code = reason && typeof reason === "object" && "code" in reason ? String(reason.code) : "";
        if (code === "EACCES" || code === "EPERM") return { requestedPath, exists: false, error: "PERMISSION_DENIED" };
      }
    }
    return { requestedPath, exists: false, error: "FILE_NOT_FOUND" };
  }
}
