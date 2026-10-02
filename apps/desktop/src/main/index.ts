import { registerBlockGraphIpc } from "./block-graph-ipc.js";
import { registerStructureIpc } from "./structure-ipc.js";
import { desktopInvoke, desktopEvents } from "@latex-editor/contracts/desktop-ipc";
import { handleIpc, onIpc, sendIpc } from "./ipc.js";
import { app, BrowserWindow, clipboard, dialog, Menu, shell } from "electron";
import { randomUUID } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { AIStatus, CompileResult, PdfExportResult, Project } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { EnvironmentCatalog } from "@latex-editor/editor-core/preview/catalog" with { "resolution-mode": "import" };
import type { EnvironmentDefinition } from "@latex-editor/editor-core/preview/types" with { "resolution-mode": "import" };
import type { DesktopContext } from "./desktopContext.js";
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
import { createWorkspaceBlockApi } from "./ai/workspace-block-api.js";
import { registerAiIpcHandlers } from "./ai/ipc.js";
import { createProjectSourceArchive } from "./project-export.js";

let context: DesktopContext | undefined;
let settings: SettingsRepository;
const closeStates = new Map<number, { pending: string | undefined; approved: boolean; ready: boolean }>();
let quitRequested = false;

// Keep Electron's per-user data and Windows AppUserModel identity aligned with
// the product name used by the installer. This also makes the documented
// %APPDATA%\\TeXWeave layout stable across updates.
app.setName("TeXWeave");
app.setAppUserModelId("com.texweave.editor");


async function createContext(): Promise<DesktopContext> {
  const packageInfo = JSON.parse(await readFile(resolve(__dirname, "../../../../package.json"), "utf8")) as { version?: unknown };
  const appVersion = typeof packageInfo.version === "string" ? packageInfo.version : app.getVersion();
  // Backend packages are ESM; dynamic import keeps this Electron entry CommonJS-compatible.
  const [{ ProjectService, ProjectBlockGraphService, ProjectDocumentStructureService }, { systemClock }, { NodeProjectEnvironment, NodeProjectFileService }, { SQLiteProjectRegistry }, { FileResourceCatalog }, { LatexmkCompilerService }] = await Promise.all([
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
  const { environmentsFromCatalog } = await import("@latex-editor/editor-core/preview/catalog");
  const environmentCatalog = JSON.parse(await readFile(resolve(resourceRoot, "environments", "preview-environments.json"), "utf8")) as EnvironmentCatalog;
  const environmentDefinitions = async (projectId: string): Promise<EnvironmentDefinition[]> => {
    const preferences = await settings.snapshot(projectId);
    const configured = (preferences.project.environments ?? preferences.global.environments) as EnvironmentDefinition[] | undefined;
    const defaults = environmentsFromCatalog(environmentCatalog);
    return configured?.length ? [...configured, ...defaults.filter((entry) => !configured.some((custom) => custom.id === entry.id))] : defaults;
  };
  const structure = new ProjectDocumentStructureService(files, blockGraph, { next: randomUUID }, environmentDefinitions);
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
    onStatus: (status: AIStatus) => BrowserWindow.getAllWindows().forEach((window) => sendIpc(window.webContents, desktopEvents.toRenderer.aiStatus, status))
  });
  const copilot = new CopilotChatService(app.getPath("userData"));
  const aiWorkspaces = new AIWorkspaceService({
    userDataPath: app.getPath("userData"),
    codex: ai,
    copilot,
    projectFiles: files,
    projectExists: (id) => Boolean(registry.get(id) && !registry.get(id)?.missing),
    builtInSkillsRoot: resolve(resourceRoot, "ai", "skills"),
    createBlockApi: async ({ projectId, workspaceRoot }) => {
      const project = registry.get(projectId);
      if (!project || project.missing) throw new Error("The source project is no longer available.");
      // Block tools and shell edits share the same diff-reviewed working copy.
      return createWorkspaceBlockApi(project, workspaceRoot, () => environmentDefinitions(projectId));
    },
    compileWorkspace: async ({ projectId, workspaceRoot, mainFile }) => {
      const project = registry.get(projectId);
      if (!project || project.missing) throw new Error("The source project is no longer available.");
      const preferences = await settings.snapshot(projectId);
      const configuredMain = mainFile ?? project.mainFile;
      if (!configuredMain) throw new Error("Set a main TeX file in the project before asking TeXWeave AI to compile it.");
      return compiler.compileWorkspace({ workspaceRoot, mainFile: configuredMain, engine: preferences.project.engine ?? preferences.global.engine ?? "pdflatex" });
    },
    onUpdate: (kind, payload) => BrowserWindow.getAllWindows().forEach((window) => sendIpc(window.webContents, desktopEvents.toRenderer.aiUpdate, { kind, payload }))
  });
  await aiWorkspaces.initialize();
  return { registry, projects, environment, files, compiler, resources, blockGraph, structure, styleResources, themes, spellcheck, installation, images, references, ai, copilot, aiWorkspaces };
}

