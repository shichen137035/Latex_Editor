import { inferBlockKind, type ParsedBlockDescriptor, type ReconcileParsedBlocksInput } from "@latex-editor/contracts";
import type { PreviewDocument, PreviewNode } from "./types.js";

function normalizedSource(value: string): string {
  return value
    .replace(/(^|[^\\])%[^\r\n]*/g, "$1")
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Small deterministic hash; fingerprints are matching hints, not security IDs. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function explicitBinding(value: string): string | undefined {
  const match = /^\s*%\s*tw:block-(?:id|begin)\b[^\r\n]*?\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))/im.exec(value);
  const id = match?.[1] ?? match?.[2] ?? match?.[3];
  return id?.trim() || undefined;
}

function flatten(nodes: PreviewNode[], source: string, output: ParsedBlockDescriptor[], parentTransientId?: string): void {
  for (const node of nodes) {
    if (node.source.endOffset <= node.source.startOffset) {
      if (node.kind === "block") flatten(node.children, source, output, parentTransientId);
      continue;
    }
    const raw = source.slice(node.source.startOffset, node.source.endOffset);
    const role = node.kind === "block" ? node.environmentId : node.contentType;
    const origin = node.kind === "block" && node.origin === "latex" ? "environment" : "virtual";
    const bindingId = explicitBinding(raw);
    output.push({
      transientId: node.id,
      ...(parentTransientId === undefined ? {} : { parentTransientId }),
      origin,
      role,
      kind: node.kind === "block" ? node.semanticKind ?? inferBlockKind(role) : inferBlockKind(role),
      fileId: node.source.filePath,
      range: { start: node.source.startOffset, end: node.source.endOffset },
      source: {
        relativePath: node.source.filePath,
        startLine: node.source.startLine,
        startColumn: node.source.startColumn,
        endLine: node.source.endLine,
        endColumn: node.source.endColumn
      },
      fingerprint: fingerprint(`${origin}\0${role}\0${normalizedSource(raw)}`),
      ...(bindingId === undefined ? {} : { bindingId }),
      ...(node.kind !== "block" || node.latexLabel === undefined ? {} : { label: node.latexLabel }),
      ...(node.kind !== "block" || node.title === undefined ? {} : { name: node.title })
    });
    if (node.kind === "block") flatten(node.children, source, output, node.id);
  }
}

/** Converts the renderer parse tree into an IPC-safe reconciliation request. */
export function previewBlocksForReconciliation(document: PreviewDocument, source: string): ReconcileParsedBlocksInput {
  const blocks: ParsedBlockDescriptor[] = [];
  flatten(document.nodes, source, blocks);
  return { fileId: document.filePath, blocks };
}
