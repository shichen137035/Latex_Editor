import { AppError, type Project, type ProjectTemplate, type StyleResource } from "@latex-editor/contracts";
import { isoNow, type Clock, type IdGenerator } from "@latex-editor/domain";

export * from "./block-graph-service.js";
export * from "./relation-service.js";
export * from "./document-structure-service.js";
export * from "./project-block-services.js";

export interface ProjectRegistryPort {
  insert(project: Project): void;
  get(id: string): Project | undefined;
  findByCanonicalPath(canonicalPath: string): Project | undefined;
  list(): Project[];
  update(project: Project): void;
  remove(id: string): void;
}

export interface DirectoryInspection {
  canonicalPath: string;
  name: string;
  exists: boolean;
  isDirectory: boolean;
  readable: boolean;
  writable: boolean;
  empty: boolean;
}

export interface ProjectEnvironmentPort {
  inspectDirectory(folderPath: string): Promise<DirectoryInspection>;
  createProjectDirectory(parentPath: string, directoryName: string): Promise<string>;
  writeProjectText(rootPath: string, relativePath: string, content: string): Promise<void>;
  projectFileExists(rootPath: string, relativePath: string): Promise<boolean>;
  removeDirectory(canonicalPath: string): Promise<void>;
  isUnsafeDeleteTarget(canonicalPath: string): boolean;
  pathsEqual(left: string, right: string): boolean;
}

export interface TemplateCatalogPort {
  getTemplate(templateId: string): Promise<ProjectTemplate>;
}

export interface StyleResourcePort {
  getResource(resourceId: string): Promise<StyleResource | undefined>;
}

export interface CreateProjectInput { name: string; parentPath: string; templateId?: string; styleResourceIds?: string[] }
export type RemoveProjectRequest =
  | { projectId: string; mode: "registryOnly" }
  | { projectId: string; mode: "deleteLocalFolder"; confirmedCanonicalPath: string };

/**
 * 项目用例层：编排注册表、文件系统适配器和资源模板。
 * 这里不直接访问 fs/SQLite，便于用内存 port 做单元测试。
 */
export class ProjectService {
  readonly #registry: ProjectRegistryPort;
  readonly #environment: ProjectEnvironmentPort;
  readonly #templates: TemplateCatalogPort;
  readonly #styleResources: StyleResourcePort | undefined;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;

  constructor(dependencies: {
    registry: ProjectRegistryPort;
    environment: ProjectEnvironmentPort;
    templates: TemplateCatalogPort;
    styleResources?: StyleResourcePort;
    clock: Clock;
    ids: IdGenerator;
  }) {
    this.#registry = dependencies.registry;
    this.#environment = dependencies.environment;
    this.#templates = dependencies.templates;
    this.#styleResources = dependencies.styleResources;
    this.#clock = dependencies.clock;
    this.#ids = dependencies.ids;
  }

