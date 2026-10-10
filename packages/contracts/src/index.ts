/** 稳定的机器可读错误码；CLI/未来 IPC 不应依赖本地化 message。 */
export * from "./settings.js";
export * from "./theme-colors.js";
export * from "./settings-presets.js";
export * from "./spellcheck.js";
export * from "./block-graph.js";
export * from "./document-structure.js";
export * from "./history.js";
export * from "./relations.js";

export type AIAuthState = "unknown" | "signed_out" | "authenticating" | "signed_in" | "expired" | "error";
export type AICodexProcessState = "not_detected" | "stopped" | "starting" | "running" | "crashed";
/** Safe-to-display AI connection summary. Never contains credentials or raw protocol payloads. */
export interface AIStatus {
  auth: AIAuthState;
  process: AICodexProcessState;
  executablePath?: string | undefined;
  accountLabel?: string | undefined;
  error?: string | undefined;
}
export interface AIProjectSkill {
  name: string;
  content: string;
  source: "built-in" | "custom" | "customized";
  enabled: boolean;
}
export interface AIModelOption {
  id: string; name: string; description?: string; isDefault: boolean;
  supportedReasoningEfforts?: Array<{ effort: string; description?: string }>;
  defaultReasoningEffort?: string;
}
export type AIMode = "chat" | "codex";
export type AIPermissionMode = "ask" | "auto" | "full";
export interface AIApprovalRequest {
  id: string;
  conversationId: string;
  description: string;
  command?: string;
  paths: string[];
  status: "pending" | "approved" | "denied";
}
export type AIMessageRole = "user" | "assistant" | "system" | "tool";
export interface AIAttachment { id: string; name: string; size: number }
/** Provider-returned, displayable reasoning summaries, separate from the answer. */
export interface AIReasoningPart { id: string; text: string; complete: boolean }
export interface AIMessage {
  id: string;
  role: AIMessageRole;
  content: string;
  createdAt: number;
  status?: "streaming" | "complete" | "error";
  activity?: "thinking" | "responding" | "working";
  reasoning?: AIReasoningPart[];
  attachments?: AIAttachment[];
}
export interface AIConversation {
  id: string;
  title: string;
  mode: AIMode;
  createdAt: number;
  updatedAt: number;
  projectId?: string;
  threadId?: string;
  codexToolsVersion?: number;
  copilotSessionId?: string;
  copilotToolsVersion?: number;
  /** Current request, so reopening the chat can reconnect its Stop action. */
  activeTaskId?: string;
  messages: AIMessage[];
}
export interface AIContextSnapshotFile { path: string; content: string }
export interface AIChangeHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  oldText: string;
  newText: string;
  decision: "pending" | "accepted" | "rejected";
  /** Applied in the editor, but not necessarily explicitly kept by the user. */
  applied?: boolean;
}
export interface AIFileChange {
  path: string;
  type: "modify" | "create" | "delete";
  originalContent?: string;
  proposedContent?: string;
  hunks: AIChangeHunk[];
  status: "pending" | "partially_accepted" | "accepted" | "rejected";
}
export interface AIChangeSet {
  id: string;
  conversationId: string;
  createdAt: number;
  files: AIFileChange[];
  status: "pending" | "partially_accepted" | "accepted" | "rejected";
  /** Captured when the turn starts, not inferred from a later settings change. */
  permissionMode?: AIPermissionMode;
  autoApplyError?: string;
}
export interface AIConversationSnapshot { conversations: AIConversation[]; changeSets: AIChangeSet[] }
export const errorCodes = [
  "PROJECT_NOT_FOUND", "PROJECT_PATH_MISSING", "PROJECT_ALREADY_REGISTERED", "PROJECT_NOT_WRITABLE",
  "PATH_OUTSIDE_PROJECT", "INVALID_RELATIVE_PATH", "FILE_NOT_FOUND", "FILE_ALREADY_EXISTS", "INVALID_IMPORT_SOURCE", "INVALID_MOVE_TARGET", "DOCUMENT_VERSION_CONFLICT", "UNSAVED_DOCUMENT",
  "UNSUPPORTED_ENCODING", "EXTERNAL_MODIFICATION_CONFLICT", "UNSAVED_CHANGES", "REVISION_CONFLICT",
  "MAIN_FILE_NOT_SET", "TOOLCHAIN_NOT_FOUND", "COMPILATION_FAILED", "COMPILATION_TIMEOUT",
  "SYNCTEX_DATA_MISSING", "SYNCTEX_DATA_STALE", "SYNCTEX_NO_MATCH",
  "COMPILATION_CANCELLED", "RESOURCE_SCHEMA_INVALID", "RESOURCE_VERSION_UNSUPPORTED", "SNAPSHOT_NOT_FOUND",
  "SNAPSHOT_CORRUPTED", "SNAPSHOT_STORAGE_FULL", "RESTORE_CONFIRMATION_REQUIRED",
  "DELETE_CONFIRMATION_MISMATCH", "UNSAFE_DELETE_TARGET",
  "INVALID_BLOCK_ID", "BLOCK_NOT_FOUND", "BLOCK_ALREADY_EXISTS", "DEPENDENCY_SELF_REFERENCE",
  "BLOCK_RANGE_INVALID", "BLOCK_DELETE_FORBIDDEN", "RELATION_INVALID",
  "STRUCTURAL_CYCLE", "INVALID_GRAPH_QUERY", "GRAPH_SNAPSHOT_INVALID", "INTERNAL_ERROR"
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export interface AppErrorPayload {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  retryable: boolean;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, options?: { details?: Record<string, unknown>; retryable?: boolean; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options?.details;
    this.retryable = options?.retryable ?? false;
  }

  toPayload(): AppErrorPayload {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
      retryable: this.retryable
    };
  }
}

