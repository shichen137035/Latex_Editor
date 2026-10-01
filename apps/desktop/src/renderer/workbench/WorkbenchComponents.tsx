import { useState, type MouseEvent } from "react";
import type { Diagnostic, ProjectTreeNode, SyncTexPdfPosition } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { settings } from "../settings/service.js";
import type { SpellContextRequest } from "../spellcheck/SpellCheckController.js";
import { PdfViewer } from "../pdf/PdfViewer.js";

export type FileContext = { x: number; y: number; path?: string; kind?: ProjectTreeNode["kind"] };
export type WorkbenchMenuItem = { label: string; disabled?: boolean; action?: () => void; divider?: boolean };

export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    files: "M4 5h6l2 2h8v12H4z", search: "M10.5 17a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Zm5-1.5L21 21", library: "M5 5h14v14H5zM8 9h8M8 12h8M8 15h5",
    ai: "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Zm6 11 .9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14Z",
    settings: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-6v2m0 15v2m9-9h-2m-14 0H3m15.4-6.4L17 7.5M7 17l-1.4 1.4m12.8 0L17 17M7 7.5 5.6 6.1", image: "M4 5h16v14H4zM6 16l4-4 3 3 2-2 3 3M8 9h.01",
    help: "M9.5 9a2.7 2.7 0 1 1 4.3 2.2c-1.1.8-1.8 1.3-1.8 2.8m0 3h.01", home: "M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3z",
    save: "M5 3h12l3 3v15H4V3h1Zm3 0v6h8V3M8 21v-7h8v7", play: "m8 5 11 7-11 7V5Z", panel: "M4 5h16v14H4zM4 14h16",
    chevron: "m8 10 4 4 4-4", close: "m7 7 10 10M17 7 7 17", plus: "M12 5v14M5 12h14", refresh: "M19 7v5h-5M5 17v-5h5M18 12a6 6 0 0 0-10.5-4M6 12a6 6 0 0 0 10.5 4"
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Logo() {
  return <svg className="workbench-logo" viewBox="0 0 100 100" fill="none" aria-hidden="true"><circle cx="50" cy="50" r="41"/><path d="M50 9C67 25 67 75 50 91C33 75 33 25 50 9ZM9 50C25 33 75 33 91 50C75 67 25 67 9 50Z"/><circle cx="50" cy="50" r="8" fill="currentColor"/></svg>;
}

export function Menu({ items, onClose }: { items: WorkbenchMenuItem[]; onClose(): void }) {
  return <div className="menu-popover">{items.map((item, index) => item.divider ? <div className="menu-divider" key={index}/> : <button key={`${item.label}-${index}`} disabled={item.disabled} title={item.disabled ? t("common.unavailable") : undefined} onMouseDown={(event) => event.preventDefault()} onClick={() => { item.action?.(); onClose(); }}>{item.label}{item.disabled && <span>—</span>}</button>)}</div>;
}

export function ContextMenu({ context, items, onClose }: { context: Pick<FileContext, "x" | "y">; items: WorkbenchMenuItem[]; onClose(): void }) {
  return <div className="context-menu" style={{ left: context.x, top: context.y }}><Menu items={items} onClose={onClose}/></div>;
}

export function spellLanguageLabel(language: string): string {
  const labels: Record<string, string> = { "en-US": "English (US)", "en-GB": "English (UK)", "ja-JP": "日本語", "de-DE": "Deutsch", "fr-FR": "Français", "es-ES": "Español", "zh-CN": "中文", "ko-KR": "한국어", "ru-RU": "Русский" };
  return labels[language] ?? language.toUpperCase();
}

export function SpellContextMenu({ request, onClose }: { request: SpellContextRequest; onClose(): void }) {
  return <div className="spell-context-menu" style={{ left: request.x, top: request.y }} onMouseDown={(event) => event.stopPropagation()}>
    {request.suggestions.length ? request.suggestions.slice(0, 6).map((suggestion) => <button key={suggestion} onClick={() => { request.replace(suggestion); onClose(); }}>{suggestion}</button>) : <span className="spell-context-empty">{t("spell.noSuggestions")}</span>}
    <div className="menu-divider" />
    <button onClick={() => { request.ignore(); onClose(); }}>{t("spell.ignore")}</button>
    <button onClick={() => { void request.addToDictionary(); onClose(); }}>{t("spell.addToDictionary")}</button>
    <div className="menu-divider" />
    <button disabled={!request.hasSelection} onClick={() => { request.cut(); onClose(); }}>{t("editor.context.cut")}</button>
    <button disabled={!request.hasSelection} onClick={() => { request.copy(); onClose(); }}>{t("editor.context.copy")}</button>
    <button onClick={() => { void request.pastePlain(); onClose(); }}>{t("editor.context.pastePlain")}</button>
    <button disabled={!request.hasSelection} onClick={() => { request.deleteSelection(); onClose(); }}>{t("editor.context.delete")}</button>
  </div>;
}

function isBuildArtifact(node: ProjectTreeNode): boolean {
  if (node.name === ".latex-editor" || node.name === ".texweave") return true;
  return /\.(aux|bbl|blg|fdb_latexmk|fls|log|out|pdf|xdv|synctex\.gz|toc|lof|lot|nav|snm|vrb)$/i.test(node.name);
}

