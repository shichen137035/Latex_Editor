import type { NodeProjectEnvironment, NodeProjectFileService } from "@latex-editor/filesystem-node" with { "resolution-mode": "import" };
import type { SQLiteProjectRegistry } from "@latex-editor/registry-sqlite" with { "resolution-mode": "import" };
import type { LatexmkCompilerService } from "@latex-editor/compiler-latexmk" with { "resolution-mode": "import" };
import type { FileResourceCatalog } from "@latex-editor/resource-catalog" with { "resolution-mode": "import" };
import type { ProjectService, ProjectBlockGraphService, ProjectDocumentStructureService, ProjectRelationService, ProjectWorkingDocumentService } from "@latex-editor/application" with { "resolution-mode": "import" };
import type { StyleResourceRepository } from "./style-resources.js";
import type { ThemeRepository } from "./themes.js";
import type { OfflineSpellCheckService } from "./spellcheck.js";
import type { InstallationStateService } from "./installation.js";
import type { ProjectImageService } from "./images.js";
import type { ReferenceLibraryRepository } from "./references.js";
import type { CodexAppServer } from "./ai/codex-app-server.js";
import type { CopilotChatService } from "./ai/copilot-chat.js";
import type { AIWorkspaceService } from "./ai/ai-workspace.js";
import type { ProjectHistoryService } from "./project-history.js";

/** Services composed once during Electron startup and shared by IPC modules. */
export interface DesktopContext {
  registry: SQLiteProjectRegistry;
  projects: ProjectService;
  environment: NodeProjectEnvironment;
  files: NodeProjectFileService;
  compiler: LatexmkCompilerService;
  resources: FileResourceCatalog;
  blockGraph: ProjectBlockGraphService;
  relations: ProjectRelationService;
  structure: ProjectDocumentStructureService;
  documents: ProjectWorkingDocumentService;
  styleResources: StyleResourceRepository;
  themes: ThemeRepository;
  spellcheck: OfflineSpellCheckService;
  installation: InstallationStateService;
  images: ProjectImageService;
  references: ReferenceLibraryRepository;
  ai: CodexAppServer;
  copilot: CopilotChatService;
  aiWorkspaces: AIWorkspaceService;
  history: ProjectHistoryService;
}
