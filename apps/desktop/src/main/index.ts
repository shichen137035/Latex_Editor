import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CompileResult, CompileInput, PreferenceKey } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import { SettingsRepository } from "./settings.js";

interface DesktopContext {
  registry: { initialize(): void; close(): void };
  projects: {
    listProjects(): Promise<unknown>;
    createProject(input: { name: string; parentPath: string }): Promise<unknown>;
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
}

let context: DesktopContext | undefined;
let settings: SettingsRepository;

async function createContext(): Promise<DesktopContext> {
  // Backend packages are ESM; dynamic import keeps this Electron entry CommonJS-compatible.
  const [{ ProjectService }, { systemClock }, { NodeProjectEnvironment, NodeProjectFileService }, { SQLiteProjectRegistry }, { FileResourceCatalog }, { LatexmkCompilerService }] = await Promise.all([
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
  const projects = new ProjectService({
    registry,
    environment: new NodeProjectEnvironment(),
    templates: resources,
    clock: systemClock,
    ids: { next: randomUUID }
  });
  // Resource loading is completed before the first project action is accepted.
  await resources.reload();
  const files = new NodeProjectFileService(projects);
  settings = new SettingsRepository(app.getPath("userData"), async (id) => files.resolveFilePath(id, ".texweave/settings.json", false));
  await settings.initialize();
  const { discoverToolchain } = await import("@latex-editor/compiler-latexmk");
  let detected = await discoverToolchain(settings.toolchain?.latexmk ?? settings.toolchain?.binDirectory);
  if (!detected.available) detected = await discoverToolchain();
  await settings.saveToolchain(detected);
  const profiles = { getCompilerProfile: () => ({ ...resources.getCompilerProfile(), ...(settings.toolchain?.latexmk ? { executable: settings.toolchain.latexmk } : {}) }) };
  const compiler = new LatexmkCompilerService({ projects, files, profiles, clock: systemClock });
  return { registry, projects, files, compiler };
}

function registerIpcHandlers(): void {
  ipcMain.handle("settings:get", (_event, projectId?: string) => settings.snapshot(projectId));
  ipcMain.handle("settings:set", (_event, key: PreferenceKey, value: unknown, projectId?: string) => settings.set(key, value, projectId));
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
  ipcMain.handle("dialogs:pick-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
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
