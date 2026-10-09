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
  canSync?(): boolean;
  reportSyncError?(message: string): void;
  project: Project;
  api: Window["latexEditor"];
  pdfFile: string | undefined;
  layout: PersistedLayout;
  layoutRef?: MutableRefObject<PersistedLayout>;
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
  fileOpenSequence: MutableRefObject<number>;
  setNavigationRequest: Dispatch<SetStateAction<NavigationRequest | undefined>>;
  setPdfTarget(target: (SyncTexPdfPosition & { requestId: number }) | undefined): void;
  openFile(path: string): Promise<void>;
  prepareNavigation?(): boolean;
}

export function createNavigationController(options: NavigationControllerOptions) {
  const reportError = (error: unknown, nonce: number, sequence: number) => {
    if (nonce !== options.navigationNonce.current || sequence !== options.fileOpenSequence.current) return;
    const message = error instanceof Error ? error.message : String(error);
    if (options.reportSyncError) options.reportSyncError(message);
    else window.alert(message);
  };
  const currentNavigationOrigin = (offset?: number): NavigationLocation | undefined => {
    const path = options.activePathRef.current;
    if (!path) return undefined;
    const layout = options.layoutRef?.current ?? options.layout;
    const pane = layout.mode === "split" ? layout.leftPane : layout.singlePane === "pdf" ? options.lastTextPane.current : layout.singlePane;
    const editor = options.editorRef.current;
    const sourceOffset = pane === "source" && options.sourceModelPath.current === path && editor?.getModel() && editor.getPosition()
      ? editor.getModel()!.getOffsetAt(editor.getPosition()!) : options.sourcePositions.current.get(path)?.offset;
    const previewOffset = options.previewViewportAnchor.current?.fileId === path ? options.previewViewportAnchor.current.offset : options.previewPositions.current.get(path)?.offset;
    return {
      path,
      offset: Math.max(0, offset ?? (pane === "source" ? sourceOffset : previewOffset) ?? 0),
      layout: { mode: layout.mode, singlePane: layout.mode === "single" ? pane : layout.singlePane, leftPane: layout.leftPane, rightPane: layout.rightPane }
    };
  };

  const validNavigationLocation = (location: NavigationLocation): boolean => navigationLocationValid(location, options.tabsRef.current.find((tab) => tab.path === location.path)?.content);

  const openNavigationTarget = async (path: string, position: { offset?: number | undefined; line?: number | undefined; column?: number | undefined }, view: "preserve" | "source" | "preview", restoredLayout?: NavigationLocation["layout"]): Promise<NavigationLocation["layout"] | undefined> => {
    const nonce = ++options.navigationNonce.current;
    options.setNavigationRequest(position.offset !== undefined || position.line !== undefined ? { path, ...position, nonce } : undefined);
    const opening = path !== options.activePathRef.current ? options.openFile(path) : undefined;
    const sequence = options.fileOpenSequence.current;
    await opening;
    // Opening files, selecting tabs, and closing tabs all invalidate older work.
    if (nonce !== options.navigationNonce.current || sequence !== options.fileOpenSequence.current) return undefined;
    if (!options.tabsRef.current.some((tab) => tab.path === path)) {
      options.setNavigationRequest((current) => current?.nonce === nonce ? undefined : current);
      return undefined;
    }
    // The user may switch Code/Visual while a file is being read. Preserve
    // their latest layout rather than the render captured before that read.
    const layout = options.layoutRef?.current ?? options.layout;
    const targetLayout = restoredLayout ?? {
      mode: layout.mode, singlePane: view !== "preserve" ? view : layout.mode === "single" && layout.singlePane === "pdf" ? options.lastTextPane.current : layout.singlePane,
      leftPane: view !== "preserve" ? view : layout.leftPane, rightPane: layout.rightPane
    };
    options.setLayout((value) => ({ ...value, ...targetLayout }));
    return targetLayout;
  };

  const navigateTo = async (path: string, position: { offset?: number | undefined; line?: number | undefined; column?: number | undefined } = {}, view: "preserve" | "source" | "preview" = "preserve", recordHistory = true) => {
    if (options.prepareNavigation?.() === false) return;
    const origin = recordHistory && (path !== options.activePathRef.current || position.offset !== undefined || position.line !== undefined) ? currentNavigationOrigin() : undefined;
    const targetLayout = await openNavigationTarget(path, position, view);
    if (!targetLayout) return;
    const targetContent = options.tabsRef.current.find((tab) => tab.path === path)?.content;
    if (origin && targetContent !== undefined) {
      const targetPane: PaneType = targetLayout.mode === "single" ? targetLayout.singlePane : targetLayout.leftPane;
      const targetOffset = position.offset ?? (position.line !== undefined ? sourceOffsetAtLine(targetContent, position.line, position.column)
        : targetPane === "source" ? options.sourcePositions.current.get(path)?.offset : options.previewPositions.current.get(path)?.offset) ?? 0;
      options.navigationHistory.current.record(origin, { path, offset: Math.max(0, Math.min(targetOffset, targetContent.length)), layout: targetLayout });
    }
  };

  const restoreNavigationLocation = async (location: NavigationLocation) => {
    await openNavigationTarget(location.path, { offset: location.offset }, "preserve", location.layout);
  };

  const navigateBack = async () => {
    if (!options.navigationHistory.current.canBack) return;
    if (options.prepareNavigation?.() === false) return;
    const location = options.navigationHistory.current.back(validNavigationLocation);
    if (location) await restoreNavigationLocation(location);
  };
  const navigateForward = async () => {
    if (!options.navigationHistory.current.canForward) return;
    if (options.prepareNavigation?.() === false) return;
    const location = options.navigationHistory.current.forward(validNavigationLocation);
    if (location) await restoreNavigationLocation(location);
  };

  const forwardSyncToPdf = async (path: string, line: number, column = 1) => {
    if (options.canSync?.() === false) return;
    if (!options.api || !options.pdfFile || !path.toLocaleLowerCase().endsWith(".tex")) return;
    const nonce = ++options.navigationNonce.current, sequence = options.fileOpenSequence.current;
    options.setNavigationRequest(undefined);
    try {
      const target = await options.api.synctex.forward(options.project.id, path, options.pdfFile, line, column);
      if (nonce !== options.navigationNonce.current || sequence !== options.fileOpenSequence.current) return;
      options.setPdfTarget({ ...target, requestId: Date.now() });
      options.setLayout((value) => value.mode === "split" ? { ...value, rightPane: "pdf" } : { ...value, singlePane: "pdf" });
    } catch (error) { reportError(error, nonce, sequence); }
  };

  const reverseSyncFromPdf = async (page: number, x: number, y: number) => {
    if (options.canSync?.() === false) return;
    if (!options.api || !options.pdfFile) return;
    const nonce = ++options.navigationNonce.current, sequence = options.fileOpenSequence.current;
    options.setNavigationRequest(undefined);
    try {
      const target = await options.api.synctex.reverse(options.project.id, options.pdfFile, page, x, y);
      if (nonce !== options.navigationNonce.current || sequence !== options.fileOpenSequence.current) return;
      const pane = options.lastTextPane.current;
      await navigateTo(target.file, { line: target.line, column: target.column }, pane);
    } catch (error) { reportError(error, nonce, sequence); }
  };

  return { currentNavigationOrigin, navigateTo, navigateBack, navigateForward, forwardSyncToPdf, reverseSyncFromPdf };
}
