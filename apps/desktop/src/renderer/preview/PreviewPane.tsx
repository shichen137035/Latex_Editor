import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Editor, type OnMount } from "@monaco-editor/react";
import { createPortal } from "react-dom";
import type { BlockGraphSnapshot, BlockId, ProjectTreeNode, RelationDirection } from "@latex-editor/contracts";
import { t, type MessageKey } from "../i18n/index.js";
import { definitionForId } from "./environments.js";
import { parsePreview } from "./parser.js";
import type { ContentRegion, EnvironmentDefinition, PreviewNode, StructuralBlock } from "./types.js";
import "./preview.css";
import { useSettings } from "../settings/service.js";
import { CompletionController } from "../completion/CompletionController.js";
import { SpellCheckController, type SpellContextRequest } from "../spellcheck/SpellCheckController.js";
import { installEditorContextActions } from "../workbench/editorContextActions.js";
import { MathRenderer } from "./MathRenderer.js";
import { commands } from "../settings/commands.js";
import { MathPreviewPopover } from "../math/MathPreviewPopover.js";
import { extractMathExpression } from "../math/MathRenderService.js";
import { MathNodeIndex } from "../math/MathNodeLocator.js";
import { EMPTY_MATH_CONTEXT, type MathContext } from "../math/types.js";
import { searchPattern } from "../search/SearchEngine.js";
import type { SearchQuery, SearchResult } from "../search/types.js";
import { FilterEngine } from "../filter/FilterEngine.js";
import { defaultFilterQuery, type FilterQuery, type FilterState } from "../filter/types.js";
import { editorThemeName } from "../themes/runtime.js";
import type { DocumentSelection } from "../custom-blocks/selection.js";
import { candidateRelationState, type UnmatchedBehavior } from "../relations/model.js";
import { installSymbolPairing } from "../editor/symbolPairing.js";

type EditorApi = NonNullable<Window["latexEditor"]>;
export interface PreviewRelationUi {
  active: boolean;
  snapshot: BlockGraphSnapshot;
  transientToBlockId: Record<string, BlockId>;
  focusId: BlockId | null;
  direction: RelationDirection;
  matchIds: Set<BlockId>;
  contextIds: Set<BlockId>;
  unmatchedBehavior: UnmatchedBehavior;
  locateRequest?: { blockId: BlockId; nonce: number } | undefined;
  onFocus(blockId: BlockId): void;
  onToggle(blockId: BlockId, x: number, y: number): void;
}
type PreviewEditorServices = { api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; currentPath: string; definitions: EnvironmentDefinition[]; mathContext: MathContext; searchQuery: SearchQuery; activeSearchResult?: SearchResult | undefined; filterQuery: FilterQuery; filterStates: Map<string, FilterState>; relation?: PreviewRelationUi | undefined; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void; onForwardSync(path: string, line: number, column?: number): void };
interface BoundaryInsertion { targetId: string; position: number; side: "before" | "after" }
interface PreviewRenderBudget { remaining: number; }
const previewNodeLimit = 900;
const previewFilterEngine = new FilterEngine();

function sourceElement(node: Node | null, root: HTMLElement): HTMLElement | undefined {
  const element = node instanceof Element ? node : node?.parentElement;
  const result = element?.closest<HTMLElement>("[data-source-start-offset][data-source-end-offset]");
  return result && root.contains(result) ? result : undefined;
}

function previewDocumentSelection(root: HTMLElement, source: string, fileId: string): DocumentSelection | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const range = selection.getRangeAt(0);
  const startElement = sourceElement(range.startContainer, root);
  const endElement = sourceElement(range.endContainer, root);
  if (!startElement || !endElement) return undefined;
  let start = Number(startElement.dataset.sourceStartOffset);
  let end = Number(endElement.dataset.sourceEndOffset);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
  if (startElement === endElement) {
    const selectedText = selection.toString();
    const raw = source.slice(start, end);
    const relative = selectedText ? raw.indexOf(selectedText) : -1;
    if (relative >= 0 && raw.indexOf(selectedText, relative + selectedText.length) < 0) {
      start += relative;
      end = start + selectedText.length;
    }
  }
  if (end < start) [start, end] = [end, start];
  return end > start ? { fileId, start, end, origin: "preview" } : undefined;
}

function countNodes(nodes: PreviewNode[]): number {
  let count = 0;
  const pending = [...nodes];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    count += 1;
    if (node.kind === "block") pending.push(...node.children);
  }
  return count;
}

/** Keeps the initial Visual render bounded without discarding the parsed source. */
function takePreviewNodes(nodes: PreviewNode[], budget: PreviewRenderBudget): PreviewNode[] {
  const visible: PreviewNode[] = [];
  for (const node of nodes) {
    if (budget.remaining <= 0) break;
    budget.remaining -= 1;
    if (node.kind === "block") {
      const children = takePreviewNodes(node.children, budget);
      visible.push(children.length === node.children.length ? node : { ...node, children });
    } else {
      visible.push(node);
    }
  }
  return visible;
}

