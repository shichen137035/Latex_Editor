import { Fragment, memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import type { BlockGraphSnapshot, BlockId, ProjectTreeNode, RelationDirection } from "@latex-editor/contracts";
import { t, type MessageKey } from "../i18n/index.js";
import { definitionForId } from "./environments.js";
import { parsePreview } from "./parser.js";
import type { ContentRegion, EnvironmentDefinition, PreviewNode, SourceSpan, StructuralBlock } from "./types.js";
import "./preview.css";
import type { SpellContextRequest } from "../spellcheck/SpellCheckController.js";
import { useSettings } from "../settings/service.js";
import { MathRenderer } from "./MathRenderer.js";
import { bindings, commands, eventBinding } from "../settings/commands.js";
import { EMPTY_MATH_CONTEXT, type MathContext } from "../math/types.js";
import { searchPattern } from "../search/SearchEngine.js";
import type { SearchQuery, SearchResult } from "../search/types.js";
import { FilterEngine } from "../filter/FilterEngine.js";
import { defaultFilterQuery, type FilterQuery, type FilterState } from "../filter/types.js";
import type { DocumentSelection } from "../custom-blocks/selection.js";
import { candidateRelationState, type UnmatchedBehavior } from "../relations/model.js";
import { convertBlockEnvironmentSource, definitionConversionGroup, environmentDefinitionsCompatible, environmentDisplayName, EnvironmentPickerPanel, environmentConversionGroup } from "./EnvironmentPicker.js";
import { unwrapLatexEnvironment } from "./sourceOperations.js";
import { FigurePreview } from "../figure/FigurePreview.js";
import type { FigureSelection } from "../figure/FigureInspector.js";
import { TablePreview } from "../table/TablePreview.js";
import type { TableSelection } from "../table/model.js";
import { tokenizeInlineSource, type InlineSourceToken } from "./inlineSource.js";
import { sourceOffsetAtPoint } from "./sourceMapping.js";
import { upsertBlockLabel } from "./labels.js";
import { PreviewLocalEditor } from "./PreviewLocalEditor.js";
import { useUnsavedChanges } from "../lifecycle/unsavedChanges.js";

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
type PreviewEditorServices = { nodeRanges: ReadonlyMap<string, SourceSpan>; api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; currentPath: string; documentSource: string; definitions: EnvironmentDefinition[]; mathContext: MathContext; searchQuery: SearchQuery; activeSearchResult?: SearchResult | undefined; filterQuery: FilterQuery; filterStates: Map<string, FilterState>; relation?: PreviewRelationUi | undefined; selectedBlockIds: string[]; setSelectedBlockIds(ids: string[]): void; deleteBlocks(ids: string[]): void; removeEnvironment(id: string): void; onBoundaryDraftChange(insertion: BoundaryInsertion, value: string): void; onFigureSelect: ((selection?: FigureSelection) => void) | undefined; onFigureSlotSelect: ((selection: FigureSelection) => void) | undefined; onTableSelect: ((selection?: TableSelection) => void) | undefined; onTableChange: ((selection: TableSelection, source: string) => void) | undefined; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void; onForwardSync(path: string, line: number, column?: number): void };

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
interface PreviewActions extends Pick<PreviewEditorServices, "setSelectedBlockIds" | "deleteBlocks" | "removeEnvironment" | "onFigureSelect" | "onFigureSlotSelect" | "onTableSelect" | "onTableChange" | "onSpellContextMenu" | "onDetectedLanguage" | "onForwardSync"> {
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

function sourceMapped(node: ReactNode, start?: number, end?: number, atomic = false): ReactNode {
  return start === undefined || end === undefined ? node : <span data-preview-source-start={start} data-preview-source-end={end} data-preview-source-mode={atomic ? "atomic" : "text"}>{node}</span>;
}

async function writePreviewClipboard(value: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Could not copy selected LaTeX blocks");
  }
}

function inlineLatex(value: string | undefined, mathContext: MathContext, searchQuery: SearchQuery = defaultInlineSearch, active = false, sourceStartOffset?: number): ReactNode[] {
  if (!value) return [];
  const map = (node: ReactNode, token: InlineSourceToken) => sourceMapped(node, sourceStartOffset === undefined ? undefined : token.contentStart, sourceStartOffset === undefined ? undefined : token.contentEnd, token.atomic);
  const render = (tokens: InlineSourceToken[]): ReactNode[] => tokens.map((token) => {
    let content: ReactNode;
    if (token.kind === "text") content = map(highlightedText(token.value, searchQuery, active, token.start), token);
    else if (token.kind === "math") content = map(<MathRenderer expression={token.value} display={token.display ?? false} context={mathContext}/>, token);
    else if (token.kind === "format") {
      const children = render(token.children ?? []);
      content = token.command === "textbf" ? <strong>{children}</strong> : token.command === "texttt" ? <code>{children}</code> : token.command === "textit" || token.command === "emph" ? <em>{children}</em> : children;
    } else if (token.kind === "citation") content = map(<span className="preview-citation" title={"\\" + token.command}>[{token.value}]</span>, token);
    else if (token.kind === "reference") content = map(<button type="button" className="preview-reference" data-reference={token.value} title={"\\" + token.command}>[{token.value}]</button>, token);
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
      ...(match[1] ? { label: match[1], labelStart: bodyStart + (match.index ?? 0) + match[0].indexOf("[") + 1 } : {})
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

function editableBodyStart(node: StructuralBlock, source: string): number {
  const raw = source.slice(node.body.startOffset, node.body.endOffset);
  const prefix = /^(?:\s|%[^\r\n]*(?:\r?\n|$)|\\label\s*\{[^}]*\})*/.exec(raw)?.[0].length ?? 0;
  return Math.min(node.body.endOffset, node.body.startOffset + prefix);
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

function BlockEnvironmentSelector({ node, source, definition, definitions, disabled, onChange }: { node: StructuralBlock; source: string; definition: EnvironmentDefinition | undefined; definitions: EnvironmentDefinition[]; disabled: boolean; onChange(value: string): void }) {
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

function SpecializedContent({ node, source, services }: { node: StructuralBlock; source: string; services: PreviewEditorServices }) {
  const definitionId = node.environmentId;
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
  if (definitionId === "figure" || definitionId === "figure-star" || definitionId === "custom:figure*" || definitionId === "inline-image") return <FigurePreview source={nodeSource(node, source)} documentSource={services.documentSource} api={services.api} projectId={services.projectId} texPath={services.currentPath} onChooseSlot={(imageIndex) => services.onFigureSlotSelect?.({ fileId: services.currentPath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source), imageIndex })}/>;
  if (["table", "table-star", "tabular", "tabular-star", "tabularx", "longtable"].includes(definitionId)) {
    const selection = { fileId: services.currentPath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source), kind: "table" as const };
    return <TablePreview source={selection.source} renderCell={(content) => inlineLatex(content, services.mathContext, services.searchQuery, false)} onSelect={(detail) => services.onTableSelect?.({ ...selection, ...detail })} onChange={(replacement) => services.onTableChange?.(selection, replacement)}/>;
  }
  return null;
}

function ListContent({ node, source, mathContext, searchQuery, activeSearch, renderChild, onEdit }: { node: StructuralBlock; source: string; mathContext: MathContext; searchQuery: SearchQuery; activeSearch: boolean; renderChild(child: PreviewNode): ReactNode; onEdit(offset?: number): void }) {
  const items = previewListItems(node, source);
  const Tag = node.environmentId === "enumerate" ? "ol" : "ul";
  const renderItem = (item: PreviewListItem, itemIndex: number) => {
    const children = node.children.filter((child) => child.source.startOffset < item.endOffset && child.source.endOffset > item.startOffset);
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
    return <li key={`${item.startOffset}:${itemIndex}`} data-source-start-offset={item.startOffset} data-source-end-offset={item.endOffset} onClick={(event) => { if ((event.target as Element).closest("button, .preview-local-editor") || window.getSelection()?.isCollapsed === false) return; event.stopPropagation(); onEdit(sourceOffsetAtPoint(event.currentTarget, event)); }}>{item.label && <strong>{inlineLatex(item.label, mathContext, searchQuery, activeSearch, item.labelStart)} </strong>}{content}</li>;
  };
  return <Tag className="preview-list">{items.map(renderItem)}</Tag>;
}

const LocalEditor = PreviewLocalEditor;

function ContentRenderer({ node, source, editing, cursorOffset, boundary, beginEdit, applyEdit, onDraftChange, applyBoundary, cancelEdit, requestBoundary, services }: { node: ContentRegion; source: string; editing: boolean; cursorOffset?: number | undefined; boundary?: BoundaryInsertion | undefined; beginEdit(offset?: number): void; applyEdit(value: string): void; onDraftChange?: ((value: string) => void) | undefined; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; services: PreviewEditorServices }) {
  const insertion = boundary?.targetId === node.id ? boundary : undefined;
  const filterState = services.filterStates.get(node.id) ?? "match";
  if (services.filterQuery.enabled && filterState === "unmatched" && !editing && !insertion) {
    if (services.filterQuery.viewMode === "remove") return null;
    if (services.filterQuery.viewMode === "collapse") return <div className="preview-filter-collapsed">⋯ 1 {t("filter.blockCollapsed")}</div>;
  }
  const activeSearch = services.activeSearchResult ? services.activeSearchResult.matchStart >= node.source.startOffset && services.activeSearchResult.matchEnd <= node.source.endOffset : false;
  const effectiveSearch = services.filterQuery.enabled && filterState !== "match" ? defaultInlineSearch : services.searchQuery;
  const filterClass = services.filterQuery.enabled ? `filter-${filterState} filter-view-${services.filterQuery.viewMode}` : "";
  const virtualClass = node.origin === "virtual" && node.raw.length === 0 ? " preview-content-virtual" : "";
  return <Fragment>
    {insertion?.side === "before" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onDraftChange={(value) => services.onBoundaryDraftChange(insertion, value)} onCancel={cancelEdit} {...services}/>}
    {editing ? <LocalEditor value={nodeSource(node, source)} sourceStartLine={node.source.startLine} initialCursorOffset={cursorOffset === undefined ? undefined : cursorOffset - node.source.startOffset} onApply={applyEdit} onDraftChange={onDraftChange} onCancel={cancelEdit} onInsertBefore={(draft) => requestBoundary(node, "before", draft)} onInsertAfter={(draft) => requestBoundary(node, "after", draft)} {...services}/> : <div className={`preview-content-region${virtualClass} ${filterClass} ${activeSearch ? "search-result-active" : ""}`} data-node-id={node.id} data-source-line={node.source.startLine} data-source-start-offset={node.source.startOffset} data-source-end-offset={node.source.endOffset} onClick={(event) => { event.stopPropagation(); if (window.getSelection()?.isCollapsed !== false) beginEdit(sourceOffsetAtPoint(event.currentTarget, event)); }}>{inlineLatex(node.raw, services.mathContext, effectiveSearch, activeSearch, node.source.startOffset)}</div>}
    {insertion?.side === "after" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onDraftChange={(value) => services.onBoundaryDraftChange(insertion, value)} onCancel={cancelEdit} {...services}/>}
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

function hasEmptyBody(node: StructuralBlock, source: string): boolean {
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

function BlockRenderer({ node, source, definitions, selectedId, editingId, cursorOffset, boundary, select, edit, applyEdit, applyBoundary, cancelEdit, requestBoundary, services }: { node: StructuralBlock; source: string; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; cursorOffset?: number | undefined; boundary?: BoundaryInsertion | undefined; select(id: string): void; edit(id: string, cursorOffset?: number): void; applyEdit(node: PreviewNode, value: string): void; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; onDraftChange?: ((value: string) => void) | undefined; services: PreviewEditorServices }) {
  const definition = definitionForId(definitions, node.environmentId);
  const family = definition?.family ?? (node.origin === "virtual" ? "virtual" : "generic");
  const editing = editingId === node.id;
  const selected = services.selectedBlockIds.includes(node.id);
  const singleSelected = services.selectedBlockIds.length === 1 && selected;
  const filterState = services.filterStates.get(node.id) ?? "match";
  const activeSearch = services.activeSearchResult ? services.activeSearchResult.matchStart >= node.source.startOffset && services.activeSearchResult.matchEnd <= node.source.endOffset : false;
  const effectiveSearch = services.filterQuery.enabled && filterState !== "match" ? defaultInlineSearch : services.searchQuery;
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
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [deleteMenuOpen]);
  const blockSource = nodeSource(node, source);
  const canRemoveEnvironment = node.origin === "latex" && unwrapLatexEnvironment(blockSource, node.environmentId) !== undefined;
  const preferences = useSettings();
  const specialized = SpecializedContent({ node, source, services });
  const specializedContent = emptyBlock && contentBlock
    ? <div className="preview-empty-block-placeholder" onClick={(event) => { event.stopPropagation(); edit(node.id); }}>{t("preview.emptyBlockHint")}</div>
    : emptyStructuralParagraph
      ? <PreviewNodeRenderer node={emptyStructuralParagraph} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} cursorOffset={cursorOffset} boundary={boundary} select={select} edit={edit} applyEdit={applyEdit} onDraftChange={(draft) => { if (structuralBlockDraft(draft, services.currentPath, definitions)) applyEdit(emptyStructuralParagraph, draft); }} applyBoundary={applyBoundary} cancelEdit={cancelEdit} requestBoundary={requestBoundary} services={services}/>
      : listEnvironment
        ? <ListContent node={node} source={source} mathContext={services.mathContext} searchQuery={effectiveSearch} activeSearch={activeSearch} onEdit={(offset) => edit(node.id, offset)} renderChild={(child) => <PreviewNodeRenderer key={child.id} node={child} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} cursorOffset={cursorOffset} boundary={boundary} select={select} edit={edit} applyEdit={applyEdit} applyBoundary={applyBoundary} cancelEdit={cancelEdit} requestBoundary={requestBoundary} services={services}/>} />
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
  if (services.filterQuery.enabled && filterState === "unmatched" && !editing && !insertion && !selected) {
    if (services.filterQuery.viewMode === "remove") return null;
    if (services.filterQuery.viewMode === "collapse") return <div className="preview-filter-collapsed">⋯ 1 {t("filter.blockCollapsed")}</div>;
  }
  const filterClass = services.filterQuery.enabled ? `filter-${filterState} filter-view-${services.filterQuery.viewMode}` : "";
  const applyLabel = (label: string) => {
    const blockSource = nodeSource(node, source);
    const ownedRange = node.labelSource ? { startOffset: node.labelSource.startOffset - node.source.startOffset, endOffset: node.labelSource.endOffset - node.source.startOffset } : null;
    const replacement = upsertBlockLabel(blockSource, label, ownedRange);
    if (replacement !== blockSource) applyEdit(node, replacement);
  };
  return <Fragment>
    {insertion?.side === "before" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onDraftChange={(value) => services.onBoundaryDraftChange(insertion, value)} onCancel={cancelEdit} {...services}/>}
    <section className={`preview-block env-${family} ${filterClass} ${activeSearch ? "search-result-active" : ""} ${selected ? "selected" : ""} ${selected && services.selectedBlockIds.length > 1 ? "multi-selected" : ""} ${editing ? "editing" : ""} ${services.relation?.active && !relationMatches ? "relation-unmatched" : ""} ${semanticId === services.relation?.focusId ? "relation-focus" : ""}`} data-preview-node-id={node.id} data-environment={node.environmentId} data-semantic-block-id={semanticId} data-source-line={node.source.startLine} data-source-start-offset={node.source.startOffset} data-source-end-offset={node.source.endOffset} onDoubleClickCapture={(event) => { const target = event.target as Element; if (target.closest(".preview-local-editor, .structured-table") || target.closest(".preview-block") !== event.currentTarget) return; event.preventDefault(); event.stopPropagation(); const figureBlock = node.environmentId === "figure" || node.environmentId === "figure-star" || node.environmentId === "custom:figure*" || node.environmentId === "inline-image"; if (figureBlock) { if (preferences.get("images").editor.defaultMode === "source") edit(node.id); else { select(node.id); services.onFigureSelect?.({ fileId: services.currentPath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source) }); } return; } services.onForwardSync(services.currentPath, node.source.startLine, 1); }} style={{ "--block-accent": cssValue(definition?.style.accentToken, "--env-generic-accent"), "--block-fill": cssValue(definition?.style.fillToken, "--env-generic-fill"), "--block-border": cssValue(definition?.style.borderToken, "--env-border-default"), "--block-selected-border": cssValue(definition?.style.selectedBorderToken, "--env-border-selected"), "--block-label-bg": cssValue(definition?.style.labelBackgroundToken, "--env-generic-label-bg"), "--block-label-text": cssValue(definition?.style.labelTextToken, "--env-generic-label-text") } as CSSProperties}>
    {(definition?.behavior.showHeader ?? true) && <div className="preview-block-header"><div className="preview-block-header-main" onClick={(event) => { event.stopPropagation(); select(node.id); }}><BlockEnvironmentSelector node={node} source={source} definition={definition} definitions={definitions} disabled={editing} onChange={(value) => applyEdit(node, value)}/>{node.title && <strong>{node.title}</strong>}{(definition?.behavior.showLabel ?? true) && <LabelEditor label={node.latexLabel ?? ""} auto={Boolean(node.autoLabel)} onCommit={applyLabel}/>}</div>{(singleSelected || (services.relation?.active && semanticId && services.selectedBlockIds.length === 1)) && <div className="preview-block-header-actions">{services.relation?.active && semanticId && <><button className={semanticId === services.relation.focusId ? "relation-control active" : "relation-control"} title={t("relation.setFocus")} onClick={(event) => { event.stopPropagation(); services.relation?.onFocus(semanticId); }}>◎</button><button className="relation-control" disabled={!!relationState?.disabledReason} title={relationState?.disabledReason ? t(`relation.invalid.${relationState.disabledReason}`) : relationState?.existing ? t("relation.remove") : t("relation.add")} onClick={(event) => { event.stopPropagation(); services.relation?.onToggle(semanticId, event.clientX, event.clientY); }}>{relationState?.existing ? relationState.existingDirection === "prerequisite" ? "← −" : "→ −" : "+"}</button></>}{singleSelected && <><button title={t("preview.insertBefore")} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); requestBoundary(node, "before"); }} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) requestBoundary(node, "before"); }}>↥＋</button><button title={t("preview.insertAfter")} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); requestBoundary(node, "after"); }} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) requestBoundary(node, "after"); }}>↧＋</button><button className="preview-block-delete" title={t("files.delete")} aria-label={t("files.delete")} onClick={(event) => { event.stopPropagation(); services.deleteBlocks([node.id]); }}>×</button></>}</div>}</div>}
    <div className="preview-block-body" onClickCapture={() => {
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
       {editing ? <LocalEditor value={nodeSource(node, source)} sourceStartLine={node.source.startLine} initialCursorOffset={cursorOffset === undefined ? undefined : cursorOffset - node.source.startOffset} mathDraft={isMathBlock(node)} onApply={(value) => applyEdit(node, value)} onCancel={cancelEdit} onInsertBefore={(draft) => requestBoundary(node, "before", draft)} onInsertAfter={(draft) => requestBoundary(node, "after", draft)} {...services}/> : specializedContent ?? <PreviewNodeList nodes={node.children} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} cursorOffset={cursorOffset} boundary={boundary} select={select} edit={contentBlock ? (_id, offset) => edit(node.id, offset) : edit} applyEdit={applyEdit} applyBoundary={applyBoundary} cancelEdit={cancelEdit} requestBoundary={requestBoundary} services={services}/> }
    </div>
    <div className="preview-block-footer">
      <button className="preview-block-footer-main" title={environmentLabel(definition, node.environmentId)} onClick={(event) => { event.stopPropagation(); select(node.id); }}><span/></button>
      {singleSelected && <div className="preview-block-footer-actions"><button title={t("preview.insertBefore")} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); requestBoundary(node, "before"); }} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) requestBoundary(node, "before"); }}>↥＋</button><button title={t("preview.insertAfter")} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); requestBoundary(node, "after"); }} onClick={(event) => { event.stopPropagation(); if (event.detail === 0) requestBoundary(node, "after"); }}>↧＋</button><button className="preview-block-delete" title={t("files.delete")} aria-label={t("files.delete")} onClick={(event) => { event.stopPropagation(); services.deleteBlocks([node.id]); }}>×</button></div>}
    </div>
    </section>
    {deleteMenuOpen && createPortal(<div ref={deleteMenuRef} className="preview-delete-menu" role="menu" style={{ left: deleteMenuPosition.x, top: deleteMenuPosition.y }}>
      {canRemoveEnvironment && <button role="menuitem" onClick={() => { setDeleteMenuOpen(false); services.removeEnvironment(node.id); }}>{t("preview.removeEnvironment")}</button>}
      <button role="menuitem" className="danger" onClick={() => { setDeleteMenuOpen(false); services.deleteBlocks([node.id]); }}>{t("preview.deleteEntireBlock")}</button>
    </div>, document.body)}
    {insertion?.side === "after" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onDraftChange={(value) => services.onBoundaryDraftChange(insertion, value)} onCancel={cancelEdit} {...services}/>}
  </Fragment>;
}