function requireContext(): DesktopContext {
  if (!context) throw new Error("Application context is not ready");
  return context;
}

function registerIpcHandlers(): void {
  onIpc(desktopEvents.toMain.closeReady, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const state = window && closeStates.get(window.id);
    if (state) state.ready = true;
  });
  onIpc(desktopEvents.toMain.closeResponse, (event, requestId, allow) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const state = window && closeStates.get(window.id);
    if (!window || !state || !state.pending || state.pending !== requestId) return;
    state.pending = undefined;
    if (allow !== true) { quitRequested = false; return; }
    state.approved = true;
    if (quitRequested) app.quit(); else window.close();
  });
  handleIpc(desktopInvoke.lifecycle.confirmClose, async (event, labels) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || !closeStates.get(window.id)?.pending) return "cancel";
    const result = await dialog.showMessageBox(window, { type: "warning", ...labels, defaultId: 0, cancelId: 2, noLink: true });
    return (["save", "discard", "cancel"] as const)[result.response] ?? "cancel";
  });
  handleIpc(desktopInvoke.lifecycle.showSaveError, async (event, title, message) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) await dialog.showMessageBox(window, { type: "error", title, message });
  });
  handleIpc(desktopInvoke.settings.get, (_event, projectId) => settings.snapshot(projectId));
  handleIpc(desktopInvoke.settings.set, async (_event, key, value, projectId) => {
    const snapshot = await settings.set(key, value, projectId);
    if (key === "themeDirectory" && projectId === undefined && context) await context.themes.setDirectory(typeof value === "string" ? value : "");
    return snapshot;
  });
  handleIpc(desktopInvoke.installation.state, () => context?.installation.snapshot());
  handleIpc(desktopInvoke.installation.setMode, (_event, mode, installDirectory) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.installation.setInstallMode(mode, installDirectory);
  });
  handleIpc(desktopInvoke.installation.recordComponent, (_event, component) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.installation.recordComponent(component);
  });
  handleIpc(desktopInvoke.installation.recordEnvironment, (_event, toolchain) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.installation.recordEnvironment(toolchain);
  });
  handleIpc(desktopInvoke.installation.removeUserData, (_event, options) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.installation.removeUserData(options);
  });
  handleIpc(desktopInvoke.resources.searchCommands, (_event, query) => context?.resources.searchCommands(query) ?? []);
  handleIpc(desktopInvoke.references.snapshot, (_event, projectId) => context?.references.snapshot(projectId));
  handleIpc(desktopInvoke.references.importFile, (_event, path) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.importBibFile(path);
  });
  handleIpc(desktopInvoke.references.saveEntry, (_event, input) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.saveEntry(input);
  });
  handleIpc(desktopInvoke.references.removeEntry, (_event, id) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.removeEntry(id);
  });
  handleIpc(desktopInvoke.references.setFavorite, (_event, id, favorite) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.setFavorite(id, favorite);
  });
  handleIpc(desktopInvoke.references.createCollection, (_event, name, parentId) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.createCollection(name, parentId);
  });
  handleIpc(desktopInvoke.references.createTag, (_event, name) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.createTag(name);
  });
  handleIpc(desktopInvoke.references.renameTag, (_event, id, name) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.renameTag(id, name);
  });
  handleIpc(desktopInvoke.references.removeTag, (_event, id) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.removeTag(id);
  });
  handleIpc(desktopInvoke.references.setProjectLink, (_event, link) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.setProjectLink(link);
  });
  handleIpc(desktopInvoke.references.removeProjectLink, (_event, projectId, entryId) => {
    if (!context) throw new Error("Application context is not ready");
    return context.references.removeProjectLink(projectId, entryId);
  });
  registerStructureIpc(() => requireContext().structure);
  registerBlockGraphIpc(() => requireContext().blockGraph);
  handleIpc(desktopInvoke.spellcheck.status, () => context?.spellcheck.status());
  handleIpc(desktopInvoke.spellcheck.checkText, (_event, text, language) => context?.spellcheck.checkText(text, language) ?? []);
  handleIpc(desktopInvoke.spellcheck.checkWords, (_event, words, language) => context?.spellcheck.checkWords(words, language) ?? []);
  handleIpc(desktopInvoke.spellcheck.suggestions, (_event, word, language) => context?.spellcheck.suggestions(word, language) ?? []);
  handleIpc(desktopInvoke.spellcheck.configure, (_event, mode, language) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.spellcheck.configure(mode, language);
  });
  handleIpc(desktopInvoke.spellcheck.addToDictionary, (_event, word) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.spellcheck.addToDictionary(word);
  });
  handleIpc(desktopInvoke.spellcheck.dictionaryWords, () => context?.spellcheck.dictionaryWords() ?? []);
  handleIpc(desktopInvoke.spellcheck.listDictionaries, (_event, query = "") => context?.spellcheck.listDictionaries(query) ?? []);
  handleIpc(desktopInvoke.spellcheck.refreshDictionaries, () => context?.spellcheck.refreshDictionaries() ?? []);
  handleIpc(desktopInvoke.spellcheck.installDictionary, async (_event, id) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.spellcheck.installDictionary(id);
  });
  handleIpc(desktopInvoke.spellcheck.removeDictionary, async (_event, id) => {
    if (context === undefined) throw new Error("Application context is not ready");
    await context.spellcheck.removeDictionary(id);
    return context.spellcheck.status();
  });
  handleIpc(desktopInvoke.styleResources.list, () => context?.styleResources.list() ?? []);
  handleIpc(desktopInvoke.styleResources.create, (_event, name) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.createResource(name);
  });
  handleIpc(desktopInvoke.styleResources.importFiles, (_event, paths, name) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.importFiles(paths, name);
  });
  handleIpc(desktopInvoke.styleResources.importFolder, (_event, folderPath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.importFolder(folderPath);
  });
  handleIpc(desktopInvoke.styleResources.duplicate, (_event, id) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.duplicate(id);
  });
  handleIpc(desktopInvoke.styleResources.addFiles, (_event, id, paths) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.addFiles(id, paths);
  });
  handleIpc(desktopInvoke.styleResources.rename, (_event, id, name) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.renameResource(id, name);
  });
  handleIpc(desktopInvoke.styleResources.remove, (_event, id) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.styleResources.remove(id);
  });
  handleIpc(desktopInvoke.themes.list, () => context?.themes.list() ?? []);
  handleIpc(desktopInvoke.themes.directory, () => context?.themes.directory() ?? "");
  handleIpc(desktopInvoke.themes.importFiles, (_event, paths) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.themes.importFiles(paths);
  });
  handleIpc(desktopInvoke.themes.importFolder, (_event, folderPath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.themes.importFolder(folderPath);
  });
  handleIpc(desktopInvoke.themes.remove, (_event, id) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.themes.remove(id);
  });
  handleIpc(desktopInvoke.settings.detectToolchain, async (_event, manual) => {
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
  handleIpc(desktopInvoke.projects.list, async () => {
    if (!context) return [];
    const projects = await context.projects.listProjects();
    return Promise.all(projects.map(async (project) => {
      if (!project.mainFile || project.missing) return project;
      try { await context!.files.resolveFilePath(project.id, project.mainFile, true); return project; }
      catch { return { ...project, mainFileMissing: true }; }
    }));
  });
  handleIpc(desktopInvoke.projects.updateDirectoryEntry, (_event, projectId, patch) => {
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
    if (patch.avatarLetter !== undefined) {
      if (typeof patch.avatarLetter !== "string") throw new Error("Project avatar letter must be text");
      const letter = Array.from(patch.avatarLetter.trim());
      const codePoint = letter[0]?.codePointAt(0);
      if (letter.length !== 1 || codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) throw new Error("Project avatar must contain one character");
      next.avatarLetter = Array.from(letter[0]!.toLocaleUpperCase())[0] ?? "?";
    }
    if (patch.avatarColor !== undefined) {
      if (typeof patch.avatarColor !== "string" || !/^#[\da-f]{6}$/i.test(patch.avatarColor)) throw new Error("Project avatar color must be a six-digit hex color");
      next.avatarColor = patch.avatarColor.toLocaleLowerCase("en-US");
    }
    const updated = { ...project, settings: { ...project.settings, projectDirectory: next } };
    context.registry.update(updated);
    return updated;
  });
  handleIpc(desktopInvoke.projects.removeFromDirectory, async (_event, projectId) => {
    if (!context) throw new Error("Application context is not ready");
    return context.projects.remove({ projectId, mode: "registryOnly" });
  });
  handleIpc(desktopInvoke.projects.relocateInDirectory, async (_event, projectId, folderPath) => {
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
  handleIpc(desktopInvoke.projects.deleteToRecycleBin, async (_event, projectId, confirmedPath) => {
    if (!context) throw new Error("Application context is not ready");
    const project = context.registry.get(projectId);
    if (!project || project.canonicalPath !== confirmedPath) throw new Error("Project path confirmation did not match");
    if (project.missing || context.environment.isUnsafeDeleteTarget(project.canonicalPath)) throw new Error("This project folder cannot be safely moved to the Recycle Bin");
    await shell.trashItem(project.canonicalPath);
    await context.projects.remove({ projectId, mode: "registryOnly" });
    return true;
  });
  handleIpc(desktopInvoke.projects.revealInFileManager, (_event, projectId) => {
    if (!context) throw new Error("Application context is not ready");
    const project = context.registry.get(projectId);
    if (!project || project.missing) throw new Error("Project folder is unavailable");
    shell.showItemInFolder(project.canonicalPath);
  });
  handleIpc(desktopInvoke.projects.copyProjectPath, (_event, projectId) => {
    if (!context) throw new Error("Application context is not ready");
    const project = context.registry.get(projectId);
    if (!project) throw new Error("Project not found");
    clipboard.writeText(project.canonicalPath);
  });
  handleIpc(desktopInvoke.projects.create, async (_event, input) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.projects.createProject(input);
  });
  handleIpc(desktopInvoke.projects.register, async (_event, folderPath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.projects.registerExistingFolder(folderPath);
  });
  handleIpc(desktopInvoke.projects.open, async (_event, projectId) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.projects.openProject(projectId);
  });
  handleIpc(desktopInvoke.files.tree, async (_event, projectId) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.listTree(projectId);
  });
  handleIpc(desktopInvoke.files.read, async (_event, projectId, relativePath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.readText(projectId, relativePath);
  });
  handleIpc(desktopInvoke.files.write, async (_event, projectId, relativePath, content) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.writeText(projectId, relativePath, content);
  });
  handleIpc(desktopInvoke.files.readPdf, async (_event, projectId, relativePath) => {
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
  handleIpc(desktopInvoke.files.createFile, async (_event, projectId, relativePath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.createFile(projectId, relativePath);
  });
  handleIpc(desktopInvoke.files.createDirectory, async (_event, projectId, relativePath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.createDirectory(projectId, relativePath);
  });
  handleIpc(desktopInvoke.files.rename, async (_event, projectId, fromRelativePath, toRelativePath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.renameEntry(projectId, fromRelativePath, toRelativePath);
  });
  handleIpc(desktopInvoke.files.copy, async (_event, projectId, fromRelativePath, toRelativePath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.copyEntry(projectId, fromRelativePath, toRelativePath);
  });
  handleIpc(desktopInvoke.files.import, async (_event, projectId, sourcePath, destinationRelativePath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.importEntry(projectId, sourcePath, destinationRelativePath);
  });
  handleIpc(desktopInvoke.files.remove, async (_event, projectId, relativePath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.files.removeEntry(projectId, relativePath);
  });
  handleIpc(desktopInvoke.images.pick, async (_event, multiple = false) => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", ...(multiple ? ["multiSelections" as const] : [])], filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "svg", "pdf"] }] });
    return result.canceled ? [] : result.filePaths;
  });
  handleIpc(desktopInvoke.images.import, async (_event, projectId, sourcePaths, directory) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.images.importImages(projectId, sourcePaths, directory);
  });
  handleIpc(desktopInvoke.images.resolve, async (_event, projectId, texPath, requestedPath, graphicPaths) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.images.resolve(projectId, texPath, requestedPath, graphicPaths);
  });
  handleIpc(desktopInvoke.projects.setMainFile, async (_event, projectId, relativePath) => {
    if (context === undefined) throw new Error("Application context is not ready");
    return context.projects.setMainFile(projectId, relativePath);
  });
  handleIpc(desktopInvoke.compile.run, async (_event, projectId, mainFile) => {
    if (context === undefined) throw new Error("Application context is not ready");
    const preferences = await settings.snapshot(projectId);
    let result: CompileResult;
    try {
      result = await context.compiler.compile({ projectId, engine: preferences.project.engine ?? preferences.global.engine ?? "pdflatex", ...(mainFile === undefined ? {} : { mainFile }) });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "COMPILATION_FAILED";
      const message = code === "TOOLCHAIN_NOT_FOUND" ? "LaTeX toolchain unavailable. Open Settings > Compiler to detect or locate latexmk." : error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString();
      return { compilationId: randomUUID(), status: "failed", exitCode: null, startedAt: now, finishedAt: now, durationMs: 0, mainFile: mainFile ?? "", diagnostics: [{ severity: "error", source: "system", code, message }], stdoutTail: "", stderrTail: message } satisfies CompileResult;
    }
    if (result.pdfPath === undefined) return result;
    const pdfDataUrl = `data:application/pdf;base64,${(await readFile(result.pdfPath)).toString("base64")}`;
    return { ...result, pdfDataUrl };
  });
  handleIpc(desktopInvoke.exports.sourceArchive, async (event, projectId, mainFile) => {
    if (context === undefined) throw new Error("Application context is not ready");
    const project = await context.projects.openProject(projectId);
    const options = {
      title: "Export project source",
      defaultPath: join(app.getPath("downloads"), `${project.name}-source.zip`),
      filters: [{ name: "ZIP archive", extensions: ["zip"] }]
    };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const choice = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return undefined;
    await createProjectSourceArchive(project.canonicalPath, mainFile ?? project.mainFile, choice.filePath);
    return choice.filePath;
  });
  handleIpc(desktopInvoke.exports.mainTex, async (event, projectId, mainFile) => {
    if (context === undefined) throw new Error("Application context is not ready");
    if (extname(mainFile).toLowerCase() !== ".tex") throw new Error("Choose a .tex file as the project's main file.");
    const project = await context.projects.openProject(projectId);
    const sourcePath = await context.files.resolveFilePath(projectId, mainFile, true);
    const suggestedName = mainFile.split(/[\\/]/).at(-1) ?? `${project.name}.tex`;
    const options = {
      title: "Export main TeX file",
      defaultPath: join(app.getPath("downloads"), suggestedName),
      filters: [{ name: "TeX source", extensions: ["tex"] }]
    };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const choice = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return undefined;
    const targetPath = resolve(choice.filePath);
    const normalizedSource = process.platform === "win32" ? sourcePath.toLocaleLowerCase("en-US") : sourcePath;
    const normalizedTarget = process.platform === "win32" ? targetPath.toLocaleLowerCase("en-US") : targetPath;
    if (normalizedSource !== normalizedTarget) await copyFile(sourcePath, targetPath);
    return targetPath;
  });
  handleIpc(desktopInvoke.exports.pdf, async (event, projectId, mainFile): Promise<PdfExportResult> => {
    if (context === undefined) throw new Error("Application context is not ready");
    if (extname(mainFile).toLowerCase() !== ".tex") throw new Error("Choose a .tex file as the project's main file.");
    const project = await context.projects.openProject(projectId);
    await context.files.resolveFilePath(projectId, mainFile, true);
    const texName = mainFile.split(/[\\/]/).at(-1) ?? `${project.name}.tex`;
    const pdfName = texName.replace(/\.tex$/i, ".pdf");
    const options = {
      title: "Compile and export PDF",
      defaultPath: join(app.getPath("downloads"), pdfName),
      filters: [{ name: "PDF document", extensions: ["pdf"] }]
    };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const choice = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return { status: "cancelled" };

    const preferences = await settings.snapshot(projectId);
    let compilation: CompileResult;
    try {
      compilation = await context.compiler.compile({
        projectId,
        mainFile,
        engine: preferences.project.engine ?? preferences.global.engine ?? "pdflatex"
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "COMPILATION_FAILED";
      const message = code === "TOOLCHAIN_NOT_FOUND" ? "LaTeX toolchain unavailable. Open Settings > Compiler to detect or locate latexmk." : error instanceof Error ? error.message : String(error);
      const timestamp = new Date().toISOString();
      compilation = {
        compilationId: randomUUID(), status: "failed", exitCode: null,
        startedAt: timestamp, finishedAt: timestamp, durationMs: 0, mainFile,
        diagnostics: [{ severity: "error", source: "system", code, message }], stdoutTail: "", stderrTail: message
      };
    }
    if (compilation.status !== "succeeded" || !compilation.pdfPath) return { status: "failed", compilation };

    const targetPath = resolve(choice.filePath);
    const normalizedSource = process.platform === "win32" ? compilation.pdfPath.toLocaleLowerCase("en-US") : compilation.pdfPath;
    const normalizedTarget = process.platform === "win32" ? targetPath.toLocaleLowerCase("en-US") : targetPath;
    if (normalizedSource !== normalizedTarget) await copyFile(compilation.pdfPath, targetPath);
    const pdfDataUrl = `data:application/pdf;base64,${(await readFile(compilation.pdfPath)).toString("base64")}`;
    return { status: "exported", path: targetPath, compilation, pdfDataUrl };
  });
  registerAiIpcHandlers(context, settings);
  handleIpc(desktopInvoke.synctex.forward, async (_event, projectId, sourceFile, pdfFile, line, column) => {
    if (context === undefined) throw new Error("Application context is not ready");
    const project = await context.projects.openProject(projectId);
    const [sourcePath, pdfPath] = await Promise.all([context.files.resolveFilePath(projectId, sourceFile, true), context.files.resolveFilePath(projectId, pdfFile, true)]);
    return forwardSync({ root: project.canonicalPath, sourcePath, pdfPath, line, column, ...(settings.toolchain?.binDirectory ? { binDirectory: settings.toolchain.binDirectory } : {}), ...(settings.toolchain?.latexmk ? { latexmk: settings.toolchain.latexmk } : {}) });
  });
  handleIpc(desktopInvoke.synctex.reverse, async (_event, projectId, pdfFile, page, x, y) => {
    if (context === undefined) throw new Error("Application context is not ready");
    const project = await context.projects.openProject(projectId);
    const pdfPath = await context.files.resolveFilePath(projectId, pdfFile, true);
    return reverseSync({ root: project.canonicalPath, pdfPath, page, x, y, ...(settings.toolchain?.binDirectory ? { binDirectory: settings.toolchain.binDirectory } : {}), ...(settings.toolchain?.latexmk ? { latexmk: settings.toolchain.latexmk } : {}) });
  });
  handleIpc(desktopInvoke.dialogs.pickFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  handleIpc(desktopInvoke.dialogs.pickFiles, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "TeX resources", extensions: ["sty", "cls", "bst", "bib", "tex", "cfg", "def", "ltx"] }] });
    return result.canceled ? [] : result.filePaths;
  });
  handleIpc(desktopInvoke.dialogs.pickThemeFiles, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: "CSS themes", extensions: ["css"] }] });
    return result.canceled ? [] : result.filePaths;
  });
}