function plainLatex(value: string): string {
  return value
    .replace(/^\s*%.*$/gm, "")
    .replace(/%[^\n]*/g, "")
    .replace(/\\label\{[^}]+\}/g, "")
    .replace(/\\(?:begin|end)\{[^}]+\}/g, "")
    .replace(/\\(?:caption|section|subsection|subsubsection)\*?\{([^}]*)\}/g, "$1")
    .replace(/\\(?:textbf|textit|emph|textrm|texttt)\{([^}]*)\}/g, "$1")
    .replace(/\\(?:[A-Za-z]*cite[A-Za-z]*)\{([^}]*)\}/g, "[$1]")
    .replace(/\\(?:[A-Za-z]*ref[A-Za-z]*)\{([^}]*)\}/g, "[$1]")
    .replace(/\\(?:quad|qquad)/g, "  ")
    .replace(/\\,/g, " ")
    .replace(/\\([%&_#$])/g, "$1")
    .trim();
}

function highlightedText(value: string, query: SearchQuery, active: boolean, keyBase: number): ReactNode[] {
  const pattern = searchPattern(query).expression;
  if (!pattern || !value) return [<Fragment key={keyBase}>{value}</Fragment>];
  const expression = new RegExp(pattern.source, pattern.flags);
  const result: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of value.matchAll(expression)) {
    const start = match.index ?? 0;
    if (start > cursor) result.push(<Fragment key={`${keyBase}:t:${index++}`}>{value.slice(cursor, start)}</Fragment>);
    if (!match[0]) continue;
    result.push(<mark className={active ? "preview-search-match active" : "preview-search-match"} key={`${keyBase}:m:${index++}`}>{match[0]}</mark>);
    cursor = start + match[0].length;
  }
  if (cursor < value.length) result.push(<Fragment key={`${keyBase}:t:${index}`}>{value.slice(cursor)}</Fragment>);
  return result.length ? result : [<Fragment key={keyBase}>{value}</Fragment>];
}

function inlineLatex(value: string | undefined, mathContext: MathContext, searchQuery: SearchQuery = defaultInlineSearch, active = false): ReactNode[] {
  if (!value) return [];
  const clean = value.replace(/^\s*%.*$/gm, "").replace(/%[^\n]*/g, "").trim();
  const pattern = /\$\$([\s\S]*?)\$\$|\$(?!\$)([^$\n]+?)\$|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\\(textbf|textit|emph|texttt)\{([^{}]*)\}|\\([A-Za-z]*cite[A-Za-z]*)\{([^{}]*)\}|\\([A-Za-z]*ref[A-Za-z]*)\{([^{}]*)\}/g;
  const result: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of clean.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) result.push(...highlightedText(plainLatex(clean.slice(cursor, start)), searchQuery, active, index++));
    if (match[1] !== undefined) result.push(<MathRenderer key={index++} expression={match[1]} display context={mathContext}/>);
    else if (match[2] !== undefined) result.push(<MathRenderer key={index++} expression={match[2]} context={mathContext}/>);
    else if (match[3] !== undefined) result.push(<MathRenderer key={index++} expression={match[3]} context={mathContext}/>);
    else if (match[4] !== undefined) result.push(<MathRenderer key={index++} expression={match[4]} display context={mathContext}/>);
    else if (match[5] === "textbf") result.push(<strong key={index++}>{highlightedText(match[6] ?? "", searchQuery, active, index++)}</strong>);
    else if (match[5] === "texttt") result.push(<code key={index++}>{highlightedText(match[6] ?? "", searchQuery, active, index++)}</code>);
    else if (match[5]) result.push(<em key={index++}>{highlightedText(match[6] ?? "", searchQuery, active, index++)}</em>);
    else if (match[7]) result.push(<span className="preview-citation" key={index++} title={`\\${match[7]}`}>[{match[8]}]</span>);
    else result.push(<button type="button" className="preview-reference" data-reference={match[10]} key={index++} title={`\\${match[9]}`}>[{match[10]}]</button>);
    cursor = start + match[0].length;
  }
  if (cursor < clean.length) result.push(...highlightedText(plainLatex(clean.slice(cursor)), searchQuery, active, index));
  return result;
}

const defaultInlineSearch: SearchQuery = { text: "", caseSensitive: false, wholeWord: false, useRegex: false, scope: "current-file" };

interface PreviewListItem {
  startOffset: number;
  endOffset: number;
  label?: string;
}

/** Keep absolute ranges so nested math blocks can remain independent preview nodes. */
function listBodyRange(node: StructuralBlock, source: string): [number, number] {
  const full = nodeSource(node, source);
  const opening = /^\\begin\{[^}]+\}(?:\[[^\]]*\])?/s.exec(full)?.[0]?.length ?? 0;
  const closing = /\\end\{[^}]+\}\s*$/s.exec(full);
  const bodyStart = node.source.startOffset + opening;
  const bodyEnd = closing ? node.source.startOffset + closing.index : node.source.endOffset;
  return [bodyStart, Math.max(bodyStart, bodyEnd)];
}

function previewListItems(node: StructuralBlock, source: string): PreviewListItem[] {
  const [bodyStart, bodyEnd] = listBodyRange(node, source);
  const value = source.slice(bodyStart, bodyEnd);
  const matches = [...value.matchAll(/\\item(?:\[([^\]]+)\])?/g)];
  if (!matches.length) return [{ startOffset: bodyStart, endOffset: bodyEnd }];
  return matches.map((match, index) => {
    const contentStart = bodyStart + (match.index ?? 0) + match[0].length;
    const contentEnd = bodyStart + (matches[index + 1]?.index ?? value.length);
    return {
      startOffset: contentStart,
      endOffset: contentEnd,
      ...(match[1] ? { label: match[1] } : {})
    };
  });
}

function nodeSource(node: PreviewNode, source: string): string {
  return source.slice(node.source.startOffset, node.source.endOffset);
}

function labelOffset(source: string, label: string): number | undefined {
  const expression = /\\label\{([^}]+)\}/g;
  for (const match of source.matchAll(expression)) if (match[1] === label) return match.index ?? 0;
  return undefined;
}

function nodeAtOffset(nodes: PreviewNode[], offset: number): PreviewNode | undefined {
  for (const node of nodes) {
    if (offset < node.source.startOffset || offset > node.source.endOffset) continue;
    if (node.kind === "block") return nodeAtOffset(node.children, offset) ?? node;
    return node;
  }
  return undefined;
}

function nodeById(nodes: PreviewNode[], id: string): PreviewNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.kind === "block") {
      const nested = nodeById(node.children, id);
      if (nested) return nested;
    }
  }
  return undefined;
}

function nodeAtStart(nodes: PreviewNode[], startOffset: number, kind: PreviewNode["kind"]): PreviewNode | undefined {
  for (const node of nodes) {
    if (node.source.startOffset === startOffset && node.kind === kind) return node;
    if (node.kind === "block") {
      const nested = nodeAtStart(node.children, startOffset, kind);
      if (nested) return nested;
    }
  }
  return undefined;
}

