import { registerBlockGraphIpc } from "./block-graph-ipc.js";
import { registerStructureIpc } from "./structure-ipc.js";
import { registerWorkingDocumentIpc } from "./working-document-ipc.js";
import { registerRelationIpc } from "./relation-ipc.js";
import { desktopInvoke, desktopEvents, type UnsavedDialogLabels, type UnsavedDialogChoice } from "@latex-editor/contracts/desktop-ipc";
import { handleIpc, onIpc, sendIpc } from "./ipc.js";
import { app, BrowserWindow, clipboard, dialog, Menu, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { randomUUID } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { AIStatus, CompileResult, FileWriteResult, PdfExportResult, PreviewDirectiveDefinition, Project } from "@latex-editor/contracts" with { "resolution-mode": "import" };
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
import { failedCompilation, publishWorkspaceCompilation } from "./compile-preview.js";
import { createProjectSourceArchive } from "./project-export.js";
import { ProjectHistoryService } from "./project-history.js";
import { registerHistoryIpc } from "./history-ipc.js";
import { installRendererSecurity, resolveRendererTarget } from "./renderer-security.js";
import { translateNative } from "./i18n.js";
import { readAppInfo } from "./app-info.js";

let context: DesktopContext | undefined;
let settings: SettingsRepository;
const nativeText = (key: string) => translateNative(settings?.global.locale ?? "en", key);
const closeStates = new Map<number, { pending: string | undefined; approved: boolean; ready: boolean }>();
let quitRequested = false;

// Keep Electron's per-user data and Windows AppUserModel identity aligned with
// the product name used by the installer. This also makes the documented
// %APPDATA%\\TeXWeave layout stable across updates.
app.setName("TeXWeave");
app.setAppUserModelId("com.texweave.editor");


async function createContext(): Promise<DesktopContext> {
  const { version: appVersion } = await readAppInfo();
  // Backend packages are ESM; dynamic import keeps this Electron entry CommonJS-compatible.
  const [{ ProjectService, createProjectBlockServices, WorkingDocumentFiles, ProjectWorkingDocumentService }, { systemClock }, { NodeProjectEnvironment, NodeProjectFileService }, { SQLiteProjectRegistry }, { FileResourceCatalog }, { LatexmkCompilerService }] = await Promise.all([
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
  settings = new SettingsRepository(app.getPath("userData"), async (id) => files.resolveFilePath(id, ".texweave/settings.json", false));
  await settings.initialize();
  const { defaultHistoryPreferences, includeNewBuiltInDirectives } = await import("@latex-editor/contracts");
  const history = new ProjectHistoryService((id) => projects.getProject(id), async (id) => {
    const snapshot = await settings.snapshot(id);
    return { ...defaultHistoryPreferences, ...(snapshot.global.history ?? {}), ...(snapshot.project.history ?? {}) };
  });
  const { environmentsFromCatalog } = await import("@latex-editor/editor-core/preview/catalog");
  const environmentCatalog = JSON.parse(await readFile(resolve(resourceRoot, "environments", "preview-environments.json"), "utf8")) as EnvironmentCatalog;
  const environmentDefinitions = async (projectId: string): Promise<EnvironmentDefinition[]> => {
    const preferences = await settings.snapshot(projectId);
    const configured = (preferences.project.environments ?? preferences.global.environments) as EnvironmentDefinition[] | undefined;
    const defaults = environmentsFromCatalog(environmentCatalog);
    return configured?.length ? [...configured, ...defaults.filter((entry) => !configured.some((custom) => custom.id === entry.id))] : defaults;
  };
  const directiveDefinitions = async (projectId: string): Promise<PreviewDirectiveDefinition[]> => {
    const preferences = await settings.snapshot(projectId);
    return includeNewBuiltInDirectives(preferences.project.previewDirectives ?? preferences.global.previewDirectives ?? []);
  };
  const workingFiles = new WorkingDocumentFiles(files);
  const { blockGraph, structure, relations, cacheReclamation } = createProjectBlockServices({ files: workingFiles, ids: { next: randomUUID }, definitions: environmentDefinitions, directives: directiveDefinitions });
  const documents = new ProjectWorkingDocumentService(workingFiles, blockGraph, { next: randomUUID }, environmentDefinitions, directiveDefinitions, cacheReclamation);
  relations.onEvent((projectId, event) => BrowserWindow.getAllWindows().forEach(window => sendIpc(window.webContents, desktopEvents.toRenderer.relationUpdate, { projectId, event })));
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
  const images = new ProjectImageService(files, { reclamation: cacheReclamation });
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
      if (!project || project.missing) throw new Error(nativeText("native.sourceProjectUnavailable"));
      // Block tools and shell edits share the same diff-reviewed working copy.
      return createWorkspaceBlockApi(project, workspaceRoot, () => environmentDefinitions(projectId), () => directiveDefinitions(projectId));
    },
    relationAccess: { api: id => relations.aiAPI(id), commit: (id, proposalId) => relations.commitRelationProposal(id, proposalId), reject: (id, proposalId) => relations.rejectProposal(id, proposalId) },
    compileWorkspace: async ({ projectId, workspaceRoot, mainFile }) => {
      const project = registry.get(projectId);
      if (!project || project.missing) throw new Error(nativeText("native.sourceProjectUnavailable"));
      const preferences = await settings.snapshot(projectId);
      const configuredMain = mainFile ?? project.mainFile;
      if (!configuredMain) throw new Error(nativeText("native.aiMainFileRequired"));
      let result: CompileResult;
      try { result = await compiler.compileWorkspace({ workspaceRoot, mainFile: configuredMain, engine: preferences.project.engine ?? preferences.global.engine ?? "pdflatex" }); }
      catch (error) { result = failedCompilation(configuredMain, error); }
      return publishWorkspaceCompilation(projectId, result, files, update => {
        BrowserWindow.getAllWindows().forEach(window => sendIpc(window.webContents, desktopEvents.toRenderer.compileUpdate, update));
      });
    },
    setMainFile: async (projectId, relativePath) => {
      const updated = await projects.setMainFile(projectId, relativePath);
      BrowserWindow.getAllWindows().forEach(window => sendIpc(window.webContents, desktopEvents.toRenderer.projectUpdate, updated));
    },
    onUpdate: (kind, payload) => BrowserWindow.getAllWindows().forEach((window) => sendIpc(window.webContents, desktopEvents.toRenderer.aiUpdate, { kind, payload }))
  });
  await aiWorkspaces.initialize();
  return { registry, projects, environment, files, compiler, resources, blockGraph, structure, relations, documents, styleResources, themes, spellcheck, installation, images, references, ai, copilot, aiWorkspaces, history };
}

