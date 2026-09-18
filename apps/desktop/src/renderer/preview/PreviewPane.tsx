import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Editor, type OnMount } from "@monaco-editor/react";
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

type EditorApi = NonNullable<Window["latexEditor"]>;
type PreviewEditorServices = { api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; currentPath: string; definitions: EnvironmentDefinition[]; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void };
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

function inlineLatex(value: string | undefined): ReactNode[] {
  if (!value) return [];
  const clean = value.replace(/^\s*%.*$/gm, "").replace(/%[^\n]*/g, "").trim();
  const pattern = /\$\$([\s\S]*?)\$\$|\$(?!\$)([^$\n]+?)\$|\\\(([\s\S]*?)\\\)|\\(textbf|textit|emph|texttt)\{([^{}]*)\}|\\([A-Za-z]*cite[A-Za-z]*)\{([^{}]*)\}|\\([A-Za-z]*ref[A-Za-z]*)\{([^{}]*)\}/g;
  const result: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of clean.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) result.push(<Fragment key={index++}>{plainLatex(clean.slice(cursor, start))}</Fragment>);
    if (match[1] !== undefined) result.push(<MathRenderer key={index++} expression={match[1]} display/>);
    else if (match[2] !== undefined) result.push(<MathRenderer key={index++} expression={match[2]}/>);
    else if (match[3] !== undefined) result.push(<MathRenderer key={index++} expression={match[3]}/>);
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

function SpecializedContent({ node, source }: { node: StructuralBlock; source: string }) {
  const raw = bodySource(node, source);
  const definitionId = node.environmentId;
  if (/equation|align|gather|multline|display-math/.test(definitionId)) {
    const mathBody = mathBodySource(node, source);
    const environment = definitionId.replace(/-star$/, "");
    const expression = /^(align|gather|multline)$/.test(environment) ? `\\begin{${environment}}${mathBody}\\end{${environment}}` : mathBody;
    return <MathRenderer expression={expression} display/>;
  }
  if (/verbatim|lstlisting/.test(definitionId)) return <pre className="preview-code">{raw.trim()}</pre>;
  if (/itemize|enumerate|description/.test(definitionId)) {
    const items = previewListItems(raw);
    const Tag = definitionId === "enumerate" ? "ol" : "ul";
    return <Tag className="preview-list">{items.map((item, index) => <li key={index}>{item.label && <strong>{inlineLatex(item.label)} </strong>}{inlineLatex(item.content)}</li>)}</Tag>;
  }
  if (definitionId === "figure") {
    const image = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/.exec(raw)?.[1];
    const caption = /\\caption\{([^}]*)\}/.exec(raw)?.[1];
    return <figure className="preview-figure"><div className="preview-media">{image ? `Image · ${image}` : t("preview.figurePlaceholder")}</div>{caption && <figcaption>{inlineLatex(caption)}</figcaption>}</figure>;
  }
  if (definitionId === "table") {
    const tabular = /\\begin\{tabular\}\{[^}]*\}([\s\S]*?)\\end\{tabular\}/.exec(raw)?.[1] ?? raw;
    return <div className="preview-table"><pre>{plainLatex(tabular).replaceAll("\\\\", "\n")}</pre></div>;
  }
  return null;
}

