import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { ThemeDefinition } from "@latex-editor/contracts" with { "resolution-mode": "import" };

const themeExtension = ".css";

function safeId(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLocaleLowerCase();
  return normalized || "theme";
}

function displayName(filePath: string, css: string): string {
  const declared = /(?:^|\/\*)\s*@theme-name\s*:\s*([^*\r\n]+?)(?:\s*\*\/|\s*$)/im.exec(css)?.[1]?.trim();
  if (declared) return declared;
  return basename(filePath, extname(filePath)).replace(/^custom-/i, "").replace(/-[0-9a-f]{8}$/i, "").replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Discovers CSS themes from shipped resources and the configurable local theme folder. */
export class ThemeRepository {
  readonly #builtInRoot: string;
  readonly #defaultUserRoot: string;
  #userRoot: string;

  constructor(resourcesRoot: string, defaultUserRoot: string) {
    this.#builtInRoot = join(resourcesRoot, "themes");
    this.#defaultUserRoot = resolve(defaultUserRoot);
    this.#userRoot = this.#defaultUserRoot;
  }

  async initialize(): Promise<void> {
    await mkdir(this.#userRoot, { recursive: true });
  }

  directory(): string { return this.#userRoot; }

  async setDirectory(directory: string): Promise<void> {
    this.#userRoot = directory.trim() ? resolve(directory) : this.#defaultUserRoot;
    await mkdir(this.#userRoot, { recursive: true });
  }

  async list(): Promise<ThemeDefinition[]> {
    const builtIns: ThemeDefinition[] = [
      { id: "light", name: "Light", source: "built-in" },
      { id: "dark", name: "Dark", source: "built-in" },
      { id: "tech-light", name: "Tech Light", source: "built-in" }
    ];
    const discovered = await Promise.all([
      this.#listRoot(this.#builtInRoot, "built-in"),
      this.#listRoot(this.#userRoot, "user")
    ]);
    const seen = new Set(builtIns.map((theme) => theme.id));
    return [...builtIns, ...discovered.flat().filter((theme) => {
      if (seen.has(theme.id)) return false;
      seen.add(theme.id);
      return true;
    })].sort((left, right) => left.source === right.source ? left.name.localeCompare(right.name) : left.source === "built-in" ? -1 : 1);
  }

  async importFiles(paths: string[]): Promise<ThemeDefinition[]> {
    const imported: ThemeDefinition[] = [];
    for (const original of [...new Set(paths.map((path) => resolve(path)))]) {
      if (extname(original).toLocaleLowerCase() !== themeExtension) throw new Error("Only CSS theme files can be imported");
      const id = `custom-${safeId(basename(original, themeExtension))}-${randomUUID().slice(0, 8)}`;
      const target = join(this.#userRoot, `${id}${themeExtension}`);
      await cp(original, target, { errorOnExist: true, force: false });
      imported.push({ id, name: displayName(original, await readFile(original, "utf8")), source: "user", css: await readFile(target, "utf8"), filePath: target });
    }
    return imported;
  }
  async importPresetTheme(theme: { id: string; css: string; name?: string }): Promise<string> {
    const css = theme.name ? `/* @theme-name: ${theme.name.replace(/[\r\n*]/g, " ")} */\n${theme.css}` : theme.css;
    const existing = (await this.list()).find(item => item.css === theme.css || item.css === css);
    if (existing) return existing.id;
    const id = `custom-preset-${randomUUID().slice(0, 8)}`;
    await mkdir(this.#userRoot, { recursive: true });
    await writeFile(join(this.#userRoot, `${id}.css`), css, { encoding: "utf8", flag: "wx" });
    return id;
  }

  async importFolder(folderPath: string): Promise<ThemeDefinition[]> {
    const root = resolve(folderPath);
    const files: string[] = [];
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (extname(entry.name).toLocaleLowerCase() === themeExtension) files.push(path);
      }
    };
    await walk(root);
    return this.importFiles(files);
  }

  async remove(id: string): Promise<void> {
    if (!id.startsWith("custom-")) throw new Error("Built-in themes cannot be deleted");
    const themes = await this.#listRoot(this.#userRoot, "user");
    const theme = themes.find((item) => item.id === id);
    if (!theme?.filePath) throw new Error(`Theme not found: ${id}`);
    await rm(theme.filePath, { force: false });
  }

  async #listRoot(root: string, source: ThemeDefinition["source"]): Promise<ThemeDefinition[]> {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      const result: ThemeDefinition[] = [];
      for (const entry of entries) {
        if (!entry.isFile() || extname(entry.name).toLocaleLowerCase() !== themeExtension) continue;
        const filePath = join(root, entry.name);
        try {
          const css = await readFile(filePath, "utf8");
          const stem = safeId(basename(entry.name, themeExtension));
          const id = source === "built-in" ? `builtin-${stem}` : stem.startsWith("custom-") ? stem : `custom-${stem}`;
          result.push({ id, name: displayName(filePath, css), source, css, filePath });
        } catch { /* Ignore one unreadable file and keep the catalog usable. */ }
      }
      return result;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
}