/** SQLite 注册表中的项目索引，不包含项目源文件正文。 */
export interface Project {
  id: string;
  name: string;
  canonicalPath: string;
  createdAt: string;
  registeredAt: string;
  lastOpenedAt?: string;
  lastEditedAt?: string;
  mainFile?: string;
  writable: boolean;
  missing: boolean;
  /** Computed for the project-directory response; not persisted in the registry. */
  mainFileMissing?: boolean;
  settings: Record<string, unknown>;
}

export interface ProjectTreeNode {
  name: string;
  relativePath: string;
  kind: "file" | "directory" | "symlink";
  children?: ProjectTreeNode[];
}

export interface ProjectPdfDocument {
  /** TeX path for compiled documents; PDF path for standalone PDF resources. */
  id: string;
  pdfFile: string;
  syncFile?: string;
  sourceFile?: string;
  /** Root source and its static input/include files. */
  sourceFiles: string[];
  available: boolean;
}

export type ImagePreviewError = "FILE_NOT_FOUND" | "UNSUPPORTED_FORMAT" | "FAILED_TO_DECODE" | "PDF_RENDER_FAILED" | "PERMISSION_DENIED" | "PATH_OUTSIDE_PROJECT";
export interface ImportedImage { sourcePath: string; relativePath: string; renamed: boolean; kind: "file" | "directory" }
export interface ResolvedGraphic {
  requestedPath: string;
  resolvedPath?: string;
  exists: boolean;
  format?: "png" | "jpg" | "jpeg" | "webp" | "svg" | "pdf";
  resolutionSource?: "direct" | "graphicspath" | "extension-search";
  dataUrl?: string;
  modifiedAt?: string;
  size?: number;
  error?: ImagePreviewError;
}

export interface TextFileContent {
  projectId: string;
  relativePath: string;
  content: string;
  encoding: "utf8";
  hash: string;
  modifiedAt: string;
}

export interface FileWriteResult {
  projectId: string;
  relativePath: string;
  hash: string;
  modifiedAt: string;
}

/** 编辑缓冲区相对于磁盘文件的状态。 */
export type DocumentStatus = "clean" | "dirty" | "externallyModified" | "deletedOnDisk";

export interface OpenDocument {
  projectId: string;
  relativePath: string;
  encoding: "utf8";
  content: string;
  revision: number;
  diskHash: string;
  status: DocumentStatus;
  openedAt: string;
  lastSavedAt?: string;
}

export interface TextPosition { line: number; column: number }
export interface TextRange { start: TextPosition; end: TextPosition }
export interface TextChange { text: string; range?: TextRange }

export interface LatexReference {
  kind: "label" | "ref" | "cite" | "input" | "include" | "command" | "environment";
  value: string;
  line: number;
  column: number;
}

