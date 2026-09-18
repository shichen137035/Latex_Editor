import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Editor, type OnMount } from "@monaco-editor/react";
import { createPortal } from "react-dom";
import type { ProjectTreeNode } from "@latex-editor/contracts";
import { t, type MessageKey } from "../i18n/index.js";
import { definitionForId } from "./environments.js";
import { parsePreview } from "./parser.js";
import type { ContentRegion, EnvironmentDefinition, PreviewNode, StructuralBlock } from "./types.js";
import "./preview.css";
import { useSettings } from "../settings/service.js";
import { CompletionController } from "../completion/CompletionController.js";
import { SpellCheckController, type SpellContextRequest } from "../spellcheck/SpellCheckController.js";
import { MathRenderer } from "./MathRenderer.js";
import { commands } from "../settings/commands.js";
import { MathPreviewPopover } from "../math/MathPreviewPopover.js";
import { extractMathExpression } from "../math/MathRenderService.js";
import { EMPTY_MATH_CONTEXT, type MathContext } from "../math/types.js";

type EditorApi = NonNullable<Window["latexEditor"]>;
type PreviewEditorServices = { api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; currentPath: string; definitions: EnvironmentDefinition[]; mathContext: MathContext; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void };
interface BoundaryInsertion { targetId: string; position: number; side: "before" | "after" }
interface PreviewRenderBudget { remaining: number; }
const previewNodeLimit = 900;

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

function inlineLatex(value: string | undefined, mathContext: MathContext): ReactNode[] {
  if (!value) return [];
  const clean = value.replace(/^\s*%.*$/gm, "").replace(/%[^\n]*/g, "").trim();
  const pattern = /\$\$([\s\S]*?)\$\$|\$(?!\$)([^$\n]+?)\$|\\\(([\s\S]*?)\\\)|\\(textbf|textit|emph|texttt)\{([^{}]*)\}|\\([A-Za-z]*cite[A-Za-z]*)\{([^{}]*)\}|\\([A-Za-z]*ref[A-Za-z]*)\{([^{}]*)\}/g;
  const result: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of clean.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) result.push(<Fragment key={index++}>{plainLatex(clean.slice(cursor, start))}</Fragment>);
    if (match[1] !== undefined) result.push(<MathRenderer key={index++} expression={match[1]} display context={mathContext}/>);
    else if (match[2] !== undefined) result.push(<MathRenderer key={index++} expression={match[2]} context={mathContext}/>);
    else if (match[3] !== undefined) result.push(<MathRenderer key={index++} expression={match[3]} context={mathContext}/>);
    else if (match[4] === "textbf") result.push(<strong key={index++}>{match[5]}</strong>);
    else if (match[4] === "texttt") result.push(<code key={index++}>{match[5]}</code>);
    else if (match[4]) result.push(<em key={index++}>{match[5]}</em>);
    else if (match[6]) result.push(<span className="preview-citation" key={index++} title={`\\${match[6]}`}>[{match[7]}]</span>);
    else result.push(<button type="button" className="preview-reference" data-reference={match[9]} key={index++} title={`\\${match[8]}`}>[{match[9]}]</button>);
    cursor = start + match[0].length;
  }
  if (cursor < clean.length) result.push(<Fragment key={index}>{plainLatex(clean.slice(cursor))}</Fragment>);
  return result;
}

interface PreviewListItem {
  content: string;
  label?: string;
}

/**
 * Extracts list items without using a capturing `split`. JavaScript inserts an
 * `undefined` entry for an unmatched optional capture, which previously made
 * ordinary `\item` lists crash the complete React preview while rendering.
 */
