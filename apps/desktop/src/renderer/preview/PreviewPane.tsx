import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Editor } from "@monaco-editor/react";
import { t, type MessageKey } from "../i18n/index.js";
import { definitionForId } from "./environments.js";
import { parsePreview } from "./parser.js";
import type { ContentRegion, EnvironmentDefinition, PreviewNode, StructuralBlock } from "./types.js";
import "./preview.css";
import { useSettings } from "../settings/service.js";

function plainLatex(value: string): string {
  return value
    .replace(/^\s*%.*$/gm, "")
    .replace(/%[^\n]*/g, "")
    .replace(/\\label\{[^}]+\}/g, "")
    .replace(/\\(?:begin|end)\{[^}]+\}/g, "")
    .replace(/\\(?:caption|section|subsection|subsubsection)\*?\{([^}]*)\}/g, "$1")
    .replace(/\\(?:textbf|textit|emph|textrm|texttt)\{([^}]*)\}/g, "$1")
    .replace(/\\(?:cite|ref|eqref)\{([^}]*)\}/g, "[$1]")
    .replace(/\\(?:quad|qquad)/g, "  ")
    .replace(/\\,/g, " ")
    .replace(/\\([%&_#$])/g, "$1")
    .trim();
}

function inlineLatex(value: string): ReactNode[] {
  const clean = value.replace(/^\s*%.*$/gm, "").replace(/%[^\n]*/g, "").trim();
  const pattern = /\$(?!\$)([^$]+)\$|\\(textbf|textit|emph|texttt)\{([^{}]*)\}|\\(cite|ref|eqref)\{([^{}]*)\}/g;
  const result: ReactNode[] = [];
  let cursor = 0;
  let index = 0;
  for (const match of clean.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) result.push(<Fragment key={index++}>{plainLatex(clean.slice(cursor, start))}</Fragment>);
    if (match[1] !== undefined) result.push(<span className="preview-inline-math" key={index++}>{match[1]}</span>);
    else if (match[2] === "textbf") result.push(<strong key={index++}>{match[3]}</strong>);
    else if (match[2] === "texttt") result.push(<code key={index++}>{match[3]}</code>);
    else if (match[2]) result.push(<em key={index++}>{match[3]}</em>);
    else result.push(<span className="preview-reference" key={index++}>{match[4]} {match[5]}</span>);
    cursor = start + match[0].length;
  }
  if (cursor < clean.length) result.push(<Fragment key={index}>{plainLatex(clean.slice(cursor))}</Fragment>);
  return result;
}

function nodeSource(node: PreviewNode, source: string): string {
  return source.slice(node.source.startOffset, node.source.endOffset);
}

function bodySource(node: StructuralBlock, source: string): string {
  if (node.children.length) {
    const first = node.children[0];
    const last = node.children.at(-1);
    if (first && last) return source.slice(first.source.startOffset, last.source.endOffset);
  }
  return nodeSource(node, source).replace(/^.*?\\begin\{[^}]+\}(?:\[[^\]]*\])?\s*/s, "").replace(/\s*\\end\{[^}]+\}.*$/s, "").replace(/^\\\[/, "").replace(/\\\]$/, "");
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
  if (/equation|align|gather|multline|display-math/.test(definitionId)) return <div className="preview-display-math">{plainLatex(raw)}</div>;
  if (/verbatim|lstlisting/.test(definitionId)) return <pre className="preview-code">{raw.trim()}</pre>;
  if (/itemize|enumerate|description/.test(definitionId)) {
    const items = raw.split(/\\item(?:\[([^\]]+)\])?/).slice(1);
    const Tag = definitionId === "enumerate" ? "ol" : "ul";
    return <Tag className="preview-list">{items.map((item, index) => <li key={index}>{inlineLatex(item)}</li>)}</Tag>;
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

function LocalEditor({ value, onApply, onCancel }: { value: string; onApply(value: string): void; onCancel(): void }) {
  const preferences = useSettings();
  const [draft, setDraft] = useState(value);
  return <div className="preview-local-editor" onClick={(event) => event.stopPropagation()}>
    <Editor height="150px" language="latex" value={draft} onChange={(next) => setDraft(next ?? "")} theme={preferences.get("theme") === "dark" ? "vs-dark" : "vs"} options={{ minimap: { enabled: false }, lineNumbers: "off", folding: false, fontSize: preferences.get("fontSize"), tabSize: preferences.get("tabSize"), wordWrap: preferences.get("wordWrap") ? "on" : "off", lineHeight: 23, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 10 } }} onMount={(editor) => {
      editor.focus();
      editor.addCommand(9 /* Escape */, onCancel);
      editor.addCommand(2048 | 3 /* Ctrl+Enter */, () => onApply(editor.getValue()));
    }}/>
    <div><span>{t("preview.editHint")}</span><button onClick={onCancel}>{t("preview.cancel")}</button><button className="primary" onClick={() => onApply(draft)}>{t("preview.apply")}</button></div>
  </div>;
}

