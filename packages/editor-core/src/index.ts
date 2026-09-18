import {
  AppError, type CommandMetadata, type EnvironmentMetadata, type FileWriteResult, type LatexReference,
  type OpenDocument, type TextChange, type TextFileContent
} from "@latex-editor/contracts";
import { isoNow, type Clock } from "@latex-editor/domain";

export * from "./block-graph.js";

export interface DocumentFilePort {
  readText(projectId: string, relativePath: string): Promise<TextFileContent>;
  writeText(projectId: string, relativePath: string, content: string): Promise<FileWriteResult>;
}

export interface ApplyTextChangesInput {
  projectId: string;
  relativePath: string;
  expectedRevision: number;
  changes: TextChange[];
}

export interface SaveDocumentResult {
  document: OpenDocument;
  conflictOverridden: boolean;
}

function documentKey(projectId: string, relativePath: string): string {
  return `${projectId}\0${relativePath.replaceAll("\\", "/")}`;
}

function cloneDocument(document: OpenDocument): OpenDocument {
  return { ...document };
}

function offsetAt(content: string, line: number, column: number): number {
  if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
    throw new AppError("INVALID_RELATIVE_PATH", "Text positions are 1-based positive integers");
  }
  const lines = content.split("\n");
  if (line > lines.length || column > (lines[line - 1]?.length ?? 0) + 1) {
    throw new AppError("REVISION_CONFLICT", "Text change range is outside the current document");
  }
  let offset = 0;
  for (let index = 0; index < line - 1; index += 1) offset += (lines[index]?.length ?? 0) + 1;
  return offset + column - 1;
}

function applyChange(content: string, change: TextChange): string {
  if (change.range === undefined) return change.text;
  const start = offsetAt(content, change.range.start.line, change.range.start.column);
  const end = offsetAt(content, change.range.end.line, change.range.end.column);
  if (end < start) throw new AppError("REVISION_CONFLICT", "Text change range end precedes its start");
  return `${content.slice(0, start)}${change.text}${content.slice(end)}`;
}

/** 无 UI 的文档状态机；Monaco 只需把变更转换成此处的 contract。 */
export class DocumentService {
  readonly #files: DocumentFilePort;
  readonly #clock: Clock;
  readonly #documents = new Map<string, OpenDocument>();

  constructor(files: DocumentFilePort, clock: Clock) {
    this.#files = files;
    this.#clock = clock;
  }

