import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Project, ProjectTreeNode } from "@latex-editor/contracts";
import { settings } from "../settings/service.js";
import { t } from "../i18n/index.js";
import type { EditHistory } from "./EditHistory.js";
import type { NavigationHistory } from "./NavigationHistory.js";
import type { FileContext, WorkbenchMenuItem } from "./WorkbenchComponents.js";
import type { PersistedLayout } from "./layout.js";

export interface EditorTab { path: string; content: string; dirty: boolean }
export interface EntryNameRequest { message: string; fallback: string; resolve(value?: string): void }
export interface DeleteEntryRequest { path: string; resolve(value: boolean): void }

export function projectPathJoin(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function pathParent(path: string): string {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

interface WorkbenchFileActionsOptions {
  api: Window["latexEditor"];
  project: Project;
  fileContext: FileContext | undefined;
  activePath: string | undefined;
  tabsRef: MutableRefObject<EditorTab[]>;
  savedContents: MutableRefObject<Map<string, string>>;
  editHistory: MutableRefObject<EditHistory>;
  navigationHistory: MutableRefObject<NavigationHistory>;
  setTabs: Dispatch<SetStateAction<EditorTab[]>>;
  setActivePath: Dispatch<SetStateAction<string | undefined>>;
  setLayout: Dispatch<SetStateAction<PersistedLayout>>;
  importingProjectEntries: boolean;
  setImportingProjectEntries(value: boolean): void;
  setNameRequest: Dispatch<SetStateAction<EntryNameRequest | undefined>>;
  setDeleteRequest: Dispatch<SetStateAction<DeleteEntryRequest | undefined>>;
  refreshTree(): Promise<ProjectTreeNode[] | undefined>;
  openFile(path: string): Promise<void>;
  onSwitch(project: Project): void;
}

export function createWorkbenchFileActions(options: WorkbenchFileActionsOptions) {
  const promptEntryName = (message: string, fallback: string) => new Promise<string | undefined>((resolve) => {
    options.setNameRequest({ message, fallback, resolve });
  });

  const updateMovedEntryReferences = async (from: string, to: string) => {
    options.navigationHistory.current.clear();
    const movedPath = (path: string) => path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
    options.editHistory.current.renameFile(from, to);
    options.savedContents.current = new Map([...options.savedContents.current].map(([path, content]) => [movedPath(path), content]));
    options.setTabs((current) => current.map((tab) => ({ ...tab, path: movedPath(tab.path) })));
    options.setActivePath((value) => value ? movedPath(value) : value);
    const nextMainFile = options.project.mainFile ? movedPath(options.project.mainFile) : undefined;
    if (options.api && options.project.mainFile && nextMainFile && nextMainFile !== options.project.mainFile && nextMainFile.toLocaleLowerCase().endsWith(".tex")) {
      options.onSwitch(await options.api.projects.setMainFile(options.project.id, nextMainFile));
    }
  };

  const createEntry = async (directory: boolean, forcedParent?: string) => {
    if (!options.api) return;
    const parent = forcedParent ?? (options.fileContext?.path && options.fileContext.kind === "directory" ? options.fileContext.path : "");
    const name = await promptEntryName(directory ? t("files.newFolderPrompt") : t("files.newFilePrompt"), directory ? t("files.newFolderDefault") : t("files.newFileDefault"));
    if (!name) return;
    try {
      if (directory) await options.api.files.createDirectory(options.project.id, projectPathJoin(parent, name));
      else await options.api.files.createFile(options.project.id, projectPathJoin(parent, name));
      await options.refreshTree();
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const moveEntry = async (sourcePath: string, destinationDirectory: string) => {
    if (!options.api || !options.project.writable) return;
    const name = sourcePath.split("/").at(-1);
    if (!name || destinationDirectory === sourcePath || destinationDirectory.startsWith(`${sourcePath}/`)) return;
    const destinationPath = projectPathJoin(destinationDirectory, name);
    if (destinationPath === sourcePath) return;
    try {
      await options.api.files.rename(options.project.id, sourcePath, destinationPath);
      await updateMovedEntryReferences(sourcePath, destinationPath);
      await options.refreshTree();
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const importFromComputer = async (kind: "file" | "folder") => {
    if (!options.api || options.importingProjectEntries || !options.project.writable) return;
    options.setImportingProjectEntries(true);
    let importAttempted = false;
    try {
      const sourcePaths = kind === "file" ? await options.api.dialogs.pickProjectFiles() : await options.api.dialogs.pickProjectFolders();
      if (!sourcePaths.length) return;
      options.navigationHistory.current.clear();
      const currentTree = await options.refreshTree();
      if (!currentTree) return;
      const names = new Set(currentTree.map((node) => node.name.normalize("NFC").toLocaleLowerCase("en-US")));
      const destinations = sourcePaths.map((sourcePath) => sourcePath.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) ?? "");
      for (const name of destinations) {
        const key = name.normalize("NFC").toLocaleLowerCase("en-US");
        if (!name || names.has(key)) throw new Error(t("files.importConflict", { name }));
        names.add(key);
      }
      for (const [index, sourcePath] of sourcePaths.entries()) {
        const destination = destinations[index];
        if (!destination) continue;
        importAttempted = true;
        await options.api.files.import(options.project.id, sourcePath, destination);
      }
      await options.refreshTree();
      if (kind === "file" && sourcePaths.length === 1 && destinations[0]) {
        options.setLayout((value) => value.mode === "single" ? { ...value, singlePane: "source" } : { ...value, leftPane: "source" });
        await options.openFile(destinations[0]);
      }
    } catch (error) {
      if (importAttempted) await options.refreshTree().catch(() => undefined);
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      options.setImportingProjectEntries(false);
    }
  };

  const renameEntry = async () => {
    if (!options.api || !options.fileContext?.path) return;
    const currentPath = options.fileContext.path;
    const oldName = currentPath.split("/").at(-1) ?? currentPath;
    const newName = await promptEntryName(t("files.renamePrompt"), oldName);
    if (!newName || newName === oldName) return;
    try {
      const nextPath = projectPathJoin(pathParent(currentPath), newName);
      await options.api.files.rename(options.project.id, currentPath, nextPath);
      await updateMovedEntryReferences(currentPath, nextPath);
      await options.refreshTree();
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const copyEntry = async () => {
    if (!options.api || !options.fileContext?.path || options.fileContext.kind !== "file") return;
    const oldName = options.fileContext.path.split("/").at(-1) ?? options.fileContext.path;
    const dot = oldName.lastIndexOf(".");
    const fallback = dot > 0 ? `${oldName.slice(0, dot)} copy${oldName.slice(dot)}` : `${oldName} copy`;
    const newName = await promptEntryName(t("files.copyPrompt"), fallback);
    if (!newName) return;
    try {
      await options.api.files.copy(options.project.id, options.fileContext.path, projectPathJoin(pathParent(options.fileContext.path), newName));
      await options.refreshTree();
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const removeEntry = async () => {
    if (!options.api || !options.fileContext?.path) return;
    const removedPath = options.fileContext.path;
    const confirmed = await new Promise<boolean>((resolve) => options.setDeleteRequest({ path: removedPath, resolve }));
    if (!confirmed) return;
    try {
      if (settings.get("history").beforeLargeDelete) {
        await options.api.history.snapshot(options.project.id, "pre-delete", removedPath,
          options.tabsRef.current.filter((tab) => tab.dirty).map(({ path, content }) => ({ path, content })));
      }
      await options.api.files.remove(options.project.id, removedPath);
      options.navigationHistory.current.clear();
      options.editHistory.current.forgetFile(removedPath);
      options.setTabs((current) => current.filter((tab) => tab.path !== removedPath && !tab.path.startsWith(`${removedPath}/`)));
      if (options.activePath === removedPath || options.activePath?.startsWith(`${removedPath}/`)) options.setActivePath(undefined);
      await options.refreshTree();
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const setAsMainFile = async () => {
    if (!options.api || !options.fileContext?.path || options.fileContext.kind !== "file" || !options.fileContext.path.toLocaleLowerCase().endsWith(".tex")) return;
    try { options.onSwitch(await options.api.projects.setMainFile(options.project.id, options.fileContext.path)); }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const fileContextItems = (): WorkbenchMenuItem[] => {
    const hasEntry = Boolean(options.fileContext?.path);
    const isFile = options.fileContext?.kind === "file";
    const isTex = isFile && options.fileContext?.path?.toLocaleLowerCase().endsWith(".tex");
    if (!hasEntry) return [
      { label: t("files.newFile"), action: () => void createEntry(false) },
      { label: t("files.newFolder"), action: () => void createEntry(true) }
    ];
    if (!isFile) return [
      { label: t("files.rename"), action: () => void renameEntry() },
      { label: t("files.newFile"), action: () => void createEntry(false) },
      { label: t("files.newFolder"), action: () => void createEntry(true) },
      { label: t("files.delete"), action: () => void removeEntry() }
    ];
    return [
      { label: t("files.setMainFile"), disabled: !isTex, action: () => void setAsMainFile() },
      { label: t("files.delete"), action: () => void removeEntry() },
      { label: t("files.rename"), action: () => void renameEntry() },
      { label: t("files.copy"), action: () => void copyEntry() }
    ];
  };

  return { createEntry, moveEntry, importFromComputer, fileContextItems };
}
