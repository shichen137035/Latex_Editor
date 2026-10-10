import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Editor, type OnMount } from "@monaco-editor/react";
import { createPortal } from "react-dom";
import type { ProjectTreeNode } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { useSettings } from "../settings/service.js";
import { commands } from "../settings/commands.js";
import { CompletionController } from "../completion/CompletionController.js";
import { SpellCheckController, type SpellContextRequest } from "../spellcheck/SpellCheckController.js";
import { installEditorContextActions } from "../workbench/editorContextActions.js";
import { installSymbolPairing } from "../editor/symbolPairing.js";
import { MathPreviewPopover } from "../math/MathPreviewPopover.js";
import { extractMathExpression } from "../math/MathRenderService.js";
import { MathNodeIndex } from "../math/MathNodeLocator.js";
import type { MathContext } from "../math/types.js";
import { editorThemeName } from "../themes/runtime.js";
import type { EnvironmentDefinition } from "./types.js";
import { useUnsavedChanges } from "../lifecycle/unsavedChanges.js";
import { registerCitationTarget } from "../references/citationInsertion.js";

type EditorApi = NonNullable<Window["latexEditor"]>;

export interface PreviewLocalEditorProps {
  value: string;
  onApply(value: string): void;
  onDraftChange?: ((value: string) => void) | undefined;
  onCancel(): void;
  onInsertBefore?(draft: string): void;
  onInsertAfter?(draft: string): void;
  mathDraft?: boolean;
  sourceStartLine?: number;
  sourceStartOffset?: number;
  getOpenDocuments?: (() => Array<{ path: string; content: string }>) | undefined;
  initialCursorOffset?: number | undefined;
  initialHeight?: number | undefined;
  api: EditorApi | undefined;
  projectId: string;
  tree: ProjectTreeNode[];
  currentPath: string;
  definitions: EnvironmentDefinition[];
  mathContext: MathContext;
  onSpellContextMenu(request: SpellContextRequest): void;
  onDetectedLanguage(language: string): void;
  onForwardSync(path: string, line: number, column?: number): void;
}