function LocalEditor({ value, onApply, onCancel, api, projectId, tree, currentPath, definitions, onSpellContextMenu, onDetectedLanguage }: { value: string; onApply(value: string): void; onCancel(): void; api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; currentPath: string; definitions: EnvironmentDefinition[]; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void }) {
  const preferences = useSettings();
  const [draft, setDraft] = useState(value);
  const completionController = useRef<CompletionController | null>(null);
  const spellCheckController = useRef<SpellCheckController | null>(null);
  const mode = preferences.get("spellCheckMode");
  const language = preferences.get("spellCheckLanguage");
  useEffect(() => () => { completionController.current?.dispose(); spellCheckController.current?.dispose(); }, []);
  useEffect(() => { spellCheckController.current?.refresh(); }, [mode, language]);
  const onMount: OnMount = (editor, monaco) => {
    editor.focus();
    editor.addCommand(9 /* Escape */, onCancel);
    editor.addCommand(2048 | 3 /* Ctrl+Enter */, () => onApply(editor.getValue()));
    completionController.current?.dispose();
    spellCheckController.current?.dispose();
    if (!api) return;
    completionController.current = new CompletionController({ monaco, api, projectId, getTree: () => tree, getCurrentPath: () => currentPath, getEnvironments: () => definitions, isDocumentWordCompletionEnabled: () => preferences.get("documentWordCompletion") });
    spellCheckController.current = new SpellCheckController({ editor, api, getCurrentPath: () => currentPath, getMode: () => preferences.get("spellCheckMode"), getManualLanguage: () => preferences.get("spellCheckLanguage"), onDetectedLanguage, onContextMenu: onSpellContextMenu });
  };
  return <div className="preview-local-editor" onClick={(event) => event.stopPropagation()}>
    <Editor height="150px" language="latex" value={draft} onChange={(next) => setDraft(next ?? "")} theme={preferences.get("theme") === "dark" ? "texweave-dark" : "texweave-light"} options={{ minimap: { enabled: false }, lineNumbers: "off", folding: false, fontSize: preferences.get("fontSize"), tabSize: preferences.get("tabSize"), wordWrap: preferences.get("wordWrap") ? "on" : "off", lineHeight: 23, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 10 }, quickSuggestions: { other: true, comments: true, strings: true }, suggestOnTriggerCharacters: true, autoClosingBrackets: "always", autoClosingQuotes: "always", autoSurround: "languageDefined" }} onMount={onMount} />
    <div className="preview-local-editor-actions"><span>{t("preview.editHint")}</span><button onClick={onCancel}>{t("preview.cancel")}</button><button className="primary" onClick={() => onApply(draft)}>{t("preview.apply")}</button></div>
  </div>;
}

function ContentRenderer({ node, source, editing, beginEdit, applyEdit, cancelEdit, services }: { node: ContentRegion; source: string; editing: boolean; beginEdit(): void; applyEdit(value: string): void; cancelEdit(): void; services: PreviewEditorServices }) {
  if (editing) return <LocalEditor value={nodeSource(node, source)} onApply={applyEdit} onCancel={cancelEdit} {...services}/>;
  return <div className="preview-content-region" data-node-id={node.id} data-source-line={node.source.startLine} data-source-start-offset={node.source.startOffset} onClick={(event) => { event.stopPropagation(); beginEdit(); }}>{inlineLatex(node.raw)}</div>;
}

function BlockRenderer({ node, source, definitions, selectedId, editingId, select, edit, applyEdit, cancelEdit, services, budget }: { node: StructuralBlock; source: string; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; select(id: string): void; edit(id: string): void; applyEdit(node: PreviewNode, value: string): void; cancelEdit(): void; services: PreviewEditorServices; budget: PreviewRenderBudget }) {
  const definition = definitionForId(definitions, node.environmentId);
  const family = definition?.family ?? (node.origin === "virtual" ? "virtual" : "generic");
  const specialized = SpecializedContent({ node, source });
  const editing = editingId === node.id;
  const cssValue = (value: string | undefined, fallback: string) => value ? (value.startsWith("--") ? `var(${value})` : value) : `var(${fallback})`;
  return <section className={`preview-block env-${family} ${selectedId === node.id ? "selected" : ""} ${editing ? "editing" : ""}`} data-environment={node.environmentId} data-source-line={node.source.startLine} data-source-start-offset={node.source.startOffset} style={{ "--block-accent": cssValue(definition?.style.accentToken, "--env-generic-accent"), "--block-fill": cssValue(definition?.style.fillToken, "--env-generic-fill"), "--block-border": cssValue(definition?.style.borderToken, "--env-border-default"), "--block-selected-border": cssValue(definition?.style.selectedBorderToken, "--env-border-selected"), "--block-label-bg": cssValue(definition?.style.labelBackgroundToken, "--env-generic-label-bg"), "--block-label-text": cssValue(definition?.style.labelTextToken, "--env-generic-label-text") } as CSSProperties}>
    {(definition?.behavior.showHeader ?? true) && <button className="preview-block-header" onClick={(event) => { event.stopPropagation(); select(node.id); }}><span>{environmentLabel(definition, node.environmentId)}</span>{node.title && <strong>{node.title}</strong>}{node.latexLabel && <small>{node.latexLabel}</small>}</button>}
    <div className="preview-block-body" onClick={(event) => {
      if (specialized && (definition?.behavior.inlineEditable ?? true)) { event.stopPropagation(); edit(node.id); }
    }}>
      {editing ? <LocalEditor value={nodeSource(node, source)} onApply={(value) => applyEdit(node, value)} onCancel={cancelEdit} {...services}/> : specialized ?? node.children.map((child) => <PreviewNodeRenderer key={child.id} node={child} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} select={select} edit={edit} applyEdit={applyEdit} cancelEdit={cancelEdit} services={services} budget={budget}/>) }
    </div>
  </section>;
}