function blockAtOffset(nodes: PreviewNode[], offset: number): StructuralBlock | undefined {
  let result: StructuralBlock | undefined;
  for (const node of nodes) {
    if (node.kind !== "block" || offset < node.source.startOffset || offset > node.source.endOffset) continue;
    result = node;
    result = blockAtOffset(node.children, offset) ?? result;
  }
  return result;
}

function nodesBefore(nodes: PreviewNode[], targetId: string): number | undefined {
  let count = 0;
  for (const node of nodes) {
    if (node.id === targetId) return count;
    count += 1;
    if (node.kind === "block") {
      const nested = nodesBefore(node.children, targetId);
      if (nested !== undefined) return count + nested;
      count += countNodes(node.children);
    }
  }
  return undefined;
}

function bodySource(node: StructuralBlock, source: string): string {
  if (node.children.length) {
    const first = node.children[0];
    const last = node.children.at(-1);
    if (first && last) return source.slice(first.source.startOffset, last.source.endOffset);
  }
  return nodeSource(node, source).replace(/^.*?\\begin\{[^}]+\}(?:\[[^\]]*\])?\s*/s, "").replace(/\s*\\end\{[^}]+\}.*$/s, "").replace(/^\\\[/, "").replace(/\\\]$/, "");
}

/** Removes only the outer math wrapper; nested aligned/cases environments are valid TeX. */
function mathBodySource(node: StructuralBlock, source: string): string {
  return nodeSource(node, source)
    .replace(/^\s*\\begin\{[^}]+\}(?:\[[^\]]*\])?\s*/s, "")
    .replace(/\s*\\end\{[^}]+\}\s*$/s, "")
    .replace(/^\s*\\\[/, "")
    .replace(/\\\]\s*$/, "")
    .replace(/^\s*%.*$/gm, "")
    .replace(/\\label\{[^}]+\}/g, "")
    .trim();
}

function isListEnvironment(environmentId: string): boolean {
  return /^(itemize|enumerate|description)$/.test(environmentId);
}

function environmentLabel(definition: EnvironmentDefinition | undefined, id: string): string {
  if (definition) return definition.label ?? t(definition.labelKey as MessageKey) ?? definition.id;
  if (id.startsWith("virtual:")) return id.slice("virtual:".length).replaceAll("-", " ").toLocaleUpperCase();
  if (id.startsWith("custom:")) return `${t("environment.custom")} · ${id.slice("custom:".length)}`;
  return id.replaceAll("-", " ").toLocaleUpperCase();
}

function SpecializedContent({ node, source, mathContext, searchQuery, activeSearch }: { node: StructuralBlock; source: string; mathContext: MathContext; searchQuery: SearchQuery; activeSearch: boolean }) {
  const raw = bodySource(node, source);
  const definitionId = node.environmentId;
  if (/equation|align|gather|multline|display-math/.test(definitionId)) {
    const mathBody = mathBodySource(node, source);
    const environment = definitionId.replace(/-star$/, "");
    const expression = /^(align|gather|multline)$/.test(environment) ? `\\begin{${environment}}${mathBody}\\end{${environment}}` : mathBody;
    return <MathRenderer expression={expression} display context={mathContext}/>;
  }
  if (/verbatim|lstlisting/.test(definitionId)) return <pre className="preview-code">{raw.trim()}</pre>;
  if (definitionId === "figure") {
    const image = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/.exec(raw)?.[1];
    const caption = /\\caption\{([^}]*)\}/.exec(raw)?.[1];
    return <figure className="preview-figure"><div className="preview-media">{image ? `Image · ${image}` : t("preview.figurePlaceholder")}</div>{caption && <figcaption>{inlineLatex(caption, mathContext, searchQuery, activeSearch)}</figcaption>}</figure>;
  }
  if (definitionId === "table") {
    const tabular = /\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/.exec(raw)?.[1] ?? raw;
    return <div className="preview-table"><pre>{plainLatex(tabular).replaceAll("\\\\", "\n")}</pre></div>;
  }
  return null;
}

function ListContent({ node, source, mathContext, searchQuery, activeSearch, renderChild }: { node: StructuralBlock; source: string; mathContext: MathContext; searchQuery: SearchQuery; activeSearch: boolean; renderChild(child: PreviewNode): ReactNode }) {
  const items = previewListItems(node, source);
  const Tag = node.environmentId === "enumerate" ? "ol" : "ul";
  const renderItem = (item: PreviewListItem, itemIndex: number) => {
    const children = node.children.filter((child) => child.source.startOffset < item.endOffset && child.source.endOffset > item.startOffset);
    const content: ReactNode[] = [];
    let cursor = item.startOffset;
    const addText = (start: number, end: number, key: string) => {
      if (end <= start) return;
      content.push(<Fragment key={key}>{inlineLatex(source.slice(start, end), mathContext, searchQuery, activeSearch)}</Fragment>);
    };
    for (const child of children) {
      const start = Math.max(cursor, item.startOffset);
      const end = Math.min(child.source.startOffset, item.endOffset);
      addText(start, end, `text:${itemIndex}:${start}`);
      if (child.kind === "block") {
        content.push(<Fragment key={child.id}>{renderChild(child)}</Fragment>);
      } else {
        addText(Math.max(child.source.startOffset, item.startOffset), Math.min(child.source.endOffset, item.endOffset), `content:${child.id}`);
      }
      cursor = Math.max(cursor, child.source.endOffset);
    }
    addText(Math.max(cursor, item.startOffset), item.endOffset, `tail:${itemIndex}`);
    return <li key={`${item.startOffset}:${itemIndex}`}>{item.label && <strong>{inlineLatex(item.label, mathContext, searchQuery, activeSearch)} </strong>}{content}</li>;
  };
  return <Tag className="preview-list">{items.map(renderItem)}</Tag>;
}

