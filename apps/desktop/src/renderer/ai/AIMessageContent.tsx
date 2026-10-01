import type { ReactNode } from "react";
import { t } from "../i18n/index.js";

type Props = {
  content: string;
  projectRoot: string;
  onOpenFile?(path: string, line?: number): void;
};

type Block =
  | { kind: "paragraph" | "quote"; text: string }
  | { kind: "heading"; text: string; level: number }
  | { kind: "list"; items: string[]; ordered: boolean }
  | { kind: "code"; text: string; language: string };

const FILE_EXTENSION = "(?:tex|bib|sty|cls|txt|md|cfg|def|ltx|ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|yml|yaml|toml|xml|svg)";
const INLINE_TOKEN = new RegExp(
  `(\\[[^\\]]+\\]\\\\?\\([^)]+\\)|\u0060[^\u0060\\n]+\u0060|\\*\\*[^*\\n]+\\*\\*|__[^_\\n]+__|\\*[^*\\n]+\\*|_[^_\\n]+_|(?:[A-Za-z]:[\\\\/]|/[A-Za-z]:/)[^\\r\\n<>|"\u0060]*?\\.${FILE_EXTENSION}(?::\\d+(?::\\d+)?)?|(?:\\.texweave[\\\\/]|(?:[\\w.-]+[\\\\/])+)[^\\r\\n<>|"\u0060]*?\\.${FILE_EXTENSION}(?::\\d+(?::\\d+)?)?)`,
  "g"
);

export function AIMessageContent({ content, projectRoot, onOpenFile }: Props) {
  const blocks = parseBlocks(content);
  return <div className="ai-rich-message">
    {blocks.map((block, index) => {
      if (block.kind === "heading") {
        const Tag = `h${Math.min(4, block.level + 1)}` as "h2" | "h3" | "h4";
        return <Tag key={index}>{renderInline(block.text, projectRoot, onOpenFile)}</Tag>;
      }
      if (block.kind === "code") return <pre className="ai-code-block" key={index}><code>{block.text}</code>{block.language && <span className="ai-code-language">{block.language}</span>}</pre>;
      if (block.kind === "list") {
        const List = block.ordered ? "ol" : "ul";
        return <List key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, projectRoot, onOpenFile)}</li>)}</List>;
      }
      if (block.kind === "quote") return <blockquote key={index}>{renderInline(block.text, projectRoot, onOpenFile)}</blockquote>;
      return <p key={index}>{renderInline(block.text, projectRoot, onOpenFile)}</p>;
    })}
  </div>;
}

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let quote: string[] = [];
  let code: string[] | undefined;
  let codeLanguage = "";
  const flushParagraph = () => { if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") }); paragraph = []; };
  const flushList = () => { if (listItems.length) blocks.push({ kind: "list", items: listItems, ordered: listOrdered }); listItems = []; };
  const flushQuote = () => { if (quote.length) blocks.push({ kind: "quote", text: quote.join(" ") }); quote = []; };

  for (const line of lines) {
    const fence = /^\s*```([^`]*)\s*$/.exec(line);
    if (code) {
      if (fence) { blocks.push({ kind: "code", text: code.join("\n"), language: codeLanguage }); code = undefined; codeLanguage = ""; }
      else code.push(line);
      continue;
    }
    if (fence) { flushParagraph(); flushList(); flushQuote(); code = []; codeLanguage = fence[1]?.trim() ?? ""; continue; }
    if (!line.trim()) { flushParagraph(); flushList(); flushQuote(); continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); flushQuote(); blocks.push({ kind: "heading", level: heading[1]!.length, text: heading[2]! }); continue; }
    const list = /^\s*(?:([-+*])\s+|(\d+)[.)]\s+)(.*)$/.exec(line);
    if (list) {
      flushParagraph(); flushQuote();
      const ordered = Boolean(list[2]);
      if (listItems.length && ordered !== listOrdered) flushList();
      listOrdered = ordered;
      listItems.push(list[3] ?? "");
      continue;
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1] ?? ""); continue; }
    flushList(); flushQuote(); paragraph.push(line);
  }
  if (code) blocks.push({ kind: "code", text: code.join("\n"), language: codeLanguage });
  flushParagraph(); flushList(); flushQuote();
  return blocks;
}