type PreviewNodeRendererProps = { node: PreviewNode; source: string; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; cursorOffset?: number | undefined; boundary?: BoundaryInsertion | undefined; select(id: string): void; edit(id: string, cursorOffset?: number): void; applyEdit(node: PreviewNode, value: string): void; onDraftChange?: ((value: string) => void) | undefined; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; services: PreviewEditorServices };

const PreviewNodeRenderer = memo(function RenderPreviewNode(props: PreviewNodeRendererProps) {
  if (props.node.kind === "block") return <BlockRenderer {...props} node={props.node} select={(id) => { props.services.setSelectedBlockIds([id]); props.select(id); }} edit={(id, offset) => { props.services.setSelectedBlockIds([]); props.edit(id, offset); }}/>;
  // Keep click offsets document-relative through every recursive renderer. Only
  // the LocalEditor boundary converts to the source range actually being edited.
  return <ContentRenderer node={props.node} source={props.source} editing={props.editingId === props.node.id} cursorOffset={props.cursorOffset} boundary={props.boundary} beginEdit={(offset) => { props.services.setSelectedBlockIds([]); props.edit(props.node.id, offset); }} applyEdit={(value) => props.applyEdit(props.node, value)} onDraftChange={props.onDraftChange} applyBoundary={props.applyBoundary} cancelEdit={props.cancelEdit} requestBoundary={props.requestBoundary} services={props.services}/>;
}, samePreviewNodeRender);