function LocalEditor({ value, onApply, onCancel, onInsertBefore, onInsertAfter, mathDraft = false, sourceStartLine = 1, api, projectId, tree, currentPath, definitions, mathContext, onSpellContextMenu, onDetectedLanguage, onForwardSync }: { value: string; onApply(value: string): void; onCancel(): void; onInsertBefore?(draft: string): void; onInsertAfter?(draft: string): void; mathDraft?: boolean; sourceStartLine?: number; api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; currentPath: string; definitions: EnvironmentDefinition[]; mathContext: MathContext; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void; onForwardSync(path: string, line: number, column?: number): void }) {
  const preferences = useSettings();
  const [draft, setDraft] = useState(value);
  const [cursorMath, setCursorMath] = useState<{ expression: string; displayMode: boolean; start: number; end: number }>();
  const [mathAnchor, setMathAnchor] = useState<DOMRect>();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const localEditorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const draftRef = useRef(value);
  const applyRef = useRef(onApply);
  const cancelRef = useRef(onCancel);
  const completionController = useRef<CompletionController | null>(null);
  const spellCheckController = useRef<SpellCheckController | null>(null);
  const contextActions = useRef<{ dispose(): void } | null>(null);
  const symbolPairing = useRef<{ dispose(): void } | null>(null);
  const mode = preferences.get("spellCheckMode");
  const language = preferences.get("spellCheckLanguage");
  draftRef.current = draft;
  applyRef.current = onApply;
  cancelRef.current = onCancel;
  useEffect(() => () => { completionController.current?.dispose(); spellCheckController.current?.dispose(); contextActions.current?.dispose(); symbolPairing.current?.dispose(); }, []);
  useEffect(() => { spellCheckController.current?.refresh(); }, [mode, language]);
  useEffect(() => {
    const registrations = [
      commands.register("preview.applyDraft", { execute: () => applyRef.current(draftRef.current) }),
      commands.register("preview.cancelDraft", { execute: () => cancelRef.current() }),
      commands.register("block.insertBefore", { when: () => !!onInsertBefore, execute: () => onInsertBefore?.(draftRef.current) }),
      commands.register("block.insertAfter", { when: () => !!onInsertAfter, execute: () => onInsertAfter?.(draftRef.current) })
    ];
    return () => registrations.forEach((dispose) => dispose());
  }, []);
  const onMount: OnMount = (editor, monaco) => {
    localEditorRef.current = editor;
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
      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position) { setCursorMath(undefined); return; }
      if (model.getVersionId() !== indexedVersion) {
        indexedVersion = model.getVersionId();
        mathIndex = MathNodeIndex.fromSource(model.getValue());
      }
      const node = mathIndex.findMathNodeAtOffset(model.getOffsetAt(position));
      if (!node) { setCursorMath(undefined); return; }
      const extracted = extractMathExpression(model.getValue().slice(node.start, node.end));
      setCursorMath({ ...extracted, start: node.start, end: node.end });
    };
    editor.onDidChangeCursorPosition(updateCursorMath);
    editor.onDidChangeModelContent(() => { indexedVersion = -1; updateCursorMath(); });
    editor.onDidBlurEditorWidget(() => setCursorMath(undefined));
    updateCursorMath();
    if (!api) return;
    completionController.current = new CompletionController({ monaco, api, projectId, getTree: () => tree, getCurrentPath: () => currentPath, getEnvironments: () => definitions, isDocumentWordCompletionEnabled: () => preferences.get("documentWordCompletion") });
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
  return <><div ref={editorShellRef} className="preview-local-editor" onClick={(event) => event.stopPropagation()}>
    {activeMath && mathAnchor && <MathPreviewPopover source={activeMath.expression} displayMode={activeMath.displayMode} context={mathContext} anchor={mathAnchor} className="preview-draft-math"/>}
    <Editor height="150px" language="latex" value={draft} onChange={(next) => { const value = next ?? ""; draftRef.current = value; setDraft(value); }} theme={editorThemeName(preferences.get("theme"))} options={{ minimap: { enabled: false }, lineNumbers: "off", folding: false, fontSize: preferences.get("fontSize"), tabSize: preferences.get("tabSize"), wordWrap: preferences.get("wordWrap") ? "on" : "off", lineHeight: 23, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 10 }, quickSuggestions: { other: true, comments: true, strings: true }, suggestOnTriggerCharacters: true, autoClosingBrackets: "never", autoClosingQuotes: "always", autoSurround: "never" }} onMount={onMount} />
    <div className="preview-local-editor-actions"><span>{t("preview.editHint")}</span>{onInsertBefore && onInsertAfter && <div className="preview-line-actions"><button title={t("preview.insertLineBefore")} onClick={() => onInsertBefore(draftRef.current)}>↥＋</button><button title={t("preview.insertLineAfter")} onClick={() => onInsertAfter(draftRef.current)}>↧＋</button></div>}<button onClick={onCancel}>{t("preview.cancel")}</button><button className="primary" onClick={() => onApply(draft)}>{t("preview.apply")}</button></div>
  </div>{confirmLeave && createPortal(<div className="preview-confirm-backdrop"><section className="preview-confirm-dialog" role="dialog" aria-modal="true" aria-label={t("preview.unsavedTitle")}><h2>{t("preview.unsavedTitle")}</h2><p>{t("preview.unsavedMessage")}</p><div><button autoFocus className="primary" onClick={() => { setConfirmLeave(false); applyRef.current(draftRef.current); }}>{t("preview.yes")}</button><button onClick={() => { setConfirmLeave(false); cancelRef.current(); }}>{t("preview.no")}</button></div></section></div>, document.body)}</>;
}

