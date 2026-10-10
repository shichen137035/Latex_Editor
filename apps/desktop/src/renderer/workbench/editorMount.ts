import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Project, ProjectTreeNode } from "@latex-editor/contracts";
import type { PreferenceKey, PreferenceValues } from "@latex-editor/contracts";
import type { OnMount } from "@monaco-editor/react";
import { CompletionController } from "../completion/CompletionController.js";
import { SpellCheckController, type SpellContextRequest } from "../spellcheck/SpellCheckController.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { MathNodeIndex } from "../math/MathNodeLocator.js";
import { extractMathExpression } from "../math/MathRenderService.js";
import { installEditorContextActions } from "./editorContextActions.js";
import { installSymbolPairing } from "../editor/symbolPairing.js";
import { sourceReferenceAtOffset } from "../editor/sourceReferences.js";
import { commands } from "../settings/commands.js";
import { t } from "../i18n/index.js";
import type { DocumentSelection } from "../custom-blocks/selection.js";
import type { IndexedDocument } from "../completion/ProjectIndex.js";
import { SourceModelContentGuard } from "../editor/SourceModelContentGuard.js";

export interface SourceMathPreview { source: string; displayMode: boolean; anchor: DOMRect; kind: "source-cursor" | "source-hover" }

interface SettingsReader {
  get<K extends PreferenceKey>(key: K): PreferenceValues[K];
}

interface WorkbenchEditorMountOptions {
  api: Window["latexEditor"];
  project: Project;
  store: SettingsReader;
  editorRef: MutableRefObject<Parameters<OnMount>[0] | null>;
  sourceRestoredFor: MutableRefObject<string | undefined>;
  setEditorMountVersion: Dispatch<SetStateAction<number>>;
  searchDecorationsRef: MutableRefObject<ReturnType<Parameters<OnMount>[0]["createDecorationsCollection"]> | null>;
  completionController: MutableRefObject<CompletionController | null>;
  spellCheckController: MutableRefObject<SpellCheckController | null>;
  referenceMouseListener: MutableRefObject<{ dispose(): void } | null>;
  symbolPairingListener: MutableRefObject<{ dispose(): void } | null>;
  activePathRef: MutableRefObject<string | undefined>;
  sourceModelPath: MutableRefObject<string | undefined>;
  setSourceMathPreview: Dispatch<SetStateAction<SourceMathPreview | undefined>>;
  clearHoverMathPreviewRef: MutableRefObject<() => void>;
  mathPopoverInteracting: MutableRefObject<boolean>;
  mathPopoverInteractionChangeRef: MutableRefObject<(active: boolean) => void>;
  setCursor: Dispatch<SetStateAction<{ line: number; column: number }>>;
  sourcePositions: MutableRefObject<Map<string, { offset: number; scrollTop: number }>>;
  activeContentRef: MutableRefObject<string>;
  setSourceSelection: Dispatch<SetStateAction<DocumentSelection | undefined>>;
  forwardSyncToPdf(path: string, line: number, column?: number): Promise<void>;
  treeRef: MutableRefObject<ProjectTreeNode[]>;
  environmentsRef: MutableRefObject<EnvironmentDefinition[]>;
  getOpenDocuments(): IndexedDocument[];
  onReferenceJump(jump: NonNullable<ReturnType<typeof sourceReferenceAtOffset>>): void;
  setDetectedSpellLanguage: Dispatch<SetStateAction<string>>;
  setSpellContextMenu: Dispatch<SetStateAction<SpellContextRequest | undefined>>;
}

