import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import type { ResourceFileKind, StyleResource, StyleResourceFile } from "@latex-editor/contracts" with { "resolution-mode": "import" };

type StoredFile = Omit<StyleResourceFile, "content">;
type StoredResource = Omit<StyleResource, "files"> & { files: StoredFile[] };

const supportedExtensions = new Set([".sty", ".cls", ".bst", ".bib", ".tex", ".cfg", ".def", ".ltx"]);

function safeName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/\s+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return normalized || `resource-${randomUUID().slice(0, 8)}`;
}

function safeRelative(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => part === ".." || part === "." || part.length === 0)) throw new Error(`Invalid resource path: ${value}`);
  return normalized;
}

function kindFor(fileName: string): ResourceFileKind {
  switch (extname(fileName).toLocaleLowerCase()) {
    case ".sty": return "style";
    case ".cls": return "class";
    case ".bst": return "bibliography-style";
    case ".bib": return "bibliography";
    case ".tex":
    case ".ltx": return "tex";
    default: return "other";
  }
}

function defaultMainStyle(files: StoredFile[]): { kind: "package"; name: string } | undefined {
  if (files.length !== 1 || files[0] === undefined || files[0].kind !== "style") return undefined;
  return { kind: "package", name: basename(files[0].targetPath, extname(files[0].targetPath)) };
}

/**
 * Local style library. Built-ins are read-only files shipped under resources;
 * user resources live in Electron's userData and are always copied by value.
 */
export class StyleResourceRepository {
  readonly #builtInRoot: string;
  readonly #userRoot: string;

  constructor(resourcesRoot: string, userDataRoot: string) {
    this.#builtInRoot = join(resourcesRoot, "style-resources", "built-in");
    this.#userRoot = join(userDataRoot, "style-resources", "user");
  }

