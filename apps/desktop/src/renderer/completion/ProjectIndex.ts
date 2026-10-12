import type { CommandMetadata, ProjectTreeNode } from "@latex-editor/contracts";
import { parseMathNodes } from "../math/MathNodeLocator.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import type { CompletionContext } from "./context.js";
import { parseBibtex } from "@latex-editor/editor-core/bibtex";
import { maskLatexComments } from "@latex-editor/editor-core/latex-source";
import { ProjectReferenceIndex } from "../editor/ProjectReferenceIndex.js";

export interface IndexedDocument {
  path: string;
  content: string;
}

type CompletionKind = "command" | "environment" | "reference" | "text" | "file" | "word" | "math-symbol";

export interface CompletionEntry {
  label: string;
  insertText: string;
  detail: string;
  kind: CompletionKind;
  filterText: string;
  snippet?: boolean;
  sourceRank: number;
}

interface IndexedFile {
  path: string;
  name: string;
}

interface IndexedLabel {
  key: string;
  detail: string;
}

interface IndexedCitation {
  key: string;
  detail: string;
}

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".eps", ".pdf"]);
const documentWordPattern = /[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu;
const mathSymbolPattern = /[\p{L}][\p{L}\p{N}_]*/gu;
const mathTextCommandPattern = /\\(?:text|textnormal|textrm|textit|textbf|mathrm|operatorname|mbox)\s*\{[^{}]*\}/g;

function flattenTree(nodes: ProjectTreeNode[], result: IndexedFile[] = []): IndexedFile[] {
  for (const node of nodes) {
    if (node.kind === "file") result.push({ path: node.relativePath, name: node.name });
    if (node.children) flattenTree(node.children, result);
  }
  return result;
}

function extension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot).toLocaleLowerCase() : "";
}

function lineNumber(content: string, offset: number): number {
  return content.slice(0, offset).split("\n").length;
}

function cleanField(value: string | undefined): string {
  return (value ?? "").replace(/[{}]/g, "").replace(/\s+/g, " ").trim();
}

function relativePath(fromFile: string, targetFile: string): string {
  const from = fromFile.split("/").slice(0, -1).filter(Boolean);
  const target = targetFile.split("/").filter(Boolean);
  let shared = 0;
  while (shared < from.length && shared < target.length && from[shared] === target[shared]) shared += 1;
  const prefix = Array.from({ length: from.length - shared }, () => "..");
  const result = [...prefix, ...target.slice(shared)].join("/");
  return result || target.at(-1) || targetFile;
}