  async registerExistingFolder(folderPath: string): Promise<Project> {
    const inspection = await this.#environment.inspectDirectory(folderPath);
    if (!inspection.exists || !inspection.isDirectory) {
      throw new AppError("PROJECT_PATH_MISSING", `Project folder does not exist: ${folderPath}`);
    }
    if (!inspection.readable) throw new AppError("PROJECT_PATH_MISSING", `Project folder is not readable: ${folderPath}`);
    const duplicate = this.#registry.findByCanonicalPath(inspection.canonicalPath);
    if (duplicate !== undefined) {
      throw new AppError("PROJECT_ALREADY_REGISTERED", `Project is already registered: ${inspection.canonicalPath}`, {
        details: { projectId: duplicate.id }
      });
    }
    const now = isoNow(this.#clock);
    const project: Project = {
      id: this.#ids.next(),
      name: inspection.name,
      canonicalPath: inspection.canonicalPath,
      createdAt: now,
      registeredAt: now,
      writable: inspection.writable,
      missing: false,
      settings: {}
    };
    this.#registry.insert(project);
    return project;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const directoryName = input.name.trim();
    if (directoryName.length === 0 || directoryName === "." || directoryName === ".." || directoryName.includes("/") || directoryName.includes("\\")) {
      throw new AppError("INVALID_RELATIVE_PATH", "Project name must be a non-empty directory name");
    }
    const canonicalPath = await this.#environment.createProjectDirectory(input.parentPath, directoryName);
    const template = await this.#templates.getTemplate(input.templateId ?? "minimal");
    try {
      const fileKey = (path: string) => path.replaceAll("\\", "/").toLocaleLowerCase();
      const files = new Map(template.files.map((file) => [fileKey(file.relativePath), { relativePath: file.relativePath.replaceAll("\\", "/"), content: file.content }]));
      const resourceTargets = new Set<string>();
      const imports: string[] = [];
      for (const resourceId of input.styleResourceIds ?? []) {
        const resource = await this.#styleResources?.getResource(resourceId);
        if (resource === undefined) throw new AppError("RESOURCE_SCHEMA_INVALID", `Unknown style resource: ${resourceId}`);
        for (const file of resource.files) {
          const target = file.targetPath.replaceAll("\\", "/");
          if (files.has(fileKey(target)) || resourceTargets.has(fileKey(target))) throw new AppError("FILE_ALREADY_EXISTS", `Style resource target already exists: ${target}`);
          if (file.content === undefined) throw new AppError("RESOURCE_SCHEMA_INVALID", `Style resource file is unreadable: ${file.sourcePath}`);
          resourceTargets.add(fileKey(target));
          files.set(fileKey(target), { relativePath: target, content: file.content });
        }
        if (resource.mainStyle?.kind === "package") imports.push(resource.mainStyle.name);
      }
      const mainPath = "main.tex";
      if (imports.length > 0 && files.has(fileKey(mainPath))) {
        let main = files.get(fileKey(mainPath))!.content;
        const missingImports = imports.filter((name) => !main.includes(`\\usepackage{${name}}`));
        if (missingImports.length > 0) {
          const importText = missingImports.map((name) => `\\usepackage{${name}}`).join("\n");
          const documentClassEnd = main.indexOf("\n", main.indexOf("\\documentclass"));
          main = documentClassEnd < 0 ? `${main}\n${importText}\n` : `${main.slice(0, documentClassEnd + 1)}${importText}\n${main.slice(documentClassEnd + 1)}`;
          files.get(fileKey(mainPath))!.content = main;
        }
      }
      for (const file of files.values()) await this.#environment.writeProjectText(canonicalPath, file.relativePath, file.content);
      const project = await this.registerExistingFolder(canonicalPath);
      const mainFile = template.files.find((file) => file.relativePath === "main.tex")?.relativePath;
      if (mainFile !== undefined) {
        const updated = { ...project, mainFile };
        this.#registry.update(updated);
        return updated;
      }
      return project;
    } catch (error: unknown) {
      await this.#environment.removeDirectory(canonicalPath).catch(() => undefined);
      throw error;
    }
  }

  getProject(projectId: string): Project {
    const project = this.#registry.get(projectId);
    if (project === undefined) throw new AppError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
    return project;
  }

  async listProjects(): Promise<Project[]> {
    const projects = this.#registry.list();
    const refreshed: Project[] = [];
    for (const project of projects) {
      const inspection = await this.#environment.inspectDirectory(project.canonicalPath);
      const next = { ...project, missing: !inspection.exists || !inspection.isDirectory, writable: inspection.writable };
      if (next.missing !== project.missing || next.writable !== project.writable) this.#registry.update(next);
      refreshed.push(next);
    }
    return refreshed;
  }

  async openProject(projectId: string): Promise<Project> {
    const project = this.getProject(projectId);
    const inspection = await this.#environment.inspectDirectory(project.canonicalPath);
    if (!inspection.exists || !inspection.isDirectory) {
      const missing = { ...project, missing: true };
      this.#registry.update(missing);
      throw new AppError("PROJECT_PATH_MISSING", `Project folder is missing: ${project.canonicalPath}`);
    }
    const opened = { ...project, missing: false, writable: inspection.writable, lastOpenedAt: isoNow(this.#clock) };
    this.#registry.update(opened);
    return opened;
  }

  async setMainFile(projectId: string, relativePath: string): Promise<Project> {
    const project = this.getProject(projectId);
    if (!relativePath.toLocaleLowerCase().endsWith(".tex")) {
      throw new AppError("INVALID_RELATIVE_PATH", "The main file must be a .tex file");
    }
    if (!(await this.#environment.projectFileExists(project.canonicalPath, relativePath))) {
      throw new AppError("FILE_NOT_FOUND", `Main file not found: ${relativePath}`);
    }
    const updated = { ...project, mainFile: relativePath.replaceAll("\\", "/") };
    this.#registry.update(updated);
    return updated;
  }

  touchEditedAt(projectId: string): void {
    const project = this.getProject(projectId);
    this.#registry.update({ ...project, lastEditedAt: isoNow(this.#clock) });
  }

  async remove(request: RemoveProjectRequest): Promise<{ deletedLocalFolder: boolean; recoverable: false }> {
    const project = this.getProject(request.projectId);
    if (request.mode === "registryOnly") {
      this.#registry.remove(project.id);
      return { deletedLocalFolder: false, recoverable: false };
    }
    if (!this.#environment.pathsEqual(request.confirmedCanonicalPath, project.canonicalPath)) {
      throw new AppError("DELETE_CONFIRMATION_MISMATCH", "Confirmed path does not match registered project path");
    }
    if (this.#environment.isUnsafeDeleteTarget(project.canonicalPath)) {
      throw new AppError("UNSAFE_DELETE_TARGET", `Refusing to delete unsafe path: ${project.canonicalPath}`);
    }
    await this.#environment.removeDirectory(project.canonicalPath);
    this.#registry.remove(project.id);
    return { deletedLocalFolder: true, recoverable: false };
  }
}
