import { useEffect, useLayoutEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { OnMount } from "@monaco-editor/react";
import type { SearchResponse, SearchResult } from "../search/types.js";
import { sourcePositionAtOffset } from "./layout.js";
import type { NavigationRequest } from "./navigationController.js";
import { SourceModelContentGuard } from "../editor/SourceModelContentGuard.js";

interface EditorStateEffectsOptions {
  editorRef: MutableRefObject<Parameters<OnMount>[0] | null>;
  sourceRestoredFor: MutableRefObject<string | undefined>;
  sourceModelPath: MutableRefObject<string | undefined>;
  sourcePositions: MutableRefObject<Map<string, { offset: number; scrollTop: number }>>;
  pendingVisualToCodeAnchor: MutableRefObject<{ fileId: string; offset: number } | undefined>;
  searchDecorationsRef: MutableRefObject<ReturnType<Parameters<OnMount>[0]["createDecorationsCollection"]> | null>;
  aiFileNavigationRef: MutableRefObject<(path: string, line?: number) => void>;
  sourceEditorVisible: boolean;
  activePath: string | undefined;
  activeTab: { path: string; content: string } | undefined;
  navigationRequest: NavigationRequest | undefined;
  editorMountVersion: number;
  searchResponse: SearchResponse;
  activeSearchResult: SearchResult | undefined;
  setNavigationRequest: Dispatch<SetStateAction<NavigationRequest | undefined>>;
}

export function useEditorStateEffects(options: EditorStateEffectsOptions): void {
  const contentGuard = useRef(new SourceModelContentGuard());
  useLayoutEffect(() => {
    if (!options.sourceEditorVisible || options.sourceModelPath.current !== options.activePath) options.sourceModelPath.current = undefined;
  }, [options.sourceEditorVisible, options.activePath]);
  useEffect(() => {
    if (!options.sourceEditorVisible) { options.sourceRestoredFor.current = undefined; return; }
    if (!options.activeTab) return;
    const path = options.activeTab.path;
    const request = options.navigationRequest?.path === path ? options.navigationRequest : undefined;
    if (!request && options.sourceRestoredFor.current === path) return;
    const visualAnchor = options.pendingVisualToCodeAnchor.current?.fileId === path ? options.pendingVisualToCodeAnchor.current : undefined;
    const remembered = options.sourcePositions.current.get(path);
    let attempts = 0;
    let frame = 0;
    const applyWhenReady = () => {
      const editor = options.editorRef.current;
      const model = editor?.getModel();
      if (!editor || !editor.getDomNode()?.isConnected || !model || !contentGuard.current.matches(model, options.activeTab!.content)) {
        if (attempts++ < 20) frame = requestAnimationFrame(applyWhenReady);
        return;
      }
      options.sourceModelPath.current = path;
      options.sourceRestoredFor.current = path;
      const position = request?.offset !== undefined ? sourcePositionAtOffset(options.activeTab!.content, request.offset)
        : request?.line !== undefined ? { lineNumber: request.line, column: request.column ?? 1 }
        : visualAnchor ? sourcePositionAtOffset(options.activeTab!.content, visualAnchor.offset)
        : remembered ? sourcePositionAtOffset(options.activeTab!.content, remembered.offset) : undefined;
      if (position) {
        const safeLine = Math.min(Math.max(1, position.lineNumber), model.getLineCount());
        const safePosition = { lineNumber: safeLine, column: Math.min(Math.max(1, position.column), model.getLineMaxColumn(safeLine)) };
        editor.setPosition(safePosition);
        if (request || visualAnchor) editor.revealPositionInCenter(safePosition);
        else if (remembered) editor.setScrollTop(remembered.scrollTop);
        if (request || visualAnchor) editor.focus();
      } else {
        editor.setPosition({ lineNumber: 1, column: 1 });
        editor.setScrollTop(0);
      }
      if (visualAnchor) options.pendingVisualToCodeAnchor.current = undefined;
      if (request) options.setNavigationRequest((current) => current?.nonce === request.nonce ? undefined : current);
    };
    frame = requestAnimationFrame(applyWhenReady);
    return () => cancelAnimationFrame(frame);
  }, [options.sourceEditorVisible, options.activePath, options.activeTab?.path, options.activeTab?.content, options.navigationRequest, options.editorMountVersion]);

  useEffect(() => {
    const openAIFile = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; line?: number }>).detail;
      if (typeof detail?.path === "string") options.aiFileNavigationRef.current(detail.path, detail.line);
    };
    window.addEventListener("texweave:ai-open-file", openAIFile);
    return () => window.removeEventListener("texweave:ai-open-file", openAIFile);
  }, []);

  useEffect(() => {
    const editor = options.editorRef.current;
    const model = editor?.getModel();
    const decorations = options.searchDecorationsRef.current;
    if (!editor || !model || !decorations) return;
    decorations.set(options.searchResponse.results.filter((result) => result.fileId === options.activePath).map((result) => {
      const start = model.getPositionAt(result.matchStart);
      const end = model.getPositionAt(result.matchEnd);
      return {
        range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column },
        options: { inlineClassName: result.id === options.activeSearchResult?.id ? "texweave-search-match-active" : "texweave-search-match" }
      };
    }));
  }, [options.searchResponse, options.activeSearchResult, options.activePath, options.activeTab?.content, options.editorMountVersion]);
}
