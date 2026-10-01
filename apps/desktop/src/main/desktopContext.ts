import type { CommandMetadata, CompileInput, CompileResult, Project } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { ProjectBlockGraphService, ProjectDocumentStructureService } from "@latex-editor/application" with { "resolution-mode": "import" };
import type { StyleResourceRepository } from "./style-resources.js";
import type { ThemeRepository } from "./themes.js";
import type { OfflineSpellCheckService } from "./spellcheck.js";
import type { InstallationStateService } from "./installation.js";
import type { ProjectImageService } from "./images.js";
import type { ReferenceLibraryRepository } from "./references.js";
import type { CodexAppServer } from "./ai/codex-app-server.js";
import type { CopilotChatService } from "./ai/copilot-chat.js";
import type { AIWorkspaceService } from "./ai/ai-workspace.js";

/** Services composed once during Electron startup and shared by IPC modules. */
export interface DesktopContext {
  registry: { initialize(): void; close(): void; get(id: string): Project | undefined; update(project: Project): void };
  projects: {
    listProjects(): Promise<unknown>;
    createProject(input: { name: string; parentPath: string; styleResourceIds?: string[] }): Promise<unknown>;
    registerExistingFolder(folderPath: string): Promise<Project>;
    openProject(projectId: string): Promise<unknown>;
    setMainFile(projectId: string, relativePath: string): Promise<unknown>;
    remove(request: { projectId: string; mode: "registryOnly" }): Promise<unknown>;
  };
  environment: { isUnsafeDeleteTarget(path: string): boolean };
  files: {
    listTree(projectId: string): Promise<unknown>;
    readText(projectId: string, relativePath: string): Promise<unknown>;
    writeText(projectId: string, relativePath: string, content: string): Promise<unknown>;
    resolveFilePath(projectId: string, relativePath: string, mustExist?: boolean): Promise<string>;
    createFile(projectId: string, relativePath: string, content?: string): Promise<void>;
    createDirectory(projectId: string, relativePath: string): Promise<void>;
    renameEntry(projectId: string, fromRelativePath: string, toRelativePath: string): Promise<void>;
    copyEntry(projectId: string, fromRelativePath: string, toRelativePath: string): Promise<void>;
    importEntry(projectId: string, sourcePath: string, destinationRelativePath: string): Promise<void>;
    removeEntry(projectId: string, relativePath: string): Promise<void>;
  };
  compiler: { compile(input: CompileInput): Promise<CompileResult>; compileWorkspace(input: { workspaceRoot: string; mainFile: string; engine?: CompileInput["engine"] }): Promise<CompileResult> };
  resources: { searchCommands(query: string): CommandMetadata[] };
  blockGraph: ProjectBlockGraphService;
  structure: ProjectDocumentStructureService;
  styleResources: StyleResourceRepository;
  themes: ThemeRepository;
  spellcheck: OfflineSpellCheckService;
  installation: InstallationStateService;
  images: ProjectImageService;
  references: ReferenceLibraryRepository;
  ai: CodexAppServer;
  copilot: CopilotChatService;
  aiWorkspaces: AIWorkspaceService;
}