function PreviewNodeRenderer(props: { node: PreviewNode; source: string; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; select(id: string): void; edit(id: string): void; applyEdit(node: PreviewNode, value: string): void; cancelEdit(): void; services: PreviewEditorServices; budget: PreviewRenderBudget }) {
  if (props.budget.remaining <= 0) return null;
  props.budget.remaining -= 1;
  if (props.node.kind === "block") return <BlockRenderer {...props} node={props.node}/>;
  return <ContentRenderer node={props.node} source={props.source} editing={props.editingId === props.node.id} beginEdit={() => props.edit(props.node.id)} applyEdit={(value) => props.applyEdit(props.node, value)} cancelEdit={props.cancelEdit} services={props.services}/>;
}

export function PreviewPane({ filePath, source, definitions, onSourceChange, api, projectId, tree, onSpellContextMenu, onDetectedLanguage }: { filePath?: string | undefined; source?: string | undefined; definitions: EnvironmentDefinition[]; onSourceChange(next: string): void; api: EditorApi | undefined; projectId: string; tree: ProjectTreeNode[]; onSpellContextMenu(request: SpellContextRequest): void; onDetectedLanguage(language: string): void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [renderLimit, setRenderLimit] = useState(previewNodeLimit);
  const [pendingReferenceOffset, setPendingReferenceOffset] = useState<number>();
  const document = useMemo(() => filePath && source !== undefined ? parsePreview(source, filePath, definitions) : undefined, [filePath, source, definitions]);
  useEffect(() => { setRenderLimit(previewNodeLimit); setEditingId(undefined); setSelectedId(undefined); }, [filePath, source]);
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
  const services: PreviewEditorServices = { api, projectId, tree, currentPath: filePath, definitions, onSpellContextMenu, onDetectedLanguage };
  const applyEdit = (node: PreviewNode, replacement: string) => {
    onSourceChange(source.slice(0, node.source.startOffset) + replacement + source.slice(node.source.endOffset));
    setEditingId(undefined);
  };
  const totalNodes = document ? countNodes(document.nodes) : 0;
  const visibleBudget: PreviewRenderBudget = { remaining: renderLimit };
  const visibleNodes = document ? takePreviewNodes(document.nodes, visibleBudget) : [];
  const shownNodes = countNodes(visibleNodes);
  const onPreviewClick = (event: MouseEvent<HTMLDivElement>) => {
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
  };
  return <div className="structured-preview" onClickCapture={onPreviewClick}>
    <article>{visibleNodes.map((node) => <PreviewNodeRenderer key={node.id} node={node} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} select={(id) => { setSelectedId(id); setEditingId(undefined); }} edit={(id) => { setEditingId(id); setSelectedId(undefined); }} applyEdit={applyEdit} cancelEdit={() => setEditingId(undefined)} services={services} budget={{ remaining: Number.MAX_SAFE_INTEGER }}/>)}</article>
    {totalNodes > shownNodes && <aside className="preview-limit-notice"><strong>{t("preview.largeDocumentTitle")}</strong><span>{t("preview.largeDocumentMessage", { shown: shownNodes, total: totalNodes })}</span><button onClick={(event) => { event.stopPropagation(); setRenderLimit((value) => value + previewNodeLimit); }}>{t("preview.loadMore")}</button></aside>}
    {document?.diagnostics.length ? <aside className="preview-diagnostics"><strong>{t("preview.recovered")}</strong>{document.diagnostics.map((message, index) => <p key={index}>{message}</p>)}</aside> : null}
  </div>;
}
