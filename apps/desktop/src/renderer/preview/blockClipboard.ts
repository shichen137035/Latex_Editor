import { t } from "../i18n/index.js";
import type { BlockGraphSnapshot } from "@latex-editor/contracts";
import type { PreviewNode, StructuralBlock } from "./types.js";

const BLOCK_MIME = "application/x-texweave-block";

export interface SerializedBlock {
  id: string;
  environmentId: string;
  rawLatex: string;
  children: SerializedBlock[];
}
export interface BlockClipboardPayload {
  version: 1;
  sourceProjectId: string;
  sourceFile: string;
  blocks: SerializedBlock[];
  rawLatex: string;
  relations: Array<{ sourceId: string; targetId: string }>;
  assets: string[];
}

let currentPayload: BlockClipboardPayload | undefined;

function serialize(block: StructuralBlock, source: string): SerializedBlock {
  return {
    id: block.id,
    environmentId: block.environmentId,
    rawLatex: source.slice(block.source.startOffset, block.source.endOffset),
    children: block.children.filter((node): node is StructuralBlock => node.kind === "block").map((child) => serialize(child, source))
  };
}

export function createBlockClipboardPayload(projectId: string, filePath: string, source: string, blocks: StructuralBlock[], relation?: { snapshot: BlockGraphSnapshot; transientToBlockId: Record<string, string> }): BlockClipboardPayload {
  const rawLatex = blocks.map((block) => source.slice(block.source.startOffset, block.source.endOffset)).join("\n\n");
  const copiedIds = new Set<string>();
  const collectIds = (nodes: PreviewNode[]) => {
    for (const node of nodes) {
      const semanticId = relation?.transientToBlockId[node.id];
      if (semanticId) copiedIds.add(semanticId);
      if (node.kind === "block") collectIds(node.children);
    }
  };
  collectIds(blocks);
  return {
    version: 1,
    sourceProjectId: projectId,
    sourceFile: filePath,
    blocks: blocks.map((block) => serialize(block, source)),
    rawLatex,
    relations: (relation?.snapshot.relations ?? []).filter((edge) => copiedIds.has(edge.sourceId) && copiedIds.has(edge.targetId)).map((edge) => ({ sourceId: edge.sourceId, targetId: edge.targetId })),
    assets: [...new Set([...rawLatex.matchAll(/\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}/g)].map((match) => match[1]!))]
  };
}

async function writePlainText(value: string): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) throw new Error(t("ui.blockClipboard.clipboard_api_unavailable"));
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error(t("ui.blockClipboard.could_not_copy_selected_latex_blocks"));
  }
}

export async function writeBlockClipboard(payload: BlockClipboardPayload): Promise<void> {
  currentPayload = undefined;
  if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([payload.rawLatex], { type: "text/plain" }),
        [BLOCK_MIME]: new Blob([JSON.stringify(payload)], { type: BLOCK_MIME })
      })]);
      currentPayload = payload;
      return;
    } catch { /* Some clipboard implementations do not accept custom MIME types. */ }
  }
  await writePlainText(payload.rawLatex);
  currentPayload = payload;
}

function validPayload(value: unknown): value is BlockClipboardPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<BlockClipboardPayload>;
  return payload.version === 1 && typeof payload.sourceProjectId === "string" && typeof payload.sourceFile === "string"
    && typeof payload.rawLatex === "string" && Array.isArray(payload.blocks);
}

export async function readBlockClipboard(): Promise<BlockClipboardPayload | undefined> {
  if (navigator.clipboard?.read) {
    try {
      for (const item of await navigator.clipboard.read()) {
        if (!item.types.includes(BLOCK_MIME)) continue;
        const parsed: unknown = JSON.parse(await (await item.getType(BLOCK_MIME)).text());
        if (validPayload(parsed)) return parsed;
      }
    } catch { /* Fall through to the verified in-session copy. */ }
  }
  if (!currentPayload) return undefined;
  try {
    if (await navigator.clipboard.readText() === currentPayload.rawLatex) return currentPayload;
  } catch { /* Clipboard read may be denied after the original user gesture. */ }
  currentPayload = undefined;
  return undefined;
}

export function clearBlockClipboard(): void { currentPayload = undefined; }