/** 编译器和编辑器共用的诊断格式，file 始终使用项目相对路径。 */
export interface Diagnostic {
  severity: "fatal" | "error" | "warning" | "notice" | "info";
  source: "latex" | "latexmk" | "bibtex" | "biber" | "system" | "engine" | "package" | "class" | "filesystem" | "external";
  category?: "syntax" | "command" | "environment" | "package" | "file" | "reference" | "citation" | "bibliography" | "font" | "layout" | "encoding" | "engine" | "build" | "external";
  code?: string;
  message: string;
  occurrences?: number;
  file?: string;
  line?: number;
  column?: number;
  endLine?: number;
  rawExcerpt?: string;
}

export interface CompileInput { projectId: string; mainFile?: string; mode?: "pdf"; timeoutMs?: number; engine?: "pdflatex" | "xelatex" | "lualatex" }

/** 一次 latexmk 运行的可序列化结果；完整日志通过 logPath 追踪。 */
export interface CompileResult {
  compilationId: string;
  status: "succeeded" | "failed" | "cancelled" | "timedOut";
  exitCode: number | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  mainFile: string;
  pdfPath?: string;
  /** Immutable PDF from this successful run, so a later build cannot overwrite its preview. */
  pdfArtifactPath?: string;
  logPath?: string;
  diagnostics: Diagnostic[];
  /** Project-relative files read by the TeX engine, recorded from its .fls file when available. */
  recorderInputs?: string[];
  stdoutTail: string;
  stderrTail: string;
}

export type PdfExportResult =
  | { status: "cancelled" }
  | { status: "failed"; compilation: CompileResult }
  | { status: "exported"; path: string; compilation: CompileResult; pdfDataUrl: string };

/** Coordinates returned by SyncTeX use PDF points measured from the page's top-left. */
export interface SyncTexPdfPosition { page: number; x: number; y: number; }
export interface SyncTexSourcePosition { file: string; line: number; column: number }

export interface ToolchainStatus { available: boolean; executable: string; version?: string; error?: string }

export interface CommandMetadata { id: string; name: string; insertText: string; detail: string; category: string }
export interface EnvironmentMetadata { id: string; name: string; begin: string; body: string; end: string; category: string }
export type ResourceFileKind = "style" | "class" | "bibliography-style" | "bibliography" | "tex" | "other";

/** A reusable, local-first LaTeX resource. Files are copied into projects as snapshots. */
export interface StyleResourceFile {
  sourcePath: string;
  targetPath: string;
  kind: ResourceFileKind;
  /** Present only when the resource is read by the project bootstrapper. */
  content?: string;
}

export interface StyleResource {
  id: string;
  name: string;
  description?: string;
  version: number;
  source: "built-in" | "user" | "online";
  files: StyleResourceFile[];
  mainStyle?: { kind: "package"; name: string };
}

/** A CSS theme discovered from the built-in or user theme directory. */
export interface ThemeDefinition {
  id: string;
  name: string;
  source: "built-in" | "user";
  /** CSS is returned for user themes so the renderer can apply it without file access. */
  css?: string;
  filePath?: string;
}

export interface ProjectTemplate { id: string; name: string; files: Array<{ relativePath: string; content: string }> }

export interface ReferenceLibraryEntry {
  id: string;
  citationKey: string;
  entryType: string;
  fields: Record<string, string>;
  favorite: boolean;
  rawBibtex?: string;
  sourceFile?: string;
  tags: string[];
  collections: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface ReferenceCollection { id: string; name: string; parentId?: string; }
export interface ReferenceTag { id: string; name: string; color?: string; }
export interface ProjectReferenceLink {
  projectId: string;
  libraryEntryId: string;
  citationKeyInProject: string;
  mode: "link" | "copy" | "local";
  targetBibPath?: string;
  lastSnapshot?: string;
}
export interface ReferenceLibrarySnapshot {
  entries: ReferenceLibraryEntry[];
  collections: ReferenceCollection[];
  tags: ReferenceTag[];
  projectLinks: ProjectReferenceLink[];
}
export interface ReferenceImportResult {
  entries: ReferenceLibraryEntry[];
  invalid: Array<{ raw: string; message: string; start?: number; end?: number }>;
  duplicates: string[];
}
/** 来自 resources 的编译器配置，arguments 由 catalog 做 allowlist 校验。 */
export interface CompilerProfile { id: string; executable: string; arguments: string[]; timeoutMs: number }

export * from "./installation.js";
export type { DesktopApi, DesktopInvokeApi } from "./desktop-ipc.cjs";
