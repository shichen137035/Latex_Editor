import { Fragment, memo, Profiler, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { includeNewBuiltInDirectives, isRelationCapableBlock, type BlockGraphSnapshot, type BlockId, type PreviewDirectiveDefinition, type ProjectTreeNode, type RelationDirection } from "@latex-editor/contracts";
import { t, type MessageKey } from "../i18n/index.js";
import { definitionForId } from "./environments.js";
import { environmentBlockStyle } from "./environment-block-style.js";
import { parsePreview } from "./parser.js";
import type { ContentRegion, EnvironmentDefinition, PreviewDocument, PreviewNode, SourceSpan, StructuralBlock } from "./types.js";
import { adjacentVisibleBlockId, buildPreviewRenderIndex, estimatedPreviewHeight, previewPath, reusePreviewDocument } from "./renderModel.js";
import { tryIncrementalPreviewUpdate, type PreviewChangeSet, type PreviewFallbackReason, type PreviewSourceTransaction, type PreviewTextChange } from "./incremental.js";
import { VirtualPreviewController, VirtualPreviewList } from "./VirtualPreview.js";
import "./preview.css";
import type { SpellContextRequest } from "../spellcheck/SpellCheckController.js";
import { useSettings } from "../settings/service.js";
import { MathRenderer } from "./MathRenderer.js";
import { mathRenderService } from "../math/MathRenderService.js";
import { bindings, commands, eventBinding } from "../settings/commands.js";
import { EMPTY_MATH_CONTEXT, type MathContext } from "../math/types.js";
import { inlineMatchRanges } from "../search/inlineMatches.js";
import type { InlineSearchQuery, SearchQuery, SearchResult } from "../search/types.js";
import { FilterEngine } from "../filter/FilterEngine.js";
import { combineFilterStates, defaultFilterQuery, filterDisposition, type FilterQuery, type FilterState } from "../filter/types.js";
import type { DocumentSelection } from "../custom-blocks/selection.js";
import { candidateRelationState } from "../relations/model.js";
import { convertBlockEnvironmentSource, definitionConversionGroup, environmentDefinitionsCompatible, environmentDisplayName, EnvironmentPickerPanel, environmentConversionGroup } from "./EnvironmentPicker.js";
import { unwrapLatexEnvironment } from "./sourceOperations.js";
import { FigurePreview } from "../figure/FigurePreview.js";
import { parseGraphicPaths } from "../figure/parser.js";
import type { FigureSelection } from "../figure/FigureInspector.js";
import { TablePreview } from "../table/TablePreview.js";
import type { TableSelection } from "../table/model.js";
import { tokenizeInlineSource, type InlineSourceToken } from "./inlineSource.js";
import { sourceOffsetAtPoint } from "./sourceMapping.js";
import { upsertBlockLabel } from "./labels.js";
import { PreviewLocalEditor } from "./PreviewLocalEditor.js";
import { captionSourceField, environmentOptionField, replaceSourceField, type PreviewSourceField } from "./sourceFields.js";
import { useUnsavedChanges } from "../lifecycle/unsavedChanges.js";
import { BlockOperationError, blockSourceForCopy, blocksInSelectionRanges, decodeDisabledSource, normalizeBlockSelection, planDeleteBlocks, planDisableBlocks, planEnableBlocks, planMoveBlocks, planPasteBlocks, type BlockSourceTransaction, type MovePosition } from "./blockOperations.js";
import { createBlockClipboardPayload, readBlockClipboard, writeBlockClipboard } from "./blockClipboard.js";
import { BlockActionToolbar } from "./BlockActionToolbar.js";
import { readCollapsedPreview, writeCollapsedPreview } from "../collapseState.js";
import { PreviewNavigationEvents, previewNodeAtOffset as nodeAtOffset, previewSpanContains } from "./navigation.js";

type EditorApi = NonNullable<Window["latexEditor"]>;
export interface PreviewRelationUi {
  active: boolean;
  snapshot: BlockGraphSnapshot;
  transientToBlockId: Record<string, BlockId>;
  focusId: BlockId | null;
  direction: RelationDirection;
  matchIds: Set<BlockId>;
  contextIds: Set<BlockId>;
  locateRequest?: { fileId: string; blockId: BlockId; nonce: number } | undefined;
  onLocated?(nonce: number): void;
  onFocus(blockId: BlockId): void;
  onToggle(blockId: BlockId, x: number, y: number): void;
}
type PreviewSourceReader = Pick<string, "slice">;
type PreviewEditorServices = { onFieldEditing(id: string, active: boolean): void; getOpenDocuments?: (() => Array<{ path: string; content: string }>) | undefined; nodeRanges: Pick<ReadonlyMap<string, SourceSpan>, "get">; api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; currentPath: string; graphicPaths: string[]; definitions: EnvironmentDefinition[]; directives: PreviewDirectiveDefinition[]; mathContext: MathContext; searchQuery: InlineSearchQuery; activeSearchResult?: SearchResult | undefined; filterQuery: FilterQuery; filterStates: Map<string, FilterState>; visibilitySignatures: ReadonlyMap<string, string>; relation?: PreviewRelationUi | undefined; selectedBlockIds: string[]; collapsedBlockIds: ReadonlySet<string>; virtual: VirtualPreviewController; virtualRoot: { current: HTMLDivElement | null }; forcedIds: ReadonlySet<string>; forceOffset?: number; initialHeight?: number | undefined; setSelectedBlockIds(ids: string[]): void; selectBlockWithModifiers(id: string, modifiers: { toggle: boolean; range: boolean }): void; toggleCollapse(ids: string[], collapsed?: boolean, scope?: "selected" | "children" | "siblings" | "all"): void; moveBlocks(ids: string[], targetId: string, position: MovePosition): void; copyBlocks(ids: string[], cut: boolean): void; duplicateBlocks(ids: string[]): void; pasteBlocks(targetId: string, position: MovePosition): void; disableBlocks(ids: string[]): void; enableBlocks(ids: string[]): void; deleteBlocks(ids: string[]): void; removeEnvironment(id: string): void; onBoundaryDraftChange(insertion: BoundaryInsertion, value: string): void; onFigureSelect: ((selection?: FigureSelection) => void) | undefined; onFigureSlotSelect: ((selection: FigureSelection) => void) | undefined; onTableSelect: ((selection?: TableSelection) => void) | undefined; onTableChange: ((selection: TableSelection, source: string) => void) | undefined; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void; onForwardSync(path: string, line: number, column?: number): void };

function measurePreviewEditHeight(root: HTMLDivElement | null, id: string): number | undefined {
  if (!root) return undefined;
  const nodes = root.querySelectorAll<HTMLElement>("[data-node-id], [data-preview-node-id]");
  for (const node of Array.from(nodes)) {
    if (node.dataset.nodeId !== id && node.dataset.previewNodeId !== id) continue;
    const target = node.classList.contains("preview-block")
      ? node.querySelector<HTMLElement>(":scope > .preview-block-body") ?? node
      : node;
    const height = target.getBoundingClientRect().height;
    return height > 0 ? Math.ceil(height) : undefined;
  }
  return undefined;
}

function previewFilterState(node: PreviewNode, services: PreviewEditorServices): FilterState {
  const documentState = services.filterQuery.enabled ? services.filterStates.get(node.id) ?? "match" : "match";
  const semanticId = services.relation?.active ? services.relation.transientToBlockId[node.id] : undefined;
  const relationState: FilterState = !semanticId || !services.relation?.active
    ? "match"
    : services.relation.matchIds.has(semanticId)
      ? "match"
      : services.relation.contextIds.has(semanticId)
        ? "context"
        : "unmatched";
  return combineFilterStates(documentState, relationState);
}

const deleteMenuHandlers = new Map<string, (event: globalThis.MouseEvent) => void>();
let deleteMenuDocument: Document | undefined;
const dispatchDeleteContextMenu = (event: Event) => {
  const mouseEvent = event as globalThis.MouseEvent;
  const target = event.target instanceof Element ? event.target : undefined;
  const button = target?.closest(".preview-block-delete");
  const ownerId = button?.closest("[data-preview-node-id]")?.getAttribute("data-preview-node-id");
  if (!ownerId) return;
  deleteMenuHandlers.get(ownerId)?.(mouseEvent);
};
function registerDeleteMenuHandler(id: string, handler: (event: globalThis.MouseEvent) => void): () => void {
  deleteMenuHandlers.set(id, handler);
  if (typeof document !== "undefined" && deleteMenuDocument !== document) {
    deleteMenuDocument?.removeEventListener("contextmenu", dispatchDeleteContextMenu);
    deleteMenuDocument = document;
    deleteMenuDocument.addEventListener("contextmenu", dispatchDeleteContextMenu);
  }
  return () => {
    deleteMenuHandlers.delete(id);
    if (deleteMenuHandlers.size === 0 && deleteMenuDocument) {
      deleteMenuDocument.removeEventListener("contextmenu", dispatchDeleteContextMenu);
      deleteMenuDocument = undefined;
    }
  };
}
interface BoundaryInsertion { targetId: string; position: number; side: "before" | "after" }
interface PendingPreviewScroll { fileId: string; id: string; offset?: number; align: ScrollLogicalPosition; highlight?: "reference-target" | "relation-locate-highlight" | "custom-block-created-highlight"; nonce?: number; highlightNonce?: number; relationNonce?: number }
interface PreviewActions extends Pick<PreviewEditorServices, "setSelectedBlockIds" | "selectBlockWithModifiers" | "toggleCollapse" | "moveBlocks" | "copyBlocks" | "duplicateBlocks" | "pasteBlocks" | "disableBlocks" | "enableBlocks" | "deleteBlocks" | "removeEnvironment" | "onFigureSelect" | "onFigureSlotSelect" | "onTableSelect" | "onTableChange" | "onSpellContextMenu" | "onDetectedLanguage" | "onForwardSync"> {
  select(id: string): void;
  edit(id: string, offset?: number): void;
  applyEdit(node: PreviewNode, value: string): void;
  applyBoundary(insertion: BoundaryInsertion, value: string): void;
  onBoundaryDraftChange(insertion: BoundaryInsertion, value: string): void;
  cancelEdit(): void;
  requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void;
  relationFocus(id: BlockId): void;
  relationToggle(id: BlockId, x: number, y: number): void;
}
const previewFilterEngine = new FilterEngine();
const noVisibilitySignatures: ReadonlyMap<string, string> = new Map();
const noRelationIds: Record<string, BlockId> = {};

function sourceElement(node: Node | null, root: HTMLElement): HTMLElement | undefined {
  const element = node instanceof Element ? node : node?.parentElement;
  const result = element?.closest<HTMLElement>("[data-source-start-offset][data-source-end-offset]");
  return result && root.contains(result) ? result : undefined;
}

function referenceModifierPressed(event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">, modifier: "ctrl" | "alt" | "shift" | "meta"): boolean {
  return modifier === "ctrl" ? event.ctrlKey : modifier === "alt" ? event.altKey : modifier === "shift" ? event.shiftKey : event.metaKey;
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

function highlightedText(value: string, query: InlineSearchQuery, active: boolean, keyBase: number, sourceOffset?: number): ReactNode[] {
  const ranges = inlineMatchRanges(value, query, sourceOffset);
  if (!ranges.length) return [<Fragment key={keyBase}>{value}</Fragment>];
  const result: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) result.push(<Fragment key={`${keyBase}:t:${index++}`}>{value.slice(cursor, start)}</Fragment>);
    const current = active && sourceOffset !== undefined && query.resolvedMatches?.some(match => match.id === query.activeMatchId && match.matchStart === sourceOffset + start);
    result.push(<mark className={current ? "preview-search-match active" : "preview-search-match"} key={`${keyBase}:m:${index++}`}>{value.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < value.length) result.push(<Fragment key={`${keyBase}:t:${index}`}>{value.slice(cursor)}</Fragment>);
  return result.length ? result : [<Fragment key={keyBase}>{value}</Fragment>];
}

function sourceMapped(node: ReactNode, start?: number, end?: number, atomic = false): ReactNode {
  return start === undefined || end === undefined ? node : <span data-preview-source-start={start} data-preview-source-end={end} data-preview-source-mode={atomic ? "atomic" : "text"}>{node}</span>;
}

function inlineLatex(value: string | undefined, mathContext: MathContext, searchQuery: InlineSearchQuery = defaultInlineSearch, active = false, sourceStartOffset?: number): ReactNode[] {
  if (!value) return [];
  const map = (node: ReactNode, token: InlineSourceToken) => sourceMapped(node, sourceStartOffset === undefined ? undefined : token.contentStart, sourceStartOffset === undefined ? undefined : token.contentEnd, token.atomic);
  const render = (tokens: InlineSourceToken[]): ReactNode[] => tokens.map((token) => {
    let content: ReactNode;
    if (token.kind === "text") content = map(highlightedText(token.value, searchQuery, active, token.start, sourceStartOffset === undefined || token.contentEnd - token.contentStart !== token.value.length ? undefined : token.contentStart), token);
    else if (token.kind === "math") content = map(<MathRenderer expression={token.value} display={token.display ?? false} context={mathContext}/>, token);
    else if (token.kind === "format") {
      const children = render(token.children ?? []);
      content = token.command === "textbf" ? <strong>{children}</strong> : token.command === "texttt" ? <code>{children}</code> : token.command === "textit" || token.command === "emph" ? <em>{children}</em> : children;
    } else if (token.kind === "citation") content = map(<span className="preview-citation" title={"\\" + token.command}>[{token.value}]</span>, token);
    else if (token.kind === "reference") content = map(<button type="button" className="preview-reference" data-reference={token.value} data-reference-source-start={sourceStartOffset === undefined ? undefined : token.start} data-reference-source-end={sourceStartOffset === undefined ? undefined : token.end} title={`\\${token.command} ﾂｷ modifier-click to jump`}>[{token.value}]</button>, token);
    else content = <span className="preview-algorithm-command" data-command={token.command?.toUpperCase()}>{sourceMapped(<strong>{token.command?.toUpperCase()}</strong>, sourceStartOffset === undefined ? undefined : token.start, sourceStartOffset === undefined ? undefined : token.start + (token.command?.length ?? 0) + 1, true)}{token.children && <span className="preview-algorithm-argument">{render(token.children)}</span>}</span>;
    return <Fragment key={token.kind + ":" + token.start}>{content}</Fragment>;
  });
  return render(tokenizeInlineSource(value, sourceStartOffset));
}

function DocumentTitlePreview({ title, author, date, mathContext, searchQuery }: { title?: string; author?: string; date?: string; mathContext: MathContext; searchQuery: SearchQuery }) {
  const renderedDate = date?.replace(/\\today\b/g, new Date().toLocaleDateString(globalThis.document.documentElement.lang || undefined));
  return <header className="preview-document-title">
    {title && <h1>{inlineLatex(title, mathContext, searchQuery)}</h1>}
    {author && <div className="preview-document-authors">{inlineLatex(author.replace(/\\and\b/g, "\n").replace(/\\\\/g, "\n"), mathContext, searchQuery)}</div>}
    {renderedDate && <time>{inlineLatex(renderedDate, mathContext, searchQuery)}</time>}
  </header>;
}

const defaultInlineSearch: SearchQuery = { text: "", caseSensitive: false, wholeWord: false, useRegex: false, scope: "current-file" };

interface PreviewListItem {
  startOffset: number;
  endOffset: number;
  label?: string;
  labelStart?: number;
}

/** Keep absolute ranges so nested math blocks can remain independent preview nodes. */
function listBodyRange(node: StructuralBlock, source: PreviewSourceReader): [number, number] {
  const full = nodeSource(node, source);
  const opening = /^\\begin\{[^}]+\}(?:\[[^\]]*\])?/s.exec(full)?.[0]?.length ?? 0;
  const closing = /\\end\{[^}]+\}\s*$/s.exec(full);
  const bodyStart = node.source.startOffset + opening;
  const bodyEnd = closing ? node.source.startOffset + closing.index : node.source.endOffset;
  return [bodyStart, Math.max(bodyStart, bodyEnd)];
}