export function Tree({ nodes, activePath, mainFile, filter, hideBuildArtifacts, onOpen, onContextMenu }: { nodes: ProjectTreeNode[]; activePath: string | undefined; mainFile: string | undefined; filter: string; hideBuildArtifacts?: boolean; onOpen(path: string): void; onContextMenu?: (path: string, kind: ProjectTreeNode["kind"], event: MouseEvent) => void }) {
  const shouldHideBuildArtifacts = hideBuildArtifacts ?? settings.get("hideBuildArtifacts");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const renderNodes = (items: ProjectTreeNode[], depth: number) => items.map((node) => {
    if (shouldHideBuildArtifacts && isBuildArtifact(node)) return null;
    const visible = !filter || `${node.name} ${node.relativePath}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()) || node.children?.some((child) => `${child.name} ${child.relativePath}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
    if (!visible) return null;
    const isDirectory = node.kind === "directory";
    const isCollapsed = collapsed.has(node.relativePath);
    return <div key={node.relativePath}><button className={`tree-row ${activePath === node.relativePath ? "active" : ""}`} data-path={node.relativePath} data-kind={node.kind} style={{ paddingLeft: 10 + depth * 16 }} onClick={() => isDirectory ? setCollapsed((value) => { const next = new Set(value); if (next.has(node.relativePath)) next.delete(node.relativePath); else next.add(node.relativePath); return next; }) : onOpen(node.relativePath)}><span className="tree-arrow">{isDirectory ? (isCollapsed ? "›" : "⌄") : ""}</span><span className="tree-kind">{isDirectory ? "▱" : node.name.endsWith(".tex") ? "TₑX" : "◇"}</span><span>{node.name}</span>{node.relativePath === mainFile && <span className="main-file-star">★</span>}</button>{isDirectory && !isCollapsed && node.children && <div>{renderNodes(node.children, depth + 1)}</div>}</div>;
  });
  return <div className="file-tree" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files).map((file) => window.latexEditor?.files.pathForFile(file)).filter((path): path is string => Boolean(path));
    const row = (event.target as HTMLElement).closest<HTMLElement>(".tree-row");
    window.dispatchEvent(new CustomEvent("texweave:file-drop", { detail: { paths, destination: row?.dataset.kind === "directory" ? row.dataset.path ?? "" : "" } }));
  }} onContextMenu={(event) => {
    event.preventDefault();
    const show = (path: string, kind: ProjectTreeNode["kind"]) => {
      if (onContextMenu) onContextMenu(path, kind, event);
      else window.dispatchEvent(new CustomEvent("texweave:file-context", { detail: { path, kind, x: event.clientX, y: event.clientY } }));
    };
    const row = (event.target as HTMLElement).closest<HTMLElement>(".tree-row");
    if (!row) { show("", "directory"); return; }
    show(row.dataset.path ?? "", row.dataset.kind as ProjectTreeNode["kind"]);
  }}>{renderNodes(nodes, 0)}</div>;
}

export function Placeholder({ type, pdfDataUrl, pdfTarget, onPdfDoubleClick, onPdfInteract }: { type: "preview" | "pdf"; pdfDataUrl?: string | undefined; pdfTarget?: SyncTexPdfPosition | undefined; onPdfDoubleClick?(page: number, x: number, y: number): void; onPdfInteract?(): void }) {
  if (type === "pdf" && pdfDataUrl) return <PdfViewer dataUrl={pdfDataUrl} target={pdfTarget} onReverse={(page, x, y) => onPdfDoubleClick?.(page, x, y)} onInteract={() => onPdfInteract?.()}/>;
  return <div className="pane-placeholder"><div className="placeholder-orbit"><Logo /></div><h2>{t(type === "preview" ? "placeholder.previewTitle" : "placeholder.pdfTitle")}</h2><p>{t(type === "preview" ? "placeholder.preview" : "placeholder.pdf")}</p>{type === "preview" && <small>{t("placeholder.previewPlan")}</small>}</div>;
}

export function EntryNameInput({ message, fallback, finish }: { message: string; fallback: string; finish(value?: string): void }) {
  const [value, setValue] = useState(fallback);
  const [error, setError] = useState("");
  return <form className="entry-name-form" onSubmit={(event) => {
    event.preventDefault();
    const name = value.trim();
    if (!name || name === "." || name === ".." || /[<>:"/\\|?*]/.test(name) || /[. ]$/.test(name)) { setError(t("files.invalidName")); return; }
    finish(name);
  }}>
    <label>{message}<input aria-label={message} autoFocus value={value} onFocus={(event) => event.target.select()} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") finish(); }}/></label>
    {error && <small role="alert">{error}</small>}
    <button type="submit">{t("common.save")}</button><button type="button" onClick={() => finish()}>{t("project.cancel")}</button>
  </form>;
}

export function DiagnosticRow({ diagnostic, onOpen }: { diagnostic: Diagnostic; onOpen(): void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const location = diagnostic.file ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ""}` : ""}` : diagnostic.source;
    const text = [location, diagnostic.message, diagnostic.rawExcerpt && diagnostic.rawExcerpt !== diagnostic.message ? diagnostic.rawExcerpt : undefined].filter(Boolean).join("\n");
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("Clipboard API unavailable");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copiedByFallback = document.execCommand("copy");
      textarea.remove();
      if (!copiedByFallback) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  };
  return <div className={`diagnostic-row ${diagnostic.severity}`} role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }}><span>{diagnostic.severity === "error" ? "×" : diagnostic.severity === "warning" ? "△" : "i"}</span><strong>{diagnostic.file ?? diagnostic.source}</strong>{diagnostic.line && <small>:{diagnostic.line}</small>}<p>{diagnostic.message}</p><button className="diagnostic-copy" type="button" onClick={(event) => { event.stopPropagation(); void copy(); }}>{copied ? t("panel.copied") : t("panel.copyDiagnostic")}</button></div>;
}