export function createWorkbenchEditorMount(options: WorkbenchEditorMountOptions): OnMount {
  const {
    api, project, store, editorRef, sourceRestoredFor, setEditorMountVersion, searchDecorationsRef,
    completionController, spellCheckController, referenceMouseListener, symbolPairingListener, activePathRef, sourceModelPath,
    setSourceMathPreview, clearHoverMathPreviewRef, mathPopoverInteracting, mathPopoverInteractionChangeRef,
    setCursor, sourcePositions, activeContentRef, setSourceSelection, forwardSyncToPdf, treeRef,
    environmentsRef, setDetectedSpellLanguage, setSpellContextMenu
  } = options;
  return (editor, monaco) => {
    editorRef.current = editor;
    sourceRestoredFor.current = undefined;
    setEditorMountVersion((version) => version + 1);
    searchDecorationsRef.current?.clear();
    searchDecorationsRef.current = editor.createDecorationsCollection();
    completionController.current?.dispose();
    spellCheckController.current?.dispose();
    referenceMouseListener.current?.dispose();
    symbolPairingListener.current?.dispose();
    symbolPairingListener.current = installSymbolPairing(editor, () => store.get("autoPairSymbols"));
    const blockAction = editor.addAction({ id: "texweave.createCustomBlock", label: t("block.createFromSelection"), precondition: "editorHasSelection", contextMenuGroupId: "navigation", contextMenuOrder: 0.45, run: () => { commands.execute("block.createFromSelection"); } });
    let indexedVersion = -1;
    let indexedModel: ReturnType<typeof editor.getModel> = null;
    let mathIndex = new MathNodeIndex([]);
    let cursorMathActive = false;
    let mathTimer: number | undefined;
    let hoverExitTimer: number | undefined;
    let pendingMathKind: SourceMathPreview["kind"] | undefined;
    let activeMath: { source: string; displayMode: boolean; kind: SourceMathPreview["kind"]; start: number; end: number } | undefined;
    const contentGuard = new SourceModelContentGuard();
    let scrollFrame = 0;
    const cancelPendingMath = (kind?: SourceMathPreview["kind"]) => {
      if (kind && pendingMathKind !== kind) return;
      if (mathTimer !== undefined) window.clearTimeout(mathTimer);
      mathTimer = undefined;
      pendingMathKind = undefined;
    };
    const clearHoverMathPreview = () => {
      if (pendingMathKind === "source-hover") {
        if (mathTimer !== undefined) window.clearTimeout(mathTimer);
        mathTimer = undefined;
        pendingMathKind = undefined;
      }
      if (activeMath?.kind === "source-hover") activeMath = undefined;
      setSourceMathPreview((current) => current?.kind === "source-hover" ? undefined : current);
    };
    clearHoverMathPreviewRef.current = clearHoverMathPreview;
    const currentMathIndex = () => {
      const model = editor.getModel();
      if (model && (model !== indexedModel || model.getVersionId() !== indexedVersion)) {
        indexedModel = model;
        indexedVersion = model.getVersionId();
        mathIndex = MathNodeIndex.fromSource(model.getValue());
      }
      return mathIndex;
    };
    const mathAnchor = (start: number, end: number): DOMRect | undefined => {
      const model = editor.getModel();
      const bounds = editor.getDomNode()?.getBoundingClientRect();
      if (!model || !bounds) return undefined;
      const startVisible = editor.getScrolledVisiblePosition(model.getPositionAt(start));
      const endVisible = editor.getScrolledVisiblePosition(model.getPositionAt(end));
      if (!startVisible && !endVisible) return undefined;
      const rawTop = startVisible ? bounds.top + startVisible.top : bounds.top;
      const rawBottom = endVisible ? bounds.top + endVisible.top + endVisible.height : bounds.bottom;
      const top = Math.max(bounds.top, rawTop);
      const bottom = Math.min(bounds.bottom, Math.max(rawBottom, top + 1));
      if (bottom <= bounds.top || top >= bounds.bottom) return undefined;
      const left = bounds.left + (startVisible?.left ?? endVisible?.left ?? 12);
      return new DOMRect(left, top, 1, Math.max(1, bottom - top));
    };
    const refreshMathPreview = () => {
      if (activeMath?.kind === "source-hover" && !store.get("mathPreviewOnHover")) {
        clearHoverMathPreview();
        return;
      }
      if (!activeMath) return;
      const anchor = mathAnchor(activeMath.start, activeMath.end);
      const next = anchor ? { source: activeMath.source, displayMode: activeMath.displayMode, anchor, kind: activeMath.kind } : undefined;
      setSourceMathPreview(current => current && next && current.source === next.source && current.kind === next.kind
        && current.displayMode === next.displayMode && current.anchor.x === next.anchor.x && current.anchor.y === next.anchor.y
        && current.anchor.width === next.anchor.width && current.anchor.height === next.anchor.height ? current : next);
    };
    const scheduleMathPreview = (position: { lineNumber: number; column: number }, kind: SourceMathPreview["kind"]): boolean => {
      if (kind === "source-hover" && !store.get("mathPreviewOnHover")) return false;
      const model = editor.getModel();
      if (!model || !/\.tex$/i.test(activePathRef.current ?? "")) return false;
      const offset = model.getOffsetAt(position);
      const version = model.getVersionId();
      const path = activePathRef.current;
      if (mathTimer !== undefined) window.clearTimeout(mathTimer);
      mathTimer = window.setTimeout(() => {
        mathTimer = undefined;
        pendingMathKind = undefined;
        if (editor.getModel() !== model || model.isDisposed() || model.getVersionId() !== version || activePathRef.current !== path
          || (kind === "source-cursor" && !editor.hasTextFocus()) || (kind === "source-hover" && !hoverPosition)) return;
        if (kind === "source-hover" && !store.get("mathPreviewOnHover")) {
          clearHoverMathPreview();
          return;
        }
        // Indexing a long article belongs after the debounce, not in every
        // mouse/cursor/content event leading up to it.
        const mathNode = currentMathIndex().findMathNodeAtOffset(offset);
        if (!mathNode || !mathAnchor(mathNode.start, mathNode.end)) {
          if (kind === "source-cursor") cursorMathActive = false;
          if (activeMath?.kind === kind) activeMath = undefined;
          setSourceMathPreview(current => current?.kind === kind ? undefined : current);
          return;
        }
        const start = model.getPositionAt(mathNode.start), end = model.getPositionAt(mathNode.end);
        const extracted = extractMathExpression(model.getValueInRange({ startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }));
        activeMath = { source: extracted.expression, displayMode: extracted.displayMode, kind, start: mathNode.start, end: mathNode.end };
        refreshMathPreview();
      }, 75);
      pendingMathKind = kind;
      return true;
    };
    const updateCursorMath = (position: { lineNumber: number; column: number }) => {
      cursorMathActive = scheduleMathPreview(position, "source-cursor");
      if (!cursorMathActive) {
        cancelPendingMath("source-cursor");
        if (activeMath?.kind === "source-cursor") activeMath = undefined;
        setSourceMathPreview((current) => current?.kind === "source-cursor" ? undefined : current);
      }
    };
    const cursorListener = editor.onDidChangeCursorPosition((event) => {
      setCursor(current => current.line === event.position.lineNumber && current.column === event.position.column
        ? current : { line: event.position.lineNumber, column: event.position.column });
      updateCursorMath(event.position);
      const path = sourceModelPath.current;
      const model = editor.getModel();
      if (path && path === activePathRef.current && model && contentGuard.matches(model, activeContentRef.current)) {
        sourcePositions.current.set(path, { offset: model.getOffsetAt(event.position), scrollTop: editor.getScrollTop() });
      }
    });
    const selectionListener = editor.onDidChangeCursorSelection((event) => {
      const model = editor.getModel();
      const path = sourceModelPath.current;
      if (!model || !path || path !== activePathRef.current || event.selection.isEmpty()) { setSourceSelection(undefined); return; }
      setSourceSelection({ fileId: path, start: model.getOffsetAt(event.selection.getStartPosition()), end: model.getOffsetAt(event.selection.getEndPosition()), origin: "source" });
    });
    const contentListener = editor.onDidChangeModelContent(() => {
      cancelPendingMath();
      indexedVersion = -1;
      activeMath = undefined;
      const position = editor.getPosition();
      if (position) updateCursorMath(position);
    });
    const modelListener = editor.onDidChangeModel(() => {
      cancelPendingMath();
      indexedModel = null;
      indexedVersion = -1;
      activeMath = undefined;
      cursorMathActive = false;
      setSourceMathPreview(undefined);
      setSourceSelection(undefined);
    });
    const scrollListener = editor.onDidScrollChange(() => {
      if (activeMath && !scrollFrame) scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; refreshMathPreview(); });
      const path = sourceModelPath.current;
      const model = editor.getModel();
      const position = editor.getPosition();
      if (path && path === activePathRef.current && model && position && contentGuard.matches(model, activeContentRef.current)) {
        sourcePositions.current.set(path, { offset: model.getOffsetAt(position), scrollTop: editor.getScrollTop() });
      }
    });
    const layoutListener = editor.onDidLayoutChange(refreshMathPreview);
    const blurListener = editor.onDidBlurEditorWidget(() => {
      if (mathPopoverInteracting.current) return;
      cancelPendingMath("source-cursor");
      cursorMathActive = false;
      if (activeMath?.kind === "source-cursor") activeMath = undefined;
      setSourceMathPreview((current) => current?.kind === "source-cursor" ? undefined : current);
    });
    const modifierPressed = (event: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => {
      const modifier = store.get("referenceLinkModifier");
      return modifier === "ctrl" ? event.ctrlKey : modifier === "alt" ? event.altKey : modifier === "shift" ? event.shiftKey : event.metaKey;
    };
    const referenceAtPosition = (position: { lineNumber: number; column: number }) => {
      const model = editor.getModel();
      if (!model || sourceModelPath.current !== activePathRef.current || !/\.tex$/i.test(activePathRef.current ?? "")) return undefined;
      return sourceReferenceAtOffset(model.getValue(), model.getOffsetAt(position));
    };
    const setReferenceCursor = (enabled: boolean) => editor.getDomNode()?.classList.toggle("texweave-reference-cursor", enabled);
    let hoverPosition: { lineNumber: number; column: number } | undefined;
    mathPopoverInteractionChangeRef.current = (active) => {
      mathPopoverInteracting.current = active;
      if (active) {
        if (hoverExitTimer !== undefined) window.clearTimeout(hoverExitTimer);
        return;
      }
      if (!hoverPosition && !cursorMathActive) clearHoverMathPreview();
      if (!editor.hasTextFocus() && cursorMathActive) {
        cursorMathActive = false;
        if (activeMath?.kind === "source-cursor") activeMath = undefined;
        setSourceMathPreview((current) => current?.kind === "source-cursor" ? undefined : current);
      }
    };
    const mouseDown = editor.onMouseDown((event) => {
      if (event.event.detail === 2 && event.target.position && activePathRef.current) {
        void forwardSyncToPdf(activePathRef.current, event.target.position.lineNumber, event.target.position.column);
        return;
      }
      if (!modifierPressed(event.event)) return;
      const position = event.target.position;
      const reference = position ? referenceAtPosition(position) : undefined;
      if (!reference) return;
      event.event.preventDefault();
      options.onReferenceJump(reference);
    });
    const mouseMove = editor.onMouseMove((event) => {
      hoverPosition = event.target.position ?? undefined;
      setReferenceCursor(Boolean(hoverPosition && modifierPressed(event.event) && referenceAtPosition(hoverPosition)));
      if (!cursorMathActive && hoverPosition && !scheduleMathPreview(hoverPosition, "source-hover")) clearHoverMathPreview();
    });
    const mouseLeave = editor.onMouseLeave(() => {
      hoverPosition = undefined;
      setReferenceCursor(false);
      if (!cursorMathActive) hoverExitTimer = window.setTimeout(() => { if (!mathPopoverInteracting.current) clearHoverMathPreview(); }, 250);
    });
    const modifierChange = (event: KeyboardEvent) => { if (hoverPosition) setReferenceCursor(Boolean(modifierPressed(event) && referenceAtPosition(hoverPosition))); };
    window.addEventListener("keydown", modifierChange);
    window.addEventListener("keyup", modifierChange);
    const initialPosition = editor.getPosition();
    if (initialPosition) updateCursorMath(initialPosition);
    const contextActions = installEditorContextActions(editor, (line, column) => { if (activePathRef.current) void forwardSyncToPdf(activePathRef.current, line, column); }, () => activePathRef.current);
    referenceMouseListener.current = { dispose: () => { cancelAnimationFrame(scrollFrame); if (mathTimer !== undefined) window.clearTimeout(mathTimer); if (hoverExitTimer !== undefined) window.clearTimeout(hoverExitTimer); activeMath = undefined; mathPopoverInteracting.current = false; mathPopoverInteractionChangeRef.current = () => undefined; if (clearHoverMathPreviewRef.current === clearHoverMathPreview) clearHoverMathPreviewRef.current = () => undefined; blockAction.dispose(); contextActions.dispose(); symbolPairingListener.current?.dispose(); symbolPairingListener.current = null; cursorListener.dispose(); selectionListener.dispose(); contentListener.dispose(); modelListener.dispose(); scrollListener.dispose(); layoutListener.dispose(); blurListener.dispose(); mouseDown.dispose(); mouseMove.dispose(); mouseLeave.dispose(); window.removeEventListener("keydown", modifierChange); window.removeEventListener("keyup", modifierChange); setReferenceCursor(false); setSourceMathPreview(undefined); } };
    if (api) {
      completionController.current = new CompletionController({ monaco, api, projectId: project.id, getModel: () => editor.getModel(), getOpenDocuments: options.getOpenDocuments, getTree: () => treeRef.current, getCurrentPath: () => activePathRef.current, getEnvironments: () => environmentsRef.current, isDocumentWordCompletionEnabled: () => store.get("documentWordCompletion") });
      spellCheckController.current = new SpellCheckController({ editor, api, getCurrentPath: () => activePathRef.current, getMode: () => store.get("spellCheckMode"), getManualLanguage: () => store.get("spellCheckLanguage"), onDetectedLanguage: setDetectedSpellLanguage, onContextMenu: setSpellContextMenu });
    }
  };
}