function previewListItems(node: StructuralBlock, source: PreviewSourceReader): PreviewListItem[] {
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
      ...(match[1] ? { label: match[1], labelStart: bodyStart + (match.index ?? 0) + match[0].indexOf("[") + 1 } : {})
    };
  });
}

function nodeSource(node: PreviewNode, source: PreviewSourceReader): string {
  return source.slice(node.source.startOffset, node.source.endOffset);
}

function labelOffset(source: string, label: string): number | undefined {
  const expression = /\\label\{([^}]+)\}/g;
  for (const match of source.matchAll(expression)) if (match[1] === label) return match.index ?? 0;
  return undefined;
}

/** One resolver controls both modifier-click navigation and its hover affordance. */
function previewJumpTarget(target: Element | undefined, source: string, nodes: PreviewNode[]): { element: HTMLElement; offset: number; node: PreviewNode } | undefined {
  const element = target?.closest<HTMLElement>("[data-reference]");
  const reference = element?.dataset.reference;
  if (!element || !reference) return undefined;
  const offset = labelOffset(source, reference);
  const node = offset === undefined ? undefined : nodeAtOffset(nodes, offset);
  return offset !== undefined && node ? { element, offset, node } : undefined;
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

function editableBodyStart(node: StructuralBlock, source: PreviewSourceReader): number {
  const raw = source.slice(node.body.startOffset, node.body.endOffset);
  const prefix = /^(?:\s|%[^\r\n]*(?:\r?\n|$)|\\label\s*\{[^}]*\})*/.exec(raw)?.[0].length ?? 0;
  return Math.min(node.body.endOffset, node.body.startOffset + prefix);
}

/** Removes only the outer math wrapper; nested aligned/cases environments are valid TeX. */
function mathBodySource(node: StructuralBlock, source: PreviewSourceReader): string {
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
  if (id.startsWith("custom:")) return `${t("environment.custom")} ﾂｷ ${id.slice("custom:".length)}`;
  return id.replaceAll("-", " ").toLocaleUpperCase();
}

function BlockEnvironmentSelector({ node, source, definition, definitions, disabled, onChange }: { node: StructuralBlock; source: PreviewSourceReader; definition: EnvironmentDefinition | undefined; definitions: EnvironmentDefinition[]; disabled: boolean; onChange(value: string): void }) {
  const [open, setOpen] = useState(false);
  const [pendingIncompatible, setPendingIncompatible] = useState<EnvironmentDefinition>();
  const rootRef = useRef<HTMLDivElement>(null);

  const preferences = useSettings();
  const blockSource = nodeSource(node, source);
  const group = environmentConversionGroup(blockSource);
  const available = group ? definitions.some((candidate) => candidate.enabled && candidate.id !== node.environmentId && definitionConversionGroup(candidate) === group) : false;
  useEffect(() => {
    if (!open && !pendingIncompatible) return;
    const closeOutside = (event: globalThis.MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); setPendingIncompatible(undefined); } };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("mousedown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [open, pendingIncompatible]);
  const label = environmentLabel(definition, node.environmentId);
  const applyConversion = (candidate: EnvironmentDefinition) => {
    const converted = convertBlockEnvironmentSource(blockSource, candidate);
    if (converted !== undefined && converted !== blockSource) onChange(converted);
    setPendingIncompatible(undefined);
    setOpen(false);
  };
  if (!available || disabled) return <span>{label}</span>;
  return <div className="preview-environment-selector" ref={rootRef} onClick={(event) => event.stopPropagation()}>
    <span className="preview-environment-label" role="button" tabIndex={0} aria-haspopup="dialog" aria-expanded={open} title={t("preview.changeEnvironment")} onClick={() => setOpen((value) => !value)} onKeyDown={(event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      setOpen((value) => !value);
    }}>{label}</span>
    {open && <EnvironmentPickerPanel definitions={definitions} title={t("preview.changeEnvironment")} hint={t("preview.changeEnvironmentHint")} include={(candidate) => candidate.id !== node.environmentId && definitionConversionGroup(candidate) === group} onSelect={(candidate) => {
      if (preferences.get("warnIncompatibleEnvironmentConversion") && !environmentDefinitionsCompatible(definition, candidate)) { setPendingIncompatible(candidate); setOpen(false); return; }
      applyConversion(candidate);
    }} onClose={() => setOpen(false)}/>}
    {pendingIncompatible && createPortal(<div className="environment-conversion-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingIncompatible(undefined); }}><section className="environment-conversion-warning" role="alertdialog" aria-modal="true" aria-label={t("preview.incompatibleEnvironmentTitle")}><h2>{t("preview.incompatibleEnvironmentTitle")}</h2><p>{t("preview.incompatibleEnvironmentMessage", { source: definition ? environmentDisplayName(definition) : label, target: environmentDisplayName(pendingIncompatible) })}</p><small>{t("preview.incompatibleEnvironmentDetail")}</small><div><button onClick={() => setPendingIncompatible(undefined)}>{t("project.cancel")}</button><button className="danger" onClick={() => applyConversion(pendingIncompatible)}>{t("preview.replaceAnyway")}</button></div></section></div>, document.body)}
  </div>;
}

function LabelEditor({ label, auto, onCommit }: { label: string; auto: boolean; onCommit(value: string): void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label);
  const editingRef = useRef(false);
  useEffect(() => { if (!editing) setDraft(label); }, [editing, label]);
  useUnsavedChanges({ hasChanges: () => editingRef.current && draft !== label, commit: () => commit() });
  const commit = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    const next = draft.replace(/[{}\r\n]/g, "").trim();
    if (next && next !== label) onCommit(next);
    setEditing(false);
  };
  if (editing) return <input className="preview-block-label-editor" data-shortcut-capture autoFocus value={draft} aria-label={t("preview.editLabel")} onClick={(event) => event.stopPropagation()} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const key = eventBinding(event.nativeEvent), configured = bindings();
    const save = configured["file.save"] === key ? "file.save" : configured["file.saveAll"] === key ? "file.saveAll" : undefined;
    if (save) { event.preventDefault(); event.stopPropagation(); flushSync(commit); commands.execute(save); return; }
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); editingRef.current = false; setDraft(label); setEditing(false); }
  }}/>;
  return <button type="button" className={`preview-block-label${auto ? " auto" : ""}${label ? "" : " empty"}`} title={t(label ? (auto ? "preview.autoLabelHint" : "preview.editLabel") : "preview.addLabel")} onClick={(event) => { event.stopPropagation(); editingRef.current = true; setDraft(label); setEditing(true); }}>{label || t("preview.addLabel")}</button>;
}

function TitleEditor({ title, onCommit, bracketed = false }: { title: string; onCommit(value: string): void; bracketed?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const editingRef = useRef(false);
  useEffect(() => { if (!editing) setDraft(title); }, [editing, title]);
  useUnsavedChanges({ hasChanges: () => editingRef.current && draft !== title, commit: () => commit() });
  const commit = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    if (draft !== title) onCommit(draft.replace(/[\r\n]/g, " "));
    setEditing(false);
  };
  if (editing) return <input className="preview-block-title-editor" data-shortcut-capture autoFocus value={draft} aria-label={t("preview.editLabel")} onClick={(event) => event.stopPropagation()} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const key = eventBinding(event.nativeEvent), configured = bindings();
    const save = configured["file.save"] === key ? "file.save" : configured["file.saveAll"] === key ? "file.saveAll" : undefined;
    if (save) { event.preventDefault(); event.stopPropagation(); flushSync(commit); commands.execute(save); return; }
    if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); editingRef.current = false; setDraft(title); setEditing(false); }
  }}/>;
  return <button type="button" className={`preview-block-title${bracketed ? " preview-block-options" : ""}`} title={t("preview.editLabel")} onClick={(event) => { event.stopPropagation(); editingRef.current = true; setDraft(title); setEditing(true); }}>{bracketed ? `[${title}]` : title}</button>;
}

function CaptionEditor({ node, source, services, onChange }: { node: StructuralBlock; source: string; services: PreviewEditorServices; onChange(value: string): void }) {
  const [editing, setEditing] = useState<PreviewSourceField>();
  const [notice, setNotice] = useState("");
  const field = captionSourceField(source);
  const isEditing = !!editing;
  useEffect(() => {
    if (!isEditing) return;
    services.onFieldEditing(node.id, true);
    return () => services.onFieldEditing(node.id, false);
  }, [isEditing, node.id, services.onFieldEditing]);
  if (!field && !editing) return null;
  return <div className="preview-caption-field" data-preview-field onClick={event => event.stopPropagation()}>
    {editing ? <PreviewLocalEditor {...services} value={editing.value} sourceStartLine={node.source.startLine + source.slice(0, editing.start).split("\n").length - 1} sourceStartOffset={node.source.startOffset + editing.start} onCancel={() => { setEditing(undefined); setNotice(""); }} onApply={value => {
      if (!field || field.value !== editing.value) { setNotice(t("preview.fieldChanged")); return; }
      const next = replaceSourceField(source, field, value);
      if (next !== undefined && next !== source) onChange(next);
      setEditing(undefined); setNotice("");
    }}/> : <button type="button" className="preview-caption-text" onClick={() => { setNotice(""); setEditing(field); }}>{field!.body.value ? inlineLatex(field!.body.value, services.mathContext, services.searchQuery, false, node.source.startOffset + field!.body.start) : "\\caption{}"}</button>}
    {notice && <small role="alert">{notice}</small>}
  </div>;
}

function replaceHeadingTitle(node: StructuralBlock, source: string, title: string): string | undefined {
  // Heading nodes start at their LaTeX command. Keep the edit limited to its
  // argument even though the preview node owns the following section content.
  const match = /^(\\[A-Za-z@]+\*?\{)([^{}]*)(\})/.exec(source);
  if (!match || match[2] !== node.title) return undefined;
  return `${match[1]}${title}${match[3]}${source.slice(match[0].length)}`;
}

function SpecializedContent({ node, source, services, applyEdit }: { node: StructuralBlock; source: PreviewSourceReader; services: PreviewEditorServices; applyEdit(node: PreviewNode, value: string): void }) {
  const definitionId = node.environmentId;
  const captionContent = /^(figure(?:-star)?|custom:figure\*|table(?:-star)?|tabular(?:-star|x)?|longtable)$/.test(definitionId) && captionSourceField(nodeSource(node, source)) ? <CaptionEditor node={node} source={nodeSource(node, source)} services={services} onChange={value => applyEdit(node, value)}/> : undefined;
  if (/equation|align|gather|multline|display-math/.test(definitionId)) {
    const mathBody = mathBodySource(node, source);
    const environment = definitionId.replace(/-star$/, "");
    const expression = /^(align|gather|multline)$/.test(environment) ? `\\begin{${environment}}${mathBody}\\end{${environment}}` : mathBody;
    return sourceMapped(<MathRenderer expression={expression} display context={services.mathContext}/>, editableBodyStart(node, source), node.body.endOffset, true);
  }
  if (/verbatim|lstlisting/.test(definitionId)) {
    const raw = source.slice(node.body.startOffset, node.body.endOffset);
    const start = node.body.startOffset + raw.length - raw.trimStart().length;
    return <pre className="preview-code">{sourceMapped(raw.trim(), start, start + raw.trim().length)}</pre>;
  }
  if (definitionId === "figure" || definitionId === "figure-star" || definitionId === "custom:figure*" || definitionId === "inline-image") return <FigurePreview source={nodeSource(node, source)} captionContent={captionContent} graphicPaths={services.graphicPaths} api={services.api} projectId={services.projectId} texPath={services.currentPath} onChooseSlot={services.onFigureSlotSelect ? (imageIndex) => services.onFigureSlotSelect?.({ fileId: services.currentPath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source), imageIndex }) : undefined}/>;
  if (["table", "table-star", "tabular", "tabular-star", "tabularx", "longtable"].includes(definitionId)) {
    const selection = { fileId: services.currentPath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source), kind: "table" as const };
    return <TablePreview source={selection.source} captionContent={captionContent} renderCell={(content) => inlineLatex(content, services.mathContext, services.searchQuery, false)} onSelect={(detail) => services.onTableSelect?.({ ...selection, ...detail })} onChange={(replacement) => services.onTableChange?.(selection, replacement)}/>;
  }
  return null;
}