function ContentRenderer({ node, source, editing, beginEdit, applyEdit, cancelEdit }: { node: ContentRegion; source: string; editing: boolean; beginEdit(): void; applyEdit(value: string): void; cancelEdit(): void }) {
  if (editing) return <LocalEditor value={nodeSource(node, source)} onApply={applyEdit} onCancel={cancelEdit}/>;
  return <div className="preview-content-region" data-node-id={node.id} onClick={(event) => { event.stopPropagation(); beginEdit(); }}>{inlineLatex(node.raw)}</div>;
}

function BlockRenderer({ node, source, definitions, selectedId, editingId, select, edit, applyEdit, cancelEdit }: { node: StructuralBlock; source: string; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; select(id: string): void; edit(id: string): void; applyEdit(node: PreviewNode, value: string): void; cancelEdit(): void }) {
  const definition = definitionForId(definitions, node.environmentId);
  const family = definition?.family ?? (node.origin === "virtual" ? "virtual" : "generic");
  const specialized = SpecializedContent({ node, source });
  const editing = editingId === node.id;
  const cssValue = (value: string | undefined, fallback: string) => value ? (value.startsWith("--") ? `var(${value})` : value) : `var(${fallback})`;
  return <section className={`preview-block env-${family} ${selectedId === node.id ? "selected" : ""} ${editing ? "editing" : ""}`} data-environment={node.environmentId} style={{ "--block-accent": cssValue(definition?.style.accentToken, "--env-generic-accent"), "--block-fill": cssValue(definition?.style.fillToken, "--env-generic-fill"), "--block-border": cssValue(definition?.style.borderToken, "--env-border-default"), "--block-selected-border": cssValue(definition?.style.selectedBorderToken, "--env-border-selected"), "--block-label-bg": cssValue(definition?.style.labelBackgroundToken, "--env-generic-label-bg"), "--block-label-text": cssValue(definition?.style.labelTextToken, "--env-generic-label-text") } as CSSProperties}>
    {(definition?.behavior.showHeader ?? true) && <button className="preview-block-header" onClick={(event) => { event.stopPropagation(); select(node.id); }}><span>{environmentLabel(definition, node.environmentId)}</span>{node.title && <strong>{node.title}</strong>}{node.latexLabel && <small>{node.latexLabel}</small>}</button>}
    <div className="preview-block-body" onClick={(event) => {
      if (specialized && (definition?.behavior.inlineEditable ?? true)) { event.stopPropagation(); edit(node.id); }
    }}>
      {editing ? <LocalEditor value={nodeSource(node, source)} onApply={(value) => applyEdit(node, value)} onCancel={cancelEdit}/> : specialized ?? node.children.map((child) => <PreviewNodeRenderer key={child.id} node={child} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} select={select} edit={edit} applyEdit={applyEdit} cancelEdit={cancelEdit}/>) }
    </div>
  </section>;
}

function PreviewNodeRenderer(props: { node: PreviewNode; source: string; definitions: EnvironmentDefinition[]; selectedId?: string | undefined; editingId?: string | undefined; select(id: string): void; edit(id: string): void; applyEdit(node: PreviewNode, value: string): void; cancelEdit(): void }) {
  if (props.node.kind === "block") return <BlockRenderer {...props} node={props.node}/>;
  return <ContentRenderer node={props.node} source={props.source} editing={props.editingId === props.node.id} beginEdit={() => props.edit(props.node.id)} applyEdit={(value) => props.applyEdit(props.node, value)} cancelEdit={props.cancelEdit}/>;
}

export function PreviewPane({ filePath, source, definitions, onSourceChange }: { filePath?: string | undefined; source?: string | undefined; definitions: EnvironmentDefinition[]; onSourceChange(next: string): void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const document = useMemo(() => filePath && source !== undefined ? parsePreview(source, filePath, definitions) : undefined, [filePath, source, definitions]);
  if (!filePath || source === undefined) return <div className="preview-empty"><h2>{t("preview.noSourceTitle")}</h2><p>{t("preview.noSource")}</p></div>;
  if (!filePath.toLocaleLowerCase().endsWith(".tex")) return <div className="preview-empty"><h2>{t("preview.unsupportedFileTitle")}</h2><p>{t("preview.unsupportedFile")}</p></div>;
  const applyEdit = (node: PreviewNode, replacement: string) => {
    onSourceChange(source.slice(0, node.source.startOffset) + replacement + source.slice(node.source.endOffset));
    setEditingId(undefined);
  };
  return <div className="structured-preview" onClick={() => setSelectedId(undefined)}>
    <article>{document?.nodes.map((node) => <PreviewNodeRenderer key={node.id} node={node} source={source} definitions={definitions} selectedId={selectedId} editingId={editingId} select={(id) => { setSelectedId(id); setEditingId(undefined); }} edit={(id) => { setEditingId(id); setSelectedId(undefined); }} applyEdit={applyEdit} cancelEdit={() => setEditingId(undefined)}/>)}</article>
    {document?.diagnostics.length ? <aside className="preview-diagnostics"><strong>{t("preview.recovered")}</strong>{document.diagnostics.map((message, index) => <p key={index}>{message}</p>)}</aside> : null}
  </div>;
}
