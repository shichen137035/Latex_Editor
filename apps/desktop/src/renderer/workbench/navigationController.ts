import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Project, SyncTexPdfPosition } from "@latex-editor/contracts";
import type { OnMount } from "@monaco-editor/react";
import { navigationLocationValid, type NavigationHistory, type NavigationLocation } from "./NavigationHistory.js";
import { sourceOffsetAtLine, type PaneType, type PersistedLayout } from "./layout.js";

export interface NavigationRequest {
  path: string;
  offset?: number | undefined;
  line?: number | undefined;
  column?: number | undefined;
  nonce: number;
}

interface OpenEditorTab { path: string; content: string }
type SavedPosition = { offset: number; scrollTop: number };

export interface NavigationControllerOptions {
  project: Project;
  api: Window["latexEditor"];
  pdfFile: string | undefined;
  layout: PersistedLayout;
  setLayout: Dispatch<SetStateAction<PersistedLayout>>;
  activePathRef: MutableRefObject<string | undefined>;
  tabsRef: MutableRefObject<OpenEditorTab[]>;
  editorRef: MutableRefObject<Parameters<OnMount>[0] | null>;
  sourceModelPath: MutableRefObject<string | undefined>;
  lastTextPane: MutableRefObject<"source" | "preview">;
  sourcePositions: MutableRefObject<Map<string, SavedPosition>>;
  previewPositions: MutableRefObject<Map<string, SavedPosition>>;
  previewViewportAnchor: MutableRefObject<{ fileId: string; offset: number } | undefined>;
  navigationHistory: MutableRefObject<NavigationHistory>;
  navigationNonce: MutableRefObject<number>;
  setNavigationRequest: Dispatch<SetStateAction<NavigationRequest | undefined>>;
  setPdfTarget(target: (SyncTexPdfPosition & { requestId: number }) | undefined): void;
  openFile(path: string): Promise<void>;
}

export function createNavigationController(options: NavigationControllerOptions) {
  const currentNavigationOrigin = (offset?: number): NavigationLocation | undefined => {
    const path = options.activePathRef.current;
    if (!path) return undefined;
    const pane = options.layout.mode === "split" ? options.layout.leftPane : options.layout.singlePane === "pdf" ? options.lastTextPane.current : options.layout.singlePane;
    const editor = options.editorRef.current;
    const sourceOffset = pane === "source" && options.sourceModelPath.current === path && editor?.getModel() && editor.getPosition()
      ? editor.getModel()!.getOffsetAt(editor.getPosition()!) : options.sourcePositions.current.get(path)?.offset;
    const previewOffset = options.previewViewportAnchor.current?.fileId === path ? options.previewViewportAnchor.current.offset : options.previewPositions.current.get(path)?.offset;
    return {
      path,
      offset: Math.max(0, offset ?? (pane === "source" ? sourceOffset : previewOffset) ?? 0),
      layout: { mode: options.layout.mode, singlePane: options.layout.mode === "single" ? pane : options.layout.singlePane, leftPane: options.layout.leftPane, rightPane: options.layout.rightPane }
    };
  };

  const validNavigationLocation = (location: NavigationLocation): boolean => navigationLocationValid(location, options.tabsRef.current.find((tab) => tab.path === location.path)?.content);

  const navigateTo = async (path: string, position: { offset?: number | undefined; line?: number | undefined; column?: number | undefined } = {}, view: "preserve" | "source" = "preserve", recordHistory = true) => {
    const origin = recordHistory && (path !== options.activePathRef.current || position.offset !== undefined || position.line !== undefined) ? currentNavigationOrigin() : undefined;
    const targetLayout: NavigationLocation["layout"] = {
      mode: options.layout.mode, singlePane: view === "source" ? "source" : options.layout.mode === "single" && options.layout.singlePane === "pdf" ? options.lastTextPane.current : options.layout.singlePane,
      leftPane: view === "source" ? "source" : options.layout.leftPane, rightPane: options.layout.rightPane
    };
    if (view === "source") options.setLayout((value) => value.mode === "single" ? { ...value, singlePane: "source" } : { ...value, leftPane: "source" });
    else options.setLayout((value) => value.mode === "single" && value.singlePane === "pdf" ? { ...value, singlePane: options.lastTextPane.current } : value);
    if (position.offset !== undefined || position.line !== undefined) {
      options.setNavigationRequest({ path, ...position, nonce: ++options.navigationNonce.current });
    } else options.setNavigationRequest(undefined);
    if (path !== options.activePathRef.current) await options.openFile(path);
    const targetContent = options.tabsRef.current.find((tab) => tab.path === path)?.content;
    if (origin && targetContent !== undefined) {
      const targetPane: PaneType = targetLayout.mode === "single" ? targetLayout.singlePane : targetLayout.leftPane;
      const targetOffset = position.offset ?? (position.line !== undefined ? sourceOffsetAtLine(targetContent, position.line, position.column)
        : targetPane === "source" ? options.sourcePositions.current.get(path)?.offset : options.previewPositions.current.get(path)?.offset) ?? 0;
      options.navigationHistory.current.record(origin, { path, offset: Math.max(0, Math.min(targetOffset, targetContent.length)), layout: targetLayout });
    }
  };

  const restoreNavigationLocation = async (location: NavigationLocation) => {
    options.setLayout((value) => ({ ...value, ...location.layout }));
    options.setNavigationRequest({ path: location.path, offset: location.offset, nonce: ++options.navigationNonce.current });
    if (location.path !== options.activePathRef.current) await options.openFile(location.path);
  };

  const navigateBack = async () => {
    const location = options.navigationHistory.current.back(validNavigationLocation);
    if (location) await restoreNavigationLocation(location);
  };
  const navigateForward = async () => {
    const location = options.navigationHistory.current.forward(validNavigationLocation);
    if (location) await restoreNavigationLocation(location);
  };

  const forwardSyncToPdf = async (path: string, line: number, column = 1) => {
    if (!options.api || !options.pdfFile || !path.toLocaleLowerCase().endsWith(".tex")) return;
    try {
      const target = await options.api.synctex.forward(options.project.id, path, options.pdfFile, line, column);
      options.setPdfTarget({ ...target, requestId: Date.now() });
      options.setLayout((value) => value.mode === "split" ? { ...value, rightPane: "pdf" } : { ...value, singlePane: "pdf" });
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const reverseSyncFromPdf = async (page: number, x: number, y: number) => {
    if (!options.api || !options.pdfFile) return;
    try {
      const target = await options.api.synctex.reverse(options.project.id, options.pdfFile, page, x, y);
      const pane = options.lastTextPane.current;
      options.setLayout((value) => value.mode === "split" ? { ...value, leftPane: pane } : { ...value, singlePane: pane });
      await navigateTo(target.file, { line: target.line, column: target.column });
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  return { currentNavigationOrigin, navigateTo, navigateBack, navigateForward, forwardSyncToPdf, reverseSyncFromPdf };
}