function ListContent({ node, source, mathContext, searchQuery, activeSearch, renderChild, onEdit, services }: { node: StructuralBlock; source: PreviewSourceReader; mathContext: MathContext; searchQuery: SearchQuery; activeSearch: boolean; renderChild(child: PreviewNode): ReactNode; onEdit(offset?: number): void; services: PreviewEditorServices }) {
  const items = previewListItems(node, source);
  let childIndex = 0;
  const rows = items.map((item, index) => {
    while (node.children[childIndex] && node.children[childIndex]!.source.endOffset <= item.startOffset) childIndex += 1;
    const children: PreviewNode[] = [];
    for (let cursor = childIndex; node.children[cursor] && node.children[cursor]!.source.startOffset < item.endOffset; cursor += 1) children.push(node.children[cursor]!);
    return { id: `listitem:${node.id}:${index}`, estimatedHeight: Math.max(45, 20 + Math.ceil((item.endOffset - item.startOffset) / 75) * 27) + children.reduce((sum, child) => sum + (child.kind === "block" ? estimatedPreviewHeight(child) : 0), 0), item, index, children };
  });
  const forcedListItems = new Set(services.forcedIds);
  const forcedOffsets = [...services.forcedIds].map((id) => services.nodeRanges.get(id)?.startOffset).filter((offset): offset is number => offset !== undefined);
  if (services.forceOffset !== undefined) forcedOffsets.push(services.forceOffset);
  for (const row of rows) if (forcedOffsets.some((offset) => row.item.startOffset <= offset && offset < row.item.endOffset)) forcedListItems.add(row.id);
  const renderItem = ({ item, index: itemIndex, children }: typeof rows[number]) => {
    const content: ReactNode[] = [];
    let cursor = item.startOffset;
    const addText = (start: number, end: number, key: string) => {
      if (end <= start) return;
      content.push(<Fragment key={key}>{inlineLatex(source.slice(start, end), mathContext, searchQuery, activeSearch, start)}</Fragment>);
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
    return <div data-source-start-offset={item.startOffset} data-source-end-offset={item.endOffset} onClick={(event) => { if ((event.target as Element).closest("button, .preview-local-editor") || window.getSelection()?.isCollapsed === false) return; event.stopPropagation(); onEdit(sourceOffsetAtPoint(event.currentTarget, event)); }}>{item.label && <strong>{inlineLatex(item.label, mathContext, searchQuery, activeSearch, item.labelStart)} </strong>}{content}</div>;
  };
  return <VirtualPreviewList items={rows} controller={services.virtual} rootRef={services.virtualRoot} forcedIds={forcedListItems} renderItem={renderItem} as={node.environmentId === "enumerate" ? "ol" : "ul"}/>;
}

const LocalEditor = PreviewLocalEditor;

function ContentRenderer({ node, source, editing, cursorOffset, boundary, beginEdit, applyEdit, onDraftChange, applyBoundary, cancelEdit, requestBoundary, services }: { node: ContentRegion; source: PreviewSourceReader; editing: boolean; cursorOffset?: number | undefined; boundary?: BoundaryInsertion | undefined; beginEdit(offset?: number): void; applyEdit(value: string): void; onDraftChange?: ((value: string) => void) | undefined; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; services: PreviewEditorServices }) {
  const insertion = boundary?.targetId === node.id ? boundary : undefined;
  const queryFilterState = services.filterQuery.enabled ? services.filterStates.get(node.id) ?? "match" : "match";
  const filterState = previewFilterState(node, services);
  const disposition = filterDisposition(filterState, services.filterQuery.viewMode);
  if (disposition === "remove" && !editing && !insertion && !services.forcedIds.has(node.id)) return null;
  if (disposition === "collapse" && !editing && !insertion && !services.forcedIds.has(node.id)) {
    return <div className="preview-filter-collapsed">站ｯ 1 {t("filter.blockCollapsed")}</div>;
  }
  const activeSearch = services.activeSearchResult ? services.activeSearchResult.matchStart >= node.source.startOffset && services.activeSearchResult.matchEnd <= node.source.endOffset : false;
  const effectiveSearch = services.filterQuery.enabled && queryFilterState !== "match" ? defaultInlineSearch : services.searchQuery;
  const filterClass = services.filterQuery.enabled || services.relation?.active ? `filter-${filterState} filter-view-${services.filterQuery.viewMode}` : "";
  const virtualClass = node.origin === "virtual" && node.raw.length === 0 ? " preview-content-virtual" : "";
  const directive = node.directiveId ? services.directives.find((item) => item.id === node.directiveId) : undefined;
  const directiveDisplay = directive?.display ?? (node.contentType === "spacer" ? "spacer" : "divider");
  const directiveContent = node.contentType === "directive" || node.contentType === "spacer";
  return <Fragment>
    {insertion?.side === "before" && <LocalEditor value="" sourceStartOffset={insertion.position} onApply={(value) => applyBoundary(insertion, value)} onDraftChange={(value) => services.onBoundaryDraftChange(insertion, value)} onCancel={cancelEdit} {...services}/>}
    {editing ? <LocalEditor value={nodeSource(node, source)} sourceStartLine={node.source.startLine} sourceStartOffset={node.source.startOffset} initialCursorOffset={cursorOffset === undefined ? undefined : cursorOffset - node.source.startOffset} onApply={applyEdit} onDraftChange={onDraftChange} onCancel={cancelEdit} onInsertBefore={(draft) => requestBoundary(node, "before", draft)} onInsertAfter={(draft) => requestBoundary(node, "after", draft)} {...services}/> : <div className={`preview-content-region${virtualClass} ${filterClass} ${activeSearch ? "search-result-active" : ""}${directiveContent ? ` preview-directive preview-directive-${directiveDisplay}` : ""}`} style={directiveContent ? { "--directive-color": directive?.color ?? "#a0afbc" } as CSSProperties : undefined} title={directiveContent ? directive?.label : undefined} data-node-id={node.id} data-source-line={node.source.startLine} data-source-start-offset={node.source.startOffset} data-source-end-offset={node.source.endOffset} onClick={(event) => { event.stopPropagation(); if (window.getSelection()?.isCollapsed !== false) beginEdit(directiveContent ? node.source.startOffset : sourceOffsetAtPoint(event.currentTarget, event)); }}>{directiveContent ? <><span className="preview-directive-line"/><span className="preview-directive-label">{node.directiveId === "blank-line" ? "" : directive?.label ?? node.raw.trim()}</span><span className="preview-directive-line"/>{directiveDisplay === "placeholder" && <code>{node.raw.trim()}</code>}</> : inlineLatex(node.raw, services.mathContext, effectiveSearch, activeSearch, node.source.startOffset)}</div>}
    {insertion?.side === "after" && <LocalEditor value="" sourceStartOffset={insertion.position} onApply={(value) => applyBoundary(insertion, value)} onDraftChange={(value) => services.onBoundaryDraftChange(insertion, value)} onCancel={cancelEdit} {...services}/>}
  </Fragment>;
}

function isMathBlock(node: StructuralBlock): boolean {
  return /equation|align|gather|multline|display-math|aligned|split|cases/.test(node.environmentId);
}

function countDescendants(node: StructuralBlock): number {
  return node.children.reduce((count, child) => {
    if (child.source.endOffset <= child.source.startOffset) return count;
    return count + 1 + (child.kind === "block" ? countDescendants(child) : 0);
  }, 0);
}

function hasEmptyBody(node: StructuralBlock, source: PreviewSourceReader): boolean {
  if (node.children.length) return false;
  return source.slice(node.body.startOffset, node.body.endOffset)
    .replace(/^\s*%[^\r\n]*/gm, "")
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .trim().length === 0;
}

function structuralBlockDraft(source: string, filePath: string, definitions: EnvironmentDefinition[]): StructuralBlock | undefined {
  // Let the preview parser decide when a heading or environment is complete.
  // An unclosed \begin stays a draft, while headings become structural as soon
  // as their required title argument has been entered.
  const block = parsePreview(source, filePath, definitions).nodes.find((node): node is StructuralBlock => node.kind === "block");
  if (!block || block.origin !== "latex" || source.slice(0, block.source.startOffset).trim().length > 0) return undefined;
  return block;
}

function structuralBlockAt(nodes: PreviewNode[], startOffset: number, environmentId: string): StructuralBlock | undefined {
  for (const node of nodes) {
    if (node.kind !== "block") continue;
    if (node.source.startOffset === startOffset && node.environmentId === environmentId) return node;
    const nested = structuralBlockAt(node.children, startOffset, environmentId);
    if (nested) return nested;
  }
  return undefined;
}

function BlockRenderer({ node, source, definitions, selectedId, editingId, cursorOffset, boundary, select, edit, applyEdit, applyBoundary, cancelEdit, requestBoundary, services }: { node: StructuralBlock; source: PreviewSourceReader; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; cursorOffset?: number | undefined; boundary?: BoundaryInsertion | undefined; select(id: string): void; edit(id: string, cursorOffset?: number): void; applyEdit(node: PreviewNode, value: string): void; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; onDraftChange?: ((value: string) => void) | undefined; services: PreviewEditorServices }) {
  const definition = definitionForId(definitions, node.environmentId);
  const family = definition?.family ?? (node.origin === "virtual" ? "virtual" : "generic");
  const editing = editingId === node.id;
  const selected = services.selectedBlockIds.includes(node.id);
  const singleSelected = services.selectedBlockIds.length === 1 && selected;
  const collapsed = canCollapseBlock(node) && services.collapsedBlockIds.has(node.id) && !editing && !(services.forcedIds.has(node.id) && !selected);
  const [dropPosition, setDropPosition] = useState<MovePosition>();
  const queryFilterState = services.filterQuery.enabled ? services.filterStates.get(node.id) ?? "match" : "match";
  const filterState = previewFilterState(node, services);
  const activeSearch = services.activeSearchResult ? services.activeSearchResult.matchStart >= node.source.startOffset && services.activeSearchResult.matchEnd <= node.source.endOffset : false;
  const effectiveSearch = services.filterQuery.enabled && queryFilterState !== "match" ? defaultInlineSearch : services.searchQuery;
  const listEnvironment = isListEnvironment(node.environmentId);
  const figureBlock = node.environmentId === "figure" || node.environmentId === "figure-star" || node.environmentId === "custom:figure*" || node.environmentId === "inline-image";
  const tableBlock = ["table", "table-star", "tabular", "tabular-star", "tabularx", "longtable"].includes(node.environmentId);
  const contentBlock = node.semanticKind === "content";
  const emptyBlock = hasEmptyBody(node, source);
  const emptyStructuralParagraph: ContentRegion | undefined = emptyBlock && !contentBlock ? {
    id: `ui-empty:${node.id}`,
    kind: "content",
    contentType: "paragraph",
    origin: "virtual",
    raw: "",
    source: {
      ...node.body,
      endOffset: node.body.startOffset,
      endLine: node.body.startLine,
      endColumn: node.body.startColumn
    } satisfies SourceSpan,
    parentId: node.id
  } : undefined;
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const deleteMenuRef = useRef<HTMLDivElement>(null);
  const [deleteMenuPosition, setDeleteMenuPosition] = useState({ x: 0, y: 0 });
  useEffect(() => {
    return registerDeleteMenuHandler(node.id, (event) => {
      event.preventDefault();
      setDeleteMenuPosition({ x: Math.min(event.clientX, window.innerWidth - 220), y: Math.min(event.clientY, window.innerHeight - 100) });
      setDeleteMenuOpen(true);
    });
  }, [node.id]);
  useEffect(() => {
    if (!deleteMenuOpen) return;
    const dismiss = (event: PointerEvent) => { if (!deleteMenuRef.current?.contains(event.target as Node)) setDeleteMenuOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setDeleteMenuOpen(false); };
    window.document.addEventListener("pointerdown", dismiss);
    window.document.addEventListener("keydown", escape);
    return () => { window.document.removeEventListener("pointerdown", dismiss); window.document.removeEventListener("keydown", escape); };
  }, [deleteMenuOpen]);
  const blockSource = nodeSource(node, source);
  const optionField = environmentOptionField(blockSource);
  const canRemoveEnvironment = node.origin === "latex" && unwrapLatexEnvironment(blockSource, node.environmentId) !== undefined;

  const preferences = useSettings();
  const specialized = SpecializedContent({ node, source, services, applyEdit });
  const specializedContent = emptyBlock && contentBlock
    ? <div className="preview-empty-block-placeholder" onClick={(event) => { event.stopPropagation(); edit(node.id); }}>{t("preview.emptyBlockHint")}</div>
    : emptyStructuralParagraph
      ? <PreviewNodeRenderer node={emptyStructuralParagraph} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} cursorOffset={cursorOffset} boundary={boundary} select={select} edit={edit} applyEdit={applyEdit} onDraftChange={(draft) => { if (structuralBlockDraft(draft, services.currentPath, definitions)) applyEdit(emptyStructuralParagraph, draft); }} applyBoundary={applyBoundary} cancelEdit={cancelEdit} requestBoundary={requestBoundary} services={services}/>
      : listEnvironment
        ? <ListContent node={node} source={source} mathContext={services.mathContext} searchQuery={effectiveSearch} activeSearch={activeSearch} onEdit={(offset) => edit(node.id, offset)} services={services} renderChild={(child) => <PreviewNodeRenderer key={child.id} node={child} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} cursorOffset={cursorOffset} boundary={boundary} select={select} edit={edit} applyEdit={applyEdit} applyBoundary={applyBoundary} cancelEdit={cancelEdit} requestBoundary={requestBoundary} services={services}/>} />
        : specialized;
  const insertion = boundary?.targetId === node.id ? boundary : undefined;
  const semanticId = services.relation?.transientToBlockId[node.id];
  const semanticBlock = semanticId ? services.relation?.snapshot.blocks.find((block) => block.id === semanticId) : undefined;
  const canSetRelationFocus = !!semanticBlock && isRelationCapableBlock(semanticBlock);
  const relationState = semanticId && services.relation?.active
    ? candidateRelationState(services.relation.snapshot, services.relation.focusId, semanticId, services.relation.direction)
    : undefined;
  const disposition = filterDisposition(filterState, services.filterQuery.viewMode);
  if (!editing && !insertion && !selected && !services.forcedIds.has(node.id) && disposition === "remove") return null;
  if (!editing && !insertion && !selected && !services.forcedIds.has(node.id) && disposition === "collapse") {
    return <div className="preview-filter-collapsed">站ｯ 1 {t("filter.blockCollapsed")}</div>;
  }
  const filterClass = services.filterQuery.enabled || services.relation?.active ? `filter-${filterState} filter-view-${services.filterQuery.viewMode}` : "";
  const applyLabel = (label: string) => {
    const blockSource = nodeSource(node, source);
    const ownedRange = node.labelSource ? { startOffset: node.labelSource.startOffset - node.source.startOffset, endOffset: node.labelSource.endOffset - node.source.startOffset } : null;
    const replacement = upsertBlockLabel(blockSource, label, ownedRange);
    if (replacement !== blockSource) applyEdit(node, replacement);
  };
  const applyTitle = (title: string) => {
    const replacement = replaceHeadingTitle(node, blockSource, title);
    if (replacement !== undefined && replacement !== blockSource) applyEdit(node, replacement);
  };
  const selectFromHeader = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey || event.shiftKey) services.selectBlockWithModifiers(node.id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey });
    else select(node.id);
  };
  const dragStart = (event: React.DragEvent<HTMLElement>) => {
    const ids = selected ? services.selectedBlockIds : [node.id];
    event.dataTransfer.setData("application/x-texweave-block-drag", JSON.stringify({ filePath: services.currentPath, ids }));
    event.dataTransfer.effectAllowed = "move";
    event.stopPropagation();
  };
  const dragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("application/x-texweave-block-drag")) return;
    event.preventDefault(); event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientY - rect.top) / Math.max(rect.height, 1);
    setDropPosition(fraction < .23 ? "before" : fraction > .77 ? "after" : "inside");
    event.dataTransfer.dropEffect = "move";
  };
  const drop = (event: React.DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes("application/x-texweave-block-drag")) return;
    event.preventDefault(); event.stopPropagation();
    setDropPosition(undefined);
    try {
      const payload = JSON.parse(event.dataTransfer.getData("application/x-texweave-block-drag")) as { filePath?: string; ids?: string[] };
      if (payload.filePath === services.currentPath && Array.isArray(payload.ids) && payload.ids.every((id) => typeof id === "string")) {
        services.moveBlocks(payload.ids, node.id, dropPosition ?? "after");
      }
    } catch { /* Ignore unrelated drag payloads. */ }
  };
  if (node.environmentId === "texweave-disabled") {
    let excerpt = "";
    try { excerpt = decodeDisabledSource(nodeSource(node, source)).trim().split(/\r?\n/).find((line) => line.trim())?.trim() ?? ""; }
    catch { excerpt = t("blockOperation.invalidDisabled"); }
    return <section className={`preview-block-disabled${selected ? " selected" : ""}`} data-preview-node-id={node.id} data-source-start-offset={node.source.startOffset} data-source-end-offset={node.source.endOffset} onDragOver={dragOver} onDragLeave={() => setDropPosition(undefined)} onDrop={drop} data-drop-position={dropPosition}>
      <button className="preview-block-drag" draggable title={t("blockOperation.drag")} onDragStart={dragStart} onDragEnd={() => setDropPosition(undefined)}>{"\u22EE\u22EE"}</button>
      <button className="preview-block-disabled-main" onClick={selectFromHeader}><strong>{t("blockOperation.disabled")}</strong><span>{excerpt.slice(0, 150)}</span></button>
      <button className="preview-block-enable" onClick={(event) => { event.stopPropagation(); services.enableBlocks([node.id]); }}>{t("blockOperation.enable")}</button>
    </section>;
  }
  return <Fragment>
    {insertion?.side === "before" && <LocalEditor value="" sourceStartOffset={insertion.position} onApply={(value) => applyBoundary(insertion, value)} onDraftChange={(value) => services.onBoundaryDraftChange(insertion, value)} onCancel={cancelEdit} {...services}/>}
    <section className={`preview-block env-${family} ${filterClass} ${activeSearch ? "search-result-active" : ""} ${selected ? "selected" : ""} ${selected && services.selectedBlockIds.length > 1 ? "multi-selected" : ""} ${editing ? "editing" : ""} ${collapsed ? "block-collapsed" : ""} ${semanticId === services.relation?.focusId ? "relation-focus" : ""}`} data-preview-node-id={node.id} data-environment={node.environmentId} data-semantic-block-id={semanticId} data-source-line={node.source.startLine} data-source-start-offset={node.source.startOffset} data-source-end-offset={node.source.endOffset} data-drop-position={dropPosition} onDragOver={dragOver} onDragLeave={() => setDropPosition(undefined)} onDrop={drop} onClickCapture={(event) => { if (!(event.ctrlKey || event.metaKey || event.shiftKey) || editing) return; const target = event.target as Element; if (target.closest(".preview-block") !== event.currentTarget || target.closest("a, input, textarea, select, [contenteditable=true], .preview-local-editor, .structured-table, .preview-reference, .preview-block-header-actions, .preview-block-collapse, .preview-block-drag, .preview-environment-selector, .preview-block-footer-actions, .preview-block-footer-main, button:not(.preview-block-title):not(.preview-block-label)")) return; event.preventDefault(); event.stopPropagation(); services.selectBlockWithModifiers(node.id, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey }); }} onDoubleClickCapture={(event) => { const target = event.target as Element; if (target.closest("[data-preview-field], button, input, .preview-local-editor, .structured-table, .figure-preview-image-choice, .figure-preview-empty-slot") || target.closest(".preview-block") !== event.currentTarget) return; event.preventDefault(); event.stopPropagation(); const figureBlock = node.environmentId === "figure" || node.environmentId === "figure-star" || node.environmentId === "custom:figure*" || node.environmentId === "inline-image"; if (figureBlock) { if (preferences.get("images").editor.defaultMode === "source") edit(node.id); else { select(node.id); services.onFigureSelect?.({ fileId: services.currentPath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source) }); } return; } services.onForwardSync(services.currentPath, node.source.startLine, 1); }} style={environmentBlockStyle(node.environmentId, family, definition)}>
    {(definition?.behavior.showHeader ?? true) && <div className="preview-block-header">
      {canCollapseBlock(node) && <button className="preview-block-collapse" title={t(collapsed ? "blockOperation.expand" : "blockOperation.collapse")} aria-expanded={!collapsed} onClick={(event) => { event.stopPropagation(); services.toggleCollapse([node.id]); }}>{collapsed ? "\u25B8" : "\u25BE"}</button>}
      <button className="preview-block-drag" draggable title={t("blockOperation.drag")} onDragStart={dragStart} onDragEnd={() => setDropPosition(undefined)}>{"\u22EE\u22EE"}</button>
      <div className="preview-block-header-main" onClick={selectFromHeader}>
        <BlockEnvironmentSelector node={node} source={source} definition={definition} definitions={definitions} disabled={editing} onChange={(value) => applyEdit(node, value)}/>
        {optionField ? <TitleEditor title={optionField.value} bracketed onCommit={value => { const next = replaceSourceField(blockSource, optionField, value); if (next !== undefined) applyEdit(node, next); }}/> : node.title && (replaceHeadingTitle(node, blockSource, node.title) !== undefined ? <TitleEditor title={node.title} onCommit={applyTitle}/> : <strong>{node.title}</strong>)}
        {(definition?.behavior.showLabel ?? true) && <LabelEditor label={node.latexLabel ?? ""} auto={Boolean(node.autoLabel)} onCommit={applyLabel}/>}
      </div>
      {(singleSelected || (services.relation?.active && semanticId && services.selectedBlockIds.length === 1)) && <div className="preview-block-header-actions">
        {services.relation?.active && semanticId && <>
          <button className={semanticId === services.relation.focusId ? "relation-control active" : "relation-control"} disabled={!canSetRelationFocus} title={canSetRelationFocus ? t("relation.setFocus") : t("relation.invalid.virtual-endpoint")} onClick={(event) => { event.stopPropagation(); services.relation?.onFocus(semanticId); }}>{"\u25CE"}</button>
          <button className="relation-control" disabled={!!relationState?.disabledReason} title={relationState?.disabledReason ? t(`relation.invalid.${relationState.disabledReason}`) : relationState?.existing ? t("relation.remove") : t("relation.add")} onClick={(event) => { event.stopPropagation(); services.relation?.onToggle(semanticId, event.clientX, event.clientY); }}>{relationState?.existing ? (relationState.existingDirection === "prerequisite" ? "\u2190 \u2212" : "\u2192 \u2212") : "+"}</button>
        </>}
        {singleSelected && <>
          <button title={t("preview.insertBefore")} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); requestBoundary(node, "before"); }} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) requestBoundary(node, "before"); }}>{"\u21A5\uFF0B"}</button>
          <button title={t("preview.insertAfter")} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); requestBoundary(node, "after"); }} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) requestBoundary(node, "after"); }}>{"\u21A7\uFF0B"}</button>
          <button className="preview-block-delete" title={t("files.delete")} aria-label={t("files.delete")} onClick={(event) => { event.stopPropagation(); services.deleteBlocks([node.id]); }}>{"\u00D7"}</button>
        </>}
      </div>}
    </div>}
    {!(definition?.behavior.showHeader ?? true) && (node.environmentId !== "placeholder" || collapsed) && canCollapseBlock(node) && <div className="preview-block-compact-header">
      <button className="preview-block-collapse" title={t(collapsed ? "blockOperation.expand" : "blockOperation.collapse")} aria-label={t(collapsed ? "blockOperation.expand" : "blockOperation.collapse")} aria-expanded={!collapsed} onClick={(event) => { event.stopPropagation(); services.toggleCollapse([node.id]); }}>{collapsed ? "笆ｸ" : "笆ｾ"}</button>
      <span>{environmentLabel(definition, node.environmentId)}</span>
    </div>}
    {!collapsed && <div className="preview-block-body" onClickCapture={(event) => {
       if ((event.target as Element).closest("[data-preview-field]")) return;
       // Figure and table previews stop propagation for their own controls/cell editing.
       // Activate the surrounding block during capture so its boundary actions remain
       // available even when the specialized preview consumes the click afterwards.
       if (!editing && !emptyBlock && (figureBlock || tableBlock)) {
         select(node.id);
         if (figureBlock) services.onFigureSelect?.({ fileId: services.currentPath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source) });
         if (tableBlock) services.onTableSelect?.({ fileId: services.currentPath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source), kind: "table" });
       }
     }} onClick={(event) => {
       if (figureBlock && preferences.get("images").editor.defaultMode === "gui") {
         event.stopPropagation();
         select(node.id);
         services.onFigureSelect?.({ fileId: services.currentPath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source) });
         return;
       }
       if (contentBlock && (definition?.behavior.inlineEditable ?? true)) { event.stopPropagation(); edit(node.id, sourceOffsetAtPoint(event.currentTarget, event)); }
     }}>
       {editing ? <LocalEditor value={nodeSource(node, source)} sourceStartLine={node.source.startLine} sourceStartOffset={node.source.startOffset} initialCursorOffset={cursorOffset === undefined ? undefined : cursorOffset - node.source.startOffset} mathDraft={isMathBlock(node)} onApply={(value) => applyEdit(node, value)} onCancel={cancelEdit} onInsertBefore={(draft) => requestBoundary(node, "before", draft)} onInsertAfter={(draft) => requestBoundary(node, "after", draft)} {...services}/> : specializedContent ?? <PreviewNodeList nodes={node.children} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} cursorOffset={cursorOffset} boundary={boundary} select={select} edit={contentBlock ? (_id, offset) => edit(node.id, offset) : edit} applyEdit={applyEdit} applyBoundary={applyBoundary} cancelEdit={cancelEdit} requestBoundary={requestBoundary} services={services}/> }
    </div>}
    {!collapsed && <div className="preview-block-footer">
      <button className="preview-block-footer-main" title={environmentLabel(definition, node.environmentId)} onClick={(event) => { event.stopPropagation(); select(node.id); }}><span/></button>
      {singleSelected && <div className="preview-block-footer-actions">
        <button title={t("preview.insertBefore")} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); requestBoundary(node, "before"); }} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) requestBoundary(node, "before"); }}>{"\u21A5\uFF0B"}</button>
        <button title={t("preview.insertAfter")} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); requestBoundary(node, "after"); }} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) requestBoundary(node, "after"); }}>{"\u21A7\uFF0B"}</button>
        <button className="preview-block-delete" title={t("files.delete")} aria-label={t("files.delete")} onClick={(event) => { event.stopPropagation(); services.deleteBlocks([node.id]); }}>{"\u00D7"}</button>
      </div>}
    </div>}
    </section>
    {deleteMenuOpen && createPortal(<div ref={deleteMenuRef} className="preview-delete-menu" role="menu" style={{ left: deleteMenuPosition.x, top: deleteMenuPosition.y }}>
      {canRemoveEnvironment && <button role="menuitem" onClick={() => { setDeleteMenuOpen(false); services.removeEnvironment(node.id); }}>{t("preview.removeEnvironment")}</button>}
      <button role="menuitem" className="danger" onClick={() => { setDeleteMenuOpen(false); services.deleteBlocks([node.id]); }}>{t("preview.deleteEntireBlock")}</button>
    </div>, document.body)}
    {insertion?.side === "after" && <LocalEditor value="" sourceStartOffset={insertion.position} onApply={(value) => applyBoundary(insertion, value)} onDraftChange={(value) => services.onBoundaryDraftChange(insertion, value)} onCancel={cancelEdit} {...services}/>}
  </Fragment>;
}