function ContentRenderer({ node, source, editing, boundary, beginEdit, applyEdit, applyBoundary, cancelEdit, requestBoundary, services }: { node: ContentRegion; source: string; editing: boolean; boundary?: BoundaryInsertion | undefined; beginEdit(): void; applyEdit(value: string): void; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; services: PreviewEditorServices }) {
  const insertion = boundary?.targetId === node.id ? boundary : undefined;
  const filterState = services.filterStates.get(node.id) ?? "match";
  if (services.filterQuery.enabled && filterState === "unmatched" && !editing && !insertion) {
    if (services.filterQuery.viewMode === "remove") return null;
    if (services.filterQuery.viewMode === "collapse") return <div className="preview-filter-collapsed">⋯ 1 {t("filter.blockCollapsed")}</div>;
  }
  const activeSearch = services.activeSearchResult ? services.activeSearchResult.matchStart >= node.source.startOffset && services.activeSearchResult.matchEnd <= node.source.endOffset : false;
  const effectiveSearch = services.filterQuery.enabled && filterState !== "match" ? defaultInlineSearch : services.searchQuery;
  const filterClass = services.filterQuery.enabled ? `filter-${filterState} filter-view-${services.filterQuery.viewMode}` : "";
  return <Fragment>
    {insertion?.side === "before" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onCancel={cancelEdit} {...services}/>}
    {editing ? <LocalEditor value={nodeSource(node, source)} sourceStartLine={node.source.startLine} onApply={applyEdit} onCancel={cancelEdit} onInsertBefore={(draft) => requestBoundary(node, "before", draft)} onInsertAfter={(draft) => requestBoundary(node, "after", draft)} {...services}/> : <div className={`preview-content-region ${filterClass} ${activeSearch ? "search-result-active" : ""}`} data-node-id={node.id} data-source-line={node.source.startLine} data-source-start-offset={node.source.startOffset} data-source-end-offset={node.source.endOffset} onClick={(event) => { event.stopPropagation(); if (window.getSelection()?.isCollapsed !== false) beginEdit(); }}>{inlineLatex(node.raw, services.mathContext, effectiveSearch, activeSearch)}</div>}
    {insertion?.side === "after" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onCancel={cancelEdit} {...services}/>}
  </Fragment>;
}

function isMathBlock(node: StructuralBlock): boolean {
  return /equation|align|gather|multline|display-math|aligned|split|cases/.test(node.environmentId);
}

function BlockRenderer({ node, source, definitions, selectedId, editingId, boundary, select, edit, applyEdit, applyBoundary, cancelEdit, requestBoundary, services, budget }: { node: StructuralBlock; source: string; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; boundary?: BoundaryInsertion | undefined; select(id: string): void; edit(id: string): void; applyEdit(node: PreviewNode, value: string): void; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; services: PreviewEditorServices; budget: PreviewRenderBudget }) {
  const definition = definitionForId(definitions, node.environmentId);
  const family = definition?.family ?? (node.origin === "virtual" ? "virtual" : "generic");
  const editing = editingId === node.id;
  const selected = selectedId === node.id;
  const filterState = services.filterStates.get(node.id) ?? "match";
  const activeSearch = services.activeSearchResult ? services.activeSearchResult.matchStart >= node.source.startOffset && services.activeSearchResult.matchEnd <= node.source.endOffset : false;
  const effectiveSearch = services.filterQuery.enabled && filterState !== "match" ? defaultInlineSearch : services.searchQuery;
  const listEnvironment = isListEnvironment(node.environmentId);
  const specialized = SpecializedContent({ node, source, mathContext: services.mathContext, searchQuery: effectiveSearch, activeSearch });
  const specializedContent = listEnvironment
    ? <ListContent node={node} source={source} mathContext={services.mathContext} searchQuery={effectiveSearch} activeSearch={activeSearch} renderChild={(child) => <PreviewNodeRenderer key={child.id} node={child} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} boundary={boundary} select={select} edit={edit} applyEdit={applyEdit} applyBoundary={applyBoundary} cancelEdit={cancelEdit} requestBoundary={requestBoundary} services={services} budget={budget}/>} />
    : specialized;
  const cssValue = (value: string | undefined, fallback: string) => value ? (value.startsWith("--") ? `var(${value})` : value) : `var(${fallback})`;
  const insertion = boundary?.targetId === node.id ? boundary : undefined;
  const semanticId = services.relation?.transientToBlockId[node.id];
  const relationState = semanticId && services.relation?.active
    ? candidateRelationState(services.relation.snapshot, services.relation.focusId, semanticId, services.relation.direction)
    : undefined;
  const relationMatches = semanticId ? services.relation?.matchIds.has(semanticId) ?? true : true;
  const relationContext = semanticId ? services.relation?.contextIds.has(semanticId) ?? false : false;
  if (services.relation?.active && services.relation.unmatchedBehavior === "hide" && semanticId && !relationMatches && !relationContext && !editing && !insertion) return null;
  if (services.filterQuery.enabled && filterState === "unmatched" && !editing && !insertion) {
    if (services.filterQuery.viewMode === "remove") return null;
    if (services.filterQuery.viewMode === "collapse") return <div className="preview-filter-collapsed">⋯ 1 {t("filter.blockCollapsed")}</div>;
  }
  const filterClass = services.filterQuery.enabled ? `filter-${filterState} filter-view-${services.filterQuery.viewMode}` : "";
  return <Fragment>
    {insertion?.side === "before" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onCancel={cancelEdit} {...services}/>}
    <section className={`preview-block env-${family} ${filterClass} ${activeSearch ? "search-result-active" : ""} ${selected ? "selected" : ""} ${editing ? "editing" : ""} ${services.relation?.active && !relationMatches ? "relation-unmatched" : ""} ${semanticId === services.relation?.focusId ? "relation-focus" : ""}`} data-environment={node.environmentId} data-semantic-block-id={semanticId} data-source-line={node.source.startLine} data-source-start-offset={node.source.startOffset} data-source-end-offset={node.source.endOffset} onDoubleClickCapture={(event) => { const target = event.target as Element; if (target.closest(".preview-local-editor") || target.closest(".preview-block") !== event.currentTarget) return; event.preventDefault(); event.stopPropagation(); services.onForwardSync(services.currentPath, node.source.startLine, 1); }} style={{ "--block-accent": cssValue(definition?.style.accentToken, "--env-generic-accent"), "--block-fill": cssValue(definition?.style.fillToken, "--env-generic-fill"), "--block-border": cssValue(definition?.style.borderToken, "--env-border-default"), "--block-selected-border": cssValue(definition?.style.selectedBorderToken, "--env-border-selected"), "--block-label-bg": cssValue(definition?.style.labelBackgroundToken, "--env-generic-label-bg"), "--block-label-text": cssValue(definition?.style.labelTextToken, "--env-generic-label-text") } as CSSProperties}>
    {(definition?.behavior.showHeader ?? true) && <div className="preview-block-header"><button className="preview-block-header-main" onClick={(event) => { event.stopPropagation(); select(node.id); }}><span>{environmentLabel(definition, node.environmentId)}</span>{node.title && <strong>{node.title}</strong>}{node.latexLabel && <small>{node.latexLabel}</small>}</button>{(selected || (services.relation?.active && semanticId)) && <div className="preview-block-header-actions">{services.relation?.active && semanticId && <><button className={semanticId === services.relation.focusId ? "relation-control active" : "relation-control"} title={t("relation.setFocus")} onClick={(event) => { event.stopPropagation(); services.relation?.onFocus(semanticId); }}>◎</button><button className="relation-control" disabled={!!relationState?.disabledReason} title={relationState?.disabledReason ? t(`relation.invalid.${relationState.disabledReason}`) : relationState?.existing ? t("relation.remove") : t("relation.add")} onClick={(event) => { event.stopPropagation(); services.relation?.onToggle(semanticId, event.clientX, event.clientY); }}>{relationState?.existing ? relationState.existingDirection === "prerequisite" ? "← −" : "→ −" : "+"}</button></>}{selected && <><button title={t("preview.insertBefore")} onClick={(event) => { event.stopPropagation(); requestBoundary(node, "before"); }}>↥＋</button><button title={t("preview.insertAfter")} onClick={(event) => { event.stopPropagation(); requestBoundary(node, "after"); }}>↧＋</button></>}</div>}</div>}
    <div className="preview-block-body" onClick={(event) => {
       if (specializedContent && (definition?.behavior.inlineEditable ?? true)) { event.stopPropagation(); edit(node.id); }
     }}>
       {editing ? <LocalEditor value={nodeSource(node, source)} sourceStartLine={node.source.startLine} mathDraft={isMathBlock(node)} onApply={(value) => applyEdit(node, value)} onCancel={cancelEdit} onInsertBefore={(draft) => requestBoundary(node, "before", draft)} onInsertAfter={(draft) => requestBoundary(node, "after", draft)} {...services}/> : specializedContent ?? <PreviewNodeList nodes={node.children} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} boundary={boundary} select={select} edit={edit} applyEdit={applyEdit} applyBoundary={applyBoundary} cancelEdit={cancelEdit} requestBoundary={requestBoundary} services={services} budget={budget}/> }
    </div>
    <div className="preview-block-footer">
      <button className="preview-block-footer-main" title={environmentLabel(definition, node.environmentId)} onClick={(event) => { event.stopPropagation(); select(node.id); }}><span/></button>
      {selected && <div className="preview-block-footer-actions"><button title={t("preview.insertBefore")} onClick={(event) => { event.stopPropagation(); requestBoundary(node, "before"); }}>↥＋</button><button title={t("preview.insertAfter")} onClick={(event) => { event.stopPropagation(); requestBoundary(node, "after"); }}>↧＋</button></div>}
    </div>
    </section>
    {insertion?.side === "after" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onCancel={cancelEdit} {...services}/>}
  </Fragment>;
}