function previewListItems(value: string): PreviewListItem[] {
  const matches = [...value.matchAll(/\\item(?:\[([^\]]+)\])?/g)];
  return matches.map((match, index) => {
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd = matches[index + 1]?.index ?? value.length;
    return {
      content: value.slice(contentStart, contentEnd),
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

function environmentLabel(definition: EnvironmentDefinition | undefined, id: string): string {
  if (definition) return definition.label ?? t(definition.labelKey as MessageKey) ?? definition.id;
  if (id.startsWith("virtual:")) return id.slice("virtual:".length).replaceAll("-", " ").toLocaleUpperCase();
  if (id.startsWith("custom:")) return `${t("environment.custom")} · ${id.slice("custom:".length)}`;
  return id.replaceAll("-", " ").toLocaleUpperCase();
}

function SpecializedContent({ node, source, mathContext }: { node: StructuralBlock; source: string; mathContext: MathContext }) {
  const raw = bodySource(node, source);
  const definitionId = node.environmentId;
  if (/equation|align|gather|multline|display-math/.test(definitionId)) {
    const mathBody = mathBodySource(node, source);
    const environment = definitionId.replace(/-star$/, "");
    const expression = /^(align|gather|multline)$/.test(environment) ? `\\begin{${environment}}${mathBody}\\end{${environment}}` : mathBody;
    return <MathRenderer expression={expression} display context={mathContext}/>;
  }
  if (/verbatim|lstlisting/.test(definitionId)) return <pre className="preview-code">{raw.trim()}</pre>;
  if (/itemize|enumerate|description/.test(definitionId)) {
    const items = previewListItems(raw);
    const Tag = definitionId === "enumerate" ? "ol" : "ul";
    return <Tag className="preview-list">{items.map((item, index) => <li key={index}>{item.label && <strong>{inlineLatex(item.label, mathContext)} </strong>}{inlineLatex(item.content, mathContext)}</li>)}</Tag>;
  }
  if (definitionId === "figure") {
    const image = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/.exec(raw)?.[1];
    const caption = /\\caption\{([^}]*)\}/.exec(raw)?.[1];
    return <figure className="preview-figure"><div className="preview-media">{image ? `Image · ${image}` : t("preview.figurePlaceholder")}</div>{caption && <figcaption>{inlineLatex(caption, mathContext)}</figcaption>}</figure>;
  }
  if (definitionId === "table") {
    const tabular = /\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/.exec(raw)?.[1] ?? raw;
    return <div className="preview-table"><pre>{plainLatex(tabular).replaceAll("\\\\", "\n")}</pre></div>;
  }
  return null;
}

function LocalEditor({ value, onApply, onCancel, onInsertBefore, onInsertAfter, mathDraft = false, api, projectId, tree, currentPath, definitions, mathContext, onSpellContextMenu, onDetectedLanguage }: { value: string; onApply(value: string): void; onCancel(): void; onInsertBefore?(draft: string): void; onInsertAfter?(draft: string): void; mathDraft?: boolean; api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; currentPath: string; definitions: EnvironmentDefinition[]; mathContext: MathContext; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void }) {
  const preferences = useSettings();
  const [draft, setDraft] = useState(value);
  const [mathAnchor, setMathAnchor] = useState<DOMRect>();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const editorShellRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef(value);
  const applyRef = useRef(onApply);
  const cancelRef = useRef(onCancel);
  const completionController = useRef<CompletionController | null>(null);
  const spellCheckController = useRef<SpellCheckController | null>(null);
  const mode = preferences.get("spellCheckMode");
  const language = preferences.get("spellCheckLanguage");
  draftRef.current = draft;
  applyRef.current = onApply;
  cancelRef.current = onCancel;
  useEffect(() => () => { completionController.current?.dispose(); spellCheckController.current?.dispose(); }, []);
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
    editor.focus();
    completionController.current?.dispose();
    spellCheckController.current?.dispose();
    if (!api) return;
    completionController.current = new CompletionController({ monaco, api, projectId, getTree: () => tree, getCurrentPath: () => currentPath, getEnvironments: () => definitions, isDocumentWordCompletionEnabled: () => preferences.get("documentWordCompletion") });
    spellCheckController.current = new SpellCheckController({ editor, api, getCurrentPath: () => currentPath, getMode: () => preferences.get("spellCheckMode"), getManualLanguage: () => preferences.get("spellCheckLanguage"), onDetectedLanguage, onContextMenu: onSpellContextMenu });
  };
  const activeMath = useMemo(() => mathDraft ? extractMathExpression(draft) : undefined, [draft, mathDraft]);
  useEffect(() => {
    if (!activeMath) { setMathAnchor(undefined); return; }
    let frame = 0;
    const updateAnchor = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = editorShellRef.current?.getBoundingClientRect();
        setMathAnchor(rect && rect.bottom > 0 && rect.top < window.innerHeight ? rect : undefined);
      });
    };
    const scrollRoot = editorShellRef.current?.closest(".structured-preview");
    updateAnchor();
    scrollRoot?.addEventListener("scroll", updateAnchor, { passive: true });
    window.addEventListener("resize", updateAnchor);
    return () => {
      window.cancelAnimationFrame(frame);
      scrollRoot?.removeEventListener("scroll", updateAnchor);
      window.removeEventListener("resize", updateAnchor);
    };
  }, [activeMath]);
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
    <Editor height="150px" language="latex" value={draft} onChange={(next) => { const value = next ?? ""; draftRef.current = value; setDraft(value); }} theme={preferences.get("theme") === "dark" ? "texweave-dark" : "texweave-light"} options={{ minimap: { enabled: false }, lineNumbers: "off", folding: false, fontSize: preferences.get("fontSize"), tabSize: preferences.get("tabSize"), wordWrap: preferences.get("wordWrap") ? "on" : "off", lineHeight: 23, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 10 }, quickSuggestions: { other: true, comments: true, strings: true }, suggestOnTriggerCharacters: true, autoClosingBrackets: "always", autoClosingQuotes: "always", autoSurround: "languageDefined" }} onMount={onMount} />
    <div className="preview-local-editor-actions"><span>{t("preview.editHint")}</span>{onInsertBefore && onInsertAfter && <div className="preview-line-actions"><button title={t("preview.insertLineBefore")} onClick={() => onInsertBefore(draftRef.current)}>↥＋</button><button title={t("preview.insertLineAfter")} onClick={() => onInsertAfter(draftRef.current)}>↧＋</button></div>}<button onClick={onCancel}>{t("preview.cancel")}</button><button className="primary" onClick={() => onApply(draft)}>{t("preview.apply")}</button></div>
  </div>{confirmLeave && createPortal(<div className="preview-confirm-backdrop"><section className="preview-confirm-dialog" role="dialog" aria-modal="true" aria-label={t("preview.unsavedTitle")}><h2>{t("preview.unsavedTitle")}</h2><p>{t("preview.unsavedMessage")}</p><div><button autoFocus className="primary" onClick={() => { setConfirmLeave(false); applyRef.current(draftRef.current); }}>{t("preview.yes")}</button><button onClick={() => { setConfirmLeave(false); cancelRef.current(); }}>{t("preview.no")}</button></div></section></div>, document.body)}</>;
}