function samePreviewNodeRender(previous: PreviewNodeRendererProps, next: PreviewNodeRendererProps): boolean {
  if (previous.node !== next.node || previous.source !== next.source || previous.definitions !== next.definitions || previous.onDraftChange !== next.onDraftChange) return false;
  const a = previous.services, b = next.services;
  if (a.api !== b.api || a.projectId !== b.projectId || a.tree !== b.tree || a.currentPath !== b.currentPath || a.mathContext !== b.mathContext || a.searchQuery !== b.searchQuery || a.activeSearchResult !== b.activeSearchResult || a.filterQuery !== b.filterQuery || a.filterStates !== b.filterStates) return false;
  const ra = a.relation, rb = b.relation;
  if (ra?.active !== rb?.active || ra?.snapshot !== rb?.snapshot || ra?.transientToBlockId !== rb?.transientToBlockId || ra?.focusId !== rb?.focusId || ra?.direction !== rb?.direction || ra?.matchIds !== rb?.matchIds || ra?.contextIds !== rb?.contextIds || ra?.unmatchedBehavior !== rb?.unmatchedBehavior) return false;
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
    return `${selected.join(",")}:${selected.length ? props.services.selectedBlockIds.length : 0}|${editing}|${boundary}`;
  };
  return interaction(previous) === interaction(next);
}