function PreviewNodeRenderer(props: { node: PreviewNode; source: string; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; boundary?: BoundaryInsertion | undefined; select(id: string): void; edit(id: string): void; applyEdit(node: PreviewNode, value: string): void; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; services: PreviewEditorServices; budget: PreviewRenderBudget }) {
  if (props.budget.remaining <= 0) return null;
  props.budget.remaining -= 1;
  if (props.node.kind === "block") return <BlockRenderer {...props} node={props.node}/>;
  return <ContentRenderer node={props.node} source={props.source} editing={props.editingId === props.node.id} boundary={props.boundary} beginEdit={() => props.edit(props.node.id)} applyEdit={(value) => props.applyEdit(props.node, value)} applyBoundary={props.applyBoundary} cancelEdit={props.cancelEdit} requestBoundary={props.requestBoundary} services={props.services}/>;
}

function PreviewNodeList({ nodes, ...props }: { nodes: PreviewNode[] } & Omit<Parameters<typeof PreviewNodeRenderer>[0], "node">) {
  const rendered: ReactNode[] = [];
  for (let index = 0; index < nodes.length;) {
    const node = nodes[index];
    if (!node) break;
    const collapsible = props.services.filterQuery.enabled && props.services.filterQuery.viewMode === "collapse" && props.services.filterStates.get(node.id) === "unmatched" && props.editingId !== node.id && props.boundary?.targetId !== node.id;
    if (!collapsible) { rendered.push(<PreviewNodeRenderer key={node.id} node={node} {...props}/>); index += 1; continue; }
    let end = index + 1;
    while (end < nodes.length) {
      const next = nodes[end];
      if (!next || props.services.filterStates.get(next.id) !== "unmatched" || props.editingId === next.id || props.boundary?.targetId === next.id) break;
      end += 1;
    }
    rendered.push(<div className="preview-filter-collapsed" key={`collapsed:${node.id}`}>⋯ {end - index} {t("filter.blocksCollapsed")}</div>);
    index = end;
  }
  return rendered;
}

