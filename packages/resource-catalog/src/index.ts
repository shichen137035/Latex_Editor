import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  AppError, type CommandMetadata, type CompilerProfile, type EnvironmentMetadata, type ProjectTemplate
} from "@latex-editor/contracts";

const requiredGroups = [
  "commands", "compiler-profiles", "completions", "diagnostics", "environments", "schemas", "snippets", "templates"
] as const;
const allowedCompilerArguments = new Set(["-pdf", "-file-line-error", "-interaction=nonstopmode", "-synctex=1"]);

function record(value: unknown, source: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("RESOURCE_SCHEMA_INVALID", `Expected object in ${source}`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string, source: string): string {
  if (typeof value[field] !== "string" || value[field].length === 0) {
    throw new AppError("RESOURCE_SCHEMA_INVALID", `Missing or invalid ${field} in ${source}`, { details: { field, source } });
  }
  return value[field];
}

function requireVersion(value: Record<string, unknown>, source: string): void {
  if (value.schemaVersion !== 1) {
    throw new AppError(value.schemaVersion === undefined ? "RESOURCE_SCHEMA_INVALID" : "RESOURCE_VERSION_UNSUPPORTED", `Expected schemaVersion 1 in ${source}`);
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  try {
    return record(JSON.parse(await readFile(filePath, "utf8")) as unknown, filePath);
  } catch (error: unknown) {
    if (error instanceof AppError) throw error;
    throw new AppError("RESOURCE_SCHEMA_INVALID", `Invalid JSON resource: ${filePath}`, { cause: error, details: { source: filePath } });
  }
}

/** 从 JSON 资源加载命令、环境、模板和编译器 profile，不执行资源中的代码。 */
export class FileResourceCatalog {
  readonly #resourcesPath: string;
  #commands: CommandMetadata[] = [];
  #environments: EnvironmentMetadata[] = [];
  #templates = new Map<string, ProjectTemplate>();
  #profiles = new Map<string, CompilerProfile>();

  constructor(resourcesPath: string) {
    this.#resourcesPath = resourcesPath;
  }

  async reload(): Promise<{ filesLoaded: number }> {
    // 先构建局部 catalog，全部通过校验后一次性替换，避免半加载状态。
    const commands: CommandMetadata[] = [];
    const environments: EnvironmentMetadata[] = [];
    const templates = new Map<string, ProjectTemplate>();
    const profiles = new Map<string, CompilerProfile>();
    let filesLoaded = 0;

    for (const fileName of await this.#jsonFiles("commands")) {
      const source = join(this.#resourcesPath, "commands", fileName);
      const value = await readJson(source);
      requireVersion(value, source);
      if (!Array.isArray(value.commands)) throw new AppError("RESOURCE_SCHEMA_INVALID", `commands must be an array in ${source}`);
      for (const item of value.commands) {
        const entry = record(item, source);
        commands.push({
          id: stringField(entry, "id", source), name: stringField(entry, "name", source),
          insertText: stringField(entry, "insertText", source), detail: stringField(entry, "detail", source),
          category: stringField(entry, "category", source)
        });
      }
      filesLoaded += 1;
    }

    for (const fileName of await this.#jsonFiles("environments")) {
      const source = join(this.#resourcesPath, "environments", fileName);
      const value = await readJson(source);
      requireVersion(value, source);
      // Preview environment definitions have a richer renderer-facing schema.
      // Validate their stable identity here, while the renderer normalizes
      // style and behavior defaults from the same JSON resource.
      if (Array.isArray(value.previewEnvironments)) {
        const ids = new Set<string>();
        for (const item of value.previewEnvironments) {
          const entry = record(item, source);
          const id = stringField(entry, "id", source);
          stringField(entry, "family", source);
          record(entry.match, source);
          if (ids.has(id)) throw new AppError("RESOURCE_SCHEMA_INVALID", `Duplicate Preview environment id ${id} in ${source}`);
          ids.add(id);
        }
        filesLoaded += 1;
        continue;
      }
      if (!Array.isArray(value.environments)) throw new AppError("RESOURCE_SCHEMA_INVALID", `environments must be an array in ${source}`);
      for (const item of value.environments) {
        const entry = record(item, source);
        environments.push({
          id: stringField(entry, "id", source), name: stringField(entry, "name", source),
          begin: stringField(entry, "begin", source), body: typeof entry.body === "string" ? entry.body : "",
          end: stringField(entry, "end", source), category: stringField(entry, "category", source)
        });
      }
      filesLoaded += 1;
    }

    for (const fileName of await this.#jsonFiles("templates")) {
      const source = join(this.#resourcesPath, "templates", fileName);
      const value = await readJson(source);
      requireVersion(value, source);
      if (!Array.isArray(value.files)) throw new AppError("RESOURCE_SCHEMA_INVALID", `files must be an array in ${source}`);
      const template: ProjectTemplate = {
        id: stringField(value, "id", source), name: stringField(value, "name", source),
        files: value.files.map((item) => {
          const entry = record(item, source);
          if (typeof entry.content !== "string") throw new AppError("RESOURCE_SCHEMA_INVALID", `Missing or invalid content in ${source}`);
          return { relativePath: stringField(entry, "relativePath", source), content: entry.content };
        })
      };
      templates.set(template.id, template);
      filesLoaded += 1;
    }

    for (const fileName of await this.#jsonFiles("compiler-profiles")) {
      const source = join(this.#resourcesPath, "compiler-profiles", fileName);
      const value = await readJson(source);
      requireVersion(value, source);
      if (!Array.isArray(value.arguments) || !value.arguments.every((item) => typeof item === "string" && allowedCompilerArguments.has(item))) {
        throw new AppError("RESOURCE_SCHEMA_INVALID", `Compiler arguments are not allowlisted in ${source}`);
      }
      if (typeof value.timeoutMs !== "number" || value.timeoutMs < 1_000 || value.timeoutMs > 300_000) {
        throw new AppError("RESOURCE_SCHEMA_INVALID", `Invalid timeoutMs in ${source}`);
      }
      const profile: CompilerProfile = {
        id: stringField(value, "id", source), executable: stringField(value, "executable", source),
        arguments: [...value.arguments] as string[], timeoutMs: value.timeoutMs
      };
      profiles.set(profile.id, profile);
      filesLoaded += 1;
    }

    this.#commands = commands.sort((left, right) => left.id.localeCompare(right.id));
    this.#environments = environments.sort((left, right) => left.id.localeCompare(right.id));
    this.#templates = templates;
    this.#profiles = profiles;
    return { filesLoaded };
  }

  searchCommands(query: string): CommandMetadata[] {
    const normalized = query.toLocaleLowerCase("en-US");
    return this.#commands.filter((item) => item.name.toLocaleLowerCase("en-US").includes(normalized));
  }

  searchEnvironments(query: string): EnvironmentMetadata[] {
    const normalized = query.toLocaleLowerCase("en-US");
    return this.#environments.filter((item) => item.name.toLocaleLowerCase("en-US").includes(normalized));
  }

  async getTemplate(templateId: string): Promise<ProjectTemplate> {
    const template = this.#templates.get(templateId);
    if (template === undefined) throw new AppError("RESOURCE_SCHEMA_INVALID", `Unknown project template: ${templateId}`);
    return template;
  }

  getCompilerProfile(profileId = "latexmk-pdf"): CompilerProfile {
    const profile = this.#profiles.get(profileId);
    if (profile === undefined) throw new AppError("RESOURCE_SCHEMA_INVALID", `Unknown compiler profile: ${profileId}`);
    return profile;
  }

  async #jsonFiles(group: string): Promise<string[]> {
    return (await readdir(join(this.#resourcesPath, group)))
      .filter((name) => name.endsWith(".json"))
      .sort((left, right) => left.localeCompare(right));
  }
}

export async function validateResourceDirectory(resourcesPath: string): Promise<boolean> {
  try {
    const entries = await readdir(resourcesPath, { withFileTypes: true });
    const names = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
    if (!requiredGroups.every((group) => names.has(group))) return false;
    const catalog = new FileResourceCatalog(resourcesPath);
    await catalog.reload();
    return true;
  } catch {
    return false;
  }
}
