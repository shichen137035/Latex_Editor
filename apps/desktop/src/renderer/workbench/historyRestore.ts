import type { BlockGraphSnapshot, Project, ProjectTreeNode } from "@latex-editor/contracts";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { CompletionController } from "../completion/CompletionController.js";
import { settings } from "../settings/service.js";
import type { EditHistory } from "./EditHistory.js";
import { projectFilePaths } from "./layout.js";
import type { NavigationHistory } from "./NavigationHistory.js";
import type { NavigationRequest } from "./navigationController.js";
import type { EditorTab } from "./fileActions.js";

interface HistoryRestoreOptions {
  api: Window["latexEditor"];
  project: Project;
  tabsRef: MutableRefObject<EditorTab[]>;
  savedContents: MutableRefObject<Map<string, string>>;
  activePathRef: MutableRefObject<string | undefined>;
  sourcePositions: MutableRefObject<Map<string, { offset: number; scrollTop: number }>>;
  previewPositions: MutableRefObject<Map<string, { offset: number; scrollTop: number }>>;
  sourceRestoredFor: MutableRefObject<string | undefined>;
  completionController: MutableRefObject<CompletionController | null>;
  navigationHistory: MutableRefObject<NavigationHistory>;
  editHistory: MutableRefObject<EditHistory>;
  setTabs: Dispatch<SetStateAction<EditorTab[]>>;
  setTree: Dispatch<SetStateAction<ProjectTreeNode[]>>;
  setActivePath: Dispatch<SetStateAction<string | undefined>>;
  setSaveState: Dispatch<SetStateAction<"saved" | "unsaved" | "saving" | "failed">>;
  setNavigationRequest: Dispatch<SetStateAction<NavigationRequest | undefined>>;
  setBlockSnapshot: Dispatch<SetStateAction<BlockGraphSnapshot | undefined>>;
}

export function createHistoryRestoreHandler(options: HistoryRestoreOptions) {
  return async (restored: string[]) => {
    if (!options.api) return;
    const nextTree = await options.api.files.tree(options.project.id);
    const available = new Set(projectFilePaths(nextTree));
    const nextTabs = (await Promise.all(options.tabsRef.current.filter((tab) => available.has(tab.path)).map(async (tab) => {
      try { return { path: tab.path, content: (await options.api!.files.read(options.project.id, tab.path)).content, dirty: false }; }
      catch { return undefined; }
    }))).filter((tab): tab is EditorTab => tab !== undefined);
    options.tabsRef.current = nextTabs;
    options.setTabs(nextTabs);
    options.savedContents.current = new Map(nextTabs.map((tab) => [tab.path, tab.content]));
    options.setTree(nextTree);
    if (options.activePathRef.current && !nextTabs.some((tab) => tab.path === options.activePathRef.current)) options.setActivePath(nextTabs.at(-1)?.path);
    options.setSaveState("saved");
    options.setNavigationRequest(undefined);
    options.navigationHistory.current.clear();
    options.editHistory.current.clear();
    for (const path of restored) {
      options.sourcePositions.current.delete(path);
      options.previewPositions.current.delete(path);
    }
    options.sourceRestoredFor.current = undefined;
    options.completionController.current?.invalidate();
    options.setBlockSnapshot(await options.api.blockGraph.snapshot(options.project.id));
    await settings.load(options.project.id);
  };
}