export function PreviewPane({ filePath, source, definitions, mathContext = EMPTY_MATH_CONTEXT, searchQuery = defaultInlineSearch, filterQuery = defaultFilterQuery, activeSearchResult, highlightRange, relation, onSourceChange, onSelectionChange, onSelectionContextMenu, onViewportAnchorChange, api, projectId, tree, onSpellContextMenu, onDetectedLanguage, onForwardSync }: { filePath?: string | undefined; source?: string | undefined; definitions: EnvironmentDefinition[]; mathContext?: MathContext; searchQuery?: SearchQuery; filterQuery?: FilterQuery; activeSearchResult?: SearchResult | undefined; highlightRange?: { fileId: string; start: number; end: number; nonce: number } | undefined; relation?: PreviewRelationUi | undefined; onSourceChange(next: string): void; onSelectionChange?(selection?: DocumentSelection): void; onSelectionContextMenu?(selection: DocumentSelection, x: number, y: number): void; onViewportAnchorChange?(anchor: { fileId: string; offset: number }): void; api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void; onForwardSync(path: string, line: number, column?: number): void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [boundary, setBoundary] = useState<BoundaryInsertion>();
  const [renderLimit, setRenderLimit] = useState(previewNodeLimit);
  const [pendingReferenceOffset, setPendingReferenceOffset] = useState<number>();
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const pendingBoundaryRef = useRef<{ startOffset: number; position: number; side: "before" | "after"; kind: PreviewNode["kind"] } | undefined>(undefined);
  const document = useMemo(() => filePath && source !== undefined ? parsePreview(source, filePath, definitions) : undefined, [filePath, source, definitions]);
  const filterEvaluation = useMemo(() => document && source !== undefined && filePath ? previewFilterEngine.evaluate(document.nodes, source, filePath, filterQuery) : undefined, [document, source, filePath, filterQuery]);
  useEffect(() => { pendingBoundaryRef.current = undefined; setRenderLimit(previewNodeLimit); setEditingId(undefined); setSelectedId(undefined); setBoundary(undefined); }, [filePath]);
  useEffect(() => {
    const pending = pendingBoundaryRef.current;
    if (pending && document) {
      const target = nodeAtStart(document.nodes, pending.startOffset, pending.kind);
      pendingBoundaryRef.current = undefined;
      setEditingId(undefined);
      setSelectedId(undefined);
      setBoundary(target ? { targetId: target.id, position: pending.position, side: pending.side } : undefined);
      return;
    }
    setEditingId(undefined);
    setBoundary(undefined);
  }, [source]);
  const requestBoundary = (node: PreviewNode, side: "before" | "after", draft?: string) => {
    const original = nodeSource(node, source ?? "");
    if (draft !== undefined && draft !== original && source !== undefined) {
      const nextSource = source.slice(0, node.source.startOffset) + draft + source.slice(node.source.endOffset);
      pendingBoundaryRef.current = { startOffset: node.source.startOffset, position: side === "before" ? node.source.startOffset : node.source.startOffset + draft.length, side, kind: node.kind };
      onSourceChange(nextSource);
      return;
    }
    setEditingId(undefined);
    setSelectedId(undefined);
    setBoundary({ targetId: node.id, position: side === "before" ? node.source.startOffset : node.source.endOffset, side });
  };
  useEffect(() => {
    const selected = selectedId && document ? nodeById(document.nodes, selectedId) : undefined;
    const selectedBlock = selected?.kind === "block" ? selected : undefined;
    const registrations = [
      commands.register("block.insertBefore", { when: () => !!selectedBlock && !boundary && !editingId, execute: () => { if (selectedBlock) requestBoundary(selectedBlock, "before"); } }),
      commands.register("block.insertAfter", { when: () => !!selectedBlock && !boundary && !editingId, execute: () => { if (selectedBlock) requestBoundary(selectedBlock, "after"); } })
    ];
    return () => registrations.forEach((dispose) => dispose());
  }, [selectedId, document, boundary, editingId]);
  useEffect(() => {
    if (pendingReferenceOffset === undefined || !document) return;
    const node = nodeAtOffset(document.nodes, pendingReferenceOffset);
    if (!node) return;
    const target = globalThis.document.querySelector<HTMLElement>(`[data-source-start-offset="${node.source.startOffset}"]`) ?? (() => {
      const block = blockAtOffset(document.nodes, pendingReferenceOffset);
      return block ? globalThis.document.querySelector<HTMLElement>(`[data-source-start-offset="${block.source.startOffset}"]`) : null;
    })();
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("reference-target");
    const timer = window.setTimeout(() => target.classList.remove("reference-target"), 700);
    setPendingReferenceOffset(undefined);
    return () => window.clearTimeout(timer);
  }, [document, pendingReferenceOffset, renderLimit]);
  useEffect(() => {
    if (!activeSearchResult || activeSearchResult.fileId !== filePath || !document) return;
    const node = nodeAtOffset(document.nodes, activeSearchResult.matchStart);
    if (!node) return;
    const target = globalThis.document.querySelector<HTMLElement>(`.structured-preview [data-source-start-offset="${node.source.startOffset}"]`);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSearchResult, filePath, document, renderLimit]);
  useEffect(() => {
    const root = previewRootRef.current;
    if (!root || !highlightRange || highlightRange.fileId !== filePath) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>("[data-source-start-offset][data-source-end-offset]")).filter((element) => {
      const start = Number(element.dataset.sourceStartOffset);
      const end = Number(element.dataset.sourceEndOffset);
      return start < highlightRange.end && highlightRange.start < end;
    });
    for (const target of targets) target.classList.add("custom-block-created-highlight");
    const timer = window.setTimeout(() => targets.forEach((target) => target.classList.remove("custom-block-created-highlight")), 900);
    return () => window.clearTimeout(timer);
  }, [highlightRange, filePath, document, renderLimit]);
  useEffect(() => {
    const request = relation?.locateRequest;
    const root = previewRootRef.current;
    if (!request || !root) return;
    const target = Array.from(root.querySelectorAll<HTMLElement>("[data-semantic-block-id]")).find((element) => element.dataset.semanticBlockId === request.blockId);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("relation-locate-highlight");
    const timer = window.setTimeout(() => target.classList.remove("relation-locate-highlight"), 900);
    return () => window.clearTimeout(timer);
  }, [relation?.locateRequest, renderLimit]);
  useEffect(() => {
    const root = previewRootRef.current;
    if (!root || !filePath || !onViewportAnchorChange) return;
    let frame = 0;
    const reportAnchor = () => {
      frame = 0;
      const rootRect = root.getBoundingClientRect();
      const centerY = rootRect.top + root.clientHeight / 2;
      const elements = Array.from(root.querySelectorAll<HTMLElement>("[data-source-start-offset][data-source-end-offset]"));
      let best: { element: HTMLElement; distance: number; contains: boolean } | undefined;
      for (const element of elements) {
        const rect = element.getBoundingClientRect();
        if (rect.height <= 0 || rect.bottom < rootRect.top || rect.top > rootRect.bottom) continue;
        const contains = rect.top <= centerY && centerY <= rect.bottom;
        const distance = contains ? rect.height : Math.min(Math.abs(rect.top - centerY), Math.abs(rect.bottom - centerY)) + 10_000;
        if (!best || distance < best.distance) best = { element, distance, contains };
      }
      if (!best) return;
      const start = Number(best.element.dataset.sourceStartOffset);
      const end = Number(best.element.dataset.sourceEndOffset);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return;
      const rect = best.element.getBoundingClientRect();
      const progress = best.contains && rect.height > 1 ? Math.min(1, Math.max(0, (centerY - rect.top) / rect.height)) : centerY < rect.top ? 0 : 1;
      onViewportAnchorChange({ fileId: filePath, offset: Math.round(start + (end - start) * progress) });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(reportAnchor); };
    root.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => { root.removeEventListener("scroll", schedule); if (frame) cancelAnimationFrame(frame); };
  }, [filePath, document, renderLimit, onViewportAnchorChange]);
  if (!filePath || source === undefined) return <div className="preview-empty"><h2>{t("preview.noSourceTitle")}</h2><p>{t("preview.noSource")}</p></div>;
  if (!filePath.toLocaleLowerCase().endsWith(".tex")) return <div className="preview-empty"><h2>{t("preview.unsupportedFileTitle")}</h2><p>{t("preview.unsupportedFile")}</p></div>;
  const services: PreviewEditorServices = { api, projectId, tree, currentPath: filePath, definitions, mathContext, searchQuery, activeSearchResult: activeSearchResult?.fileId === filePath ? activeSearchResult : undefined, filterQuery, filterStates: filterEvaluation?.states ?? new Map(), relation, onSpellContextMenu, onDetectedLanguage, onForwardSync };
  const applyEdit = (node: PreviewNode, replacement: string) => {
    onSourceChange(source.slice(0, node.source.startOffset) + replacement + source.slice(node.source.endOffset));
    setEditingId(undefined);
  };
  const applyBoundary = (insertion: BoundaryInsertion, value: string) => {
    const content = value.replace(/^\n+|\n+$/g, "");
    const replacement = insertion.side === "before" ? `${content}${content ? "\n" : ""}\n` : `\n${content ? `\n${content}` : ""}`;
    onSourceChange(source.slice(0, insertion.position) + replacement + source.slice(insertion.position));
    setBoundary(undefined);
  };
  const totalNodes = document ? countNodes(document.nodes) : 0;
  const visibleBudget: PreviewRenderBudget = { remaining: renderLimit };
  const visibleNodes = document ? takePreviewNodes(document.nodes, visibleBudget) : [];
  const shownNodes = countNodes(visibleNodes);
  const onPreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest(".preview-local-editor, .preview-block-header-actions, .preview-block-footer-actions")) return;
    const reference = (event.target as Element).closest<HTMLElement>("[data-reference]")?.dataset.reference;
    if (reference && document) {
      event.stopPropagation();
      const offset = labelOffset(source, reference);
      const node = offset === undefined ? undefined : nodeAtOffset(document.nodes, offset);
      if (offset !== undefined && node) {
        setPendingReferenceOffset(offset);
        const required = nodesBefore(document.nodes, node.id);
        if (required !== undefined && required >= renderLimit) setRenderLimit(Math.min(totalNodes, required + 1));
      }
      return;
    }
    setSelectedId(undefined);
    setBoundary(undefined);
  };
  const emitSelection = () => {
    const selection = previewRootRef.current ? previewDocumentSelection(previewRootRef.current, source, filePath) : undefined;
    onSelectionChange?.(selection);
    return selection;
  };
  return <div ref={previewRootRef} className="structured-preview" onClickCapture={onPreviewClick} onMouseUp={() => emitSelection()} onKeyUp={() => emitSelection()} onContextMenu={(event) => {
    const selection = emitSelection();
    if (!selection || !onSelectionContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectionContextMenu(selection, event.clientX, event.clientY);
  }}>
    <article><PreviewNodeList nodes={visibleNodes} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} boundary={boundary} select={(id) => { setSelectedId(id); setEditingId(undefined); setBoundary(undefined); }} edit={(id) => { setEditingId(id); setSelectedId(undefined); setBoundary(undefined); }} applyEdit={applyEdit} applyBoundary={applyBoundary} cancelEdit={() => { setEditingId(undefined); setBoundary(undefined); }} requestBoundary={requestBoundary} services={services} budget={{ remaining: Number.MAX_SAFE_INTEGER }}/></article>
    {totalNodes > shownNodes && <aside className="preview-limit-notice"><strong>{t("preview.largeDocumentTitle")}</strong><span>{t("preview.largeDocumentMessage", { shown: shownNodes, total: totalNodes })}</span><button onClick={(event) => { event.stopPropagation(); setRenderLimit((value) => value + previewNodeLimit); }}>{t("preview.loadMore")}</button></aside>}
    {filterQuery.enabled && filterEvaluation && filterEvaluation.matches.size === 0 && <aside className="preview-filter-empty">{t("filter.noMatches")}</aside>}
    {document?.diagnostics.length ? <aside className="preview-diagnostics"><strong>{t("preview.recovered")}</strong>{document.diagnostics.map((message, index) => <p key={index}>{message}</p>)}</aside> : null}
  </div>;
}