function fuzzyScore(candidate: string, query: string): number {
  const value = candidate.toLocaleLowerCase();
  const normalized = query.toLocaleLowerCase();
  if (!normalized) return 0;
  if (value === normalized) return 1000;
  if (value.startsWith(normalized)) return 800 - (value.length - normalized.length);
  let cursor = 0;
  let gaps = 0;
  for (const character of normalized) {
    const found = value.indexOf(character, cursor);
    if (found < 0) return -1;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 500 - gaps - (value.length - normalized.length);
}

function addPreferred(map: Map<string, CompletionEntry>, entry: CompletionEntry): void {
  const current = map.get(entry.label);
  if (!current || entry.sourceRank < current.sourceRank) map.set(entry.label, entry);
}

/**
 * Lightweight project semantics for completion. It deliberately recognizes
 * only declarations TeXWeave needs now, leaving full TeX parsing to TexLab or
 * a future provider.
 */
export class ProjectIndex {
  private references = new ProjectReferenceIndex();
  private files: IndexedFile[] = [];
  private commands: CompletionEntry[] = [];
  private environments: CompletionEntry[] = [];
  private labels: IndexedLabel[] = [];
  private citations: IndexedCitation[] = [];
  private words: CompletionEntry[] = [];
  private mathSymbols: CompletionEntry[] = [];

  rebuild(tree: ProjectTreeNode[], documents: IndexedDocument[], definitions: EnvironmentDefinition[], builtInCommands: CommandMetadata[]): void {
    this.references.update(documents);
    this.files = flattenTree(tree);
    const commandEntries = new Map<string, CompletionEntry>();
    for (const command of builtInCommands) {
      const insertText = command.insertText.startsWith("\\") ? command.insertText.slice(1) : command.insertText;
      addPreferred(commandEntries, { label: `\\${command.name}`, insertText, detail: command.detail, kind: "command", filterText: command.name, snippet: insertText.includes("$") || insertText.includes("\\t"), sourceRank: 2 });
    }

    const environmentEntries = new Map<string, CompletionEntry>();
    for (const definition of definitions) {
      if (definition.match.kind !== "latex-environment") continue;
      const name = definition.match.name;
      addPreferred(environmentEntries, { label: name, insertText: `${name}}\n\t$0\n\\end{${name}}`, detail: "TeXWeave environment", kind: "environment", filterText: name, snippet: true, sourceRank: 2 });
    }

    const labels: IndexedLabel[] = [];
    const citations: IndexedCitation[] = [];
    const wordEntries = new Map<string, CompletionEntry>();
    const mathSymbolEntries = new Map<string, CompletionEntry>();
    for (const document of documents) {
      const path = document.path;
      const content = extension(path) === ".bib" ? document.content : maskLatexComments(document.content);
      if (extension(path) === ".tex") {
        const mathNodes = parseMathNodes(content);
        let mathNodeIndex = 0;
        for (const match of content.matchAll(documentWordPattern)) {
          const word = match[0];
          const offset = match.index ?? 0;
          while ((mathNodes[mathNodeIndex]?.end ?? Number.MAX_SAFE_INTEGER) < offset) mathNodeIndex += 1;
          const mathNode = mathNodes[mathNodeIndex];
          if (mathNode && mathNode.start <= offset && offset < mathNode.end) continue;
          if (word.length < 2 || content[offset - 1] === "\\") continue;
          const key = word.toLocaleLowerCase();
          if (!wordEntries.has(key)) wordEntries.set(key, { label: word, insertText: word, detail: `Document word · ${path}`, kind: "word", filterText: word, sourceRank: 3 });
        }
        for (const mathNode of mathNodes) {
          const body = content.slice(mathNode.contentStart, mathNode.contentEnd);
          // Prose embedded with \text{...} is neither a formula symbol nor a
          // document-word source, so keep it out of both completion indexes.
          const symbolicBody = body.replace(mathTextCommandPattern, (value) => " ".repeat(value.length));
          for (const match of symbolicBody.matchAll(mathSymbolPattern)) {
            const symbol = match[0];
            const localOffset = match.index ?? 0;
            if (symbolicBody[localOffset - 1] === "\\") continue;
            if (!mathSymbolEntries.has(symbol)) mathSymbolEntries.set(symbol, { label: symbol, insertText: symbol, detail: `Math symbol · ${path}`, kind: "math-symbol", filterText: symbol, sourceRank: 3 });
          }
        }
      }
      const commandPattern = /\\(?:newcommand|renewcommand|providecommand)\s*(?:\[[^\]]*\]\s*)?(?:\{\\([A-Za-z@]+)\}|\\([A-Za-z@]+))/g;
      for (const match of content.matchAll(commandPattern)) {
        const name = match[1] ?? match[2];
        if (!name) continue;
        addPreferred(commandEntries, { label: `\\${name}`, insertText: name, detail: `Project command · ${path}`, kind: "command", filterText: name, sourceRank: 0 });
      }
      const environmentPattern = /\\newenvironment\s*\{([A-Za-z@*]+)\}/g;
      for (const match of content.matchAll(environmentPattern)) {
        const name = match[1];
        if (!name) continue;
        addPreferred(environmentEntries, { label: name, insertText: `${name}}\n\t$0\n\\end{${name}}`, detail: `Project environment · ${path}`, kind: "environment", filterText: name, snippet: true, sourceRank: 0 });
      }
      const theoremPattern = /\\newtheorem\s*(?:\[[^\]]+\]\s*)?\{([A-Za-z@*]+)\}/g;
      for (const match of content.matchAll(theoremPattern)) {
        const name = match[1];
        if (!name) continue;
        addPreferred(environmentEntries, { label: name, insertText: `${name}}\n\t$0\n\\end{${name}}`, detail: `Theorem environment · ${path}`, kind: "environment", filterText: name, snippet: true, sourceRank: 0 });
      }
      const labelPattern = /(?<!\\)\\label\s*\{([^{}\n]+)\}/g;
      for (const match of content.matchAll(labelPattern)) {
        const key = match[1]?.trim();
        if (key) labels.push({ key, detail: `${path}:${lineNumber(content, match.index ?? 0)}` });
      }
      if (extension(path) === ".bib") {
        for (const entry of parseBibtex(content).entries) {
          const author = cleanField(entry.fields.author ?? entry.fields.editor);
          const year = cleanField(entry.fields.year ?? entry.fields.date);
          const title = cleanField(entry.fields.title);
          citations.push({ key: entry.citationKey, detail: [author, year, title, path].filter(Boolean).join(" · ") });
        }
      }
    }
    this.commands = [...commandEntries.values()];
    this.environments = [...environmentEntries.values()];
    this.labels = [...new Map(labels.map(item => [item.key, item])).values()];
    this.citations = [...new Map(citations.map(item => [item.key, item])).values()];
    this.words = [...wordEntries.values()];
    this.mathSymbols = [...mathSymbolEntries.values()];
  }

  complete(context: CompletionContext, currentPath: string): CompletionEntry[] {
    if (context.mode === "unknown") return [];
    if (context.mode === "command") return this.filterEntries(this.commands, context.prefix);
    if (context.mode === "environment") return this.filterEntries(this.environments, context.prefix);
    if (context.mode === "reference") {
      const labels = new Map(this.labels.map(item => [item.key, item]));
      for (const [key, targets] of this.references.visible(currentPath)) if (targets.length === 1) {
        const target = targets[0]!;
        labels.set(key, { key, detail: target.path });
      }
      return this.filterEntries([...labels.values()].map(item => ({ label: item.key, insertText: item.key, detail: item.detail, kind: "reference" as const, filterText: item.key, sourceRank: 0 })), context.prefix);
    }
    if (context.mode === "citation") return this.filterEntries(this.citations.map((item) => ({ label: item.key, insertText: item.key, detail: item.detail, kind: "text" as const, filterText: item.key, sourceRank: 0 })), context.prefix);
    if (context.mode === "document-word") return this.filterEntries(this.words, context.prefix);
    if (context.mode === "math-symbol") return this.filterEntries(this.mathSymbols, context.prefix);

    const wanted = context.mode === "image-file" ? imageExtensions : context.mode === "bib-file" ? new Set([".bib"]) : new Set([".tex"]);
    const entries = this.files.filter((file) => wanted.has(extension(file.path))).map((file) => {
      const relative = context.mode === "image-file" && !context.prefix.startsWith("../") ? file.path : relativePath(currentPath, file.path);
      const insertText = context.mode === "tex-file" ? relative.replace(/\.tex$/i, "") : relative;
      return { label: insertText, insertText, detail: `Project file · ${file.path}`, kind: "file" as const, filterText: insertText, sourceRank: 0 };
    });
    return this.filterEntries(entries, context.prefix);
  }

  private filterEntries(entries: CompletionEntry[], query: string): CompletionEntry[] {
    return entries.map((entry) => ({ entry, score: fuzzyScore(entry.filterText, query) })).filter((item) => item.score >= 0).sort((left, right) => right.entry.sourceRank === left.entry.sourceRank ? (right.score - left.score || left.entry.label.localeCompare(right.entry.label)) : left.entry.sourceRank - right.entry.sourceRank).map((item) => item.entry);
  }
}