function createWindow(): BrowserWindow {
  // Isolated UI regression tests need an active compositor without opening a
  // visible helper window. Normal launches retain the native window behavior.
  const offscreenTest = process.env.TEXWEAVE_UI_TEST_OFFSCREEN === "1";
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
      sandbox: false,
      ...(offscreenTest ? { offscreen: true, backgroundThrottling: false } : {})
    }
  });
  const closeState = { pending: undefined as string | undefined, approved: false, ready: false };
  closeStates.set(window.id, closeState);
  window.on("close", (event) => {
    if (closeState.approved || !closeState.ready || window.webContents.isLoadingMainFrame()) return;
    event.preventDefault();
    if (closeState.pending) return;
    closeState.pending = randomUUID();
    sendIpc(window.webContents, desktopEvents.toRenderer.closeRequested, closeState.pending);
  });
  window.once("closed", () => closeStates.delete(window.id));

  // The workbench is intentionally dense; opening maximized keeps the mode
  // switch and both editing panes available from the first frame.
  window.once("ready-to-show", () => {
    if (offscreenTest) return;
    if (settings.global.maximize !== false) window.maximize();
    window.show();
  });
  const rendererUrl = process.env.TEXWEAVE_RENDERER_URL;
  if (rendererUrl) void window.loadURL(rendererUrl);
  else void window.loadFile(resolve(__dirname, "../renderer/index.html"));
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

app.on("before-quit", () => { quitRequested = true; });
app.on("window-all-closed", () => {
  void context?.ai.stop();
  void context?.copilot.dispose();
  context?.registry.close();
  context?.references.close();
  if (process.platform !== "darwin") app.quit();
});
