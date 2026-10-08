import type { BlockCapabilities, BlockGraphSnapshot, BlockKind, BlockOrigin, DependencyEdge, SemanticBlock } from "./block-graph.js";
import type { BlockRelation } from "./relations.js";

/** UTF-16, half-open offsets. Line/column coordinates are one-based. */
export interface SourceRange {
  start: number; end: number;
  startLine: number; startColumn: number; endLine: number; endColumn: number;
}
export interface BlockSource { fileId: string; range: SourceRange; bodyRange?: SourceRange }
/** Identifies the text represented by a source index, independently of block revision. */
export type DocumentTextVersion = { kind: "saved"; fingerprint: string } | { kind: "working"; fingerprint: string; sessionId: string; revision: number };
export interface WorkingDocumentInput {
  sessionId: string;
  revision: number;
  files: { fileId: string; content: string; savedContent: string;
    rangeChanges?: { beforeContent: string; transactions: { from: number; to: number; insertedText: string }[][] } }[];
}
export interface WorkingDocumentResult {
  revision: number;
  snapshot: BlockGraphSnapshot;
  semanticIds: Record<string, Record<string, string>>;
}
export interface BlockSemanticMetadata {
  summary?: { text: string; source: "ai" | "user"; blockRevision: number };
  tags?: { user: string[]; ai: string[]; blockRevision: number };
}
/** Persistent index only: document text remains in the corresponding source file. */
export interface DocumentBlock {
  id: string; type: string; kind: BlockKind; origin: BlockOrigin;
  state: "active" | "orphaned" | "conflicted";
  title?: string; label?: string;
  numbering?: { display?: string; ordinal?: number };
  parentId: string | null; childIds: string[];
  source: BlockSource; revision: number; placeholder?: boolean;
  semantic?: BlockSemanticMetadata;
  identity?: { parserFingerprint?: string; contentFingerprint?: string };
  capabilityOverrides?: Partial<BlockCapabilities>;
  /** Compatibility metadata for existing user blocks and logical relations. */
  metadata?: Record<string, unknown>;
}
export interface DocumentStructure {
  schemaVersion: 2; structureRevision: number;
  configurationFingerprint?: string;
  numberingFingerprint?: string;
  /** Compatibility writes mark derived ranges/numbering for an on-demand refresh. */
  indexDirty?: boolean;
  files: Record<string, { path: string; version: number; fingerprint?: string; textVersion?: DocumentTextVersion }>;
  roots: string[]; blocks: Record<string, DocumentBlock>;
  /** Existing logical dependencies are preserved, never inferred by this API. */
  dependencies?: DependencyEdge[];
  relations?: BlockRelation[];
  relationSchemaVersion?: 1;
  /** Legacy relation nodes without a source binding are retained during migration. */
  unboundBlocks?: SemanticBlock[];
}
export interface BlockCard {
  id: string; type: string; kind: BlockKind; number?: string; ordinal?: number;
  title?: string; label?: string; summary?: string; tags?: string[];
  childCount: number; placeholder?: boolean; semanticStale?: boolean;
}
export interface BlockDetail extends BlockCard {
  origin: BlockOrigin; revision: number;
  parent: BlockCard | null; children: BlockCard[];
  location: { fileId: string; startLine: number; endLine: number };
  textVersion?: DocumentTextVersion | undefined;
  capabilities: BlockCapabilities;
}
export interface ListBlocksInput {
  parentId?: string | null; fileId?: string; kind?: BlockKind; types?: string[];
  origin?: BlockOrigin; recursive?: boolean; limit?: number;
}
export interface FindBlocksInput {
  query?: string; type?: string | string[]; kind?: BlockKind; label?: string;
  number?: string; ordinal?: number; tags?: string[]; parentId?: string | null;
  fileId?: string; limit?: number;
}
export interface ReplaceBlockContentInput { blockId: string; expectedRevision: number; content: string }
export interface InsertBlockInput {
  parentId: string | null;
  position: "start" | "end" | { before: string } | { after: string };
  fileId?: string; expectedRevision?: number;
  block: { type: string; content?: string; title?: string };
}
export interface DeleteBlockInput { blockId: string; expectedRevision: number }
export interface SetBlockSemanticInput {
  blockId: string; expectedRevision: number;
  summary?: { text: string; source: "ai" | "user" };
  tags?: { user?: string[]; ai?: string[] };
}
export interface BlockApiWarning { code: string; message: string; blockId?: string }
export type BlockApiResult<T> =
  | { ok: true; data: T; warnings: BlockApiWarning[] }
  | { ok: false; error: { code: string; message: string; expectedRevision?: number; currentRevision?: number } };
export interface BlockSourceResult { blockId: string; revision: number; content: string; textVersion?: DocumentTextVersion | undefined }
/** Shared by IPC and AI providers; no provider-specific document model. */
export interface DocumentBlockApi {
  list_blocks(input?: ListBlocksInput): Promise<BlockApiResult<BlockCard[]>>;
  find_blocks(input?: FindBlocksInput): Promise<BlockApiResult<BlockCard[]>>;
  get_block(input: { blockId: string }): Promise<BlockApiResult<BlockDetail>>;
  get_blocks(input: { blockIds: string[] }): Promise<BlockApiResult<BlockDetail[]>>;
  get_block_source(input: { blockId: string }): Promise<BlockApiResult<BlockSourceResult>>;
  replace_block_content(input: ReplaceBlockContentInput): Promise<BlockApiResult<BlockDetail>>;
  insert_block(input: InsertBlockInput): Promise<BlockApiResult<BlockDetail>>;
  delete_block(input: DeleteBlockInput): Promise<BlockApiResult<{ deletedIds: string[] }>>;
  set_block_semantic(input: SetBlockSemanticInput): Promise<BlockApiResult<BlockDetail>>;
}