function requireContext(): DesktopContext {
  if (!context) throw new Error(nativeText("native.contextNotReady"));
  return context;
}

async function showUnsavedDialog(event: IpcMainInvokeEvent, labels: UnsavedDialogLabels): Promise<UnsavedDialogChoice> {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return "cancel";
  const result = await dialog.showMessageBox(window, { type: "warning", ...labels, defaultId: 0, cancelId: 2, noLink: true });
  return (["save", "discard", "cancel"] as const)[result.response] ?? "cancel";
}

function registerIpcHandlers(): void {
  handleIpc(desktopInvoke.app.info, () => readAppInfo());
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
    return showUnsavedDialog(event, labels);
  });
  handleIpc(desktopInvoke.lifecycle.confirmNavigation, showUnsavedDialog);
  handleIpc(desktopInvoke.lifecycle.showSaveError, async (event, title, message) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) await dialog.showMessageBox(window, { type: "error", title, message });
  });
  handleIpc(desktopInvoke.settings.get, (_event, projectId) => settings.snapshot(projectId));
  handleIpc(desktopInvoke.settings.set, async (_event, key, value, projectId) => {
    const snapshot = await settings.set(key, value, projectId);
    if (key === "locale" && projectId === undefined) for (const window of BrowserWindow.getAllWindows()) window.setTitle(nativeText("native.windowTitle"));
    if (key === "themeDirectory" && projectId === undefined && context) await context.themes.setDirectory(typeof value === "string" ? value : "");
    return snapshot;
  });
  handleIpc(desktopInvoke.installation.state, () => context?.installation.snapshot());
  handleIpc(desktopInvoke.installation.setMode, (_event, mode, installDirectory) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.installation.setInstallMode(mode, installDirectory);
  });
  handleIpc(desktopInvoke.installation.recordComponent, (_event, component) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.installation.recordComponent(component);
  });
  handleIpc(desktopInvoke.installation.recordEnvironment, (_event, toolchain) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.installation.recordEnvironment(toolchain);
  });
  handleIpc(desktopInvoke.installation.removeUserData, (_event, options) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.installation.removeUserData(options);
  });
  handleIpc(desktopInvoke.resources.searchCommands, (_event, query) => context?.resources.searchCommands(query) ?? []);
  handleIpc(desktopInvoke.references.snapshot, (_event, projectId) => context?.references.snapshot(projectId));
  handleIpc(desktopInvoke.references.importFile, (_event, path) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    return context.references.importBibFile(path);
  });
  handleIpc(desktopInvoke.references.saveEntry, (_event, input) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    return context.references.saveEntry(input);
  });
  handleIpc(desktopInvoke.references.removeEntry, (_event, id) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    return context.references.removeEntry(id);
  });
  handleIpc(desktopInvoke.references.setFavorite, (_event, id, favorite) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    return context.references.setFavorite(id, favorite);
  });
  handleIpc(desktopInvoke.references.createCollection, (_event, name, parentId) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    return context.references.createCollection(name, parentId);
  });
  handleIpc(desktopInvoke.references.createTag, (_event, name) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    return context.references.createTag(name);
  });
  handleIpc(desktopInvoke.references.renameTag, (_event, id, name) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    return context.references.renameTag(id, name);
  });
  handleIpc(desktopInvoke.references.removeTag, (_event, id) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    return context.references.removeTag(id);
  });
  handleIpc(desktopInvoke.references.setProjectLink, (_event, link) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    return context.references.setProjectLink(link);
  });
  handleIpc(desktopInvoke.references.removeProjectLink, (_event, projectId, entryId) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    return context.references.removeProjectLink(projectId, entryId);
  });
  registerStructureIpc(() => requireContext().structure);
  registerWorkingDocumentIpc(() => requireContext().documents);
  registerBlockGraphIpc(() => requireContext().blockGraph);
  registerRelationIpc(() => requireContext().relations);
  registerHistoryIpc(() => requireContext().history);
  handleIpc(desktopInvoke.spellcheck.status, () => context?.spellcheck.status());
  handleIpc(desktopInvoke.spellcheck.checkText, (_event, text, language) => context?.spellcheck.checkText(text, language) ?? []);
  handleIpc(desktopInvoke.spellcheck.checkWords, (_event, words, language) => context?.spellcheck.checkWords(words, language) ?? []);
  handleIpc(desktopInvoke.spellcheck.suggestions, (_event, word, language) => context?.spellcheck.suggestions(word, language) ?? []);
  handleIpc(desktopInvoke.spellcheck.configure, (_event, mode, language) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.spellcheck.configure(mode, language);
  });
  handleIpc(desktopInvoke.spellcheck.addToDictionary, (_event, word) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.spellcheck.addToDictionary(word);
  });
  handleIpc(desktopInvoke.spellcheck.dictionaryWords, () => context?.spellcheck.dictionaryWords() ?? []);
  handleIpc(desktopInvoke.spellcheck.listDictionaries, (_event, query = "") => context?.spellcheck.listDictionaries(query) ?? []);
  handleIpc(desktopInvoke.spellcheck.refreshDictionaries, () => context?.spellcheck.refreshDictionaries() ?? []);
  handleIpc(desktopInvoke.spellcheck.installDictionary, async (_event, id) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.spellcheck.installDictionary(id);
  });
  handleIpc(desktopInvoke.spellcheck.removeDictionary, async (_event, id) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    await context.spellcheck.removeDictionary(id);
    return context.spellcheck.status();
  });
  handleIpc(desktopInvoke.styleResources.list, () => context?.styleResources.list() ?? []);
  handleIpc(desktopInvoke.styleResources.readFile, (_event, id, targetPath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.styleResources.getFile(id, targetPath);
  });
  handleIpc(desktopInvoke.styleResources.create, (_event, name) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.styleResources.createResource(name);
  });
  handleIpc(desktopInvoke.styleResources.importFiles, (_event, paths, name) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.styleResources.importFiles(paths, name);
  });
  handleIpc(desktopInvoke.styleResources.importFolder, (_event, folderPath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.styleResources.importFolder(folderPath);
  });
  handleIpc(desktopInvoke.styleResources.duplicate, (_event, id) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.styleResources.duplicate(id);
  });
  handleIpc(desktopInvoke.styleResources.addFiles, (_event, id, paths) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.styleResources.addFiles(id, paths);
  });
  handleIpc(desktopInvoke.styleResources.rename, (_event, id, name) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.styleResources.renameResource(id, name);
  });
  handleIpc(desktopInvoke.styleResources.remove, (_event, id) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.styleResources.remove(id);
  });
  handleIpc(desktopInvoke.themes.list, () => context?.themes.list() ?? []);
  handleIpc(desktopInvoke.themes.directory, () => context?.themes.directory() ?? "");
  handleIpc(desktopInvoke.themes.importFiles, (_event, paths) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.themes.importFiles(paths);
  });
  handleIpc(desktopInvoke.themes.importFolder, (_event, folderPath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.themes.importFolder(folderPath);
  });
  handleIpc(desktopInvoke.themes.remove, (_event, id) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
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
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    const project = context.registry.get(projectId);
    if (!project) throw new Error(nativeText("native.projectNotFound"));
    const current = project.settings.projectDirectory && typeof project.settings.projectDirectory === "object"
      ? project.settings.projectDirectory as Record<string, unknown> : {};
    const next: Record<string, unknown> = { ...current };
    if (patch.displayName !== undefined) {
      if (typeof patch.displayName !== "string") throw new Error(nativeText("native.displayNameText"));
      const displayName = patch.displayName.trim();
      if (!displayName || displayName.length > 120) throw new Error(nativeText("native.displayNameLength"));
      next.displayName = displayName;
    }
    if (patch.isFavorite !== undefined) {
      if (typeof patch.isFavorite !== "boolean") throw new Error(nativeText("native.favoriteBoolean"));
      next.isFavorite = patch.isFavorite;
    }
    if (patch.isPinned !== undefined) {
      if (typeof patch.isPinned !== "boolean") throw new Error(nativeText("native.pinBoolean"));
      next.isPinned = patch.isPinned;
    }
    if (patch.avatarLetter !== undefined) {
      if (typeof patch.avatarLetter !== "string") throw new Error(nativeText("native.avatarLetterText"));
      const letter = Array.from(patch.avatarLetter.trim());
      const codePoint = letter[0]?.codePointAt(0);
      if (letter.length !== 1 || codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f) throw new Error(nativeText("native.avatarLetterLength"));
      next.avatarLetter = Array.from(letter[0]!.toLocaleUpperCase())[0] ?? "?";
    }
    if (patch.avatarColor !== undefined) {
      if (typeof patch.avatarColor !== "string" || !/^#[\da-f]{6}$/i.test(patch.avatarColor)) throw new Error(nativeText("native.avatarColor"));
      next.avatarColor = patch.avatarColor.toLocaleLowerCase("en-US");
    }
    const updated = { ...project, settings: { ...project.settings, projectDirectory: next } };
    context.registry.update(updated);
    return updated;
  });
  handleIpc(desktopInvoke.projects.removeFromDirectory, async (_event, projectId) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    const result = await context.projects.remove({ projectId, mode: "registryOnly" });
    await context.blockGraph.reclaimProjectCaches(projectId, { kind: "project-removed" });
    return result;
  });
  handleIpc(desktopInvoke.projects.relocateInDirectory, async (_event, projectId, folderPath) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    const previous = context.registry.get(projectId);
    if (!previous) throw new Error(nativeText("native.projectNotFound"));
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
    await context.blockGraph.reclaimProjectCaches(relocated.id, { kind: "project-removed" });
    try { context.registry.update(updated); }
    catch (error) {
      await context.projects.registerExistingFolder(relocated.canonicalPath).catch(() => undefined);
      throw error;
    }
    return updated;
  });
  handleIpc(desktopInvoke.projects.deleteToRecycleBin, async (_event, projectId, confirmedPath) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    const project = context.registry.get(projectId);
    if (!project || project.canonicalPath !== confirmedPath) throw new Error(nativeText("native.pathConfirmationMismatch"));
    if (project.missing || context.environment.isUnsafeDeleteTarget(project.canonicalPath)) throw new Error(nativeText("native.recycleUnsafe"));
    await shell.trashItem(project.canonicalPath);
    await context.projects.remove({ projectId, mode: "registryOnly" });
    await context.blockGraph.reclaimProjectCaches(projectId, { kind: "project-removed" });
    return true;
  });
  handleIpc(desktopInvoke.projects.revealInFileManager, (_event, projectId) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    const project = context.registry.get(projectId);
    if (!project || project.missing) throw new Error(nativeText("native.projectFolderUnavailable"));
    shell.showItemInFolder(project.canonicalPath);
  });
  handleIpc(desktopInvoke.projects.copyProjectPath, (_event, projectId) => {
    if (!context) throw new Error(nativeText("native.contextNotReady"));
    const project = context.registry.get(projectId);
    if (!project) throw new Error(nativeText("native.projectNotFound"));
    clipboard.writeText(project.canonicalPath);
  });
  handleIpc(desktopInvoke.projects.create, async (_event, input) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.projects.createProject(input);
  });
  handleIpc(desktopInvoke.projects.register, async (_event, folderPath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.projects.registerExistingFolder(folderPath);
  });
  handleIpc(desktopInvoke.projects.open, async (_event, projectId) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.projects.openProject(projectId);
  });
  handleIpc(desktopInvoke.files.tree, async (_event, projectId) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.files.listTree(projectId);
  });
  handleIpc(desktopInvoke.files.read, async (_event, projectId, relativePath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.files.readText(projectId, relativePath);
  });
  handleIpc(desktopInvoke.files.write, async (_event, projectId, relativePath, content) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return await context.documents.save(projectId, relativePath, content) as FileWriteResult;
  });
  handleIpc(desktopInvoke.files.readPdf, async (_event, projectId, relativePath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
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
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.files.createFile(projectId, relativePath);
  });
  handleIpc(desktopInvoke.files.createDirectory, async (_event, projectId, relativePath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.files.createDirectory(projectId, relativePath);
  });
  handleIpc(desktopInvoke.files.rename, async (_event, projectId, fromRelativePath, toRelativePath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.documents.mutateEntries(projectId, [fromRelativePath, toRelativePath], () => requireContext().files.renameEntry(projectId, fromRelativePath, toRelativePath));
  });
  handleIpc(desktopInvoke.files.copy, async (_event, projectId, fromRelativePath, toRelativePath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.files.copyEntry(projectId, fromRelativePath, toRelativePath);
  });
  handleIpc(desktopInvoke.files.import, async (_event, projectId, sourcePath, destinationRelativePath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.files.importEntry(projectId, sourcePath, destinationRelativePath);
  });
  handleIpc(desktopInvoke.files.remove, async (_event, projectId, relativePath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.documents.mutateEntries(projectId, [relativePath], () => requireContext().files.removeEntry(projectId, relativePath));
  });
  handleIpc(desktopInvoke.images.pick, async (_event, multiple = false) => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", ...(multiple ? ["multiSelections" as const] : [])], filters: [{ name: nativeText("native.images"), extensions: ["png", "jpg", "jpeg", "webp", "svg", "pdf"] }] });
    return result.canceled ? [] : result.filePaths;
  });
  handleIpc(desktopInvoke.images.import, async (_event, projectId, sourcePaths, directory) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.images.importImages(projectId, sourcePaths, directory);
  });
  handleIpc(desktopInvoke.images.resolve, async (_event, projectId, texPath, requestedPath, graphicPaths) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.images.resolve(projectId, texPath, requestedPath, graphicPaths);
  });
  handleIpc(desktopInvoke.projects.setMainFile, async (_event, projectId, relativePath) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    const updated = await context.projects.setMainFile(projectId, relativePath);
    BrowserWindow.getAllWindows().forEach(window => sendIpc(window.webContents, desktopEvents.toRenderer.projectUpdate, updated));
    return updated;
  });
  handleIpc(desktopInvoke.compile.run, async (_event, projectId, mainFile) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    const preferences = await settings.snapshot(projectId);
    let result: CompileResult;
    try {
      result = await context.compiler.compile({ projectId, engine: preferences.project.engine ?? preferences.global.engine ?? "pdflatex", ...(mainFile === undefined ? {} : { mainFile }) });
    } catch (error) {
      return failedCompilation(mainFile ?? "", error);
    }
    if (result.status !== "succeeded" || result.pdfPath === undefined) return result;
    const pdfDataUrl = `data:application/pdf;base64,${(await readFile(result.pdfArtifactPath ?? result.pdfPath)).toString("base64")}`;
    return { ...result, pdfDataUrl };
  });
  handleIpc(desktopInvoke.compile.readLog, (_event, projectId, compilationId) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    return context.compiler.readLog(projectId, compilationId);
  });
  handleIpc(desktopInvoke.exports.sourceArchive, async (event, projectId, mainFile) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    const project = await context.projects.openProject(projectId);
    const options = {
      title: nativeText("native.exportSource"),
      defaultPath: join(app.getPath("downloads"), `${project.name}-source.zip`),
      filters: [{ name: nativeText("native.zipArchive"), extensions: ["zip"] }]
    };
    const owner = BrowserWindow.fromWebContents(event.sender);
    const choice = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return undefined;
    await createProjectSourceArchive(project.canonicalPath, mainFile ?? project.mainFile, choice.filePath);
    return choice.filePath;
  });
  handleIpc(desktopInvoke.exports.mainTex, async (event, projectId, mainFile) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    if (extname(mainFile).toLowerCase() !== ".tex") throw new Error(nativeText("native.chooseMainFile"));
    const project = await context.projects.openProject(projectId);
    const sourcePath = await context.files.resolveFilePath(projectId, mainFile, true);
    const suggestedName = mainFile.split(/[\\/]/).at(-1) ?? `${project.name}.tex`;
    const options = {
      title: nativeText("native.exportMain"),
      defaultPath: join(app.getPath("downloads"), suggestedName),
      filters: [{ name: nativeText("native.texSource"), extensions: ["tex"] }]
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
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    if (extname(mainFile).toLowerCase() !== ".tex") throw new Error(nativeText("native.chooseMainFile"));
    const project = await context.projects.openProject(projectId);
    await context.files.resolveFilePath(projectId, mainFile, true);
    const texName = mainFile.split(/[\\/]/).at(-1) ?? `${project.name}.tex`;
    const pdfName = texName.replace(/\.tex$/i, ".pdf");
    const options = {
      title: nativeText("native.exportPdf"),
      defaultPath: join(app.getPath("downloads"), pdfName),
      filters: [{ name: nativeText("native.pdfDocument"), extensions: ["pdf"] }]
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
      const message = code === "TOOLCHAIN_NOT_FOUND" ? nativeText("native.toolchainHint") : error instanceof Error ? error.message : String(error);
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
    if (normalizedSource !== normalizedTarget) await copyFile(compilation.pdfArtifactPath ?? compilation.pdfPath, targetPath);
    const pdfDataUrl = `data:application/pdf;base64,${(await readFile(compilation.pdfArtifactPath ?? compilation.pdfPath)).toString("base64")}`;
    return { status: "exported", path: targetPath, compilation, pdfDataUrl };
  });
  registerAiIpcHandlers(context, settings);
  handleIpc(desktopInvoke.synctex.forward, async (_event, projectId, sourceFile, pdfFile, line, column) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    const project = await context.projects.openProject(projectId);
    const [sourcePath, pdfPath] = await Promise.all([context.files.resolveFilePath(projectId, sourceFile, true), context.files.resolveFilePath(projectId, pdfFile, true)]);
    return forwardSync({ root: project.canonicalPath, mainFile: project.mainFile, compilerArguments: context.resources.getCompilerProfile().arguments, sourcePath, pdfPath, line, column, ...(settings.toolchain?.binDirectory ? { binDirectory: settings.toolchain.binDirectory } : {}), ...(settings.toolchain?.latexmk ? { latexmk: settings.toolchain.latexmk } : {}) });
  });
  handleIpc(desktopInvoke.synctex.reverse, async (_event, projectId, pdfFile, page, x, y) => {
    if (context === undefined) throw new Error(nativeText("native.contextNotReady"));
    const project = await context.projects.openProject(projectId);
    const pdfPath = await context.files.resolveFilePath(projectId, pdfFile, true);
    return reverseSync({ root: project.canonicalPath, mainFile: project.mainFile, compilerArguments: context.resources.getCompilerProfile().arguments, pdfPath, page, x, y, ...(settings.toolchain?.binDirectory ? { binDirectory: settings.toolchain.binDirectory } : {}), ...(settings.toolchain?.latexmk ? { latexmk: settings.toolchain.latexmk } : {}) });
  });
  handleIpc(desktopInvoke.dialogs.pickFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  handleIpc(desktopInvoke.dialogs.pickFiles, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: nativeText("native.texResources"), extensions: ["sty", "cls", "bst", "bib", "tex", "cfg", "def", "ltx"] }] });
    return result.canceled ? [] : result.filePaths;
  });
  handleIpc(desktopInvoke.dialogs.pickThemeFiles, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"], filters: [{ name: nativeText("native.cssThemes"), extensions: ["css"] }] });
    return result.canceled ? [] : result.filePaths;
  });
  handleIpc(desktopInvoke.dialogs.pickProjectFiles, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    return result.canceled ? [] : result.filePaths;
  });
  handleIpc(desktopInvoke.dialogs.pickProjectFolders, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "multiSelections", "createDirectory"] });
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
    title: nativeText("native.windowTitle"),
    webPreferences: {
      preload: resolve(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      ...(offscreenTest ? { offscreen: true, backgroundThrottling: false } : {})
    }
  });
  const rendererFile = resolve(__dirname, "../renderer/index.html");
  const rendererTarget = resolveRendererTarget(rendererFile, process.env.TEXWEAVE_RENDERER_URL, app.isPackaged);
  installRendererSecurity(window, rendererTarget, (url) => shell.openExternal(url));
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
  if (rendererTarget.startsWith("file:")) void window.loadFile(rendererFile);
  else void window.loadURL(rendererTarget);
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
    dialog.showErrorBox(nativeText("native.startFailed"), message);
    app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => { quitRequested = true; });
app.on("window-all-closed", () => {
  void (async () => {
    const current = context;
    let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>(resolve => { shutdownTimer = setTimeout(resolve, 5000); });
    // An unresponsive provider must not prevent exit; orphan staging files are cleaned on next startup.
    await Promise.race([Promise.allSettled([current?.ai.stop(), current?.aiWorkspaces.dispose()]), deadline]);
    clearTimeout(shutdownTimer);
    try { await current?.blockGraph.reclaimAllProjectCaches({ kind: "shutdown" }); }
    catch (error) { console.warn("Unable to release every project cache during shutdown", error); }
    current?.registry.close();
    current?.references.close();
    if (process.platform !== "darwin") app.quit();
  })();
});