  async initialize(): Promise<void> { await mkdir(this.#userRoot, { recursive: true }); }

  async list(): Promise<StyleResource[]> {
    const [builtIns, users] = await Promise.all([this.#listRoot(this.#builtInRoot, "built-in"), this.#listRoot(this.#userRoot, "user")]);
    return [...builtIns, ...users].sort((left, right) => left.name.localeCompare(right.name));
  }

  async getResource(id: string): Promise<StyleResource | undefined> {
    for (const [root, source] of [[this.#builtInRoot, "built-in"], [this.#userRoot, "user"]] as const) {
      const resourceRoot = join(root, id);
      try {
        const stored = await this.#readManifest(resourceRoot);
        if (stored.id !== id || stored.source !== source) continue;
        const files: StyleResourceFile[] = [];
        for (const file of stored.files) {
          const target = safeRelative(file.targetPath);
          const sourcePath = safeRelative(file.sourcePath);
          files.push({ ...file, targetPath: target, sourcePath, content: await readFile(join(resourceRoot, sourcePath), "utf8") });
        }
        return { ...stored, source, files };
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
    }
    return undefined;
  }

  async createResource(name: string): Promise<StyleResource> {
    const id = `${safeName(name).toLocaleLowerCase()}-${randomUUID().slice(0, 8)}`;
    const resourceRoot = join(this.#userRoot, id);
    const stored: StoredResource = { id, name: name.trim() || id, version: 1, source: "user", files: [] };
    await mkdir(resourceRoot, { recursive: true });
    await this.#writeManifest(resourceRoot, stored);
    return stored;
  }

  async importFiles(paths: string[], name?: string): Promise<StyleResource> {
    const unique = [...new Set(paths.map((path) => resolve(path)))];
    if (unique.length === 0) throw new Error("Choose at least one resource file");
    const files = unique.map((sourcePath) => ({ sourcePath, targetPath: basename(sourcePath), kind: kindFor(sourcePath) }));
    if (files.some((file) => !supportedExtensions.has(extname(file.sourcePath).toLocaleLowerCase()))) throw new Error("Unsupported resource file type");
    if (new Set(files.map((file) => file.targetPath.toLocaleLowerCase())).size !== files.length) throw new Error("Imported files contain duplicate filenames");
    return this.#copyImported(name ?? basename(unique[0]!, extname(unique[0]!)), files);
  }

  async importFolder(folderPath: string): Promise<StyleResource> {
    const root = resolve(folderPath);
    const paths: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (supportedExtensions.has(extname(entry.name).toLocaleLowerCase())) paths.push(path);
      }
    };
    await walk(root);
    if (paths.length === 0) throw new Error("The selected folder contains no supported TeX resource files");
    const files = paths.map((sourcePath) => ({ sourcePath, targetPath: relative(root, sourcePath).split(sep).join("/"), kind: kindFor(sourcePath) }));
    if (new Set(files.map((file) => file.targetPath.toLocaleLowerCase())).size !== files.length) throw new Error("The selected folder contains duplicate target filenames");
    return this.#copyImported(basename(root), files);
  }

  async duplicate(id: string): Promise<StyleResource> {
    const resource = await this.getResource(id);
    if (resource === undefined) throw new Error(`Resource not found: ${id}`);
    const copy = await this.createResource(`${resource.name} Copy`);
    const root = join(this.#userRoot, copy.id);
    const stored: StoredResource = { ...copy, files: [] };
    for (const file of resource.files) {
      const target = safeRelative(file.targetPath);
      await mkdir(join(root, target, ".."), { recursive: true });
      await writeFile(join(root, target), file.content ?? "", "utf8");
      stored.files.push({ sourcePath: target, targetPath: target, kind: file.kind });
    }
    if (resource.mainStyle !== undefined) stored.mainStyle = resource.mainStyle;
    await this.#writeManifest(root, stored);
    return (await this.getResource(copy.id))!;
  }

  async addFiles(id: string, paths: string[]): Promise<StyleResource> {
    const resource = await this.getResource(id);
    if (resource === undefined || resource.source !== "user") throw new Error("Only user resources can be edited");
    const unique = [...new Set(paths.map((path) => resolve(path)))];
    const existing = new Set(resource.files.map((file) => file.targetPath.toLocaleLowerCase()));
    const files = unique.map((sourcePath) => ({ sourcePath, targetPath: basename(sourcePath), kind: kindFor(sourcePath) }));
    if (files.length === 0) throw new Error("Choose at least one resource file");
    if (files.some((file) => !supportedExtensions.has(extname(file.sourcePath).toLocaleLowerCase()))) throw new Error("Unsupported resource file type");
    if (files.some((file) => existing.has(file.targetPath.toLocaleLowerCase())) || new Set(files.map((file) => file.targetPath.toLocaleLowerCase())).size !== files.length) throw new Error("A resource file with the same target name already exists");
    const root = join(this.#userRoot, id);
    const stored: StoredResource = { ...resource, files: resource.files.map((file) => ({ sourcePath: file.sourcePath, targetPath: file.targetPath, kind: file.kind })) };
    const copied: string[] = [];
    try {
      for (const file of files) {
        const target = safeRelative(file.targetPath);
        const targetPath = join(root, target);
        await cp(file.sourcePath, targetPath, { errorOnExist: true, force: false });
        copied.push(targetPath);
        stored.files.push({ sourcePath: target, targetPath: target, kind: file.kind });
      }
      if (stored.mainStyle === undefined) {
        const mainStyle = defaultMainStyle(stored.files);
        if (mainStyle !== undefined) stored.mainStyle = mainStyle;
      }
      await this.#writeManifest(root, stored);
      return (await this.getResource(id))!;
    } catch (error) {
      await Promise.all(copied.map((path) => rm(path, { force: true }))).catch(() => undefined);
      throw error;
    }
  }

  async renameResource(id: string, name: string): Promise<StyleResource> {
    const resource = await this.getResource(id);
    if (resource === undefined || resource.source !== "user") throw new Error("Only user resources can be renamed");
    const root = join(this.#userRoot, id);
    const stored: StoredResource = { ...resource, files: resource.files.map((file) => ({ sourcePath: file.sourcePath, targetPath: file.targetPath, kind: file.kind })), name: name.trim() || resource.name };
    await this.#writeManifest(root, stored);
    return (await this.getResource(id))!;
  }

  async remove(id: string): Promise<void> {
    const resource = await this.getResource(id);
    if (resource === undefined) throw new Error(`Resource not found: ${id}`);
    if (resource.source !== "user") throw new Error("Built-in resources cannot be deleted");
    await rm(join(this.#userRoot, id), { recursive: true, force: false });
  }

  async #copyImported(name: string, files: Array<{ sourcePath: string; targetPath: string; kind: ResourceFileKind }>): Promise<StyleResource> {
    const resource = await this.createResource(name);
    const root = join(this.#userRoot, resource.id);
    const stored: StoredResource = { ...resource, files: [] };
    try {
      for (const file of files) {
        const target = safeRelative(file.targetPath);
        const targetPath = join(root, target);
        await mkdir(resolve(targetPath, ".."), { recursive: true });
        await cp(file.sourcePath, targetPath, { errorOnExist: true, force: false });
        stored.files.push({ sourcePath: target, targetPath: target, kind: file.kind });
      }
      const mainStyle = defaultMainStyle(stored.files);
      if (mainStyle !== undefined) stored.mainStyle = mainStyle;
      await this.#writeManifest(root, stored);
      return (await this.getResource(resource.id))!;
    } catch (error) {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  async #listRoot(root: string, source: "built-in" | "user"): Promise<StyleResource[]> {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const resources: StyleResource[] = [];
      for (const entry of entries.filter((item) => item.isDirectory())) {
        try {
          const stored = await this.#readManifest(join(root, entry.name));
          if (stored.source === source) resources.push({ ...stored, source, files: stored.files });
        } catch { /* Ignore one broken custom entry; the settings page remains usable. */ }
      }
      return resources;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async #readManifest(root: string): Promise<StoredResource> {
    return JSON.parse(await readFile(join(root, "resource.json"), "utf8")) as StoredResource;
  }

  async #writeManifest(root: string, resource: StoredResource): Promise<void> {
    const manifest = `${JSON.stringify(resource, null, 2)}\n`;
    const temporary = join(root, `.resource-${randomUUID()}.tmp`);
    await writeFile(temporary, manifest, "utf8");
    await rename(temporary, join(root, "resource.json"));
  }
}
