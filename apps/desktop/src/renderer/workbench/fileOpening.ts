import type { Project } from "@latex-editor/contracts";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { EditorTab } from "./fileActions.js";

interface FileOpeningOptions {
  api: Window["latexEditor"];
  project: Project;
  activePathRef: MutableRefObject<string | undefined>;
  tabsRef: MutableRefObject<EditorTab[]>;
  openingFilesRef: MutableRefObject<Map<string, Promise<void>>>;
  sequenceRef: MutableRefObject<number>;
  savedContents: MutableRefObject<Map<string, string>>;
  setAiDiffFile: Dispatch<SetStateAction<{ id: string; path: string } | undefined>>;
  setActivePath: Dispatch<SetStateAction<string | undefined>>;
  setTabs: Dispatch<SetStateAction<EditorTab[]>>;
  rememberPreviewPosition(): void;
}

export function createFileOpeningController(options: FileOpeningOptions) {
  const openFile = async (path: string) => {
    if (path !== options.activePathRef.current) options.rememberPreviewPosition();
    const sequence = ++options.sequenceRef.current;
    options.setAiDiffFile(undefined);
    const existing = options.tabsRef.current.find((tab) => tab.path === path);
    if (existing) {
      if (sequence === options.sequenceRef.current) options.setActivePath(path);
      return;
    }
    if (!options.api) return;
    const opening = options.openingFilesRef.current.get(path);
    if (opening) {
      await opening;
      if (sequence === options.sequenceRef.current && options.tabsRef.current.some((tab) => tab.path === path)) options.setActivePath(path);
      return;
    }
    const pending = (async () => {
      try {
        const file = await options.api!.files.read(options.project.id, path);
        if (!options.tabsRef.current.some((tab) => tab.path === path)) {
          const nextTabs = [...options.tabsRef.current, { path, content: file.content, dirty: false }];
          options.tabsRef.current = nextTabs;
          options.savedContents.current.set(path, file.content);
          options.setTabs(nextTabs);
        }
      } catch { /* Binary and unsupported files stay unopened until dedicated viewers exist. */ }
    })();
    options.openingFilesRef.current.set(path, pending);
    try {
      await pending;
      if (sequence === options.sequenceRef.current && options.tabsRef.current.some((tab) => tab.path === path)) options.setActivePath(path);
    } finally {
      if (options.openingFilesRef.current.get(path) === pending) options.openingFilesRef.current.delete(path);
    }
  };
  return { openFile };
}