type PreviewNodeRendererProps = { node: PreviewNode; source: PreviewSourceReader; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; cursorOffset?: number | undefined; boundary?: BoundaryInsertion | undefined; select(id: string): void; edit(id: string, cursorOffset?: number): void; applyEdit(node: PreviewNode, value: string): void; onDraftChange?: ((value: string) => void) | undefined; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; services: PreviewEditorServices };

const PreviewNodeRenderer = memo(function RenderPreviewNode(props: PreviewNodeRendererProps) {
  if (props.node.kind === "block") return <BlockRenderer {...props} node={props.node} select={(id) => { props.services.setSelectedBlockIds([id]); props.select(id); }} edit={(id, offset) => { props.services.setSelectedBlockIds([]); props.edit(id, offset); }}/>;
  // Keep click offsets document-relative through every recursive renderer. Only
  // the LocalEditor boundary converts to the source range actually being edited.
  return <ContentRenderer node={props.node} source={props.source} editing={props.editingId === props.node.id} cursorOffset={props.cursorOffset} boundary={props.boundary} beginEdit={(offset) => { props.services.setSelectedBlockIds([]); props.edit(props.node.id, offset); }} applyEdit={(value) => props.applyEdit(props.node, value)} onDraftChange={props.onDraftChange} applyBoundary={props.applyBoundary} cancelEdit={props.cancelEdit} requestBoundary={props.requestBoundary} services={props.services}/>;
}, samePreviewNodeRender);

function samePreviewNodeRender(previous: PreviewNodeRendererProps, next: PreviewNodeRendererProps): boolean {
  if (previous.node !== next.node || previous.source !== next.source || previous.definitions !== next.definitions || previous.onDraftChange !== next.onDraftChange) return false;
  const a = previous.services, b = next.services;
  if (a.api !== b.api || a.projectId !== b.projectId || a.tree !== b.tree || a.currentPath !== b.currentPath || a.graphicPaths !== b.graphicPaths || a.mathContext.sourceVersion !== b.mathContext.sourceVersion || a.searchQuery !== b.searchQuery || a.filterQuery !== b.filterQuery) return false;
  if (a.visibilitySignatures.get(previous.node.id) !== b.visibilitySignatures.get(next.node.id)) return false;
  if (a.forcedIds.has(previous.node.id) !== b.forcedIds.has(next.node.id)) return false;
  const activeIn = (services: PreviewEditorServices, node: PreviewNode) => services.activeSearchResult && services.activeSearchResult.matchStart >= node.source.startOffset && services.activeSearchResult.matchEnd <= node.source.endOffset
    ? `${services.activeSearchResult.matchStart}:${services.activeSearchResult.matchEnd}` : "";
  if (activeIn(a, previous.node) !== activeIn(b, next.node)) return false;
  const ra = a.relation, rb = b.relation;
  if (ra?.active !== rb?.active || ra?.direction !== rb?.direction) return false;
  if (ra?.snapshot !== rb?.snapshot && (a.selectedBlockIds.length || b.selectedBlockIds.length)) return false;
  const interaction = (props: PreviewNodeRendererProps) => {
    const range = props.node.source;
    const contains = (id?: string) => {
      if (!id) return false;
      if (id === props.node.id) return true;
      const target = props.services.nodeRanges.get(id);
      return !!target && target.filePath === range.filePath && target.startOffset >= range.startOffset && target.endOffset <= range.endOffset;
    };
    const selected = props.services.selectedBlockIds.filter(contains);
    const editing = contains(props.editingId) ? `${props.editingId}:${props.cursorOffset}` : "";
    const boundary = contains(props.boundary?.targetId) ? `${props.boundary?.targetId}:${props.boundary?.side}:${props.boundary?.position}` : "";
    const collapsed = [...props.services.collapsedBlockIds].filter(contains).sort().join(",");
    return `${selected.join(",")}:${selected.length ? props.services.selectedBlockIds.length : 0}|${editing}|${boundary}|${collapsed}`;
  };
  return interaction(previous) === interaction(next);
}

type PreviewListRow = { id: string; estimatedHeight: number; node?: PreviewNode; collapsed?: number };

function PreviewNodeList({ nodes, ...props }: { nodes: PreviewNode[] } & Omit<PreviewNodeRendererProps, "node">) {
  const rows: PreviewListRow[] = [];
  for (let index = 0; index < nodes.length;) {
    const node = nodes[index];
    if (!node) break;
    const nodeState = previewFilterState(node, props.services);
    const disposition = filterDisposition(nodeState, props.services.filterQuery.viewMode);
    const protectedNode = props.services.forcedIds.has(node.id);
    if (disposition === "remove" && !protectedNode) { index += 1; continue; }
    const collapsible = disposition === "collapse" && !protectedNode;
    if (!collapsible) { rows.push({ id: node.id, node, estimatedHeight: estimatedPreviewHeight(node) }); index += 1; continue; }
    let end = index + 1;
    while (end < nodes.length) {
      const next = nodes[end];
      if (!next || filterDisposition(previewFilterState(next, props.services), props.services.filterQuery.viewMode) !== "collapse" || props.services.forcedIds.has(next.id)) break;
      end += 1;
    }
    rows.push({ id: `collapsed:${node.id}`, collapsed: end - index, estimatedHeight: 40 });
    index = end;
  }
  return <VirtualPreviewList items={rows} controller={props.services.virtual} rootRef={props.services.virtualRoot} forcedIds={props.services.forcedIds} renderItem={(row) => row.node
    ? <PreviewNodeRenderer node={row.node} {...props}/>
    : <div className="preview-filter-collapsed">站ｯ {row.collapsed} {t("filter.blocksCollapsed")}</div>}/>;
}

function canCollapseBlock(node: StructuralBlock): boolean {
  return node.environmentId !== "texweave-disabled";
}

function PreviewPerformancePanel({ virtual, timing, total }: { virtual: VirtualPreviewController; timing: { current: { parseMs: number; indexMs: number; reactMs: number; parseMode: "direct" | "local-reparse" | "full"; directUpdates: number; localReparses: number; fullFallbacks: number; fallbackReasons: Partial<Record<PreviewFallbackReason, number>> } }; total: number }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState({ mounted: 0, visible: 0, math: mathRenderService.stats(), heightHitRate: 0 });
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const root = virtual.root;
      const rect = root?.getBoundingClientRect();
      const visible = rect ? Array.from(root!.querySelectorAll<HTMLElement>(".preview-block, .preview-content-region")).filter((node) => {
        const bounds = node.getBoundingClientRect();
        return bounds.bottom >= rect.top && bounds.top <= rect.bottom;
      }).length : 0;
      setSnapshot({ mounted: virtual.mountedCount(), visible, math: mathRenderService.stats(), heightHitRate: virtual.heightHitRate() });
    };
    update();
    const timer = window.setInterval(update, 600);
    return () => window.clearInterval(timer);
  }, [open, virtual]);
  return <details className="preview-performance-panel" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Preview metrics</summary><div>Parse {timing.current.parseMs.toFixed(1)} ms ({timing.current.parseMode}) ﾂｷ Index {timing.current.indexMs.toFixed(1)} ms ﾂｷ React {timing.current.reactMs.toFixed(1)} ms</div><div>Direct {timing.current.directUpdates} ﾂｷ Local reparse {timing.current.localReparses} ﾂｷ Full fallback {timing.current.fullFallbacks}</div><div>Fallback reasons {Object.entries(timing.current.fallbackReasons).map(([reason, count]) => `${reason}: ${count}`).join(" ﾂｷ ") || "none"}</div><div>Visible {snapshot.visible} ﾂｷ Mounted {snapshot.mounted} / {total}</div><div>KaTeX {snapshot.math.calls - snapshot.math.hits} renders ﾂｷ cache {(snapshot.math.hitRate * 100).toFixed(0)}%</div><div>Height cache {(snapshot.heightHitRate * 100).toFixed(0)}%</div></details>;
}

