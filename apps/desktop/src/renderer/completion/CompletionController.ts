import { t } from "../i18n/index.js";
import type { CommandMetadata, ProjectTreeNode } from "@latex-editor/contracts";
import type { Monaco } from "@monaco-editor/react";
import type { IDisposable, editor } from "monaco-editor";
import type { EnvironmentDefinition } from "../preview/types.js";
import { analyzeCompletionContext, analyzeLexicalCompletionContext, type CompletionContext } from "./context.js";
import { ProjectIndex, type IndexedDocument } from "./ProjectIndex.js";

type EditorApi = NonNullable<Window["latexEditor"]>;

interface CompletionControllerOptions {
  monaco: Monaco;
  api: EditorApi;
  projectId: string;
  getTree(): ProjectTreeNode[];
  getCurrentPath(): string | undefined;
  getModel(): editor.ITextModel | null;
  getOpenDocuments?(): IndexedDocument[];
  getSourceRange?(): { start: number; end: number } | undefined;
  getEnvironments(): EnvironmentDefinition[];
  isDocumentWordCompletionEnabled(): boolean;
}

function flattenTextFiles(nodes: ProjectTreeNode[], result: string[] = []): string[] {
  for (const node of nodes) {
    if (node.kind === "file" && /\.(tex|sty|cls|bib)$/i.test(node.relativePath)) result.push(node.relativePath);
    if (node.children) flattenTextFiles(node.children, result);
  }
  return result;
}

function treeSignature(nodes: ProjectTreeNode[]): string {
  return flattenTextFiles(nodes).sort().join("\u0000");
}

/**
 * Monaco usually inserts a matching closing brace while the cursor is inside
 * an environment start. Environment suggestions already contain that brace,
 * so consume the existing brace in the replacement range.
 */
export function completionEndColumn(mode: CompletionContext["mode"], line: string, column: number): number {
  if (mode === "environment") return line[column - 1] === "}" ? column + 1 : column;
  if (!["citation", "reference", "tex-file", "image-file", "bib-file"].includes(mode)) return column;
  let end = column - 1;
  while (end < line.length && !/[,}\s]/.test(line[end]!)) end++;
  return end + 1;
}

/** Bridges Monaco's suggestion UI with the project-aware fallback index. */
export class CompletionController {
  private readonly index = new ProjectIndex();
  private readonly disposable: IDisposable;
  private readonly options: CompletionControllerOptions;
  private builtInCommands: Promise<CommandMetadata[]>;
  private documents = new Map<string, string>();
  private signature = "";
  private tree: ProjectTreeNode[] | undefined;
  private loading: Promise<void> | undefined;
  private revision = 0;
  private disposed = false;

  constructor(options: CompletionControllerOptions) {
    this.options = options;
    this.builtInCommands = options.api.resources.searchCommands("").catch(() => []);
    this.disposable = options.monaco.languages.registerCompletionItemProvider("latex", {
      triggerCharacters: ["\\", "{", ",", "/"],
      provideCompletionItems: async (model, position, _context, token) => {
        if (this.disposed || model !== options.getModel() || token.isCancellationRequested) return { suggestions: [] };
        const currentPath = this.options.getCurrentPath() ?? "main.tex";
        const version = model.getVersionId();
        const stillCurrent = () => !this.disposed && !token.isCancellationRequested && !model.isDisposed()
          && model === options.getModel() && version === model.getVersionId() && currentPath === (options.getCurrentPath() ?? "main.tex");
        const semanticContext = analyzeCompletionContext(model, position);
        // Semantic LaTeX contexts always win. Only otherwise choose one of the
        // mutually exclusive prose-word and mathematical-symbol domains.
        const context = semanticContext.mode !== "unknown" || !/\.tex$/i.test(currentPath)
          ? semanticContext
          : analyzeLexicalCompletionContext(model, position, this.options.isDocumentWordCompletionEnabled());
        if (context.mode === "unknown") return { suggestions: [] };
        await this.ensureDocuments();
        const builtIns = await this.builtInCommands;
        if (!stillCurrent()) return { suggestions: [] };
        const working = new Map(this.documents);
        for (const document of options.getOpenDocuments?.() ?? []) working.set(document.path, document.content);
        const range = options.getSourceRange?.();
        const original = working.get(currentPath);
        const content = range && original !== undefined
          ? original.slice(0, range.start) + model.getValue() + original.slice(range.end) : model.getValue();
        working.set(currentPath, content);
        const documents = [...working].map(([path, content]) => ({ path, content }));
        this.index.rebuild(this.options.getTree(), documents, this.options.getEnvironments(), builtIns);
        const line = model.getLineContent(position.lineNumber);
        const replacementRange = { startLineNumber: position.lineNumber, startColumn: context.startColumn, endLineNumber: position.lineNumber, endColumn: completionEndColumn(context.mode, line, position.column) };
        return {
          suggestions: this.index.complete(context, currentPath).map((entry) => ({
            label: entry.label,
            kind: entry.kind === "command" ? options.monaco.languages.CompletionItemKind.Function : entry.kind === "environment" ? options.monaco.languages.CompletionItemKind.Struct : entry.kind === "reference" ? options.monaco.languages.CompletionItemKind.Reference : entry.kind === "file" ? options.monaco.languages.CompletionItemKind.File : entry.kind === "word" ? options.monaco.languages.CompletionItemKind.Text : entry.kind === "math-symbol" ? options.monaco.languages.CompletionItemKind.Variable : options.monaco.languages.CompletionItemKind.Value,
            detail: entry.detail,
            insertText: entry.insertText,
            filterText: entry.filterText,
            sortText: `${entry.sourceRank}-${entry.label}`,
            range: replacementRange,
            ...(entry.snippet ? { insertTextRules: options.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet } : {}),
            ...(entry.label === "\\begin" ? { command: { id: "editor.action.triggerSuggest", title: t("ui.CompletionController.suggest_environments") } } : {})
          }))
        };
      }
    });
  }

  invalidate(): void {
    this.revision += 1;
    this.signature = "";
  }

  dispose(): void {
    this.disposed = true;
    this.revision += 1;
    this.documents.clear();
    this.disposable.dispose();
  }

  private async ensureDocuments(): Promise<void> {
    if (this.disposed) return;
    const tree = this.options.getTree();
    const signature = treeSignature(tree);
    if (signature === this.signature && tree === this.tree && !this.loading) return;
    if (this.loading) { await this.loading; return this.ensureDocuments(); }
    const revision = this.revision;
    this.loading = (async () => {
      const paths = flattenTextFiles(tree);
      const entries = await Promise.all(paths.map(async (path) => {
        try { return [path, (await this.options.api.files.read(this.options.projectId, path)).content] as const; }
        catch { return undefined; }
      }));
      if (!this.disposed && revision === this.revision) {
        this.documents = new Map(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
        this.signature = signature;
        this.tree = tree;
      }
    })().finally(() => { this.loading = undefined; });
    await this.loading;
    if (!this.disposed && (revision !== this.revision || signature !== treeSignature(this.options.getTree()))) await this.ensureDocuments();
  }
}