  async open(input: { projectId: string; relativePath: string }): Promise<OpenDocument> {
    const key = documentKey(input.projectId, input.relativePath);
    const existing = this.#documents.get(key);
    if (existing !== undefined) return cloneDocument(existing);
    const file = await this.#files.readText(input.projectId, input.relativePath);
    const document: OpenDocument = {
      projectId: input.projectId,
      relativePath: file.relativePath,
      encoding: "utf8",
      content: file.content,
      revision: 1,
      diskHash: file.hash,
      status: "clean",
      openedAt: isoNow(this.#clock)
    };
    this.#documents.set(key, document);
    return cloneDocument(document);
  }

  async applyChanges(input: ApplyTextChangesInput): Promise<OpenDocument> {
    const document = this.#requireOpen(input.projectId, input.relativePath);
    if (document.revision !== input.expectedRevision) {
      throw new AppError("REVISION_CONFLICT", `Expected revision ${input.expectedRevision}, current revision is ${document.revision}`);
    }
    let content = document.content;
    for (const change of input.changes) content = applyChange(content, change);
    document.content = content;
    document.revision += 1;
    document.status = "dirty";
    return cloneDocument(document);
  }

  async save(input: { projectId: string; relativePath: string; force?: boolean }): Promise<SaveDocumentResult> {
    const document = this.#requireOpen(input.projectId, input.relativePath);
    let diskHash: string | undefined;
    try {
      diskHash = (await this.#files.readText(input.projectId, input.relativePath)).hash;
    } catch (error: unknown) {
      if (!(error instanceof AppError) || error.code !== "FILE_NOT_FOUND") throw error;
      document.status = "deletedOnDisk";
    }
    // 比较打开时的 hash，而不是只看 dirty 状态，覆盖“外部程序先改后保存”的竞态。
    const conflicted = diskHash !== document.diskHash;
    if (conflicted && input.force !== true) {
      document.status = diskHash === undefined ? "deletedOnDisk" : "externallyModified";
      throw new AppError("EXTERNAL_MODIFICATION_CONFLICT", `File changed on disk: ${document.relativePath}`, {
        details: { expectedHash: document.diskHash, actualHash: diskHash ?? null }
      });
    }
    const result = await this.#files.writeText(document.projectId, document.relativePath, document.content);
    document.diskHash = result.hash;
    document.status = "clean";
    document.lastSavedAt = isoNow(this.#clock);
    return { document: cloneDocument(document), conflictOverridden: conflicted };
  }

  async reload(input: { projectId: string; relativePath: string }): Promise<OpenDocument> {
    const document = this.#requireOpen(input.projectId, input.relativePath);
    const file = await this.#files.readText(input.projectId, input.relativePath);
    document.content = file.content;
    document.diskHash = file.hash;
    document.revision += 1;
    document.status = "clean";
    return cloneDocument(document);
  }

  async close(input: { projectId: string; relativePath: string; discardChanges?: boolean }): Promise<void> {
    const key = documentKey(input.projectId, input.relativePath);
    const document = this.#requireOpen(input.projectId, input.relativePath);
    if (document.status === "dirty" && input.discardChanges !== true) {
      throw new AppError("UNSAVED_CHANGES", `Document has unsaved changes: ${document.relativePath}`);
    }
    this.#documents.delete(key);
  }

  async listOpen(projectId: string): Promise<OpenDocument[]> {
    return [...this.#documents.values()].filter((document) => document.projectId === projectId).map(cloneDocument);
  }

  #requireOpen(projectId: string, relativePath: string): OpenDocument {
    const document = this.#documents.get(documentKey(projectId, relativePath));
    if (document === undefined) throw new AppError("FILE_NOT_FOUND", `Document is not open: ${relativePath}`);
    return document;
  }
}

export interface EditorResourcePort {
  searchCommands(query: string): CommandMetadata[];
  searchEnvironments(query: string): EnvironmentMetadata[];
}

/** 将资源 catalog 转成编辑器无关的补全/符号结果。 */
export class EditorIntelligenceService {
  readonly #resources: EditorResourcePort;

  constructor(resources: EditorResourcePort) {
    this.#resources = resources;
  }

  getCompletions(query: string): Array<
    | { kind: "command"; id: string; label: string; insertText: string; detail: string }
    | { kind: "environment"; id: string; label: string; insertText: string; detail: string }
  > {
    const commands = this.#resources.searchCommands(query).map((item) => ({
      kind: "command" as const, id: item.id, label: item.name, insertText: item.insertText, detail: item.detail
    }));
    const environments = this.#resources.searchEnvironments(query).map((item) => ({
      kind: "environment" as const, id: item.id, label: item.name,
      insertText: `${item.begin}\n${item.body}\n${item.end}`, detail: `${item.category} environment`
    }));
    return [...commands, ...environments];
  }

  getDocumentSymbols(text: string): LatexReference[] {
    return scanLatex(text);
  }
}

function stripComment(line: string): string {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] !== "%") continue;
    let slashes = 0;
    for (let previous = index - 1; previous >= 0 && line[previous] === "\\"; previous -= 1) slashes += 1;
    if (slashes % 2 === 0) return line.slice(0, index);
  }
  return line;
}

/** 容错扫描器：只识别 v0.1 需要的引用，不尝试构造完整 TeX AST。 */
export function scanLatex(text: string): LatexReference[] {
  const references: LatexReference[] = [];
  const pattern = /\\(begin|end|label|ref|pageref|cite|input|include)\s*\{([^}]*)\}|\\([A-Za-z@]+|.)/g;
  const lines = text.split(/\r?\n/);
  lines.forEach((rawLine, lineIndex) => {
    const line = stripComment(rawLine);
    for (const match of line.matchAll(pattern)) {
      const command = match[1] ?? match[3] ?? "";
      const value = match[2] ?? command;
      let kind: LatexReference["kind"] = "command";
      if (command === "label") kind = "label";
      else if (command === "ref" || command === "pageref") kind = "ref";
      else if (command === "cite") kind = "cite";
      else if (command === "input") kind = "input";
      else if (command === "include") kind = "include";
      else if (command === "begin" || command === "end") kind = "environment";
      references.push({ kind, value, line: lineIndex + 1, column: (match.index ?? 0) + 1 });
    }
  });
  return references;
}