function PreviewNodeList({ nodes, ...props }: { nodes: PreviewNode[] } & Omit<PreviewNodeRendererProps, "node">) {
  const rendered: ReactNode[] = [];
  for (let index = 0; index < nodes.length;) {
    const node = nodes[index];
    if (!node) break;
    const collapsible = props.services.filterQuery.enabled && props.services.filterQuery.viewMode === "collapse" && props.services.filterStates.get(node.id) === "unmatched" && !props.services.selectedBlockIds.includes(node.id) && props.editingId !== node.id && props.boundary?.targetId !== node.id;
    // Source offsets change on every edit (including added preamble packages).
    // Keep the render slot stable so an active table retains its draft and focus.
    if (!collapsible) { rendered.push(<PreviewNodeRenderer key={`${node.source.filePath}:${index}:${node.kind === "block" ? node.environmentId : node.kind}`} node={node} {...props}/>); index += 1; continue; }
    let end = index + 1;
    while (end < nodes.length) {
      const next = nodes[end];
      if (!next || props.services.filterStates.get(next.id) !== "unmatched" || props.services.selectedBlockIds.includes(next.id) || props.editingId === next.id || props.boundary?.targetId === next.id) break;
      end += 1;
    }
    rendered.push(<div className="preview-filter-collapsed" key={`collapsed:${node.id}`}>⋯ {end - index} {t("filter.blocksCollapsed")}</div>);
    index = end;
  }
  return rendered;
}

