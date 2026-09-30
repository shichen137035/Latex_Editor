import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from "electron";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AIStatus, AIContextSnapshotFile, AddSemanticBlockInput, CommandMetadata, CompileResult, CompileInput, GraphTraversalOptions, PreferenceKey, CreateSemanticBlockInput, CreateUserBlockInput, UpdateSemanticBlockInput, LatexToolchain, MapUserBlockRangesInput, ReconcileParsedBlocksInput, RelationDirection, ProjectReferenceLink, ReferenceLibraryEntry, Project, ProjectTreeNode } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { ProjectBlockGraphService } from "@latex-editor/application" with { "resolution-mode": "import" };
import { SettingsRepository } from "./settings.js";
import { StyleResourceRepository } from "./style-resources.js";
import { ThemeRepository } from "./themes.js";
import { OfflineSpellCheckService } from "./spellcheck.js";
import { InstallationStateService } from "./installation.js";
import { forwardSync, reverseSync } from "./synctex.js";
import { ProjectImageService } from "./images.js";
import { ReferenceLibraryRepository } from "./references.js";
import { CodexAppServer } from "./ai/codex-app-server.js";
import { CopilotChatService } from "./ai/copilot-chat.js";
import { AIWorkspaceService } from "./ai/ai-workspace.js";

interface DesktopContext {
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

let context: DesktopContext | undefined;
let settings: SettingsRepository;

// Keep Electron's per-user data and Windows AppUserModel identity aligned with
// the product name used by the installer. This also makes the documented
// %APPDATA%\\TeXWeave layout stable across updates.
app.setName("TeXWeave");
app.setAppUserModelId("com.texweave.editor");


async function createContext(): Promise<DesktopContext> {
  const packageInfo = JSON.parse(await readFile(resolve(__dirname, "../../../../package.json"), "utf8")) as { version?: unknown };
  const appVersion = typeof packageInfo.version === "string" ? packageInfo.version : app.getVersion();
  // Backend packages are ESM; dynamic import keeps this Electron entry CommonJS-compatible.
  const [{ ProjectService, ProjectBlockGraphService }, { systemClock }, { NodeProjectEnvironment, NodeProjectFileService }, { SQLiteProjectRegistry }, { FileResourceCatalog }, { LatexmkCompilerService }] = await Promise.all([
    import("@latex-editor/application"),
    import("@latex-editor/domain"),
    import("@latex-editor/filesystem-node"),
    import("@latex-editor/registry-sqlite"),
    import("@latex-editor/resource-catalog"),
    import("@latex-editor/compiler-latexmk")
  ]);
  const registry = new SQLiteProjectRegistry(resolve(app.getPath("userData"), "registry.sqlite"));
  registry.initialize();
  const installation = new InstallationStateService(app.getPath("userData"), appVersion);
  await installation.initialize();
  // Development resources live at the repository root. Packaged resources are
  // copied beside the app by electron-builder so user projects remain separate.
  const resourceRoot = app.isPackaged ? resolve(process.resourcesPath, "resources") : resolve(__dirname, "../../../..", "resources");
  const themeRoot = app.isPackaged ? resolve(process.resourcesPath, "themes") : resolve(__dirname, "../../../..", "themes");
  const resources = new FileResourceCatalog(resourceRoot);
  const styleResources = new StyleResourceRepository(resourceRoot, app.getPath("userData"));
  await styleResources.initialize();
  const themes = new ThemeRepository(resourceRoot, themeRoot);
  await themes.initialize();
  const environment = new NodeProjectEnvironment();
  const projects = new ProjectService({
    registry,
    environment,
    templates: resources,
    styleResources,
    clock: systemClock,
    ids: { next: randomUUID }
  });
  // Resource loading is completed before the first project action is accepted.
  await resources.reload();
  const files = new NodeProjectFileService(projects);
  const blockGraph = new ProjectBlockGraphService(files, { next: randomUUID });
  settings = new SettingsRepository(app.getPath("userData"), async (id) => files.resolveFilePath(id, ".texweave/settings.json", false));
  await settings.initialize();
  await themes.setDirectory(settings.global.themeDirectory ?? "");
  const { discoverToolchain } = await import("@latex-editor/compiler-latexmk");
  let detected = await discoverToolchain(settings.toolchain?.latexmk ?? settings.toolchain?.binDirectory);
  if (!detected.available) detected = await discoverToolchain();
  await settings.saveToolchain(detected);
  await installation.recordEnvironment(detected);
  const profiles = { getCompilerProfile: () => ({ ...resources.getCompilerProfile(), ...(settings.toolchain?.latexmk ? { executable: settings.toolchain.latexmk } : {}) }) };
  const compiler = new LatexmkCompilerService({ projects, files, profiles, clock: systemClock });
  const spellcheck = new OfflineSpellCheckService();
  await spellcheck.initialize();
  spellcheck.configure(settings.global.spellCheckMode ?? "auto", settings.global.spellCheckLanguage ?? "en-US");
  await installation.recordComponent({ id: "core", version: appVersion, ownership: "installed-by-texweave", path: app.getAppPath() });
  const images = new ProjectImageService(files);
  const references = new ReferenceLibraryRepository(app.getPath("userData"));
  await references.initialize();
  const ai = new CodexAppServer({
    userDataPath: app.getPath("userData"),
    executable: () => settings.global.aiCodexExecutable ?? "",
    version: appVersion,
    onStatus: (status: AIStatus) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send("ai:status", status))
  });
  const copilot = new CopilotChatService(app.getPath("userData"));
  const aiWorkspaces = new AIWorkspaceService({
    userDataPath: app.getPath("userData"),
    codex: ai,
    copilot,
    projectFiles: files,
    projectExists: (id) => Boolean(registry.get(id) && !registry.get(id)?.missing),
    builtInSkillsRoot: resolve(resourceRoot, "ai", "skills"),
    compileWorkspace: async ({ projectId, workspaceRoot, mainFile }) => {
      const project = registry.get(projectId);
      if (!project || project.missing) throw new Error("The source project is no longer available.");
      const preferences = await settings.snapshot(projectId);
      const configuredMain = mainFile ?? project.mainFile;
      if (!configuredMain) throw new Error("Set a main TeX file in the project before asking TeXWeave AI to compile it.");
      return compiler.compileWorkspace({ workspaceRoot, mainFile: configuredMain, engine: preferences.project.engine ?? preferences.global.engine ?? "pdflatex" });
    },
    onUpdate: (kind, payload) => BrowserWindow.getAllWindows().forEach((window) => window.webContents.send("ai:update", { kind, payload }))
  });
  await aiWorkspaces.initialize();
  return { registry, projects, environment, files, compiler, resources, blockGraph, styleResources, themes, spellcheck, installation, images, references, ai, copilot, aiWorkspaces };
}