/** Monaco-backed editor for a source range opened from the visual preview. */
export function PreviewLocalEditor({ value, onApply, onDraftChange, onCancel, onInsertBefore, onInsertAfter, mathDraft = false, sourceStartLine = 1, sourceStartOffset, getOpenDocuments, initialCursorOffset, initialHeight, api, projectId, tree, currentPath, definitions, mathContext, onSpellContextMenu, onDetectedLanguage, onForwardSync }: PreviewLocalEditorProps) {
  const preferences = useSettings();
  const [draft, setDraft] = useState(value);
  const [measuredContentHeight, setMeasuredContentHeight] = useState<number>();
  const [cursorMath, setCursorMath] = useState<{ expression: string; displayMode: boolean; start: number; end: number }>();
  const [mathAnchor, setMathAnchor] = useState<DOMRect>();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [overflowWidgets] = useState(() => {
    const host = document.createElement("div");
    host.className = "monaco-editor preview-editor-overflow-widgets";
    return host;
  });
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const localEditorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const mathPopoverInteracting = useRef(false);
  const draftRef = useRef(value);
  const applyRef = useRef(onApply);
  const cancelRef = useRef(onCancel);
  const completionController = useRef<CompletionController | null>(null);
  const completionContext = useRef({ tree, currentPath, definitions, getOpenDocuments, sourceStartOffset, value });
  completionContext.current = { tree, currentPath, definitions, getOpenDocuments, sourceStartOffset, value };
  const spellCheckController = useRef<SpellCheckController | null>(null);
  const contextActions = useRef<{ dispose(): void } | null>(null);
  const symbolPairing = useRef<{ dispose(): void } | null>(null);
  const mode = preferences.get("spellCheckMode");
  const language = preferences.get("spellCheckLanguage");
  const lineHeight = Math.round(preferences.get("fontSize") * 1.5);
  const estimatedContentHeight = Math.max(40, draft.split(/\r\n?|\n/).length * lineHeight + 20);
  const contentHeight = Math.max(estimatedContentHeight, measuredContentHeight ?? 0, initialHeight === undefined ? 0 : initialHeight - 66);
  useLayoutEffect(() => {
    document.body.appendChild(overflowWidgets);
    return () => overflowWidgets.remove();
  }, [overflowWidgets]);
  useEffect(() => {
    let frame = 0;
    const reposition = (event: Event) => {
      const target = event.target;
      if (event.type === "scroll" && target instanceof Element && !target.contains(editorShellRef.current)) return;
      if (frame || !overflowWidgets.querySelector(".suggest-widget.visible, .parameter-hints-widget.visible")) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const editor = localEditorRef.current, bounds = editorShellRef.current?.getBoundingClientRect();
        if (!editor || !bounds) return;
        if (bounds.bottom < 0 || bounds.top > innerHeight) editor.trigger("preview-scroll", "hideSuggestWidget", null);
        else editor.render(true);
      });
    };
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("scroll", reposition, true); window.removeEventListener("resize", reposition); };
  }, [overflowWidgets]);
  draftRef.current = draft;
  applyRef.current = onApply;
  cancelRef.current = onCancel;
  useUnsavedChanges({ hasChanges: () => draftRef.current !== value, commit: () => applyRef.current(draftRef.current) });
  useEffect(() => registerCitationTarget(projectId, currentPath, text => {
    const editor = localEditorRef.current;
    const selection = editor?.getSelection();
    if (!editor || !selection || !editor.getModel()) return false;
    editor.executeEdits("reference-library", [{ range: selection, text, forceMoveMarkers: true }]);
    editor.focus();
    return true;
  }), [projectId, currentPath]);
  useEffect(() => () => { completionController.current?.dispose(); spellCheckController.current?.dispose(); contextActions.current?.dispose(); symbolPairing.current?.dispose(); }, []);
  useEffect(() => { spellCheckController.current?.refresh(); }, [mode, language]);
  useEffect(() => {
    const registrations = [
      commands.register("edit.undo", { execute: () => localEditorRef.current?.trigger("command", "undo", null), when: () => localEditorRef.current?.hasTextFocus() === true }),
      commands.register("edit.redo", { execute: () => localEditorRef.current?.trigger("command", "redo", null), when: () => localEditorRef.current?.hasTextFocus() === true }),
      commands.register("preview.applyDraft", { execute: () => applyRef.current(draftRef.current) }),
      commands.register("preview.cancelDraft", {
        when: () => !localEditorRef.current?.getDomNode()?.querySelector(".suggest-widget.visible, .parameter-hints-widget.visible")
          && !overflowWidgets.querySelector(".suggest-widget.visible, .parameter-hints-widget.visible"),
        execute: () => cancelRef.current()
      }),
      commands.register("block.insertBefore", { when: () => !!onInsertBefore, execute: () => onInsertBefore?.(draftRef.current) }),
      commands.register("block.insertAfter", { when: () => !!onInsertAfter, execute: () => onInsertAfter?.(draftRef.current) })
    ];
    return () => registrations.forEach((dispose) => dispose());
  }, []);
  const onMount: OnMount = (editor, monaco) => {
    localEditorRef.current = editor;
    const updateContentHeight = () => {
      const next = Math.max(40, Math.ceil(editor.getContentHeight()));
      setMeasuredContentHeight((current) => current === next ? current : next);
    };
    editor.onDidContentSizeChange(updateContentHeight);
    editor.onDidLayoutChange(updateContentHeight);
    requestAnimationFrame(updateContentHeight);
    const model = editor.getModel();
    if (model && initialCursorOffset !== undefined) {
      const offset = Math.max(0, Math.min(initialCursorOffset, model.getValueLength()));
      // The wrapper may finish syncing the initial model just after onMount.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const currentModel = editor.getModel();
        if (!currentModel) return;
        const position = currentModel.getPositionAt(Math.min(offset, currentModel.getValueLength()));
        editor.setPosition(position);
        editor.revealPositionInCenter(position);
        editor.focus();
      }));
    }
    editor.focus();
    completionController.current?.dispose();
    spellCheckController.current?.dispose();
    contextActions.current?.dispose();
    symbolPairing.current?.dispose();
    symbolPairing.current = installSymbolPairing(editor, () => preferences.get("autoPairSymbols"));
    const globalPosition = (line: number, column: number) => ({ line: sourceStartLine + line - 1, column });
    contextActions.current = installEditorContextActions(editor, (line, column) => { const position = globalPosition(line, column); onForwardSync(currentPath, position.line, position.column); });
    editor.onMouseDown((event) => {
      if (event.event.detail !== 2 || !event.target.position) return;
      const position = globalPosition(event.target.position.lineNumber, event.target.position.column);
      onForwardSync(currentPath, position.line, position.column);
    });
    let indexedVersion = -1;
    let mathIndex = new MathNodeIndex([]);
    const updateCursorMath = () => {
      const currentModel = editor.getModel();
      const position = editor.getPosition();
      if (!currentModel || !position) { setCursorMath(undefined); return; }
      if (editorShellRef.current) editorShellRef.current.dataset.cursorOffset = String(currentModel.getOffsetAt(position));
      if (currentModel.getVersionId() !== indexedVersion) {
        indexedVersion = currentModel.getVersionId();
        mathIndex = MathNodeIndex.fromSource(currentModel.getValue());
      }
      const node = mathIndex.findMathNodeAtOffset(currentModel.getOffsetAt(position));
      if (!node) { setCursorMath(undefined); return; }
      const extracted = extractMathExpression(currentModel.getValue().slice(node.start, node.end));
      setCursorMath({ ...extracted, start: node.start, end: node.end });
    };
    editor.onDidChangeCursorPosition(updateCursorMath);
    editor.onDidChangeModelContent(() => { indexedVersion = -1; updateCursorMath(); });
    editor.onDidBlurEditorWidget(() => { if (!mathPopoverInteracting.current) setCursorMath(undefined); });
    updateCursorMath();
    if (!api) return;
    completionController.current = new CompletionController({ monaco, api, projectId, getModel: () => localEditorRef.current?.getModel() ?? null, getOpenDocuments: () => completionContext.current.getOpenDocuments?.() ?? [], getSourceRange: () => {
      const { sourceStartOffset, value } = completionContext.current;
      return sourceStartOffset === undefined ? undefined : { start: sourceStartOffset, end: sourceStartOffset + value.length };
    }, getTree: () => completionContext.current.tree, getCurrentPath: () => completionContext.current.currentPath, getEnvironments: () => completionContext.current.definitions, isDocumentWordCompletionEnabled: () => preferences.get("documentWordCompletion") });
    spellCheckController.current = new SpellCheckController({ editor, api, getCurrentPath: () => currentPath, getMode: () => preferences.get("spellCheckMode"), getManualLanguage: () => preferences.get("spellCheckLanguage"), onDetectedLanguage, onContextMenu: onSpellContextMenu });
  };
  const blockMath = useMemo(() => mathDraft ? extractMathExpression(draft) : undefined, [draft, mathDraft]);
  const activeMath = cursorMath ?? blockMath;
  useEffect(() => {
    if (!activeMath) { setMathAnchor(undefined); return; }
    let frame = 0;
    const updateAnchor = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const editor = localEditorRef.current;
        const model = editor?.getModel();
        const bounds = editor?.getDomNode()?.getBoundingClientRect();
        if (cursorMath && editor && model && bounds) {
          const start = editor.getScrolledVisiblePosition(model.getPositionAt(cursorMath.start));
          const end = editor.getScrolledVisiblePosition(model.getPositionAt(cursorMath.end));
          if (!start && !end) { setMathAnchor(undefined); return; }
          const top = Math.max(bounds.top, bounds.top + (start?.top ?? 0));
          const bottom = Math.min(bounds.bottom, bounds.top + (end?.top ?? bounds.height) + (end?.height ?? 1));
          if (bottom <= bounds.top || top >= bounds.bottom) { setMathAnchor(undefined); return; }
          setMathAnchor(new DOMRect(bounds.left + (start?.left ?? end?.left ?? 12), top, 1, Math.max(1, bottom - top)));
          return;
        }
        const rect = editorShellRef.current?.getBoundingClientRect();
        setMathAnchor(rect && rect.bottom > 0 && rect.top < window.innerHeight ? rect : undefined);
      });
    };
    const scrollRoot = editorShellRef.current?.closest(".structured-preview");
    const editorScroll = localEditorRef.current?.onDidScrollChange(updateAnchor);
    const editorLayout = localEditorRef.current?.onDidLayoutChange(updateAnchor);
    updateAnchor();
    scrollRoot?.addEventListener("scroll", updateAnchor, { passive: true });
    window.addEventListener("resize", updateAnchor);
    return () => {
      window.cancelAnimationFrame(frame);
      editorScroll?.dispose();
      editorLayout?.dispose();
      scrollRoot?.removeEventListener("scroll", updateAnchor);
      window.removeEventListener("resize", updateAnchor);
    };
  }, [activeMath, cursorMath]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (editorShellRef.current?.contains(target)) return;
      if (target.closest(".latex-toolbar, .math-preview-popover, .suggest-widget, .monaco-hover, .context-view, .spell-context-menu, .menu-popover, .environment-picker, [role=dialog]")) return;
      if (draftRef.current === value) { cancelRef.current(); return; }
      if (!preferences.get("confirmPreviewEdits")) { applyRef.current(draftRef.current); return; }
      event.preventDefault();
      event.stopImmediatePropagation();
      setConfirmLeave(true);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [preferences, value]);
  useEffect(() => {
    if (!confirmLeave) return;
    const choose = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase() === "y") { event.preventDefault(); setConfirmLeave(false); applyRef.current(draftRef.current); }
      else if (event.key.toLocaleLowerCase() === "n" || event.key === "Escape") { event.preventDefault(); setConfirmLeave(false); cancelRef.current(); }
    };
    window.addEventListener("keydown", choose, true);
    return () => window.removeEventListener("keydown", choose, true);
  }, [confirmLeave]);
  return <><div ref={editorShellRef} className="preview-local-editor" data-source-start-offset={sourceStartOffset} onClick={(event) => event.stopPropagation()}>
    {activeMath && mathAnchor && <MathPreviewPopover source={activeMath.expression} displayMode={activeMath.displayMode} context={mathContext} anchor={mathAnchor} className="preview-draft-math" onInteractionChange={(active) => { mathPopoverInteracting.current = active; if (!active && !localEditorRef.current?.hasTextFocus()) setCursorMath(undefined); }}/>}
    <Editor height={`${contentHeight}px`} language="latex" value={draft} onChange={(next) => { const nextValue = next ?? ""; draftRef.current = nextValue; setDraft(nextValue); onDraftChange?.(nextValue); }} theme={editorThemeName(preferences.get("theme"))} options={{ overflowWidgetsDomNode: overflowWidgets, fixedOverflowWidgets: true, minimap: { enabled: false }, lineNumbers: "off", folding: false, fontSize: preferences.get("fontSize"), tabSize: preferences.get("tabSize"), wordWrap: "on", lineHeight, automaticLayout: true, scrollbar: { handleMouseWheel: false, alwaysConsumeMouseWheel: false }, scrollBeyondLastLine: false, padding: { top: 10 }, quickSuggestions: { other: true, comments: true, strings: true }, suggestOnTriggerCharacters: true, autoClosingBrackets: "never", autoClosingQuotes: "always", autoSurround: "never" }} onMount={onMount} />
    <div className="preview-local-editor-actions"><span>{t("preview.editHint")}</span>{onInsertBefore && onInsertAfter && <div className="preview-line-actions"><button title={t("preview.insertLineBefore")} onClick={() => onInsertBefore(draftRef.current)}>↥＋</button><button title={t("preview.insertLineAfter")} onClick={() => onInsertAfter(draftRef.current)}>↧＋</button></div>}<button onClick={onCancel}>{t("preview.cancel")}</button><button className="primary" onClick={() => applyRef.current(draftRef.current)}>{t("preview.apply")}</button></div>
  </div>{confirmLeave && createPortal(<div className="preview-confirm-backdrop"><section className="preview-confirm-dialog" role="dialog" aria-modal="true" aria-label={t("preview.unsavedTitle")}><h2>{t("preview.unsavedTitle")}</h2><p>{t("preview.unsavedMessage")}</p><div><button autoFocus className="primary" onClick={() => { setConfirmLeave(false); applyRef.current(draftRef.current); }}>{t("preview.yes")}</button><button onClick={() => { setConfirmLeave(false); cancelRef.current(); }}>{t("preview.no")}</button></div></section></div>, document.body)}</>;
}