export function PreviewPane({ filePath, source, definitions, mathContext = EMPTY_MATH_CONTEXT, searchQuery = defaultInlineSearch, filterQuery = defaultFilterQuery, activeSearchResult, highlightRange, relation, onSourceChange, onSelectionChange, onSelectionContextMenu, onViewportAnchorChange, onClickSourcePosition, onInsertionAnchorChange, onFigureSelect, onFigureSlotSelect, onTableSelect, onTableChange, api, projectId, tree, onSpellContextMenu, onDetectedLanguage, onForwardSync }: { filePath?: string | undefined; source?: string | undefined; definitions: EnvironmentDefinition[]; mathContext?: MathContext; searchQuery?: SearchQuery; filterQuery?: FilterQuery; activeSearchResult?: SearchResult | undefined; highlightRange?: { fileId: string; start: number; end: number; nonce: number } | undefined; relation?: PreviewRelationUi | undefined; onSourceChange(next: string): void; onSelectionChange?(selection?: DocumentSelection): void; onSelectionContextMenu?(selection: DocumentSelection, x: number, y: number): void; onViewportAnchorChange?(anchor: { fileId: string; offset: number }): void; onClickSourcePosition?(anchor: { fileId: string; offset: number }): void; onInsertionAnchorChange?(anchor?: { fileId: string; offset: number }): void; onFigureSelect?(selection?: FigureSelection): void; onFigureSlotSelect?(selection: FigureSelection): void; onTableSelect?(selection?: TableSelection): void; onTableChange?(selection: TableSelection, source: string): void; api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void; onForwardSync(path: string, line: number, column?: number): void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [additionalSelectedIds, setAdditionalSelectedIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string>();
  // Absolute document position; recursive renderers must never rebase it.
  const [editingCursorOffset, setEditingCursorOffset] = useState<number>();
  const [boundary, setBoundary] = useState<BoundaryInsertion>();
  const [marqueeRect, setMarqueeRect] = useState<{ left: number; top: number; width: number; height: number }>();
  const [renderLimit, setRenderLimit] = useState(previewNodeLimit);
  const [pendingReferenceOffset, setPendingReferenceOffset] = useState<number>();
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const marqueeGesture = useRef<{ pointerId: number; startX: number; startY: number; currentX: number; currentY: number; moved: boolean } | undefined>(undefined);
  const marqueeJustCompleted = useRef(false);
  const pendingBoundaryRef = useRef<{ startOffset: number; position: number; side: "before" | "after"; kind: PreviewNode["kind"] } | undefined>(undefined);
  const pendingStructuralEditRef = useRef<{ startOffset: number; environmentId: string } | undefined>(undefined);
  useEffect(() => {
    const reset = () => {
      setSelectedId(undefined); setAdditionalSelectedIds([]);
      setEditingId(undefined); setEditingCursorOffset(undefined); setBoundary(undefined);
      pendingBoundaryRef.current = undefined;
      pendingStructuralEditRef.current = undefined;
    };
    window.addEventListener("texweave:history-replayed", reset);
    return () => window.removeEventListener("texweave:history-replayed", reset);
  }, []);
  const document = useMemo(() => filePath && source !== undefined ? parsePreview(source, filePath, definitions) : undefined, [filePath, source, definitions]);
  const nodeRanges = useMemo(() => {
    const index = new Map<string, SourceSpan>();
    const pending = [...(document?.nodes ?? [])];
    while (pending.length) {
      const node = pending.pop()!;
      index.set(node.id, node.source);
      if (node.kind === "block") { index.set(`ui-empty:${node.id}`, node.body); pending.push(...node.children); }
    }
    return index;
  }, [document]);
  const rendering = useMemo(() => {
    const nodes = document ? takePreviewNodes(document.nodes, { remaining: renderLimit }) : [];
    return { nodes, total: document ? countNodes(document.nodes) : 0, shown: countNodes(nodes) };
  }, [document, renderLimit]);
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
  const filterEvaluation = useMemo(() => document && source !== undefined && filePath ? previewFilterEngine.evaluate(document.nodes, source, filePath, filterQuery) : undefined, [document, source, filePath, filterQuery]);
  useEffect(() => {
    onInsertionAnchorChange?.(boundary && filePath ? { fileId: filePath, offset: boundary.position } : undefined);
  }, [boundary, filePath, onInsertionAnchorChange]);
  useEffect(() => { pendingBoundaryRef.current = undefined; pendingStructuralEditRef.current = undefined; setRenderLimit(previewNodeLimit); setEditingId(undefined); setEditingCursorOffset(undefined); setSelectedId(undefined); setAdditionalSelectedIds([]); setBoundary(undefined); }, [filePath]);
  useEffect(() => {
    const pendingStructuralEdit = pendingStructuralEditRef.current;
    if (pendingStructuralEdit && document) {
      const target = structuralBlockAt(document.nodes, pendingStructuralEdit.startOffset, pendingStructuralEdit.environmentId);
      pendingStructuralEditRef.current = undefined;
      if (target) {
        const body = source?.slice(target.body.startOffset, target.body.endOffset) ?? "";
        const leadingWhitespace = body.match(/^[\t \r\n]*/)?.[0].length ?? 0;
        setEditingId(target.id);
        setEditingCursorOffset(target.body.startOffset + leadingWhitespace);
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
      setSelectedId(undefined);
      setAdditionalSelectedIds([]);
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
  const selectedBlockIds = () => [...new Set([...(selectedId ? [selectedId] : []), ...additionalSelectedIds])];
  const sourceRangesForBlocks = (ids: string[]) => {
    if (!document) return [];
    const ranges = ids.map((id) => nodeById(document.nodes, id)).filter((node): node is StructuralBlock => node?.kind === "block")
      .map((node) => ({ start: node.source.startOffset, end: node.source.endOffset }))
      .sort((left, right) => left.start - right.start || right.end - left.end);
    // Parent and child blocks can both be inside a marquee. Treat a containing
    // block as one source range so copying/deleting never duplicates or overlaps.
    const outermost = ranges.filter((range, index) => !ranges.some((other, otherIndex) => otherIndex !== index && other.start <= range.start && other.end >= range.end && (other.start < range.start || other.end > range.end)));
    return outermost.filter((range, index) => outermost.findIndex((candidate) => candidate.start === range.start && candidate.end === range.end) === index);
  };
  const deleteBlocks = (ids: string[]) => {
    if (!source || !ids.length) return;
    const selectedNodes = ids.map((id) => document ? nodeById(document.nodes, id) : undefined).filter((node): node is StructuralBlock => node?.kind === "block");
    const descendantTotal = selectedNodes.filter((node) => node.semanticKind === "structural").reduce((sum, node) => sum + countDescendants(node), 0);
    if (descendantTotal > 0 && !window.confirm(t("preview.deleteEntireConfirm", { count: descendantTotal }))) return;
    const ranges = sourceRangesForBlocks(ids).sort((left, right) => right.start - left.start);
    if (!ranges.length) return;
    let next = source;
    for (const range of ranges) next = next.slice(0, range.start) + next.slice(range.end);
    onSourceChange(next);
    setSelectedId(undefined);
    setAdditionalSelectedIds([]);
    setEditingId(undefined);
    setEditingCursorOffset(undefined);
    setBoundary(undefined);
    onFigureSelect?.(undefined);
    onTableSelect?.(undefined);
  };
  const removeEnvironment = (id: string) => {
    if (!source || !document) return;
    const node = nodeById(document.nodes, id);
    if (!node || node.kind !== "block" || node.origin !== "latex") return;
    const original = nodeSource(node, source);
    const unwrapped = unwrapLatexEnvironment(original, node.environmentId);
    if (unwrapped === undefined) return;
    onSourceChange(source.slice(0, node.source.startOffset) + unwrapped + source.slice(node.source.endOffset));
    setSelectedId(undefined);
    setAdditionalSelectedIds([]);
    setEditingId(undefined);
    setEditingCursorOffset(undefined);
    setBoundary(undefined);
    onFigureSelect?.(undefined);
    onTableSelect?.(undefined);
  };
  const copyBlocks = async (cut: boolean) => {
    if (!source) return;
    const ids = selectedBlockIds();
    const ranges = sourceRangesForBlocks(ids);
    if (!ranges.length) return;
    const rawLatex = ranges.map((range) => source.slice(range.start, range.end)).join("\n\n");
    try {
      await writePreviewClipboard(rawLatex);
      if (cut) deleteBlocks(ids);
    } catch (error) {
      console.error("Failed to copy selected preview blocks", error);
    }
  };
  useEffect(() => {
    if (!filePath?.toLocaleLowerCase().endsWith(".tex") || source === undefined) return;
    const handleDelete = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : undefined;
      if (target && !previewRootRef.current?.contains(target) && target !== globalThis.document.body && target !== globalThis.document.documentElement) return;
      if (editingId || boundary || target?.closest(".preview-local-editor, .monaco-editor, input, textarea, select, [contenteditable='true'], .preview-block-header-actions, .preview-block-footer-actions, .environment-picker")) return;
      if (window.getSelection()?.isCollapsed === false) return;
      const ids = selectedBlockIds();
      if (!ids.length) return;
      if (event.key === "c" || event.key === "x") {
        if (!event.ctrlKey && !event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault();
        event.stopPropagation();
        void copyBlocks(event.key === "x");
        return;
      }
      if (event.key !== "Delete" || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      event.stopPropagation();
      deleteBlocks(ids);
    };
    window.addEventListener("keydown", handleDelete, true);
    return () => window.removeEventListener("keydown", handleDelete, true);
  }, [selectedId, additionalSelectedIds, editingId, boundary, source, document, filePath]);
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
    onSourceChange(nextSource);
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
    onSourceChange(nextSource);
    setEditingId(undefined);
    setEditingCursorOffset(undefined);
  };
  const applyBoundary = (insertion: BoundaryInsertion, value: string) => {
    if (tryApplyBoundaryStructuralDraft(insertion, value)) return;
    const content = value.replace(/^\n+|\n+$/g, "");
    const replacement = insertion.side === "before" ? `${content}${content ? "\n" : ""}\n` : `\n${content ? `\n${content}` : ""}`;
    onSourceChange(source.slice(0, insertion.position) + replacement + source.slice(insertion.position));
    setBoundary(undefined);
  };
  actionsRef.current = {
    select: (id) => {
      setSelectedId(id); setEditingId(undefined); setEditingCursorOffset(undefined); setBoundary(undefined);
      const node = document ? nodeById(document.nodes, id) : undefined;
      if (node?.kind === "block" && ["figure", "figure-star", "custom:figure*", "inline-image"].includes(node.environmentId)) onFigureSelect?.({ fileId: filePath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source) }); else onFigureSelect?.(undefined);
      if (node?.kind === "block" && ["table", "table-star", "tabular", "tabular-star", "tabularx", "longtable"].includes(node.environmentId)) onTableSelect?.({ fileId: filePath, start: node.source.startOffset, end: node.source.endOffset, source: nodeSource(node, source), kind: "table" }); else onTableSelect?.(undefined);
    },
    edit: (id, offset) => { setEditingId(id); setEditingCursorOffset(offset); setSelectedId(undefined); setBoundary(undefined); onFigureSelect?.(undefined); onTableSelect?.(undefined); },
    cancelEdit: () => { setEditingId(undefined); setEditingCursorOffset(undefined); setBoundary(undefined); },
    setSelectedBlockIds: (ids) => { setSelectedId(ids[0]); setAdditionalSelectedIds(ids.slice(1)); },
    applyEdit, applyBoundary, onBoundaryDraftChange, requestBoundary, deleteBlocks, removeEnvironment, onFigureSelect, onFigureSlotSelect, onTableSelect, onTableChange, onSpellContextMenu, onDetectedLanguage, onForwardSync,
    relationFocus: (id) => relation?.onFocus(id),
    relationToggle: (id, x, y) => relation?.onToggle(id, x, y)
  };
  const services: PreviewEditorServices = {
    nodeRanges, api, projectId, tree, currentPath: filePath, documentSource: source, definitions, mathContext, searchQuery,
    activeSearchResult: activeSearchResult?.fileId === filePath ? activeSearchResult : undefined,
    filterQuery, filterStates: filterEvaluation?.states ?? new Map(),
    relation: relation ? { ...relation, onFocus: actions.relationFocus, onToggle: actions.relationToggle } : undefined,
    selectedBlockIds: selectedBlockIds(), setSelectedBlockIds: actions.setSelectedBlockIds, deleteBlocks: actions.deleteBlocks, removeEnvironment: actions.removeEnvironment, onBoundaryDraftChange: actions.onBoundaryDraftChange,
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
    setSelectedId(ids[0]);
    setAdditionalSelectedIds(ids.slice(1));
    setEditingId(undefined);
    setEditingCursorOffset(undefined);
    setBoundary(undefined);
    onFigureSelect?.(undefined);
    onTableSelect?.(undefined);
    marqueeJustCompleted.current = true;
    window.setTimeout(() => { marqueeJustCompleted.current = false; }, 0);
  };
  const cancelBlockMarquee = () => { marqueeGesture.current = undefined; setMarqueeRect(undefined); };
  const { total: totalNodes, nodes: visibleNodes, shown: shownNodes } = rendering;
  const selectedCount = (selectedId ? 1 : 0) + additionalSelectedIds.length;
  const onPreviewClick = (event: MouseEvent<HTMLDivElement>) => {
    if (marqueeJustCompleted.current) { event.preventDefault(); event.stopPropagation(); marqueeJustCompleted.current = false; return; }
    const clickTarget = event.target instanceof Element ? event.target : undefined;
    if (clickTarget?.closest(".preview-local-editor, .preview-block-header-actions, .preview-block-footer-actions, .preview-selection-toolbar, button, input, textarea, select, [contenteditable='true']")) return;
    const root = previewRootRef.current;
    const sourceRegion = root && sourceElement(event.target as Node, root);
    const sourceOffset = sourceRegion ? sourceOffsetAtPoint(sourceRegion, event) : undefined;
    if (filePath && sourceOffset !== undefined) onClickSourcePosition?.({ fileId: filePath, offset: sourceOffset });
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
    setAdditionalSelectedIds([]);
    setBoundary(undefined);
    onFigureSelect?.(undefined);
    onTableSelect?.(undefined);
  };
  const emitSelection = () => {
    const selection = previewRootRef.current ? previewDocumentSelection(previewRootRef.current, source, filePath) : undefined;
    onSelectionChange?.(selection);
    return selection;
  };
  return <div ref={previewRootRef} className={`structured-preview${marqueeRect ? " marquee-selecting" : ""}`} onPointerDown={startBlockMarquee} onPointerMove={moveBlockMarquee} onPointerUp={finishBlockMarquee} onPointerCancel={cancelBlockMarquee} onClickCapture={onPreviewClick} onMouseUp={() => emitSelection()} onKeyUp={() => emitSelection()} onContextMenu={(event) => {
    if (event.target instanceof Element && event.target.closest(".preview-block-delete")) return;
    const selection = emitSelection();
    if (!selection || !onSelectionContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectionContextMenu(selection, event.clientX, event.clientY);
  }}>
    {selectedCount > 1 && <div className="preview-selection-toolbar" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}><span className="preview-selection-count">{t("preview.selectedBlocks", { count: selectedCount })}</span><button onClick={() => void copyBlocks(false)}>{t("editor.context.copy")}</button><button onClick={() => void copyBlocks(true)}>{t("editor.context.cut")}</button><button className="danger" onClick={() => deleteBlocks(selectedBlockIds())}>{t("files.delete")}</button></div>}
    {marqueeRect && <div className="preview-marquee" style={{ left: marqueeRect.left, top: marqueeRect.top, width: marqueeRect.width, height: marqueeRect.height}}/>}
    <article>{document?.title && <DocumentTitlePreview {...document.title} mathContext={mathContext} searchQuery={searchQuery}/>}<PreviewNodeList nodes={visibleNodes} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} cursorOffset={editingCursorOffset} boundary={boundary} select={actions.select} edit={actions.edit} applyEdit={actions.applyEdit} applyBoundary={actions.applyBoundary} cancelEdit={actions.cancelEdit} requestBoundary={actions.requestBoundary} services={services}/></article>
    {totalNodes > shownNodes && <aside className="preview-limit-notice"><strong>{t("preview.largeDocumentTitle")}</strong><span>{t("preview.largeDocumentMessage", { shown: shownNodes, total: totalNodes })}</span><button onClick={(event) => { event.stopPropagation(); setRenderLimit((value) => value + previewNodeLimit); }}>{t("preview.loadMore")}</button></aside>}
    {filterQuery.enabled && filterEvaluation && filterEvaluation.matches.size === 0 && <aside className="preview-filter-empty">{t("filter.noMatches")}</aside>}
    {document?.diagnostics.length ? <aside className="preview-diagnostics"><strong>{t("preview.recovered")}</strong>{document.diagnostics.map((message, index) => <p key={index}>{message}</p>)}</aside> : null}
  </div>;
}
