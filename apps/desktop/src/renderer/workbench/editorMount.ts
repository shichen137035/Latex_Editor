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
import { commands } from "../settings/commands.js";
import { t } from "../i18n/index.js";
import type { DocumentSelection } from "../custom-blocks/selection.js";

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
    let mathIndex = new MathNodeIndex([]);
    let cursorMathActive = false;
    let mathTimer: number | undefined;
    let hoverExitTimer: number | undefined;
    let pendingMathKind: SourceMathPreview["kind"] | undefined;
    let activeMath: { source: string; displayMode: boolean; kind: SourceMathPreview["kind"]; start: number; end: number } | undefined;
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
      if (model && model.getVersionId() !== indexedVersion) {
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
      setSourceMathPreview(anchor ? { source: activeMath.source, displayMode: activeMath.displayMode, anchor, kind: activeMath.kind } : undefined);
    };
    const scheduleMathPreview = (position: { lineNumber: number; column: number }, kind: SourceMathPreview["kind"]): boolean => {
      if (kind === "source-hover" && !store.get("mathPreviewOnHover")) return false;
      const model = editor.getModel();
      if (!model || !/\.tex$/i.test(activePathRef.current ?? "")) return false;
      const offset = model.getOffsetAt(position);
      const mathNode = currentMathIndex().findMathNodeAtOffset(offset);
      if (!mathNode || !mathAnchor(mathNode.start, mathNode.end)) return false;
      const extracted = extractMathExpression(model.getValue().slice(mathNode.start, mathNode.end));
      if (mathTimer !== undefined) window.clearTimeout(mathTimer);
      mathTimer = window.setTimeout(() => {
        mathTimer = undefined;
        pendingMathKind = undefined;
        if (kind === "source-hover" && !store.get("mathPreviewOnHover")) {
          clearHoverMathPreview();
          return;
        }
        activeMath = { source: extracted.expression, displayMode: extracted.displayMode, kind, start: mathNode.start, end: mathNode.end };
        refreshMathPreview();
      }, 75);
      pendingMathKind = kind;
      return true;
    };
    const updateCursorMath = (position: { lineNumber: number; column: number }) => {
      cursorMathActive = scheduleMathPreview(position, "source-cursor");
      if (!cursorMathActive) {
        if (activeMath?.kind === "source-cursor") activeMath = undefined;
        setSourceMathPreview((current) => current?.kind === "source-cursor" ? undefined : current);
      }
    };
    const cursorListener = editor.onDidChangeCursorPosition((event) => {
      setCursor({ line: event.position.lineNumber, column: event.position.column });
      updateCursorMath(event.position);
      const path = sourceModelPath.current;
      const model = editor.getModel();
      if (path && path === activePathRef.current && model?.getValue().replace(/\r\n?/g, "\n") === activeContentRef.current.replace(/\r\n?/g, "\n")) {
        sourcePositions.current.set(path, { offset: model.getOffsetAt(event.position), scrollTop: editor.getScrollTop() });
      }
    });
    const selectionListener = editor.onDidChangeCursorSelection((event) => {
      const model = editor.getModel();
      const path = activePathRef.current;
      if (!model || !path || event.selection.isEmpty()) { setSourceSelection(undefined); return; }
      setSourceSelection({ fileId: path, start: model.getOffsetAt(event.selection.getStartPosition()), end: model.getOffsetAt(event.selection.getEndPosition()), origin: "source" });
    });
    const contentListener = editor.onDidChangeModelContent(() => {
      indexedVersion = -1;
      activeMath = undefined;
      const position = editor.getPosition();
      if (position) updateCursorMath(position);
    });
    const scrollListener = editor.onDidScrollChange(() => {
      refreshMathPreview();
      const path = sourceModelPath.current;
      const model = editor.getModel();
      const position = editor.getPosition();
      if (path && path === activePathRef.current && model && position && model.getValue().replace(/\r\n?/g, "\n") === activeContentRef.current.replace(/\r\n?/g, "\n")) {
        sourcePositions.current.set(path, { offset: model.getOffsetAt(position), scrollTop: editor.getScrollTop() });
      }
    });
    const layoutListener = editor.onDidLayoutChange(refreshMathPreview);
    const blurListener = editor.onDidBlurEditorWidget(() => {
      if (mathPopoverInteracting.current) return;
      cursorMathActive = false;
      if (activeMath?.kind === "source-cursor") activeMath = undefined;
      setSourceMathPreview((current) => current?.kind === "source-cursor" ? undefined : current);
    });
    const modifierPressed = (event: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => {
      const modifier = store.get("referenceLinkModifier");
      return modifier === "ctrl" ? event.ctrlKey : modifier === "alt" ? event.altKey : modifier === "shift" ? event.shiftKey : event.metaKey;
    };
    const isCommented = (value: string, index: number) => {
      const percent = value.lastIndexOf("%", index);
      if (percent < 0) return false;
      let slashes = 0;
      for (let cursor = percent - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1;
      return slashes % 2 === 0;
    };
    const referenceAtPosition = (position: { lineNumber: number; column: number }) => {
      if (!/\.tex$/i.test(activePathRef.current ?? "")) return undefined;
      const model = editor.getModel();
      if (!model) return undefined;
      const line = model.getLineContent(position.lineNumber);
      const referencePattern = /\\([A-Za-z]*ref[A-Za-z]*)\s*\{([^}\n]+)\}/g;
      for (const match of line.matchAll(referencePattern)) {
        if (isCommented(line, match.index ?? 0)) continue;
        const startColumn = (match.index ?? 0) + 1;
        const endColumn = startColumn + match[0].length;
        if (position.column >= startColumn && position.column <= endColumn) {
          const label = (match[2] ?? "").split(",").map((value) => value.trim()).filter(Boolean)[0];
          if (label) return label;
        }
      }
      return undefined;
    };
    const labelPosition = (label: string) => {
      const model = editor.getModel();
      if (!model) return undefined;
      const labelPattern = /\\label\s*\{([^}\n]+)\}/g;
      for (const match of model.getValue().matchAll(labelPattern)) {
        if (match[1]?.trim() !== label) continue;
        const position = model.getPositionAt(match.index ?? 0);
        if (!isCommented(model.getLineContent(position.lineNumber), position.column - 1)) return position;
      }
      return undefined;
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
      const label = position ? referenceAtPosition(position) : undefined;
      const target = label ? labelPosition(label) : undefined;
      if (!target) return;
      event.event.preventDefault();
      editor.revealLineInCenter(target.lineNumber);
      editor.setPosition({ lineNumber: target.lineNumber, column: target.column });
      editor.focus();
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
    const contextActions = installEditorContextActions(editor, (line, column) => { if (activePathRef.current) void forwardSyncToPdf(activePathRef.current, line, column); });
    referenceMouseListener.current = { dispose: () => { if (mathTimer !== undefined) window.clearTimeout(mathTimer); if (hoverExitTimer !== undefined) window.clearTimeout(hoverExitTimer); activeMath = undefined; mathPopoverInteracting.current = false; mathPopoverInteractionChangeRef.current = () => undefined; if (clearHoverMathPreviewRef.current === clearHoverMathPreview) clearHoverMathPreviewRef.current = () => undefined; blockAction.dispose(); contextActions.dispose(); symbolPairingListener.current?.dispose(); symbolPairingListener.current = null; cursorListener.dispose(); selectionListener.dispose(); contentListener.dispose(); scrollListener.dispose(); layoutListener.dispose(); blurListener.dispose(); mouseDown.dispose(); mouseMove.dispose(); mouseLeave.dispose(); window.removeEventListener("keydown", modifierChange); window.removeEventListener("keyup", modifierChange); setReferenceCursor(false); setSourceMathPreview(undefined); } };
    if (api) {
      completionController.current = new CompletionController({ monaco, api, projectId: project.id, getTree: () => treeRef.current, getCurrentPath: () => activePathRef.current, getEnvironments: () => environmentsRef.current, isDocumentWordCompletionEnabled: () => store.get("documentWordCompletion") });
      spellCheckController.current = new SpellCheckController({ editor, api, getCurrentPath: () => activePathRef.current, getMode: () => store.get("spellCheckMode"), getManualLanguage: () => store.get("spellCheckLanguage"), onDetectedLanguage: setDetectedSpellLanguage, onContextMenu: setSpellContextMenu });
    }
  };
}
