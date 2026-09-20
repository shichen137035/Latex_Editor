import type { CommandMetadata, ProjectTreeNode } from "@latex-editor/contracts";
import type { Monaco } from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";
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
  return mode === "environment" && line[column - 1] === "}" ? column + 1 : column;
}

/** Bridges Monaco's suggestion UI with the project-aware fallback index. */
export class CompletionController {
  private readonly index = new ProjectIndex();
  private readonly disposable: IDisposable;
  private readonly options: CompletionControllerOptions;
  private builtInCommands: Promise<CommandMetadata[]>;
  private documents = new Map<string, string>();
  private signature = "";
  private loading: Promise<void> | undefined;

  constructor(options: CompletionControllerOptions) {
    this.options = options;
    this.builtInCommands = options.api.resources.searchCommands("").catch(() => []);
    this.disposable = options.monaco.languages.registerCompletionItemProvider("latex", {
      triggerCharacters: ["\\", "{", ",", "/"],
      provideCompletionItems: async (model, position) => {
        const currentPath = this.options.getCurrentPath() ?? "main.tex";
        const semanticContext = analyzeCompletionContext(model, position);
        // Semantic LaTeX contexts always win. Only otherwise choose one of the
        // mutually exclusive prose-word and mathematical-symbol domains.
        const context = semanticContext.mode !== "unknown" || !/\.tex$/i.test(currentPath)
          ? semanticContext
          : analyzeLexicalCompletionContext(model, position, this.options.isDocumentWordCompletionEnabled());
        if (context.mode === "unknown") return { suggestions: [] };
        await this.ensureDocuments();
        const currentDocument: IndexedDocument = { path: currentPath, content: model.getValue() };
        const documents = [...this.documents.entries()].filter(([path]) => path !== currentPath).map(([path, content]) => ({ path, content }));
        this.index.rebuild(this.options.getTree(), [...documents, currentDocument], this.options.getEnvironments(), await this.builtInCommands);
        const line = model.getLineContent(position.lineNumber);
        const range = { startLineNumber: position.lineNumber, startColumn: context.startColumn, endLineNumber: position.lineNumber, endColumn: completionEndColumn(context.mode, line, position.column) };
        return {
          suggestions: this.index.complete(context, currentPath).map((entry) => ({
            label: entry.label,
            kind: entry.kind === "command" ? options.monaco.languages.CompletionItemKind.Function : entry.kind === "environment" ? options.monaco.languages.CompletionItemKind.Struct : entry.kind === "reference" ? options.monaco.languages.CompletionItemKind.Reference : entry.kind === "file" ? options.monaco.languages.CompletionItemKind.File : entry.kind === "word" ? options.monaco.languages.CompletionItemKind.Text : entry.kind === "math-symbol" ? options.monaco.languages.CompletionItemKind.Variable : options.monaco.languages.CompletionItemKind.Value,
            detail: entry.detail,
            insertText: entry.insertText,
            filterText: entry.filterText,
            sortText: `${entry.sourceRank}-${entry.label}`,
            range,
            ...(entry.snippet ? { insertTextRules: options.monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet } : {}),
            ...(entry.label === "\\begin" ? { command: { id: "editor.action.triggerSuggest", title: "Suggest environments" } } : {})
          }))
        };
      }
    });
  }

  invalidate(): void {
    this.signature = "";
  }

  dispose(): void {
    this.disposable.dispose();
  }

  private async ensureDocuments(): Promise<void> {
    const tree = this.options.getTree();
    const signature = treeSignature(tree);
    if (signature === this.signature && !this.loading) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const paths = flattenTextFiles(tree);
      const entries = await Promise.all(paths.map(async (path) => {
        try { return [path, (await this.options.api.files.read(this.options.projectId, path)).content] as const; }
        catch { return undefined; }
      }));
      this.documents = new Map(entries.filter((entry): entry is readonly [string, string] => Boolean(entry)));
      this.signature = signature;
    })().finally(() => { this.loading = undefined; });
    return this.loading;
  }
}