function registerIpcHandlers(): void {
  ipcMain.handle("settings:get", (_event, projectId?: string) => settings.snapshot(projectId));
  ipcMain.handle("settings:set", async (_event, key: PreferenceKey, value: unknown, projectId?: string) => {
    const snapshot = await settings.set(key, value, projectId);
    if (key === "themeDirectory" && projectId === undefined && context) await context.themes.setDirectory(typeof value === "string" ? value : "");
    return snapshot;
  });
  ipcMain.handle("installation:state", () => context?.installation.snapshot());
  ipcMain.handle("installation:set-mode", (_event, mode: "recommended" | "custom", installDirectory?: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.installation.setInstallMode(mode, installDirectory);
  });
  ipcMain.handle("installation:record-component", (_event, component: { id: "core" | "language-packs" | "spellcheck" | "latex-runtime" | "themes" | "templates"; version: string; ownership: "external" | "installed-by-texweave" | "user-managed"; path?: string; source?: string }) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.installation.recordComponent(component);
  });
  ipcMain.handle("installation:record-environment", (_event, toolchain: LatexToolchain) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.installation.recordEnvironment(toolchain);
  });
  ipcMain.handle("installation:remove-user-data", (_event, options: { settings: boolean; themes: boolean; languages: boolean; spellcheck: boolean; templates: boolean; cache: boolean }) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.installation.removeUserData(options);
  });
  ipcMain.handle("resources:commands", (_event, query: string) => context?.resources.searchCommands(query) ?? []);
  ipcMain.handle("references:snapshot", (_event, projectId?: string) => context?.references.snapshot(projectId));
  ipcMain.handle("references:import-file", (_event, path: string) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.importBibFile(path);
  });
  ipcMain.handle("references:save-entry", (_event, input: Partial<ReferenceLibraryEntry> & Pick<ReferenceLibraryEntry, "citationKey" | "entryType" | "fields">) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.saveEntry(input);
  });
  ipcMain.handle("references:remove-entry", (_event, id: string) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.removeEntry(id);
  });
  ipcMain.handle("references:set-favorite", (_event, id: string, favorite: boolean) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.setFavorite(id, favorite);
  });
  ipcMain.handle("references:create-collection", (_event, name: string, parentId?: string) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.createCollection(name, parentId);
  });
  ipcMain.handle("references:set-project-link", (_event, link: ProjectReferenceLink) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.setProjectLink(link);
  });
  ipcMain.handle("references:remove-project-link", (_event, projectId: string, entryId: string) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.removeProjectLink(projectId, entryId);
  });
  ipcMain.handle("block-graph:snapshot", (_event, projectId: string) => context?.blockGraph.snapshot(projectId));
  ipcMain.handle("block-graph:create-block", (_event, projectId: string, input: CreateSemanticBlockInput) => context?.blockGraph.createBlock(projectId, input));
  ipcMain.handle("block-graph:validate-user-block", (_event, projectId: string, input: CreateUserBlockInput) => context?.blockGraph.validateUserBlock(projectId, input));
  ipcMain.handle("block-graph:create-user-block", (_event, projectId: string, input: CreateUserBlockInput) => context?.blockGraph.createUserBlock(projectId, input));
  ipcMain.handle("block-graph:delete-user-block", (_event, projectId: string, blockId: string) => context?.blockGraph.deleteUserBlock(projectId, blockId));
  ipcMain.handle("block-graph:reconcile-parsed", (_event, projectId: string, input: ReconcileParsedBlocksInput) => context?.blockGraph.reconcileParsedBlocks(projectId, input));
  ipcMain.handle("block-graph:map-user-ranges", (_event, projectId: string, input: MapUserBlockRangesInput) => context?.blockGraph.mapUserBlockRanges(projectId, input));
  ipcMain.handle("block-graph:add-block", (_event, projectId: string, block: AddSemanticBlockInput & { id: string }) => context?.blockGraph.addBlock(projectId, block));
  ipcMain.handle("block-graph:update-block", (_event, projectId: string, blockId: string, patch: UpdateSemanticBlockInput) => context?.blockGraph.updateBlock(projectId, blockId, patch));
  ipcMain.handle("block-graph:remove-block", (_event, projectId: string, blockId: string) => context?.blockGraph.removeBlock(projectId, blockId));
  ipcMain.handle("block-graph:add-dependency", (_event, projectId: string, prerequisite: string, consequence: string) => context?.blockGraph.addDependency(projectId, prerequisite, consequence));
  ipcMain.handle("block-graph:validate-dependency", (_event, projectId: string, prerequisite: string, consequence: string) => context?.blockGraph.validateDependency(projectId, prerequisite, consequence));
  ipcMain.handle("block-graph:remove-dependency", (_event, projectId: string, prerequisite: string, consequence: string) => context?.blockGraph.removeDependency(projectId, prerequisite, consequence));
  ipcMain.handle("block-graph:has-direct-dependency", (_event, projectId: string, prerequisite: string, consequence: string) => context?.blockGraph.hasDirectDependency(projectId, prerequisite, consequence));
  ipcMain.handle("block-graph:set-structural-parent", (_event, projectId: string, child: string, parent: string | null) => context?.blockGraph.setStructuralParent(projectId, child, parent));
  ipcMain.handle("block-graph:direct-prerequisites", (_event, projectId: string, blockId: string) => context?.blockGraph.getDirectPrerequisites(projectId, blockId));
  ipcMain.handle("block-graph:direct-consequences", (_event, projectId: string, blockId: string) => context?.blockGraph.getDirectConsequences(projectId, blockId));
  ipcMain.handle("block-graph:prerequisite-closure", (_event, projectId: string, blockId: string, options?: GraphTraversalOptions) => context?.blockGraph.getPrerequisiteClosure(projectId, blockId, options));
  ipcMain.handle("block-graph:consequence-closure", (_event, projectId: string, blockId: string, options?: GraphTraversalOptions) => context?.blockGraph.getConsequenceClosure(projectId, blockId, options));
  ipcMain.handle("block-graph:is-prerequisite-of", (_event, projectId: string, prerequisite: string, consequence: string) => context?.blockGraph.isPrerequisiteOf(projectId, prerequisite, consequence));
  ipcMain.handle("block-graph:structural-parent", (_event, projectId: string, blockId: string) => context?.blockGraph.getStructuralParent(projectId, blockId));
  ipcMain.handle("block-graph:structural-children", (_event, projectId: string, blockId: string) => context?.blockGraph.getStructuralChildren(projectId, blockId));
  ipcMain.handle("block-graph:structural-ancestors", (_event, projectId: string, blockId: string) => context?.blockGraph.getStructuralAncestors(projectId, blockId));
  ipcMain.handle("block-graph:structural-descendants", (_event, projectId: string, blockId: string) => context?.blockGraph.getStructuralDescendants(projectId, blockId));
  ipcMain.handle("block-graph:is-structural-ancestor", (_event, projectId: string, ancestor: string, descendant: string) => context?.blockGraph.isStructuralAncestor(projectId, ancestor, descendant));
  ipcMain.handle("block-graph:scc", (_event, projectId: string) => context?.blockGraph.getStronglyConnectedComponents(projectId));
  ipcMain.handle("block-graph:cycles", (_event, projectId: string) => context?.blockGraph.detectDependencyCycles(projectId));
  ipcMain.handle("block-graph:prerequisite-overlaps", (_event, projectId: string, blockId: string) => context?.blockGraph.findStructuralOverlapsInPrerequisites(projectId, blockId));
  ipcMain.handle("block-graph:consequence-overlaps", (_event, projectId: string, blockId: string) => context?.blockGraph.findStructuralOverlapsInConsequences(projectId, blockId));
  ipcMain.handle("block-graph:prerequisite-relations", (_event, projectId: string, blockId: string) => context?.blockGraph.findLogicalRelationsWithinPrerequisites(projectId, blockId));
  ipcMain.handle("block-graph:between", (_event, projectId: string, start: string, end: string) => context?.blockGraph.getBlocksBetween(projectId, start, end));
  ipcMain.handle("block-graph:neighborhood", (_event, projectId: string, focusId: string | null, direction: RelationDirection, depth: number | "all") => context?.blockGraph.getRelationNeighborhood(projectId, focusId, direction, depth));
  ipcMain.handle("block-graph:history-state", (_event, projectId: string) => context?.blockGraph.historyState(projectId));
  ipcMain.handle("block-graph:undo", (_event, projectId: string) => context?.blockGraph.undo(projectId));
  ipcMain.handle("block-graph:redo", (_event, projectId: string) => context?.blockGraph.redo(projectId));
  ipcMain.handle("block-graph:validate", (_event, projectId: string) => context?.blockGraph.validate(projectId));
  ipcMain.handle("block-graph:validate-structure", (_event, projectId: string) => context?.blockGraph.validateStructure(projectId));
  ipcMain.handle("spellcheck:status", () => context?.spellcheck.status());
  ipcMain.handle("spellcheck:check-text", (_event, text: string, language: string) => context?.spellcheck.checkText(text, language) ?? []);
  ipcMain.handle("spellcheck:check-words", (_event, words: string[], language: string) => context?.spellcheck.checkWords(words, language) ?? []);
  ipcMain.handle("spellcheck:suggestions", (_event, word: string, language: string) => context?.spellcheck.suggestions(word, language) ?? []);
  ipcMain.handle("spellcheck:configure", (_event, mode: "auto" | "manual" | "disabled", language: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.spellcheck.configure(mode, language);
  });
  ipcMain.handle("spellcheck:add-word", (_event, word: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.spellcheck.addToDictionary(word);
  });
  ipcMain.handle("spellcheck:dictionary-words", () => context?.spellcheck.dictionaryWords() ?? []);
  ipcMain.handle("spellcheck:list-dictionaries", (_event, query = "") => context?.spellcheck.listDictionaries(query) ?? []);
  ipcMain.handle("spellcheck:refresh-dictionaries", () => context?.spellcheck.refreshDictionaries() ?? []);
  ipcMain.handle("spellcheck:install-dictionary", async (_event, id: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.spellcheck.installDictionary(id);
  });
  ipcMain.handle("spellcheck:remove-dictionary", async (_event, id: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    await context.spellcheck.removeDictionary(id);
    return context.spellcheck.status();
  });
  ipcMain.handle("style-resources:list", () => context?.styleResources.list() ?? []);
  ipcMain.handle("style-resources:create", (_event, name: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.createResource(name);
  });
  ipcMain.handle("style-resources:import-files", (_event, paths: string[], name?: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.importFiles(paths, name);
  });
  ipcMain.handle("style-resources:import-folder", (_event, folderPath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.importFolder(folderPath);
  });
  ipcMain.handle("style-resources:duplicate", (_event, id: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.duplicate(id);
  });
  ipcMain.handle("style-resources:add-files", (_event, id: string, paths: string[]) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.addFiles(id, paths);
  });
  ipcMain.handle("style-resources:rename", (_event, id: string, name: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.renameResource(id, name);
  });
  ipcMain.handle("style-resources:remove", (_event, id: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.remove(id);
  });
  ipcMain.handle("themes:list", () => context?.themes.list() ?? []);
  ipcMain.handle("themes:directory", () => context?.themes.directory() ?? "");
  ipcMain.handle("themes:import-files", (_event, paths: string[]) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.themes.importFiles(paths);
  });
  ipcMain.handle("themes:import-folder", (_event, folderPath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.themes.importFolder(folderPath);
  });
  ipcMain.handle("themes:remove", (_event, id: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.themes.remove(id);
  });
  ipcMain.handle("toolchain:detect", async (_event, manual?: "directory" | "executable") => {
    let path: string | undefined;
    if (manual) {
      const selected = await dialog.showOpenDialog({ properties: [manual === "directory" ? "openDirectory" : "openFile"] });
      if (selected.canceled) return settings.toolchain;
      path = selected.filePaths[0];
    }
    const { discoverToolchain } = await import("@latex-editor/compiler-latexmk");
    const detected = await discoverToolchain(path);
    await settings.saveToolchain(detected);
    if (context) await context.installation.recordEnvironment(detected);
    return detected;
  });
  ipcMain.handle("projects:list", async () => {
    if (!context) return [];
    const projects = await context.projects.listProjects() as Project[];
    return Promise.all(projects.map(async (project) => {
      if (!project.mainFile || project.missing) return project;
      try { await context!.files.resolveFilePath(project.id, project.mainFile, true); return project; }
      catch { return { ...project, mainFileMissing: true }; }
    }));
  });
  ipcMain.handle("projects:directory-update", (_event, projectId: string, patch: { displayName?: string; isFavorite?: boolean; isPinned?: boolean }) => {
    if (!context) throw new Error("Application context is not ready");
    const project = context.registry.get(projectId);
    if (!project) throw new Error("Project not found");
    const current = project.settings.projectDirectory && typeof project.settings.projectDirectory === "object"
      ? project.settings.projectDirectory as Record<string, unknown> : {};
    const next: Record<string, unknown> = { ...current };
    if (patch.displayName !== undefined) {
      if (typeof patch.displayName !== "string") throw new Error("Display name must be text");
      const displayName = patch.displayName.trim();
      if (!displayName || displayName.length > 120) throw new Error("Display name must be between 1 and 120 characters");
      next.displayName = displayName;
    }
    if (patch.isFavorite !== undefined) {
      if (typeof patch.isFavorite !== "boolean") throw new Error("Favorite state must be boolean");
      next.isFavorite = patch.isFavorite;
    }
    if (patch.isPinned !== undefined) {
      if (typeof patch.isPinned !== "boolean") throw new Error("Pin state must be boolean");
      next.isPinned = patch.isPinned;
    }
    const updated = { ...project, settings: { ...project.settings, projectDirectory: next } };
    context.registry.update(updated);
    return updated;
  });
  ipcMain.handle("projects:directory-remove", async (_event, projectId: string) => {
    if (!context) throw new Error("Application context is not ready");
    return context.projects.remove({ projectId, mode: "registryOnly" });
  });
  ipcMain.handle("projects:directory-relocate", async (_event, projectId: string, folderPath: string) => {
    if (!context) throw new Error("Application context is not ready");
    const previous = context.registry.get(projectId);
    if (!previous) throw new Error("Project not found");
    const relocated = await context.projects.registerExistingFolder(folderPath);
    let mainFile: string | undefined;
    if (previous.mainFile) {
      try { await context.projects.setMainFile(relocated.id, previous.mainFile); mainFile = previous.mainFile; }
      catch { /* A moved project may have renamed or removed its former main file. */ }
    }
    const updated: Project = {
      ...previous,
      canonicalPath: relocated.canonicalPath,
      missing: false,
      writable: relocated.writable,
      ...(mainFile ? { mainFile } : {})
    };
    if (!mainFile) delete updated.mainFile;
    await context.projects.remove({ projectId: relocated.id, mode: "registryOnly" });
    try { context.registry.update(updated); }
    catch (error) {
      await context.projects.registerExistingFolder(relocated.canonicalPath).catch(() => undefined);
      throw error;
    }
    return updated;
  });
  ipcMain.handle("projects:directory-delete", async (_event, projectId: string, confirmedPath: string) => {
    if (!context) throw new Error("Application context is not ready");
    const project = context.registry.get(projectId);
    if (!project || project.canonicalPath !== confirmedPath) throw new Error("Project path confirmation did not match");
    if (project.missing || context.environment.isUnsafeDeleteTarget(project.canonicalPath)) throw new Error("This project folder cannot be safely moved to the Recycle Bin");
    await shell.trashItem(project.canonicalPath);
    await context.projects.remove({ projectId, mode: "registryOnly" });
    return true;
  });
  ipcMain.handle("projects:directory-reveal", (_event, projectId: string) => {
    if (!context) throw new Error("Application context is not ready");
    const project = context.registry.get(projectId);
    if (!project || project.missing) throw new Error("Project folder is unavailable");
    shell.showItemInFolder(project.canonicalPath);
  });
  ipcMain.handle("projects:directory-copy-path", (_event, projectId: string) => {
    if (!context) throw new Error("Application context is not ready");
    const project = context.registry.get(projectId);
    if (!project) throw new Error("Project not found");
    clipboard.writeText(project.canonicalPath);
  });
  ipcMain.handle("projects:create", async (_event, input: { name: string; parentPath: string }) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.projects.createProject(input);
  });
  ipcMain.handle("projects:register", async (_event, folderPath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.projects.registerExistingFolder(folderPath);
  });
  ipcMain.handle("projects:open", async (_event, projectId: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.projects.openProject(projectId);
  });
  ipcMain.handle("files:tree", async (_event, projectId: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.listTree(projectId);
  });
  ipcMain.handle("files:read", async (_event, projectId: string, relativePath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.readText(projectId, relativePath);
  });
  ipcMain.handle("files:write", async (_event, projectId: string, relativePath: string, content: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.writeText(projectId, relativePath, content);
  });
  ipcMain.handle("files:read-pdf", async (_event, projectId: string, relativePath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    try {
      const filePath = await context.files.resolveFilePath(projectId, relativePath, true);
      return `data:application/pdf;base64,${(await readFile(filePath)).toString("base64")}`;
    } catch (error: unknown) {
      const code = error instanceof Error && "code" in error ? String(error.code) : "";
      if (code === "ENOENT") return undefined;
      return undefined;
    }
  });
  ipcMain.handle("files:create-file", async (_event, projectId: string, relativePath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.createFile(projectId, relativePath);
  });
  ipcMain.handle("files:create-directory", async (_event, projectId: string, relativePath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.createDirectory(projectId, relativePath);
  });
  ipcMain.handle("files:rename", async (_event, projectId: string, fromRelativePath: string, toRelativePath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.renameEntry(projectId, fromRelativePath, toRelativePath);
  });
  ipcMain.handle("files:copy", async (_event, projectId: string, fromRelativePath: string, toRelativePath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.copyEntry(projectId, fromRelativePath, toRelativePath);
  });
  ipcMain.handle("files:import", async (_event, projectId: string, sourcePath: string, destinationRelativePath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.importEntry(projectId, sourcePath, destinationRelativePath);
  });
  ipcMain.handle("files:remove", async (_event, projectId: string, relativePath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.removeEntry(projectId, relativePath);
  });
  ipcMain.handle("images:pick", async (_event, multiple = false) => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", ...(multiple ? ["multiSelections" as const] : [])], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg", "pdf"] }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("images:import", async (_event, projectId: string, sourcePaths: string[], directory: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.images.importImages(projectId, sourcePaths, directory);
  });
  ipcMain.handle("images:resolve", async (_event, projectId: string, texPath: string, requestedPath: string, graphicPaths?: string[]) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.images.resolve(projectId, texPath, requestedPath, graphicPaths);
  });
  ipcMain.handle("projects:set-main-file", async (_event, projectId: string, relativePath: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.projects.setMainFile(projectId, relativePath);
  });
  ipcMain.handle("compile:run", async (_event, projectId: string, mainFile?: string) => {
    if (context === undefined) throw new Error("Application context is not ready");
    const preferences = await settings.snapshot(projectId);
    let result: CompileResult;
    try {
      result = await context.compiler.compile({ projectId, engine: preferences.project.engine ?? preferences.global.engine ?? "pdflatex", ...(mainFile === undefined ? {} : { mainFile }) });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "COMPILATION_FAILED";
      const message = code === "TOOLCHAIN_NOT_FOUND" ? "LaTeX toolchain unavailable. Open Settings > Compiler to detect or locate latexmk." : error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString();
      return { compilationId: randomUUID(), status: "failed", exitCode: null, startedAt: now, finishedAt: now, durationMs: 0, mainFile: mainFile ?? "", diagnostics: [{ severity: "error", source: "system", code, message }], stdoutTail: "", stderrTail: message };
    }
    if (result.pdfPath === undefined) return result;
    const pdfDataUrl = `data:application/pdf;base64,${(await readFile(result.pdfPath)).toString("base64")}`;
    return { ...result, pdfDataUrl };
  });
  ipcMain.handle("ai:detect", () => context?.ai.detect());
  ipcMain.handle("ai:install", async () => {
    if (context === undefined) throw new Error("Application context is not ready");
    const status = await context.ai.install();
    if (status.executablePath) await settings.set("aiCodexExecutable", status.executablePath);
    return status;
  });
  ipcMain.handle("ai:status", () => context?.ai.refresh());
  ipcMain.handle("ai:models", () => context?.aiWorkspaces.listModels());
  ipcMain.handle("ai:skills", () => context?.aiWorkspaces.listSkills());
  ipcMain.handle("ai:skill:save", (_event, input: { name: string; content: string; create?: boolean }) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.saveSkill(input);
  });
  ipcMain.handle("ai:login", () => context?.ai.login());
  ipcMain.handle("ai:logout", () => context?.ai.logout());
  ipcMain.handle("ai:copilot:status", () => context?.copilot.status());
  ipcMain.handle("ai:copilot:install", () => context?.copilot.installCli());
  ipcMain.handle("ai:copilot:login", () => context?.copilot.login());
  ipcMain.handle("ai:copilot:logout", () => context?.copilot.logout());
  ipcMain.handle("ai:copilot:models", () => context?.aiWorkspaces.listCopilotModels());
  ipcMain.handle("ai:conversations", (_event, projectId?: string) => context?.aiWorkspaces.snapshot(projectId));
  ipcMain.handle("ai:conversation:create", (_event, mode: "chat" | "codex", projectId?: string) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.create({ mode, ...(projectId ? { projectId } : {}) });
  });
  ipcMain.handle("ai:conversation:mode", (_event, id: string, mode: "chat" | "codex") => context?.aiWorkspaces.setMode(id, mode));
  ipcMain.handle("ai:conversation:remove", (_event, id: string) => context?.aiWorkspaces.remove(id));
  ipcMain.handle("ai:change-set:resolve", (_event, id: string, decisions: Record<string, "accepted" | "rejected">, applied: boolean) => context?.aiWorkspaces.resolveChangeSet(id, decisions, applied));
  ipcMain.handle("ai:send", async (_event, input: { conversationId: string; projectId?: string; content: string; contextText?: string; overrides?: AIContextSnapshotFile[] }) => {
    if (!context) throw new Error("Application context is not ready");
    const conversation = context.aiWorkspaces.snapshot(input.projectId).conversations.find((item) => item.id === input.conversationId);
    if (!conversation) throw new Error("AI conversation was not found for this project.");
    if (conversation.projectId !== input.projectId) throw new Error("AI conversations can only access their associated project.");
    let snapshot: AIContextSnapshotFile[] = [];
    if (input.projectId) {
      const collect = (nodes: ProjectTreeNode[]): string[] => nodes.flatMap((node) => node.kind === "file" ? [node.relativePath] : node.children ? collect(node.children) : []);
      const paths = collect(await context.files.listTree(input.projectId) as ProjectTreeNode[]).filter((path) => /\.(?:tex|bib|sty|cls|txt|md|cfg|def|ltx|ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|yml|yaml|toml|xml|svg)$/i.test(path) || path.replaceAll("\\", "/").toLocaleLowerCase() === ".texweave/settings.json");
      snapshot = (await Promise.all(paths.map(async (path) => {
        const value = await context!.files.readText(input.projectId!, path) as { content?: unknown };
        return typeof value?.content === "string" ? { path, content: value.content } : undefined;
      }))).filter((item): item is AIContextSnapshotFile => Boolean(item));
      const overrideMap = new Map((input.overrides ?? []).map((file) => [file.path.replaceAll("\\", "/"), file.content]));
      snapshot = snapshot.map((file) => overrideMap.has(file.path) ? { ...file, content: overrideMap.get(file.path)! } : file);
      for (const [path, content] of overrideMap) if (!snapshot.some((file) => file.path === path)) snapshot.push({ path, content });
    }
    const model = conversation.mode === "chat" ? settings.global.aiCopilotModel : settings.global.aiModel;
    const reasoningEffort = conversation.mode === "chat" ? settings.global.aiCopilotReasoningEffort : settings.global.aiReasoningEffort;
    return context.aiWorkspaces.send({ conversationId: input.conversationId, content: input.content, ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}), ...(snapshot.length ? { snapshot } : {}), ...(input.contextText ? { contextText: input.contextText } : {}) });
  });
  ipcMain.handle("ai:cancel", (_event, taskId: string) => context?.aiWorkspaces.cancel(taskId));
  ipcMain.handle("ai:set-executable", async (_event, path: string) => {
    await settings.set("aiCodexExecutable", path);
    await context?.ai.stop();
    return context?.ai.detect();
  });
  ipcMain.handle("synctex:forward", async (_event, projectId: string, sourceFile: string, pdfFile: string, line: number, column: number) => {
    if (context === undefined) throw new Error("Application context is not ready");
    const project = await context.projects.openProject(projectId) as { canonicalPath: string };
    const [sourcePath, pdfPath] = await Promise.all([context.files.resolveFilePath(projectId, sourceFile, true), context.files.resolveFilePath(projectId, pdfFile, true)]);
    return forwardSync({ root: project.canonicalPath, sourcePath, pdfPath, line, column, ...(settings.toolchain?.binDirectory ? { binDirectory: settings.toolchain.binDirectory } : {}), ...(settings.toolchain?.latexmk ? { latexmk: settings.toolchain.latexmk } : {}) });
  });
  ipcMain.handle("synctex:reverse", async (_event, projectId: string, pdfFile: string, page: number, x: number, y: number) => {
    if (context === undefined) throw new Error("Application context is not ready");
    const project = await context.projects.openProject(projectId) as { canonicalPath: string };
    const pdfPath = await context.files.resolveFilePath(projectId, pdfFile, true);
    return reverseSync({ root: project.canonicalPath, pdfPath, page, x, y, ...(settings.toolchain?.binDirectory ? { binDirectory: settings.toolchain.binDirectory } : {}), ...(settings.toolchain?.latexmk ? { latexmk: settings.toolchain.latexmk } : {}) });
  });
  ipcMain.handle("dialogs:pick-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("dialogs:pick-files", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "TeX resources", extensions: ["sty", "cls", "bst", "bib", "tex", "cfg", "def", "ltx"] }] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("dialogs:pick-theme-files", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "CSS themes", extensions: ["css"] }] });
    return result.canceled ? [] : result.filePaths;
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#f5f7fb",
    title: "TeXWeave — Local LaTeX Editor",
    webPreferences: {
      preload: resolve(__dirname, "../../src/preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  // The workbench is intentionally dense; opening maximized keeps the mode
  // switch and both editing panes available from the first frame.
  window.once("ready-to-show", () => {
    if (settings.global.maximize !== false) window.maximize();
    window.show();
  });
  window.loadFile(resolve(__dirname, "../renderer/index.html"));
  return window;
}

app.whenReady().then(() => {
  // The renderer owns the application controls. Do not show Electron's default
  // File/Edit/View/Window/Help menu above the TeXWeave workspace.
  Menu.setApplicationMenu(null);
  void createContext().then((createdContext) => {
    context = createdContext;
    registerIpcHandlers();
    createWindow();
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to initialize desktop application", error);
    dialog.showErrorBox("TeXWeave could not start", message);
    app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  void context?.ai.stop();
  void context?.copilot.dispose();
  context?.registry.close();
  context?.references.close();
  if (process.platform !== "darwin") app.quit();
});
