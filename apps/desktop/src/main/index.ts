import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CommandMetadata, CompileResult, CompileInput, GraphTraversalOptions, PreferenceKey, SemanticBlock, CreateSemanticBlockInput, UpdateSemanticBlockInput } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { ProjectBlockGraphService } from "@latex-editor/application" with { "resolution-mode": "import" };
import { SettingsRepository } from "./settings.js";
import { StyleResourceRepository } from "./style-resources.js";
import { ThemeRepository } from "./themes.js";
import { OfflineSpellCheckService } from "./spellcheck.js";
import { forwardSync, reverseSync } from "./synctex.js";

interface DesktopContext {
  registry: { initialize(): void; close(): void };
  projects: {
    listProjects(): Promise<unknown>;
    createProject(input: { name: string; parentPath: string; styleResourceIds?: string[] }): Promise<unknown>;
    registerExistingFolder(folderPath: string): Promise<unknown>;
    openProject(projectId: string): Promise<unknown>;
    setMainFile(projectId: string, relativePath: string): Promise<unknown>;
  };
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
  compiler: { compile(input: CompileInput): Promise<CompileResult> };
  resources: { searchCommands(query: string): CommandMetadata[] };
  blockGraph: ProjectBlockGraphService;
  styleResources: StyleResourceRepository;
  themes: ThemeRepository;
  spellcheck: OfflineSpellCheckService;
}

let context: DesktopContext | undefined;
let settings: SettingsRepository;


async function createContext(): Promise<DesktopContext> {
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
  // Development build lives under apps/desktop/dist/main; packaged builds can later override this path.
  const resources = new FileResourceCatalog(resolve(__dirname, "../../../..", "resources"));
  const styleResources = new StyleResourceRepository(resolve(__dirname, "../../../..", "resources"), app.getPath("userData"));
  await styleResources.initialize();
  const themes = new ThemeRepository(resolve(__dirname, "../../../..", "resources"), resolve(__dirname, "../../../..", "themes"));
  await themes.initialize();
  const projects = new ProjectService({
    registry,
    environment: new NodeProjectEnvironment(),
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
  const profiles = { getCompilerProfile: () => ({ ...resources.getCompilerProfile(), ...(settings.toolchain?.latexmk ? { executable: settings.toolchain.latexmk } : {}) }) };
  const compiler = new LatexmkCompilerService({ projects, files, profiles, clock: systemClock });
  const spellcheck = new OfflineSpellCheckService();
  await spellcheck.initialize();
  spellcheck.configure(settings.global.spellCheckMode ?? "auto", settings.global.spellCheckLanguage ?? "en-US");
  return { registry, projects, files, compiler, resources, blockGraph, styleResources, themes, spellcheck };
}

function registerIpcHandlers(): void {
  ipcMain.handle("settings:get", (_event, projectId?: string) => settings.snapshot(projectId));
  ipcMain.handle("settings:set", async (_event, key: PreferenceKey, value: unknown, projectId?: string) => {
    const snapshot = await settings.set(key, value, projectId);
    if (key === "themeDirectory" && projectId === undefined && context) await context.themes.setDirectory(typeof value === "string" ? value : "");
    return snapshot;
  });
  ipcMain.handle("resources:commands", (_event, query: string) => context?.resources.searchCommands(query) ?? []);
  ipcMain.handle("block-graph:snapshot", (_event, projectId: string) => context?.blockGraph.snapshot(projectId));
  ipcMain.handle("block-graph:create-block", (_event, projectId: string, input: CreateSemanticBlockInput) => context?.blockGraph.createBlock(projectId, input));
  ipcMain.handle("block-graph:add-block", (_event, projectId: string, block: SemanticBlock) => context?.blockGraph.addBlock(projectId, block));
  ipcMain.handle("block-graph:update-block", (_event, projectId: string, blockId: string, patch: UpdateSemanticBlockInput) => context?.blockGraph.updateBlock(projectId, blockId, patch));
  ipcMain.handle("block-graph:remove-block", (_event, projectId: string, blockId: string) => context?.blockGraph.removeBlock(projectId, blockId));
  ipcMain.handle("block-graph:add-dependency", (_event, projectId: string, prerequisite: string, consequence: string) => context?.blockGraph.addDependency(projectId, prerequisite, consequence));
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
  ipcMain.handle("block-graph:validate", (_event, projectId: string) => context?.blockGraph.validate(projectId));
  ipcMain.handle("spellcheck:status", () => context?.spellcheck.status());
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
    return detected;
  });
  ipcMain.handle("projects:list", async () => context?.projects.listProjects() ?? []);
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
  context?.registry.close();
  if (process.platform !== "darwin") app.quit();
});