export function PreviewPane({ filePath, source, sourceTransaction, definitions, mathContext = EMPTY_MATH_CONTEXT, searchQuery = defaultInlineSearch, searchResults, filterQuery = defaultFilterQuery, activeSearchResult, highlightRange, locateRequest, restoreOffset, restoreScrollTop, onLocated, onHighlightLocated, relation, onSourceChange, onSelectionChange, onSelectionContextMenu, onViewportAnchorChange, onClickSourcePosition, onJumpFromPosition, onInsertionAnchorChange, onFigureSelect, onFigureSlotSelect, onTableSelect, onTableChange, api, projectId, tree, getOpenDocuments, onSpellContextMenu, onDetectedLanguage, onForwardSync }: { getOpenDocuments?: (() => Array<{ path: string; content: string }>) | undefined; filePath?: string | undefined; source?: string | undefined; sourceTransaction?: PreviewSourceTransaction | undefined; definitions: EnvironmentDefinition[]; mathContext?: MathContext; searchQuery?: SearchQuery; searchResults?: SearchResult[]; filterQuery?: FilterQuery; activeSearchResult?: SearchResult | undefined; highlightRange?: { fileId: string; start: number; end: number; nonce: number } | undefined; locateRequest?: { fileId: string; offset: number; nonce: number } | undefined; restoreOffset?: number | undefined; restoreScrollTop?: number | undefined; onLocated?(nonce: number): void; onHighlightLocated?(nonce: number): void; relation?: PreviewRelationUi | undefined; onSourceChange(next: string, changes?: PreviewTextChange[]): void; onSelectionChange?(selection?: DocumentSelection): void; onSelectionContextMenu?(selection: DocumentSelection, x: number, y: number): void; onViewportAnchorChange?(anchor: { fileId: string; offset: number; scrollTop: number }): void; onClickSourcePosition?(anchor: { fileId: string; offset: number }): void; onJumpFromPosition?(anchor: { fileId: string; offset: number; targetOffset: number; linkText: string; targetLabel: string }): void; onInsertionAnchorChange?(anchor?: { fileId: string; offset: number }): void; onFigureSelect?(selection?: FigureSelection): void; onFigureSlotSelect?(selection: FigureSelection): void; onTableSelect?(selection?: TableSelection): void; onTableChange?(selection: TableSelection, source: string): void; api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void; onForwardSync(path: string, line: number, column?: number): void }) {
  const inlineSearch = useMemo<InlineSearchQuery>(() => ({ ...searchQuery, activeMatchId: activeSearchResult?.id, ...(searchResults ? { resolvedMatches: searchResults.filter(result => result.fileId === filePath) } : {}) }), [searchQuery, searchResults, filePath, activeSearchResult?.id]);
  const preferences = useSettings();
  const referenceLinkModifier = preferences.get("referenceLinkModifier");
  const storedDirectives = preferences.get("previewDirectives");
  const previewDirectives = useMemo(() => includeNewBuiltInDirectives(storedDirectives), [storedDirectives]);
  const showPreviewMetrics = preferences.get("showPreviewMetrics");
  const [selectedId, setSelectedId] = useState<string>();
  const [additionalSelectedIds, setAdditionalSelectedIds] = useState<string[]>([]);
  const selectionAnchorRef = useRef<string | undefined>(undefined);
  const [blockToolbarPosition, setBlockToolbarPosition] = useState<{ x: number; y: number }>();
  const blockToolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!blockToolbarPosition) return;
    const dismiss = (event: PointerEvent) => {
      if (!blockToolbarRef.current?.contains(event.target as Node)) setBlockToolbarPosition(undefined);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setBlockToolbarPosition(undefined); };
    window.document.addEventListener("pointerdown", dismiss);
    window.document.addEventListener("keydown", escape);
    return () => {
      window.document.removeEventListener("pointerdown", dismiss);
      window.document.removeEventListener("keydown", escape);
    };
  }, [blockToolbarPosition]);
  useLayoutEffect(() => {
    if (!blockToolbarPosition) return;
    const bounds = blockToolbarRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = Math.min(Math.max(8, blockToolbarPosition.x), Math.max(8, window.innerWidth - bounds.width - 8));
    const y = Math.min(Math.max(8, blockToolbarPosition.y), Math.max(8, window.innerHeight - bounds.height - 8));
    if (x !== blockToolbarPosition.x || y !== blockToolbarPosition.y) setBlockToolbarPosition({ x, y });
  }, [blockToolbarPosition, selectedId, additionalSelectedIds]);
  const [editingId, setEditingId] = useState<string>();
  // Absolute document position; recursive renderers must never rebase it.
  const [editingCursorOffset, setEditingCursorOffset] = useState<number>();
  const [editingInitialHeight, setEditingInitialHeight] = useState<number>();
  const [boundary, setBoundary] = useState<BoundaryInsertion>();
  const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number }>();
  const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<string>>(new Set());
  const [operationNotice, setOperationNotice] = useState<string>();
  const [operationPreview, setOperationPreview] = useState<{ before: string; transaction: BlockSourceTransaction; action: "move" | "disable" | "delete" }>();
  const [forcedTargetId, setForcedTargetId] = useState<string>();
  const [pendingScroll, setPendingScroll] = useState<PendingPreviewScroll>();
  const navigationEvents = useMemo(() => new PreviewNavigationEvents(), [projectId]);
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  // A new file gets a fresh controller before its rows measure themselves.
  // Resetting the shared controller in a passive effect erased those measures.
  const virtual = useMemo(() => new VirtualPreviewController(), [projectId, filePath]);
  const sourceValueRef = useRef(source ?? "");
  sourceValueRef.current = source ?? "";
  const sourceReader = useMemo<PreviewSourceReader>(() => ({ slice: (start, end) => sourceValueRef.current.slice(start, end) }), []);
  const previousDocumentRef = useRef<{ document: PreviewDocument; source: string; definitions: EnvironmentDefinition[]; directives: PreviewDirectiveDefinition[] } | undefined>(undefined);
  const visualIdSequence = useRef(0);
  const previewTiming = useRef({ parseMs: 0, indexMs: 0, reactMs: 0, parseMode: "full" as "direct" | "local-reparse" | "full", directUpdates: 0, localReparses: 0, fullFallbacks: 0, fallbackReasons: {} as Partial<Record<PreviewFallbackReason, number>> });
  const lastUpdateRef = useRef<{ document: PreviewDocument; changeSet: PreviewChangeSet } | undefined>(undefined);
  const hoveredJumpElementRef = useRef<Element | undefined>(undefined);
  const activeJumpElementRef = useRef<HTMLElement | undefined>(undefined);
  const restoredFileRef = useRef<string | undefined>(undefined);
  const marqueeGesture = useRef<{ pointerId: number; startX: number; startY: number; currentX: number; currentY: number; moved: boolean } | undefined>(undefined);
  const marqueeJustCompleted = useRef(false);
  const pendingBoundaryRef = useRef<{ startOffset: number; position: number; side: "before" | "after"; kind: PreviewNode["kind"] } | undefined>(undefined);
  const pendingStructuralEditRef = useRef<{ startOffset: number; environmentId: string } | undefined>(undefined);
  const pendingBlockSelectionRef = useRef<{ filePath: string; source: string; ranges: Array<{ start: number; end: number }> } | undefined>(undefined);
  useEffect(() => {
    const reset = () => {
      setSelectedId(undefined); setAdditionalSelectedIds([]); setBlockToolbarPosition(undefined);
      setEditingId(undefined); setEditingCursorOffset(undefined); setEditingInitialHeight(undefined); setBoundary(undefined);
      pendingBoundaryRef.current = undefined;
      pendingStructuralEditRef.current = undefined;
      pendingBlockSelectionRef.current = undefined;
    };
    window.addEventListener("texweave:history-replayed", reset);
    return () => window.removeEventListener("texweave:history-replayed", reset);
  }, []);
  const document = useMemo(() => {
    if (!filePath || source === undefined) return undefined;
    const started = performance.now();
    const prior = previousDocumentRef.current;
    const incremental = prior?.definitions === definitions && prior.directives === previewDirectives
      ? tryIncrementalPreviewUpdate(prior.document, prior.source, source, filePath, definitions, sourceTransaction, previewDirectives)
      : undefined;
    let next: PreviewDocument;
    if (incremental && "document" in incremental) {
      next = incremental.document;
      lastUpdateRef.current = { document: next, changeSet: incremental.changeSet };
      previewTiming.current.parseMode = incremental.mode;
      if (incremental.mode === "direct") previewTiming.current.directUpdates += 1;
      else previewTiming.current.localReparses += 1;
    } else {
      const parsed = parsePreview(source, filePath, definitions, previewDirectives);
      next = reusePreviewDocument(prior?.document, prior?.source, parsed, source, () => `visual:${filePath}:${++visualIdSequence.current}`);
      lastUpdateRef.current = undefined;
      previewTiming.current.parseMode = "full";
      if (prior?.document.filePath === filePath) {
        previewTiming.current.fullFallbacks += 1;
        const reason = incremental && "fallbackReason" in incremental ? incremental.fallbackReason : "file-or-definitions";
        previewTiming.current.fallbackReasons[reason] = (previewTiming.current.fallbackReasons[reason] ?? 0) + 1;
      }
    }
    previousDocumentRef.current = { document: next, source, definitions, directives: previewDirectives };
    previewTiming.current.parseMs = performance.now() - started;
    return next;
  }, [filePath, source, definitions, previewDirectives, sourceTransaction]);
  const renderIndex = useMemo(() => {
    const started = performance.now();
    const index = buildPreviewRenderIndex(document?.nodes ?? []);
    previewTiming.current.indexMs = performance.now() - started;
    return index;
  }, [document]);
  useEffect(() => {
    setCollapsedBlockIds(filePath && source !== undefined
      ? readCollapsedPreview(projectId, filePath, renderIndex, source)
      : new Set());
  }, [projectId, filePath, source, renderIndex]);
  const revealCollapsedTargets = (ids: Iterable<string>) => {
    if (!filePath || source === undefined) return;
    const current = readCollapsedPreview(projectId, filePath, renderIndex, source);
    let changed = false;
    for (const id of ids) {
      for (const ancestor of previewPath(renderIndex, id)) changed = current.delete(ancestor) || changed;
    }
    if (!changed) return;
    writeCollapsedPreview(projectId, filePath, renderIndex, source, current);
    setCollapsedBlockIds(current);
  };
  const graphicPathsCache = useRef<{ filePath: string; paths: string[] } | undefined>(undefined);
  const graphicPaths = useMemo(() => {
    if (filePath && lastUpdateRef.current?.document === document && !lastUpdateRef.current?.changeSet.graphicPathsChanged
      && graphicPathsCache.current?.filePath === filePath) return graphicPathsCache.current.paths;
    const paths = parseGraphicPaths(source ?? "");
    if (filePath) graphicPathsCache.current = { filePath, paths };
    return paths;
  }, [document, filePath, source]);
  const stableGraphicPathsRef = useRef<string[]>([]);
  if (graphicPaths.length !== stableGraphicPathsRef.current.length || graphicPaths.some((path, index) => path !== stableGraphicPathsRef.current[index])) stableGraphicPathsRef.current = graphicPaths;
  const stableGraphicPaths = stableGraphicPathsRef.current;
  const mappedRelationIds = useMemo(() => {
    if (!relation?.active && !relation?.locateRequest) return noRelationIds;
    const mapped: Record<string, BlockId> = {};
    for (const entry of renderIndex.entries) {
      const id = relation?.transientToBlockId[entry.node.parserId ?? entry.id];
      if (id) mapped[entry.id] = id;
    }
    return mapped;
  }, [renderIndex, relation?.active, relation?.locateRequest, relation?.transientToBlockId]);
  const [fieldEditingIds, setFieldEditingIds] = useState<ReadonlySet<string>>(new Set());
  const onFieldEditing = useCallback((id: string, active: boolean) => {
    setFieldEditingIds(previous => { if (previous.has(id) === active) return previous; const next = new Set(previous); if (active) next.add(id); else next.delete(id); return next; });
  }, []);
  const forcedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of [forcedTargetId, selectedId, editingId, boundary?.targetId, ...additionalSelectedIds, ...fieldEditingIds]) {
      if (id) for (const ancestor of previewPath(renderIndex, id)) ids.add(ancestor);
    }
    return ids;
  }, [renderIndex, forcedTargetId, selectedId, editingId, boundary?.targetId, additionalSelectedIds, fieldEditingIds]);
  const updateJumpCursor = (target: Element | undefined, modifierHeld: boolean) => {
    const root = previewRootRef.current;
    const jump = modifierHeld && root?.contains(target ?? null) && document && source !== undefined
      ? previewJumpTarget(target, source, document.nodes) : undefined;
    if (activeJumpElementRef.current === jump?.element) return;
    activeJumpElementRef.current?.classList.remove("preview-jump-ready");
    jump?.element.classList.add("preview-jump-ready");
    activeJumpElementRef.current = jump?.element;
  };
  useEffect(() => {
    const onModifier = (event: KeyboardEvent) => updateJumpCursor(hoveredJumpElementRef.current, referenceModifierPressed(event, referenceLinkModifier));
    const reset = () => updateJumpCursor(undefined, false);
    window.addEventListener("keydown", onModifier);
    window.addEventListener("keyup", onModifier);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", onModifier);
      window.removeEventListener("keyup", onModifier);
      window.removeEventListener("blur", reset);
      reset();
    };
  }, [document, source, referenceLinkModifier]);
  const nodeRanges = useMemo<PreviewEditorServices["nodeRanges"]>(() => ({
    get: (id) => {
      const empty = id.startsWith("ui-empty:");
      const node = renderIndex.byId.get(empty ? id.slice("ui-empty:".length) : id)?.node;
      return empty && node?.kind === "block" ? node.body : node?.source;
    }
  }), [renderIndex]);
  // Delegates stay stable, but always use the latest document and host callbacks.
  // This makes memoized siblings safe, including deletion and inspector actions.
  const actionsRef = useRef<PreviewActions | undefined>(undefined);
  const actions = useMemo<PreviewActions>(() => ({
    select: (id) => actionsRef.current?.select(id),
    edit: (id, offset) => actionsRef.current?.edit(id, offset),
    applyEdit: (node, value) => actionsRef.current?.applyEdit(node, value),
    applyBoundary: (insertion, value) => actionsRef.current?.applyBoundary(insertion, value),
    onBoundaryDraftChange: (insertion, value) => actionsRef.current?.onBoundaryDraftChange(insertion, value),
    cancelEdit: () => actionsRef.current?.cancelEdit(),
    requestBoundary: (node, side, draft) => actionsRef.current?.requestBoundary(node, side, draft),
    setSelectedBlockIds: (ids) => actionsRef.current?.setSelectedBlockIds(ids),
    selectBlockWithModifiers: (id, modifiers) => actionsRef.current?.selectBlockWithModifiers(id, modifiers),
    toggleCollapse: (ids, collapsed, scope) => actionsRef.current?.toggleCollapse(ids, collapsed, scope),
    moveBlocks: (ids, targetId, position) => actionsRef.current?.moveBlocks(ids, targetId, position),
    copyBlocks: (ids, cut) => actionsRef.current?.copyBlocks(ids, cut),
    duplicateBlocks: (ids) => actionsRef.current?.duplicateBlocks(ids),
    pasteBlocks: (targetId, position) => actionsRef.current?.pasteBlocks(targetId, position),
    disableBlocks: (ids) => actionsRef.current?.disableBlocks(ids),
    enableBlocks: (ids) => actionsRef.current?.enableBlocks(ids),
    deleteBlocks: (ids) => actionsRef.current?.deleteBlocks(ids),
    removeEnvironment: (id) => actionsRef.current?.removeEnvironment(id),
    onFigureSelect: (selection) => actionsRef.current?.onFigureSelect?.(selection),
    onFigureSlotSelect: (selection) => actionsRef.current?.onFigureSlotSelect?.(selection),
    onTableSelect: (selection) => actionsRef.current?.onTableSelect?.(selection),
    onTableChange: (selection, replacement) => actionsRef.current?.onTableChange?.(selection, replacement),
    onSpellContextMenu: (request) => actionsRef.current?.onSpellContextMenu(request),
    onDetectedLanguage: (language) => actionsRef.current?.onDetectedLanguage(language),
    onForwardSync: (path, line, column) => actionsRef.current?.onForwardSync(path, line, column),
    relationFocus: (id) => actionsRef.current?.relationFocus(id),
    relationToggle: (id, x, y) => actionsRef.current?.relationToggle(id, x, y)
  }), []);
  const filterEvaluation = useMemo(() => filterQuery.enabled && document && source !== undefined && filePath ? previewFilterEngine.evaluate(document.nodes, source, filePath, filterQuery) : undefined, [document, source, filePath, filterQuery]);
  const visibilitySignatures = useMemo(() => {
    if (!filterQuery.enabled && !relation?.active) return noVisibilitySignatures;
    const signatures = new Map<string, string>();
    const visit = (nodes: PreviewNode[]) => {
      for (const node of nodes) {
        const query = filterQuery.enabled ? filterEvaluation?.states.get(node.id) ?? "match" : "match";
        const semanticId = mappedRelationIds[node.id];
        const relationState = !relation?.active || !semanticId ? "match"
          : relation.matchIds.has(semanticId) ? "match" : relation.contextIds.has(semanticId) ? "context" : "unmatched";
        const children = node.kind === "block" ? visit(node.children) : "";
        signatures.set(node.id, `${query}:${relationState}:${semanticId === relation?.focusId ? "focus" : ""}:${children}`);
      }
      return nodes.map((node) => signatures.get(node.id)).join("|");
    };
    visit(document?.nodes ?? []);
    return signatures;
  }, [document, filterEvaluation, filterQuery.enabled, mappedRelationIds, relation?.active, relation?.matchIds, relation?.contextIds, relation?.focusId]);
  useEffect(() => {
    onInsertionAnchorChange?.(boundary && filePath ? { fileId: filePath, offset: boundary.position } : undefined);
  }, [boundary, filePath, onInsertionAnchorChange]);
  useEffect(() => {
    pendingBoundaryRef.current = undefined; pendingStructuralEditRef.current = undefined; pendingBlockSelectionRef.current = undefined;
    restoredFileRef.current = undefined; selectionAnchorRef.current = undefined; hoveredJumpElementRef.current = undefined;
    marqueeGesture.current = undefined; setMarqueeRect(undefined); setPendingScroll(undefined);
    setForcedTargetId(undefined); setEditingId(undefined); setEditingCursorOffset(undefined); setEditingInitialHeight(undefined);
    setSelectedId(undefined); setAdditionalSelectedIds([]); setBlockToolbarPosition(undefined); setBoundary(undefined); setOperationPreview(undefined); setOperationNotice(undefined);
  }, [projectId, filePath, virtual]);
  useEffect(() => () => virtual.disconnect(), [virtual]);
  useEffect(() => {
    const pendingSelection = pendingBlockSelectionRef.current;
    if (pendingSelection && filePath === pendingSelection.filePath) {
      pendingBlockSelectionRef.current = undefined;
      const roots = source === pendingSelection.source && document ? blocksInSelectionRanges(document.nodes, pendingSelection.ranges) : [];
      setSelectedId(roots[0]?.id);
      setAdditionalSelectedIds(roots.slice(1).map((block) => block.id));
      if (roots[0]) setPendingScroll({ fileId: pendingSelection.filePath, id: roots[0].id, align: "nearest" });
    }
    const pendingStructuralEdit = pendingStructuralEditRef.current;
    if (pendingStructuralEdit && document) {
      const target = structuralBlockAt(document.nodes, pendingStructuralEdit.startOffset, pendingStructuralEdit.environmentId);
      pendingStructuralEditRef.current = undefined;
      if (target) {
        const body = source?.slice(target.body.startOffset, target.body.endOffset) ?? "";
        const leadingWhitespace = body.match(/^[\t \r\n]*/)?.[0].length ?? 0;
        setEditingId(target.id);
        setEditingCursorOffset(target.body.startOffset + leadingWhitespace);
        setEditingInitialHeight(undefined);
        setSelectedId(undefined);
        setAdditionalSelectedIds([]);
        setBoundary(undefined);
        return;
      }
    }
    const pending = pendingBoundaryRef.current;
    if (pending && document) {
      const target = nodeAtStart(document.nodes, pending.startOffset, pending.kind);
      pendingBoundaryRef.current = undefined;
      setEditingId(undefined);
      setEditingInitialHeight(undefined);
      setSelectedId(undefined);
      setAdditionalSelectedIds([]);
      setBoundary(target ? { targetId: target.id, position: pending.position, side: pending.side } : undefined);
      return;
    }
    setEditingId(undefined);
    setEditingInitialHeight(undefined);
    setBoundary(undefined);
  }, [source]);
  const requestBoundary = (node: PreviewNode, side: "before" | "after", draft?: string) => {
    const original = nodeSource(node, source ?? "");
    if (draft !== undefined && draft !== original && source !== undefined) {
      const nextSource = source.slice(0, node.source.startOffset) + draft + source.slice(node.source.endOffset);
      pendingBoundaryRef.current = { startOffset: node.source.startOffset, position: side === "before" ? node.source.startOffset : node.source.startOffset + draft.length, side, kind: node.kind };
      onSourceChange(nextSource, [{ from: node.source.startOffset, to: node.source.endOffset, insertedText: draft }]);
      return;
    }
    setEditingId(undefined);
    setEditingInitialHeight(undefined);
    setSelectedId(undefined);
    setAdditionalSelectedIds([]);
    setBoundary({ targetId: node.id, position: side === "before" ? node.source.startOffset : node.source.endOffset, side });
  };
  useEffect(() => {
    const selected = selectedId && additionalSelectedIds.length === 0 && document ? nodeById(document.nodes, selectedId) : undefined;
    const selectedBlock = selected?.kind === "block" ? selected : undefined;
    const registrations = [
      commands.register("block.insertBefore", { when: () => !!selectedBlock && !boundary && !editingId, execute: () => { if (selectedBlock) requestBoundary(selectedBlock, "before"); } }),
      commands.register("block.insertAfter", { when: () => !!selectedBlock && !boundary && !editingId, execute: () => { if (selectedBlock) requestBoundary(selectedBlock, "after"); } })
    ];
    return () => registrations.forEach((dispose) => dispose());
  }, [selectedId, additionalSelectedIds, document, boundary, editingId]);
  useEffect(() => {
    if (!filePath || !document || !previewRootRef.current) return;
    const request = locateRequest?.fileId === filePath ? locateRequest : undefined;
    if (request && !navigationEvents.consume("navigation", filePath, request.nonce)) return;
    if (!request && restoredFileRef.current === filePath) return;
    if (!request && restoreScrollTop !== undefined) {
      previewRootRef.current.scrollTop = restoreScrollTop;
      restoredFileRef.current = filePath;
      return;
    }
    const offset = request?.offset ?? restoreOffset;
    if (offset === undefined) { previewRootRef.current.scrollTop = 0; restoredFileRef.current = filePath; return; }
    const node = nodeAtOffset(document.nodes, offset);
    if (node) { if (request) revealCollapsedTargets([node.id]); setForcedTargetId(node.id); setPendingScroll({ fileId: filePath, id: node.id, offset, align: request ? "start" : "center", ...(request ? { nonce: request.nonce } : {}) }); }
    restoredFileRef.current = filePath;
    if (request && !node) onLocated?.(request.nonce);
  }, [filePath, document, locateRequest, restoreOffset, restoreScrollTop, navigationEvents]);
  // Search selection navigates through the host's explicit locateRequest.
  // activeSearchResult is only a highlight, never a persistent scroll command.
  useEffect(() => {
    if (!filePath || !highlightRange || highlightRange.fileId !== filePath || !document) return;
    if (source === undefined || highlightRange.end > source.length) return;
    if (!navigationEvents.consume("highlight", filePath, highlightRange.nonce)) return;
    if (locateRequest?.fileId === filePath) { onHighlightLocated?.(highlightRange.nonce); return; }
    const node = nodeAtOffset(document.nodes, highlightRange.start);
    if (!node) { onHighlightLocated?.(highlightRange.nonce); return; }
    revealCollapsedTargets([node.id]);
    setForcedTargetId(node.id);
    setPendingScroll({ fileId: filePath, id: node.id, offset: highlightRange.start, align: "center", highlight: "custom-block-created-highlight", highlightNonce: highlightRange.nonce });
  }, [highlightRange, filePath, document, source, navigationEvents, locateRequest, onHighlightLocated]);
  useEffect(() => {
    const request = relation?.locateRequest;
    if (!filePath || !request || request.fileId !== filePath) return;
    if (locateRequest?.fileId === filePath) { navigationEvents.consume("relation", filePath, request.nonce); relation?.onLocated?.(request.nonce); return; }
    const entry = renderIndex.entries.find((candidate) => mappedRelationIds[candidate.id] === request.blockId);
    if (!entry) return;
    if (!navigationEvents.consume("relation", filePath, request.nonce)) return;
    revealCollapsedTargets([entry.id]);
    setForcedTargetId(entry.id);
    setPendingScroll({ fileId: filePath, id: entry.id, align: "center", highlight: "relation-locate-highlight", relationNonce: request.nonce });
  }, [relation?.locateRequest, renderIndex, mappedRelationIds, filePath, navigationEvents, locateRequest]);
  useEffect(() => {
    if (!filterQuery.enabled || !filterEvaluation || !filePath || source === undefined) return;
    if (![filterQuery.blockTypes, filterQuery.locations, filterQuery.files, filterQuery.properties].some((items) => items.length > 0)) return;
    revealCollapsedTargets(filterEvaluation.matches);
  }, [filterQuery, filterEvaluation, filePath, source, renderIndex]);
  useEffect(() => {
    const root = previewRootRef.current;
    if (!root || !pendingScroll || pendingScroll.fileId !== filePath) return;
    if (!renderIndex.byId.has(pendingScroll.id)) {
      if (pendingScroll.nonce !== undefined) onLocated?.(pendingScroll.nonce);
      if (pendingScroll.highlightNonce !== undefined) onHighlightLocated?.(pendingScroll.highlightNonce);
      if (pendingScroll.relationNonce !== undefined) relation?.onLocated?.(pendingScroll.relationNonce);
      setPendingScroll(undefined); setForcedTargetId(undefined);
      return;
    }
    const containsOffset = (element: HTMLElement) => previewSpanContains({ startOffset: Number(element.dataset.sourceStartOffset), endOffset: Number(element.dataset.sourceEndOffset) }, pendingScroll.offset!);
    const row = Array.from(root.querySelectorAll<HTMLElement>("[data-virtual-node-id]")).find((element) => element.dataset.virtualNodeId === pendingScroll.id)
      ?? (pendingScroll.offset === undefined ? undefined : Array.from(root.querySelectorAll<HTMLElement>("[data-source-start-offset][data-source-end-offset]")).filter(containsOffset).sort((a, b) => (Number(a.dataset.sourceEndOffset) - Number(a.dataset.sourceStartOffset)) - (Number(b.dataset.sourceEndOffset) - Number(b.dataset.sourceStartOffset)))[0]);
    if (!row) return;
    const target = pendingScroll.offset === undefined ? row.querySelector<HTMLElement>("[data-source-start-offset]") ?? row
      : Array.from(row.querySelectorAll<HTMLElement>("[data-source-start-offset][data-source-end-offset]")).filter(containsOffset).sort((a, b) => (Number(a.dataset.sourceEndOffset) - Number(a.dataset.sourceStartOffset)) - (Number(b.dataset.sourceEndOffset) - Number(b.dataset.sourceStartOffset)))[0] ?? row;
    target.scrollIntoView({ block: pendingScroll.align });
    if (pendingScroll.highlight) {
      target.classList.add(pendingScroll.highlight);
      const className = pendingScroll.highlight;
      window.setTimeout(() => target.classList.remove(className), 900);
    }
    if (pendingScroll.nonce !== undefined) onLocated?.(pendingScroll.nonce);
    if (pendingScroll.highlightNonce !== undefined) onHighlightLocated?.(pendingScroll.highlightNonce);
    if (pendingScroll.relationNonce !== undefined) relation?.onLocated?.(pendingScroll.relationNonce);
    setPendingScroll(undefined);
    const entry = renderIndex.byId.get(pendingScroll.id);
    const query = filterQuery.enabled ? filterEvaluation?.states.get(pendingScroll.id) ?? "match" : "match";
    const semanticId = mappedRelationIds[pendingScroll.id];
    const relationState = !relation?.active || !semanticId ? "match"
      : relation.matchIds.has(semanticId) ? "match" : relation.contextIds.has(semanticId) ? "context" : "unmatched";
    if (!entry || !["remove", "collapse"].includes(filterDisposition(combineFilterStates(query, relationState), filterQuery.viewMode))) setForcedTargetId(undefined);
  }, [pendingScroll, forcedIds, onLocated, onHighlightLocated, filePath, renderIndex, filterQuery, filterEvaluation, mappedRelationIds, relation]);
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
      onViewportAnchorChange({ fileId: filePath, offset: Math.round(start + (end - start) * progress), scrollTop: root.scrollTop });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(reportAnchor); };
    root.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => { root.removeEventListener("scroll", schedule); if (frame) cancelAnimationFrame(frame); };
  }, [filePath, document, onViewportAnchorChange]);
  const selectedBlockIds = () => [...new Set([...(selectedId ? [selectedId] : []), ...additionalSelectedIds])];
  const setBlockSelection = (ids: string[]) => {
    try {
      const roots = document ? normalizeBlockSelection(document.nodes, ids) : [];
      setSelectedId(roots[0]?.id);
      setAdditionalSelectedIds(roots.slice(1).map((block) => block.id));
      selectionAnchorRef.current = roots[0]?.id;
      setBlockToolbarPosition(undefined);
      setEditingId(undefined); setEditingCursorOffset(undefined); setEditingInitialHeight(undefined); setBoundary(undefined);
      if (roots.length !== 1) { onFigureSelect?.(undefined); onTableSelect?.(undefined); }
    } catch (error) { setOperationNotice(error instanceof Error ? error.message : String(error)); }
  };
  const selectBlockWithModifiers = (id: string, modifiers: { toggle: boolean; range: boolean }) => {
    const current = selectedBlockIds();
    if (modifiers.range && (selectionAnchorRef.current || selectedId)) {
      const ordered = renderIndex.entries.filter((entry) => entry.node.kind === "block").map((entry) => entry.id);
      const anchor = selectionAnchorRef.current ?? selectedId!;
      const from = ordered.indexOf(anchor), to = ordered.indexOf(id);
      setBlockSelection(from < 0 || to < 0 ? [id] : ordered.slice(Math.min(from, to), Math.max(from, to) + 1));
      selectionAnchorRef.current = from < 0 ? id : anchor;
    } else if (modifiers.toggle) {
      setBlockSelection(current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
      selectionAnchorRef.current = id;
    } else {
      setBlockSelection([id]);
      selectionAnchorRef.current = id;
    }
  };
  const toggleCollapse = (ids: string[], collapsed?: boolean, scope: "selected" | "children" | "siblings" | "all" = "selected") => {
    if (!filePath || !document) return;
    const targets = scope === "all" ? renderIndex.entries.filter((entry) => entry.node.kind === "block").map((entry) => entry.node as StructuralBlock)
      : scope === "siblings" ? renderIndex.entries.filter((entry) => entry.node.kind === "block" && entry.parentId === renderIndex.byId.get(ids[0] ?? "")?.parentId).map((entry) => entry.node as StructuralBlock)
      : scope === "children" ? renderIndex.entries.filter((entry) => entry.node.kind === "block" && ids.some((id) => previewPath(renderIndex, entry.id).has(id)) && !ids.includes(entry.id)).map((entry) => entry.node as StructuralBlock)
      : normalizeBlockSelection(document.nodes, ids);
    const eligible = targets.filter(canCollapseBlock);
    const next = new Set(collapsedBlockIds);
    const shouldCollapse = collapsed ?? eligible.some((node) => !next.has(node.id));
    for (const node of eligible) if (shouldCollapse) next.add(node.id); else next.delete(node.id);
    writeCollapsedPreview(projectId, filePath, renderIndex, source ?? "", next);
    setCollapsedBlockIds(next);
  };
  const clearBlockOperationState = () => {
    setSelectedId(undefined); setAdditionalSelectedIds([]); setEditingId(undefined); setEditingCursorOffset(undefined);
    setEditingInitialHeight(undefined); setBlockToolbarPosition(undefined); setBoundary(undefined); onFigureSelect?.(undefined); onTableSelect?.(undefined);
  };
  const commitBlockTransaction = (before: string, planned: BlockSourceTransaction) => {
    if (sourceValueRef.current !== before) { setOperationNotice("The document changed while this block operation was pending. Try again."); return; }
    if (planned.affectedNodeCount >= 8 && api && filePath) {
      void api.history.snapshot(projectId, "manual", `Before ${planned.description.toLowerCase()} in ${filePath}`, [{ path: filePath, content: before }]).catch((error: unknown) => console.warn("Unable to capture a block-operation snapshot", error));
    }
    pendingBlockSelectionRef.current = planned.selectionRanges?.length && filePath ? { filePath, source: planned.source, ranges: planned.selectionRanges } : undefined;
    onSourceChange(planned.source, planned.changes);
    if (pendingBlockSelectionRef.current) {
      setEditingId(undefined); setEditingCursorOffset(undefined); setEditingInitialHeight(undefined); setBoundary(undefined);
      onFigureSelect?.(undefined); onTableSelect?.(undefined);
    } else clearBlockOperationState();
    setOperationPreview(undefined); setOperationNotice(undefined);
  };
  const stageBlockTransaction = (planned: BlockSourceTransaction | undefined, action: "move" | "disable" | "delete" | "other", preview = false, confirmLarge = true) => {
    if (!planned || source === undefined) return;
    if (preview || (confirmLarge && action !== "other" && planned.affectedNodeCount >= 8)) setOperationPreview({ before: source, transaction: planned, action: action === "other" ? "move" : action });
    else commitBlockTransaction(source, planned);
  };
  const runBlockPlan = (plan: () => BlockSourceTransaction | undefined, action: "move" | "disable" | "delete" | "other", preview = false, confirmLarge = true) => {
    try { stageBlockTransaction(plan(), action, preview, confirmLarge); }
    catch (error) { setOperationNotice(error instanceof Error ? error.message : String(error)); }
  };
  const deleteBlocks = (ids: string[]) => {
    if (source === undefined || !document) return;
    runBlockPlan(() => planDeleteBlocks(source, document.nodes, ids), "delete", ids.some((id) => {
      const node = nodeById(document.nodes, id);
      return node?.kind === "block" && countDescendants(node) > 0;
    }));
  };
  const moveBlocks = (ids: string[], targetId: string, position: MovePosition, continuous = false) => {
    if (source === undefined || !document) return;
    runBlockPlan(() => planMoveBlocks(source, document.nodes, ids, targetId, position, definitions), "move", !continuous && ids.length >= 4, !continuous);
  };
  const disableBlocks = (ids: string[]) => {
    if (source === undefined || !document) return;
    runBlockPlan(() => planDisableBlocks(source, document.nodes, ids), "disable", ids.some((id) => {
      const node = nodeById(document.nodes, id);
      return node?.kind === "block" && countDescendants(node) >= 4;
    }));
  };
  const enableBlocks = (ids: string[]) => { if (source !== undefined && document) runBlockPlan(() => planEnableBlocks(source, document.nodes, ids), "other"); };
  const quickMove = (direction: "up" | "down" | "outdent" | "indent") => {
    if (!document) return;
    try {
      const roots = normalizeBlockSelection(document.nodes, selectedBlockIds());
      if (!roots.length) return;
      const parent = renderIndex.byId.get(roots[0]!.id)?.parentId;
      if (roots.some((block) => renderIndex.byId.get(block.id)?.parentId !== parent)) throw new BlockOperationError("invalid-target", "Quick move requires blocks from the same level. Drag them to move across levels.");
      const siblings = renderIndex.entries.filter((entry) => entry.node.kind === "block" && entry.parentId === parent).sort((a, b) => a.node.source.startOffset - b.node.source.startOffset);
      const firstIndex = siblings.findIndex((entry) => entry.id === roots[0]!.id);
      const lastIndex = siblings.findIndex((entry) => entry.id === roots.at(-1)!.id);
      const target = direction === "up" || direction === "indent" ? siblings[firstIndex - 1] : direction === "down" ? siblings[lastIndex + 1] : parent ? renderIndex.byId.get(parent) : undefined;
      if (target) moveBlocks(roots.map((block) => block.id), target.id, direction === "up" ? "before" : direction === "down" || direction === "outdent" ? "after" : "inside", true);
    } catch (error) { setOperationNotice(error instanceof Error ? error.message : String(error)); }
  };
  const stepBlockSelection = (direction: "up" | "down") => {
    const nextId = adjacentVisibleBlockId(renderIndex, selectedBlockIds(), collapsedBlockIds, direction, (entry) => {
      const query = filterQuery.enabled ? filterEvaluation?.states.get(entry.id) ?? "match" : "match";
      const semanticId = mappedRelationIds[entry.id];
      const relationState = !relation?.active || !semanticId ? "match"
        : relation.matchIds.has(semanticId) ? "match" : relation.contextIds.has(semanticId) ? "context" : "unmatched";
      return !["remove", "collapse"].includes(filterDisposition(combineFilterStates(query, relationState), filterQuery.viewMode));
    });
    if (!nextId) return;
    setBlockSelection([nextId]);
    if (filePath) setPendingScroll({ fileId: filePath, id: nextId, align: "nearest" });
  };
  useEffect(() => {
    const register = (id: "block.moveUp" | "block.moveDown" | "block.outdent" | "block.indent", direction: "up" | "down" | "outdent" | "indent") =>
      commands.register(id, { when: () => selectedBlockIds().length > 0 && !editingId && !boundary, execute: () => quickMove(direction) });
    const dispose = [register("block.moveUp", "up"), register("block.moveDown", "down"), register("block.outdent", "outdent"), register("block.indent", "indent"),
      commands.register("block.selectPrevious", { when: () => selectedBlockIds().length > 0 && !editingId && !boundary && !operationPreview && window.getSelection()?.isCollapsed !== false, execute: () => stepBlockSelection("up") }),
      commands.register("block.selectNext", { when: () => selectedBlockIds().length > 0 && !editingId && !boundary && !operationPreview && window.getSelection()?.isCollapsed !== false, execute: () => stepBlockSelection("down") })];
    return () => dispose.forEach((release) => release());
  }, [document, selectedId, additionalSelectedIds, editingId, boundary, source, collapsedBlockIds, operationPreview, filterQuery, filterEvaluation, mappedRelationIds, relation]);
  const removeEnvironment = (id: string) => {
    if (!source || !document) return;
    const node = nodeById(document.nodes, id);
    if (!node || node.kind !== "block" || node.origin !== "latex") return;
    const original = nodeSource(node, source);
    const unwrapped = unwrapLatexEnvironment(original, node.environmentId);
    if (unwrapped === undefined) return;
    onSourceChange(source.slice(0, node.source.startOffset) + unwrapped + source.slice(node.source.endOffset), [{ from: node.source.startOffset, to: node.source.endOffset, insertedText: unwrapped }]);
    setSelectedId(undefined);
    setAdditionalSelectedIds([]);
    setEditingId(undefined);
    setEditingCursorOffset(undefined);
    setEditingInitialHeight(undefined);
    setBoundary(undefined);
    onFigureSelect?.(undefined);
    onTableSelect?.(undefined);
  };
  const copyBlocks = async (ids: string[], cut: boolean) => {
    if (source === undefined || !document || !filePath) return;
    try {
      const { blocks } = blockSourceForCopy(source, document.nodes, ids);
      if (!blocks.length) return;
      const relationIds = relation ? Object.fromEntries(renderIndex.entries.map((entry) => [entry.id, relation.transientToBlockId[entry.node.parserId ?? entry.id]]).filter((entry): entry is [string, string] => !!entry[1])) : {};
      const payload = createBlockClipboardPayload(projectId, filePath, source, blocks, relation ? { snapshot: relation.snapshot, transientToBlockId: relationIds } : undefined);
      await writeBlockClipboard(payload);
      if (cut) runBlockPlan(() => planDeleteBlocks(source, document.nodes, blocks.map((block) => block.id)), "delete", payload.assets.length > 0 || blocks.some((block) => countDescendants(block) > 0));
    } catch (error) { setOperationNotice(error instanceof Error ? error.message : String(error)); }
  };
  const duplicateBlocks = (ids: string[]) => {
    if (source === undefined || !document) return;
    runBlockPlan(() => {
      const { blocks, rawLatex } = blockSourceForCopy(source, document.nodes, ids);
      const last = blocks.at(-1);
      return last ? planPasteBlocks(source, document.nodes, last.id, "after", rawLatex, definitions) : undefined;
    }, "other");
  };
  const pasteBlocks = async (targetId: string, position: MovePosition) => {
    if (source === undefined || !document) return;
    try {
      const payload = await readBlockClipboard();
      if (payload && payload.sourceProjectId !== projectId && payload.assets.length) {
        setOperationNotice("This copied block uses project assets. Copy the assets into this project before pasting it.");
        return;
      }
      const rawLatex = payload?.rawLatex ?? await navigator.clipboard.readText();
      if (!rawLatex.trim()) { setOperationNotice("The clipboard has no LaTeX block to paste."); return; }
      runBlockPlan(() => planPasteBlocks(source, document.nodes, targetId, position, rawLatex, definitions), "other");
      if (payload?.relations.length) setOperationNotice("The source blocks were pasted. Review their relationships before recreating links to the new blocks.");
    } catch (error) { setOperationNotice(error instanceof Error ? error.message : String(error)); }
  };
  useEffect(() => {
    const canOperate = () => !!document && source !== undefined && !!filePath?.toLocaleLowerCase().endsWith(".tex")
      && selectedBlockIds().length > 0 && !editingId && !boundary && !operationPreview
      && window.getSelection()?.isCollapsed !== false;
    const selectedByState = () => selectedBlockIds().flatMap((id) => {
      const node = document ? nodeById(document.nodes, id) : undefined;
      return node?.kind === "block" ? [node] : [];
    });
    const registrations = [
      commands.register("block.copy", { when: canOperate, execute: () => copyBlocks(selectedBlockIds(), false) }),
      commands.register("block.cut", { when: canOperate, execute: () => copyBlocks(selectedBlockIds(), true) }),
      commands.register("block.paste", { when: canOperate, execute: () => { const target = selectedBlockIds().at(-1); if (target) return pasteBlocks(target, "after"); } }),
      commands.register("block.duplicate", { when: canOperate, execute: () => duplicateBlocks(selectedBlockIds()) }),
      commands.register("block.collapse", { when: () => canOperate() && selectedByState().some(canCollapseBlock), execute: () => toggleCollapse(selectedBlockIds(), true) }),
      commands.register("block.expand", { when: () => canOperate() && selectedByState().some(canCollapseBlock), execute: () => toggleCollapse(selectedBlockIds(), false) }),
      commands.register("block.disable", { when: () => canOperate() && selectedByState().some((node) => node.environmentId !== "texweave-disabled"), execute: () => disableBlocks(selectedByState().filter((node) => node.environmentId !== "texweave-disabled").map((node) => node.id)) }),
      commands.register("block.enable", { when: () => canOperate() && selectedByState().some((node) => node.environmentId === "texweave-disabled"), execute: () => enableBlocks(selectedByState().filter((node) => node.environmentId === "texweave-disabled").map((node) => node.id)) }),
      commands.register("block.delete", { when: canOperate, execute: () => deleteBlocks(selectedBlockIds()) }),
      commands.register("block.removeEnvironment", {
        when: () => {
          if (!canOperate() || selectedByState().length !== 1 || source === undefined) return false;
          const block = selectedByState()[0]!;
          return block.origin === "latex" && unwrapLatexEnvironment(nodeSource(block, source), block.environmentId) !== undefined;
        },
        execute: () => { const block = selectedByState()[0]; if (block) removeEnvironment(block.id); }
      })
    ];
    return () => registrations.forEach((dispose) => dispose());
  }, [selectedId, additionalSelectedIds, editingId, boundary, source, document, filePath, operationPreview, collapsedBlockIds]);
  // All hooks must run even while the initial file is loading or a non-TeX
  // file is active. Saved Visual layouts render both states during startup.
  if (!filePath || source === undefined) return <div className="preview-empty"><h2>{t("preview.noSourceTitle")}</h2><p>{t("preview.noSource")}</p></div>;
  if (!filePath.toLocaleLowerCase().endsWith(".tex")) return <div className="preview-empty"><h2>{t("preview.unsupportedFileTitle")}</h2><p>{t("preview.unsupportedFile")}</p></div>;
  const commitStructuralDraft = (draft: string, startOffset: number, endOffset: number, insertedSource: string, blockPrefixLength: number): boolean => {
    const createdBlock = structuralBlockDraft(draft, filePath, definitions);
    if (!createdBlock) return false;
    const nextSource = source.slice(0, startOffset) + insertedSource + source.slice(endOffset);
    pendingBoundaryRef.current = undefined;
    pendingStructuralEditRef.current = {
      startOffset: startOffset + blockPrefixLength + createdBlock.source.startOffset,
      environmentId: createdBlock.environmentId
    };
    onSourceChange(nextSource, [{ from: startOffset, to: endOffset, insertedText: insertedSource }]);
    setBoundary(undefined);
    return true;
  };
  const tryApplyBoundaryStructuralDraft = (insertion: BoundaryInsertion, value: string): boolean => {
    const content = value.replace(/^\n+|\n+$/g, "");
    const prefix = insertion.side === "before" ? "" : content ? "\n\n" : "\n";
    const insertedSource = insertion.side === "before" ? `${content}${content ? "\n" : ""}\n` : `${prefix}${content}`;
    return commitStructuralDraft(content, insertion.position, insertion.position, insertedSource, prefix.length);
  };
  const onBoundaryDraftChange = (insertion: BoundaryInsertion, value: string) => { tryApplyBoundaryStructuralDraft(insertion, value); };
  const applyEdit = (node: PreviewNode, replacement: string) => {
    if (node.kind === "content" && node.origin === "virtual" && node.raw.length === 0
      && commitStructuralDraft(replacement, node.source.startOffset, node.source.endOffset, replacement, 0)) {
      setEditingId(undefined);
      setEditingInitialHeight(undefined);
      setEditingCursorOffset(undefined);
      return;
    }
    const nextSource = source.slice(0, node.source.startOffset) + replacement + source.slice(node.source.endOffset);
    if (node.kind === "block") {
      const converted = parsePreview(replacement, filePath, definitions).nodes.find((candidate): candidate is StructuralBlock => candidate.kind === "block" && candidate.source.startOffset === 0);
      if (converted && converted.environmentId !== node.environmentId) {
        const nextId = `block:${filePath}:${node.source.startOffset}:${node.source.startOffset + converted.source.endOffset}:${converted.environmentId}`;
        setSelectedId(nextId);
        setAdditionalSelectedIds([]);
      }
    }
    onSourceChange(nextSource, [{ from: node.source.startOffset, to: node.source.endOffset, insertedText: replacement }]);
    setEditingId(undefined);
    setEditingInitialHeight(undefined);
    setEditingCursorOffset(undefined);
  };
  const applyBoundary = (insertion: BoundaryInsertion, value: string) => {
    if (tryApplyBoundaryStructuralDraft(insertion, value)) return;
    const content = value.replace(/^\n+|\n+$/g, "");
    const replacement = insertion.side === "before" ? `${content}${content ? "\n" : ""}\n` : `\n${content ? `\n${content}` : ""}`;
    onSourceChange(source.slice(0, insertion.position) + replacement + source.slice(insertion.position), [{ from: insertion.position, to: insertion.position, insertedText: replacement }]);
    setBoundary(undefined);
  };
  actionsRef.current = {
    select: (id) => {
      setSelectedId(id); setAdditionalSelectedIds([]); setEditingId(undefined); setEditingCursorOffset(undefined); setEditingInitialHeight(undefined); setBoundary(undefined);
      setBlockToolbarPosition(undefined);
      const node = document ? nodeById(document.nodes, id) : undefined;
      if (node?.kind === "block" && ["figure", "figure-star", "custom:figure*", "inline-image"].includes(node.environmentId)) onFigureSelect?.({ fileId: filePath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source) }); else onFigureSelect?.(undefined);
      if (node?.kind === "block" && ["table", "table-star", "tabular", "tabular-star", "tabularx", "longtable"].includes(node.environmentId)) onTableSelect?.({ fileId: filePath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source), kind: "table" }); else onTableSelect?.(undefined);
    },
    edit: (id, offset) => { revealCollapsedTargets([id]); setEditingInitialHeight(measurePreviewEditHeight(previewRootRef.current, id)); setEditingId(id); setEditingCursorOffset(offset); setSelectedId(undefined); setAdditionalSelectedIds([]); setBlockToolbarPosition(undefined); setBoundary(undefined); onFigureSelect?.(undefined); onTableSelect?.(undefined); },
    cancelEdit: () => { setEditingId(undefined); setEditingCursorOffset(undefined); setEditingInitialHeight(undefined); setBoundary(undefined); },
    setSelectedBlockIds: setBlockSelection,
    selectBlockWithModifiers, toggleCollapse, moveBlocks, copyBlocks: (ids, cut) => { void copyBlocks(ids, cut); }, duplicateBlocks, pasteBlocks: (id, position) => { void pasteBlocks(id, position); }, disableBlocks, enableBlocks,
    applyEdit, applyBoundary, onBoundaryDraftChange, requestBoundary, deleteBlocks, removeEnvironment, onFigureSelect, onFigureSlotSelect, onTableSelect, onTableChange, onSpellContextMenu, onDetectedLanguage, onForwardSync,
    relationFocus: (id) => relation?.onFocus(id),
    relationToggle: (id, x, y) => relation?.onToggle(id, x, y)
  };
  const services: PreviewEditorServices = {
    nodeRanges, api, projectId, tree, getOpenDocuments, currentPath: filePath, graphicPaths: stableGraphicPaths, definitions, directives: previewDirectives, mathContext, searchQuery: inlineSearch,
    activeSearchResult: activeSearchResult?.fileId === filePath ? activeSearchResult : undefined,
    filterQuery, filterStates: filterEvaluation?.states ?? new Map(), visibilitySignatures,
    relation: relation ? { ...relation, transientToBlockId: mappedRelationIds, onFocus: actions.relationFocus, onToggle: actions.relationToggle } : undefined,
    onFieldEditing, selectedBlockIds: selectedBlockIds(), collapsedBlockIds, virtual, virtualRoot: previewRootRef, forcedIds, ...(pendingScroll?.offset === undefined ? {} : { forceOffset: pendingScroll.offset }), initialHeight: editingId ? editingInitialHeight : undefined, setSelectedBlockIds: actions.setSelectedBlockIds, selectBlockWithModifiers: actions.selectBlockWithModifiers, toggleCollapse: actions.toggleCollapse, moveBlocks: actions.moveBlocks, copyBlocks: actions.copyBlocks, duplicateBlocks: actions.duplicateBlocks, pasteBlocks: actions.pasteBlocks, disableBlocks: actions.disableBlocks, enableBlocks: actions.enableBlocks, deleteBlocks: actions.deleteBlocks, removeEnvironment: actions.removeEnvironment, onBoundaryDraftChange: actions.onBoundaryDraftChange,
    onFigureSelect: actions.onFigureSelect, onFigureSlotSelect: actions.onFigureSlotSelect, onTableSelect: actions.onTableSelect, onTableChange: actions.onTableChange,
    onSpellContextMenu: actions.onSpellContextMenu, onDetectedLanguage: actions.onDetectedLanguage, onForwardSync: actions.onForwardSync
  };
  const startBlockMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || editingId || window.getSelection()?.isCollapsed === false) return;
    const target = event.target;
    const article = event.currentTarget.querySelector("article");
    if (target !== event.currentTarget && target !== article) return;
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional for synthetic input. */ }
    marqueeGesture.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, currentX: event.clientX, currentY: event.clientY, moved: false };
    setMarqueeRect({ left: event.clientX, top: event.clientY, width: 0, height: 0 });
  };
  const moveBlockMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    hoveredJumpElementRef.current = event.target instanceof Element ? event.target : undefined;
    updateJumpCursor(hoveredJumpElementRef.current, referenceModifierPressed(event, referenceLinkModifier));
    const gesture = marqueeGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.currentX = event.clientX;
    gesture.currentY = event.clientY;
    gesture.moved ||= Math.abs(gesture.currentX - gesture.startX) > 4 || Math.abs(gesture.currentY - gesture.startY) > 4;
    setMarqueeRect({ left: Math.min(gesture.startX, gesture.currentX), top: Math.min(gesture.startY, gesture.currentY), width: Math.abs(gesture.currentX - gesture.startX), height: Math.abs(gesture.currentY - gesture.startY) });
  };
  const finishBlockMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = marqueeGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    marqueeGesture.current = undefined;
    setMarqueeRect(undefined);
    if (!gesture.moved) return;
    event.preventDefault();
    event.stopPropagation();
    const box = { left: Math.min(gesture.startX, gesture.currentX), top: Math.min(gesture.startY, gesture.currentY), right: Math.max(gesture.startX, gesture.currentX), bottom: Math.max(gesture.startY, gesture.currentY) };
    const ids = Array.from(previewRootRef.current?.querySelectorAll<HTMLElement>(".preview-block[data-preview-node-id]") ?? []).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left >= box.left && rect.top >= box.top && rect.right <= box.right && rect.bottom <= box.bottom;
    }).map((element) => element.dataset.previewNodeId).filter((id): id is string => !!id);
    setBlockSelection(ids);
    marqueeJustCompleted.current = true;
    window.setTimeout(() => { marqueeJustCompleted.current = false; }, 0);
  };
  const cancelBlockMarquee = () => { marqueeGesture.current = undefined; setMarqueeRect(undefined); };
  const selectedCount = (selectedId ? 1 : 0) + additionalSelectedIds.length;
  const selectedBlocks = selectedBlockIds().map((id) => document ? nodeById(document.nodes, id) : undefined).filter((node): node is StructuralBlock => node?.kind === "block");
  const selectedEnabledIds = selectedBlocks.filter((node) => node.environmentId !== "texweave-disabled").map((node) => node.id);
  const selectedDisabledIds = selectedBlocks.filter((node) => node.environmentId === "texweave-disabled").map((node) => node.id);
  const onPreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    if (marqueeJustCompleted.current) { event.preventDefault(); event.stopPropagation(); marqueeJustCompleted.current = false; return; }
    const clickTarget = event.target instanceof Element ? event.target : undefined;
    const jump = document && source !== undefined ? previewJumpTarget(clickTarget, source, document.nodes) : undefined;
    if (jump && document && referenceModifierPressed(event, referenceLinkModifier)) {
      event.preventDefault();
      event.stopPropagation();
      const fromOffset = Number(jump.element.dataset.referenceSourceStart);
      const sourceEnd = Number(jump.element.dataset.referenceSourceEnd);
      if (filePath && Number.isFinite(fromOffset) && Number.isFinite(sourceEnd) && sourceEnd > fromOffset) {
        onJumpFromPosition?.({ fileId: filePath, offset: fromOffset, targetOffset: jump.offset, linkText: source.slice(fromOffset, sourceEnd), targetLabel: jump.element.dataset.reference ?? "" });
      }
      revealCollapsedTargets([jump.node.id]);
      setPendingScroll({ fileId: filePath, id: jump.node.id, offset: jump.offset, align: "start", highlight: "reference-target" });
      if (filePath) onClickSourcePosition?.({ fileId: filePath, offset: jump.offset });
      setForcedTargetId(jump.node.id);
      return;
    }
    if (clickTarget?.closest(".preview-local-editor, .preview-block-header-actions, .preview-block-footer-actions, .preview-selection-toolbar, button, input, textarea, select, [contenteditable='true']")) return;
    const root = previewRootRef.current;
    const sourceRegion = root && sourceElement(event.target as Node, root);
    const sourceOffset = sourceRegion ? sourceOffsetAtPoint(sourceRegion, event) : undefined;
    if (filePath && sourceOffset !== undefined) onClickSourcePosition?.({ fileId: filePath, offset: sourceOffset });
    setSelectedId(undefined);
    setAdditionalSelectedIds([]);
    setBlockToolbarPosition(undefined);
    setBoundary(undefined);
    onFigureSelect?.(undefined);
    onTableSelect?.(undefined);
  };
  const emitSelection = () => {
    const selection = previewRootRef.current ? previewDocumentSelection(previewRootRef.current, source, filePath) : undefined;
    onSelectionChange?.(selection);
    return selection;
  };
  const article = <article>{document?.title && <DocumentTitlePreview {...document.title} mathContext={mathContext} searchQuery={inlineSearch}/>}<PreviewNodeList nodes={document?.nodes ?? []} source={sourceReader} definitions={definitions} selectedId={selectedId} editingId={editingId} cursorOffset={editingCursorOffset} boundary={boundary} select={actions.select} edit={actions.edit} applyEdit={actions.applyEdit} applyBoundary={actions.applyBoundary} cancelEdit={actions.cancelEdit} requestBoundary={actions.requestBoundary} services={services}/></article>;
  return <div ref={previewRootRef} className={`structured-preview${marqueeRect ? " marquee-selecting" : ""}`} onPointerDown={startBlockMarquee} onPointerMove={moveBlockMarquee} onPointerLeave={() => { hoveredJumpElementRef.current = undefined; updateJumpCursor(undefined, false); }} onPointerUp={finishBlockMarquee} onPointerCancel={cancelBlockMarquee} onClickCapture={onPreviewClick} onMouseUp={() => emitSelection()} onKeyUp={() => emitSelection()} onContextMenu={(event) => {
    if (event.target instanceof Element && event.target.closest("[data-preview-field]")) return;
    if (event.target instanceof Element && event.target.closest(".preview-block-delete")) return;
    const selectedIds = new Set(selectedBlockIds());
    let block = event.target instanceof Element ? event.target.closest(".preview-block[data-preview-node-id], .preview-block-disabled[data-preview-node-id]") : null;
    while (block) {
      const blockId = block.getAttribute("data-preview-node-id");
      if (blockId && selectedIds.has(blockId)) {
        event.preventDefault();
        event.stopPropagation();
        setBlockToolbarPosition({ x: event.clientX + 6, y: event.clientY + 6 });
        return;
      }
      block = block.parentElement?.closest(".preview-block[data-preview-node-id], .preview-block-disabled[data-preview-node-id]") ?? null;
    }
    setBlockToolbarPosition(undefined);
    const selection = emitSelection();
    if (!selection || !onSelectionContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectionContextMenu(selection, event.clientX, event.clientY);
  }}>
    {blockToolbarPosition && selectedCount > 0 && selectedBlocks.length > 0 && createPortal(<div ref={blockToolbarRef} className="preview-selection-toolbar-anchor" style={{ left: blockToolbarPosition.x, top: blockToolbarPosition.y }}><BlockActionToolbar count={selectedBlocks.length} canCollapse={selectedBlocks.some(canCollapseBlock)} hasExpanded={selectedBlocks.some((node) => canCollapseBlock(node) && !collapsedBlockIds.has(node.id))} enabledCount={selectedEnabledIds.length} disabledCount={selectedDisabledIds.length} onMove={quickMove} onCollapse={(collapsed, scope) => toggleCollapse(selectedBlockIds(), collapsed, scope)} onCopy={() => void copyBlocks(selectedBlockIds(), false)} onCut={() => void copyBlocks(selectedBlockIds(), true)} onDuplicate={() => duplicateBlocks(selectedBlockIds())} onPaste={() => { const target = selectedBlocks.at(-1); if (target) void pasteBlocks(target.id, "after"); }} onDisable={() => disableBlocks(selectedEnabledIds)} onEnable={() => enableBlocks(selectedDisabledIds)} onDelete={() => deleteBlocks(selectedBlockIds())}/></div>, window.document.body)}
    {marqueeRect && <div className="preview-marquee" style={{ left: marqueeRect.left, top: marqueeRect.top, width: marqueeRect.width, height: marqueeRect.height}}/>}
    {import.meta.env.DEV ? <Profiler id="preview" onRender={(_id, _phase, duration) => { previewTiming.current.reactMs = duration; }}>{article}</Profiler> : article}
    {showPreviewMetrics && <PreviewPerformancePanel virtual={virtual} timing={previewTiming} total={renderIndex.entries.length}/>}
    {filterQuery.enabled && filterEvaluation && filterEvaluation.matches.size === 0 && <aside className="preview-filter-empty">{t("filter.noMatches")}</aside>}
    {document?.diagnostics.length ? <aside className="preview-diagnostics"><strong>{t("preview.recovered")}</strong>{document.diagnostics.map((message, index) => <p key={index}>{message}</p>)}</aside> : null}
    {operationNotice && <div className="preview-operation-notice" role="alert"><span>{operationNotice}</span><button type="button" aria-label={t("common.close")} onClick={() => setOperationNotice(undefined)}>ﾃ・</button></div>}
    {operationPreview && <div className="preview-operation-backdrop" onClick={(event) => { if (event.target === event.currentTarget) setOperationPreview(undefined); }}><section className="preview-operation-dialog" role="dialog" aria-modal="true" aria-label={t("blockOperation.previewTitle")}><h2>{t("blockOperation.previewTitle")}</h2><p>{t(`blockOperation.preview.${operationPreview.action}`, { count: operationPreview.transaction.affectedNodeCount })}</p><small>{operationPreview.transaction.description}</small><footer><button onClick={() => setOperationPreview(undefined)}>{t("preview.cancel")}</button><button className="primary" onClick={() => commitBlockTransaction(operationPreview.before, operationPreview.transaction)}>{t("blockOperation.confirm")}</button></footer></section></div>}
  </div>;
}