function ContentRenderer({ node, source, editing, boundary, beginEdit, applyEdit, applyBoundary, cancelEdit, requestBoundary, services }: { node: ContentRegion; source: string; editing: boolean; boundary?: BoundaryInsertion | undefined; beginEdit(): void; applyEdit(value: string): void; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; services: PreviewEditorServices }) {
  const insertion = boundary?.targetId === node.id ? boundary : undefined;
  return <Fragment>
    {insertion?.side === "before" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onCancel={cancelEdit} {...services}/>}
    {editing ? <LocalEditor value={nodeSource(node, source)} onApply={applyEdit} onCancel={cancelEdit} onInsertBefore={(draft) => requestBoundary(node, "before", draft)} onInsertAfter={(draft) => requestBoundary(node, "after", draft)} {...services}/> : <div className="preview-content-region" data-node-id={node.id} data-source-line={node.source.startLine} data-source-start-offset={node.source.startOffset} onClick={(event) => { event.stopPropagation(); beginEdit(); }}>{inlineLatex(node.raw, services.mathContext)}</div>}
    {insertion?.side === "after" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onCancel={cancelEdit} {...services}/>}
  </Fragment>;
}

function isMathBlock(node: StructuralBlock): boolean {
  return /equation|align|gather|multline|display-math|aligned|split|cases/.test(node.environmentId);
}