function renderInline(text: string, projectRoot: string, onOpenFile?: Props["onOpenFile"]): ReactNode[] {
  const result: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  INLINE_TOKEN.lastIndex = 0;
  while ((match = INLINE_TOKEN.exec(text))) {
    if (match.index > cursor) result.push(text.slice(cursor, match.index));
    const token = match[0];
    const markdownLink = /^\[([^\]]+)\]\\?\((.+)\)$/.exec(token);
    if (markdownLink) {
      const label = markdownLink[1] ?? "";
      const href = (markdownLink[2] ?? "").replace(/\\([()])/g, "$1").trim().replace(/^<|>$/g, "");
      const reference = fileReference(href, projectRoot);
      if (reference) result.push(<FileReference key={match.index} reference={reference} onOpenFile={onOpenFile}/>);
      else if (/^https?:\/\//i.test(href)) result.push(<a key={match.index} href={href} target="_blank" rel="noreferrer">{label}</a>);
      else result.push(label);
    } else if (token.startsWith("`")) {
      const code = token.slice(1, -1);
      const reference = fileReference(code, projectRoot);
      result.push(reference ? <FileReference key={match.index} reference={reference} onOpenFile={onOpenFile}/> : <code className="ai-inline-code" key={match.index}>{code}</code>);
    } else if (token.startsWith("**") || token.startsWith("__")) result.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*") || token.startsWith("_")) result.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    else {
      const reference = fileReference(token, projectRoot);
      result.push(reference ? <FileReference key={match.index} reference={reference} onOpenFile={onOpenFile}/> : token);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) result.push(text.slice(cursor));
  return result;
}

type FileReferenceData = { original: string; display: string; relativePath?: string; line?: number };

function fileReference(value: string, projectRoot: string): FileReferenceData | undefined {
  let decoded = value.trim().replace(/[.,!?;]+$/, "");
  try { decoded = decodeURIComponent(decoded); } catch { /* Keep literal percent signs in valid local paths. */ }
  if (/^(?:https?|mailto):/i.test(decoded)) return undefined;
  const lineMatch = /[:#](\d+)(?::\d+)?$/.exec(decoded);
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  const rawPath = lineMatch ? decoded.slice(0, lineMatch.index) : decoded;
  const normalized = rawPath.replaceAll("\\", "/").replace(/^\/(\w:\/)/, "$1").replace(/^\.\//, "");
  const root = projectRoot.replaceAll("\\", "/").replace(/\/$/, "");
  let relativePath: string | undefined;
  if (root && normalized.toLocaleLowerCase().startsWith(`${root.toLocaleLowerCase()}/`)) {
    relativePath = normalized.slice(root.length + 1);
  } else {
    const scratch = /(?:^|\/)ai\/workspaces\/[^/]+\/(.+)$/i.exec(normalized);
    if (scratch) relativePath = scratch[1];
    else if (!/^[a-z]:\//i.test(normalized) && !normalized.startsWith("/")) relativePath = normalized;
  }
  if (relativePath) {
    relativePath = relativePath.replace(/^\.\//, "");
    if (relativePath.split("/").some((part) => part === ".." || part === "")) relativePath = undefined;
    else if (!new RegExp(`\\.${FILE_EXTENSION}$`, "i").test(relativePath)) relativePath = undefined;
  }
  if (!relativePath && !/^[a-z]:\//i.test(normalized) && !normalized.startsWith("/")) return undefined;
  const pathForDisplay = relativePath ?? normalized;
  const segments = pathForDisplay.split("/").filter(Boolean);
  const display = segments.length > 2 ? `…/${segments.slice(-2).join("/")}` : pathForDisplay;
  return { original: value, display, ...(relativePath ? { relativePath } : {}), ...(line ? { line } : {}) };
}

function FileReference({ reference, onOpenFile }: { reference: FileReferenceData; onOpenFile?: Props["onOpenFile"] }) {
  const title = `${reference.original}${reference.line ? `:${reference.line}` : ""}`;
  const open = () => {
    if (!reference.relativePath) return;
    if (onOpenFile) onOpenFile(reference.relativePath, reference.line);
    else window.dispatchEvent(new CustomEvent("texweave:ai-open-file", { detail: { path: reference.relativePath, line: reference.line } }));
  };
  const copy = () => { void navigator.clipboard?.writeText(title).catch(() => undefined); };
  return <span className="ai-file-reference" title={title}>
    <button className="ai-file-reference-open" type="button" disabled={!reference.relativePath} onClick={open}>
      <span aria-hidden="true">▤</span><span>{reference.display}</span>{reference.line && <small>L{reference.line}</small>}
    </button>
    <button className="ai-file-reference-copy" type="button" title={t("ai.copyPath")} aria-label={t("ai.copyPath")} onClick={copy}>⧉</button>
  </span>;
}