function BlockRenderer({ node, source, definitions, selectedId, editingId, boundary, select, edit, applyEdit, applyBoundary, cancelEdit, requestBoundary, services, budget }: { node: StructuralBlock; source: string; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; boundary?: BoundaryInsertion | undefined; select(id: string): void; edit(id: string): void; applyEdit(node: PreviewNode, value: string): void; applyBoundary(insertion: BoundaryInsertion, value: string): void; cancelEdit(): void; requestBoundary(node: PreviewNode, side: "before" | "after", draft?: string): void; services: PreviewEditorServices; budget: PreviewRenderBudget }) {
  const definition = definitionForId(definitions, node.environmentId);
  const family = definition?.family ?? (node.origin === "virtual" ? "virtual" : "generic");
  const specialized = SpecializedContent({ node, source, mathContext: services.mathContext });
  const editing = editingId === node.id;
  const selected = selectedId === node.id;
  const cssValue = (value: string | undefined, fallback: string) => value ? (value.startsWith("--") ? `var(${value})` : value) : `var(${fallback})`;
  const insertion = boundary?.targetId === node.id ? boundary : undefined;
  return <Fragment>
    {insertion?.side === "before" && <LocalEditor value="" onApply={(value) => applyBoundary(insertion, value)} onCancel={cancelEdit} {...services}/>}
    <section className={`preview-block env-${family} ${selected ? "selected" : ""} ${editing ? "editing" : ""}`} data-environment={node.environmentId} data-source-line={node.source.startLine} data-source-start-offset={node.source.startOffset} style={{ "--block-accent": cssValue(definition?.style.accentToken, "--env-generic-accent"), "--block-fill": cssValue(definition?.style.fillToken, "--env-generic-fill"), "--block-border": cssValue(definition?.style.borderToken, "--env-border-default"), "--block-selected-border": cssValue(definition?.style.selectedBorderToken, "--env-border-selected"), "--block-label-bg": cssValue(definition?.style.labelBackgroundToken, "--env-generic-label-bg"), "--block-label-text": cssValue(definition?.style.labelTextToken, "--env-generic-label-text") } as CSSProperties}>
    {(definition?.behavior.showHeader ?? true) && <div className="preview-block-header"><button className="preview-block-header-main" onClick={(event) => { event.stopPropagation(); select(node.id); }}><span>{environmentLabel(definition, node.environmentId)}</span>{node.title && <strong>{node.title}</strong>}{node.latexLabel && <small>{node.latexLabel}</small>}</button>{selected && <div className="preview-block-header-actions"><button title={t("preview.insertBefore")} onClick={(event) => { event.stopPropagation(); requestBoundary(node, "before"); }}>↥＋</button><button title={t("preview.insertAfter")} onClick={(event) => { event.stopPropagation(); requestBoundary(node, "after"); }}>↧＋</button></div>}</div>}
    <div className="preview-block-body" onClick={(event) => {
      if (specialized && (definition?.behavior.inlineEditable ?? true)) { event.stopPropagation(); edit(node.id); }
    }}>
      {editing ? <LocalEditor value={nodeSource(node, source)} mathDraft={isMathBlock(node)} onApply={(value) => applyEdit(node, value)} onCancel={cancelEdit} onInsertBefore={(draft) => requestBoundary(node, "before", draft)} onInsertAfter={(draft) => requestBoundary(node, "after", draft)} {...services}/> : specialized ?? node.children.map((child) => <PreviewNodeRenderer key={child.id} node={child} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} boundary={boundary} select={select} edit={edit} applyEdit={applyEdit} applyBoundary={applyBoundary} cancelEdit={cancelEdit} requestBoundary={requestBoundary} services={services} budget={budget}/>) }
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

export function PreviewPane({ filePath, source, definitions, mathContext = EMPTY_MATH_CONTEXT, onSourceChange, api, projectId, tree, onSpellContextMenu, onDetectedLanguage }: { filePath?: string | undefined; source?: string | undefined; definitions: EnvironmentDefinition[]; mathContext?: MathContext; onSourceChange(next: string): void; api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [boundary, setBoundary] = useState<BoundaryInsertion>();
  const [renderLimit, setRenderLimit] = useState(previewNodeLimit);
  const [pendingReferenceOffset, setPendingReferenceOffset] = useState<number>();
  const pendingBoundaryRef = useRef<{ startOffset: number; position: number; side: "before" | "after"; kind: PreviewNode["kind"] } | undefined>(undefined);
  const document = useMemo(() => filePath && source !== undefined ? parsePreview(source, filePath, definitions) : undefined, [filePath, source, definitions]);
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
  if (!filePath || source === undefined) return <div className="preview-empty"><h2>{t("preview.noSourceTitle")}</h2><p>{t("preview.noSource")}</p></div>;
  if (!filePath.toLocaleLowerCase().endsWith(".tex")) return <div className="preview-empty"><h2>{t("preview.unsupportedFileTitle")}</h2><p>{t("preview.unsupportedFile")}</p></div>;
  const services: PreviewEditorServices = { api, projectId, tree, currentPath: filePath, definitions, mathContext, onSpellContextMenu, onDetectedLanguage };
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
  return <div className="structured-preview" onClickCapture={onPreviewClick}>
    <article>{visibleNodes.map((node) => <PreviewNodeRenderer key={node.id} node={node} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} boundary={boundary} select={(id) => { setSelectedId(id); setEditingId(undefined); setBoundary(undefined); }} edit={(id) => { setEditingId(id); setSelectedId(undefined); setBoundary(undefined); }} applyEdit={applyEdit} applyBoundary={applyBoundary} cancelEdit={() => { setEditingId(undefined); setBoundary(undefined); }} requestBoundary={requestBoundary} services={services} budget={{ remaining: Number.MAX_SAFE_INTEGER }}/>)}</article>
    {totalNodes > shownNodes && <aside className="preview-limit-notice"><strong>{t("preview.largeDocumentTitle")}</strong><span>{t("preview.largeDocumentMessage", { shown: shownNodes, total: totalNodes })}</span><button onClick={(event) => { event.stopPropagation(); setRenderLimit((value) => value + previewNodeLimit); }}>{t("preview.loadMore")}</button></aside>}
    {document?.diagnostics.length ? <aside className="preview-diagnostics"><strong>{t("preview.recovered")}</strong>{document.diagnostics.map((message, index) => <p key={index}>{message}</p>)}</aside> : null}
  </div>;
}
