import type { EnvironmentDefinition, PreviewNode, StructuralBlock } from "./types.js";
import type { PreviewTextChange } from "./incremental.js";

export type MovePosition = "before" | "after" | "inside";
export interface BlockSourceTransaction {
  source: string;
  changes: PreviewTextChange[];
  affectedBlockIds: string[];
  affectedNodeCount: number;
  description: string;
  selectionRanges?: Array<{ start: number; end: number }>;
}
export interface DisabledSourceBlock { start: number; end: number; source: string }

export class BlockOperationError extends Error {
  constructor(readonly code: "missing-block" | "overlap" | "invalid-target" | "descendant-target" | "unsupported-container" | "line-boundary" | "invalid-disabled-source", message: string) {
    super(message);
    this.name = "BlockOperationError";
  }
}

interface IndexedBlock { node: StructuralBlock; ancestors: string[] }
function indexBlocks(nodes: PreviewNode[]): Map<string, IndexedBlock> {
  const index = new Map<string, IndexedBlock>();
  const visit = (siblings: PreviewNode[], ancestors: string[]) => {
    for (const node of siblings) {
      if (node.kind !== "block") continue;
      index.set(node.id, { node, ancestors });
      visit(node.children, [...ancestors, node.id]);
    }
  };
  visit(nodes, []);
  return index;
}

/** The same root selection is used by every source and UI block operation. */
export function normalizeBlockSelection(nodes: PreviewNode[], blockIds: string[]): StructuralBlock[] {
  const index = indexBlocks(nodes);
  const unique = [...new Set(blockIds)];
  for (const id of unique) if (!index.has(id)) throw new BlockOperationError("missing-block", `Block ${id} is no longer available.`);
  const selected = new Set(unique);
  const roots = unique.filter((id) => !index.get(id)!.ancestors.some((ancestor) => selected.has(ancestor))).map((id) => index.get(id)!.node)
    .sort((a, b) => a.source.startOffset - b.source.startOffset || b.source.endOffset - a.source.endOffset);
  for (let i = 1; i < roots.length; i++) {
    if (roots[i]!.source.startOffset < roots[i - 1]!.source.endOffset) throw new BlockOperationError("overlap", "Selected block source ranges overlap.");
  }
  return roots;
}

function transaction(before: string, after: string, blocks: StructuralBlock[], description: string, selectionRanges?: Array<{ start: number; end: number }>): BlockSourceTransaction | undefined {
  if (before === after) return undefined;
  let from = 0;
  while (from < before.length && from < after.length && before[from] === after[from]) from++;
  let suffix = 0;
  while (suffix < before.length - from && suffix < after.length - from && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const countNodes = (block: StructuralBlock): number => 1 + block.children.reduce((count, child) => count + (child.kind === "block" ? countNodes(child) : 0), 0);
  return { source: after, changes: [{ from, to: before.length - suffix, insertedText: after.slice(from, after.length - suffix) }], affectedBlockIds: blocks.map((block) => block.id), affectedNodeCount: blocks.reduce((count, block) => count + countNodes(block), 0), description, ...(selectionRanges ? { selectionRanges } : {}) };
}

function removeRanges(source: string, blocks: StructuralBlock[]): string {
  let result = source;
  for (const block of [...blocks].reverse()) result = result.slice(0, block.source.startOffset) + result.slice(block.source.endOffset);
  return result;
}

function insertionText(source: string, at: number, raw: string): string {
  const left = at > 0 && source[at - 1] !== "\n" && source[at - 1] !== "\r" ? "\n" : "";
  const right = at < source.length && source[at] !== "\n" && source[at] !== "\r" ? "\n" : "";
  return left + raw + right;
}

/** A pasted copy must not introduce duplicate LaTeX labels. Internal references follow the renamed labels. */
export function prepareCopiedLabels(source: string, rawLatex: string): string {
  const occupied = new Set([...source.matchAll(/\\label\s*\{([^{}]+)\}/g)].map((match) => match[1]!));
  const replacements = new Map<string, string>();
  for (const match of rawLatex.matchAll(/\\label\s*\{([^{}]+)\}/g)) {
    const label = match[1]!;
    if (replacements.has(label) || !occupied.has(label)) continue;
    let candidate = `${label}-copy`, suffix = 2;
    while (occupied.has(candidate)) candidate = `${label}-copy-${suffix++}`;
    replacements.set(label, candidate);
    occupied.add(candidate);
  }
  return rawLatex.replace(/\\(label|ref|eqref|autoref|cref|Cref|pageref)\s*\{([^{}]+)\}/g, (full, command: string, label: string) => {
    const renamed = replacements.get(label);
    return renamed === undefined ? full : `\\${command}{${renamed}}`;
  });
}

function insertionOffset(target: StructuralBlock, position: MovePosition, definitions: EnvironmentDefinition[]): number {
  if (position !== "inside") return position === "before" ? target.source.startOffset : target.source.endOffset;
  const definition = definitions.find((item) => item.id === target.environmentId);
  if (target.environmentId === "texweave-disabled" || target.semanticKind === "content" || definition?.behavior.allowChildren === false) {
    throw new BlockOperationError("unsupported-container", "This block cannot contain other blocks.");
  }
  return target.body.endOffset;
}

/** Plans reordering and reparenting as one source edit and one undo step. */
export function planMoveBlocks(source: string, nodes: PreviewNode[], blockIds: string[], targetId: string, position: MovePosition, definitions: EnvironmentDefinition[]): BlockSourceTransaction | undefined {
  const blocks = normalizeBlockSelection(nodes, blockIds);
  if (!blocks.length) return undefined;
  for (const block of blocks) disableableLineRange(source, block);
  const target = indexBlocks(nodes).get(targetId)?.node;
  if (!target) throw new BlockOperationError("invalid-target", "The move destination is no longer available.");
  if (position !== "inside") disableableLineRange(source, target);
  const originalOffset = insertionOffset(target, position, definitions);
  for (const block of blocks) {
    if (block.id === targetId) throw new BlockOperationError("invalid-target", "A block cannot be moved onto itself.");
    if (block.source.startOffset <= originalOffset && originalOffset < block.source.endOffset ||
      block.source.startOffset <= target.source.startOffset && target.source.endOffset <= block.source.endOffset) {
      throw new BlockOperationError("descendant-target", "A block cannot be moved into itself or one of its children.");
    }
  }
  const raw = blocks.map((block) => source.slice(block.source.startOffset, block.source.endOffset)).join("\n");
  const without = removeRanges(source, blocks);
  const shiftedOffset = originalOffset - blocks.reduce((removed, block) => removed + (block.source.endOffset <= originalOffset ? block.source.endOffset - block.source.startOffset : 0), 0);
  const insertion = insertionText(without, shiftedOffset, raw);
  const start = shiftedOffset + insertion.indexOf(raw);
  return transaction(source, without.slice(0, shiftedOffset) + insertion + without.slice(shiftedOffset), blocks, `Move ${blocks.length} block${blocks.length === 1 ? "" : "s"}`, [{ start, end: start + raw.length }]);
}

export function planDeleteBlocks(source: string, nodes: PreviewNode[], blockIds: string[]): BlockSourceTransaction | undefined {
  const blocks = normalizeBlockSelection(nodes, blockIds);
  return transaction(source, removeRanges(source, blocks), blocks, `Delete ${blocks.length} block${blocks.length === 1 ? "" : "s"}`);
}

export function blockSourceForCopy(source: string, nodes: PreviewNode[], blockIds: string[]): { blocks: StructuralBlock[]; rawLatex: string } {
  const blocks = normalizeBlockSelection(nodes, blockIds);
  return { blocks, rawLatex: blocks.map((block) => source.slice(block.source.startOffset, block.source.endOffset)).join("\n\n") };
}

export function planPasteBlocks(source: string, nodes: PreviewNode[], targetId: string, position: MovePosition, rawLatex: string, definitions: EnvironmentDefinition[]): BlockSourceTransaction | undefined {
  const target = indexBlocks(nodes).get(targetId)?.node;
  if (!target) throw new BlockOperationError("invalid-target", "The paste destination is no longer available.");
  const at = insertionOffset(target, position, definitions);
  if (at < 0 || at > source.length) throw new BlockOperationError("invalid-target", "The paste destination is outside the source file.");
  const raw = prepareCopiedLabels(source, rawLatex);
  const insertion = insertionText(source, at, raw);
  const start = at + insertion.indexOf(raw);
  return transaction(source, source.slice(0, at) + insertion + source.slice(at), [target], "Paste blocks", [{ start, end: start + raw.length }]);
}

/** Only complete physical lines may be commented out; inline commands stay untouched. */
export function disableableLineRange(source: string, block: StructuralBlock): { start: number; end: number } {
  const start = source.lastIndexOf("\n", block.source.startOffset - 1) + 1;
  const endOffset = block.source.endOffset;
  const atLineStart = endOffset === 0 || source[endOffset - 1] === "\n";
  const lineEnd = atLineStart ? endOffset : source.indexOf("\n", endOffset);
  const end = atLineStart ? endOffset : lineEnd < 0 ? source.length : lineEnd + 1;
  const trailingEnd = atLineStart ? endOffset : lineEnd < 0 ? source.length : lineEnd;
  if (start > block.source.startOffset || source.slice(start, block.source.startOffset).trim() || source.slice(endOffset, trailingEnd).trim()) {
    throw new BlockOperationError("line-boundary", "This block shares a source line with other content and cannot be disabled safely.");
  }
  return { start, end };
}

const DISABLE_OPEN = "%<texweave:disable>";
const DISABLE_CLOSE = "%</texweave:disable>";
const NO_FINAL_NEWLINE = "%TW:NO_FINAL_NEWLINE";

export function encodeDisabledSource(source: string): string {
  const lines = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) ?? [];
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const hasFinalNewline = /\r?\n$/.test(source);
  const commented = lines.map((line) => `%TW% ${line}`).join("");
  return `${DISABLE_OPEN}${newline}${commented}${hasFinalNewline ? "" : newline + NO_FINAL_NEWLINE + newline}${DISABLE_CLOSE}${hasFinalNewline ? newline : ""}`;
}

export function decodeDisabledSource(source: string): string {
  const normalized = source.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== DISABLE_OPEN || !lines.includes(DISABLE_CLOSE)) throw new BlockOperationError("invalid-disabled-source", "The disabled block markers are damaged.");
  const closeIndex = lines.indexOf(DISABLE_CLOSE);
  if (closeIndex !== lines.length - 1 && !(closeIndex === lines.length - 2 && lines.at(-1) === "")) throw new BlockOperationError("invalid-disabled-source", "The disabled block markers are damaged.");
  const content = lines.slice(1, closeIndex);
  const withoutFinalNewline = content.at(-1) === NO_FINAL_NEWLINE;
  if (withoutFinalNewline) content.pop();
  if (content.some((line) => !line.startsWith("%TW% "))) throw new BlockOperationError("invalid-disabled-source", "A disabled source line was changed outside the editor.");
  const restored = content.map((line) => line.slice(5)).join("\n") + (withoutFinalNewline ? "" : "\n");
  return source.includes("\r\n") ? restored.replace(/\n/g, "\r\n") : restored;
}

export function planDisableBlocks(source: string, nodes: PreviewNode[], blockIds: string[]): BlockSourceTransaction | undefined {
  const blocks = normalizeBlockSelection(nodes, blockIds);
  const ranges = blocks.map((block) => {
    if (block.environmentId === "texweave-disabled") throw new BlockOperationError("invalid-target", "This block is already disabled.");
    return disableableLineRange(source, block);
  });
  for (let i = 1; i < ranges.length; i++) if (ranges[i]!.start < ranges[i - 1]!.end) throw new BlockOperationError("overlap", "Selected block source lines overlap.");
  const encoded = ranges.map((range) => encodeDisabledSource(source.slice(range.start, range.end)));
  let next = source;
  for (let i = ranges.length - 1; i >= 0; i--) { const range = ranges[i]!; next = next.slice(0, range.start) + encoded[i]! + next.slice(range.end); }
  let shift = 0;
  const selectionRanges = ranges.map((range, index) => {
    const start = range.start + shift;
    const end = start + encoded[index]!.length;
    shift += encoded[index]!.length - (range.end - range.start);
    return { start, end };
  });
  return transaction(source, next, blocks, `Disable ${blocks.length} block${blocks.length === 1 ? "" : "s"}`, selectionRanges);
}

export function planEnableBlocks(source: string, nodes: PreviewNode[], blockIds: string[]): BlockSourceTransaction | undefined {
  const blocks = normalizeBlockSelection(nodes, blockIds);
  if (blocks.some((block) => block.environmentId !== "texweave-disabled")) throw new BlockOperationError("invalid-target", "Only disabled blocks can be enabled.");
  const restored = blocks.map((block) => decodeDisabledSource(source.slice(block.source.startOffset, block.source.endOffset)));
  let next = source;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!;
    const { startOffset: start, endOffset: end } = block.source;
    next = next.slice(0, start) + restored[i]! + next.slice(end);
  }
  let shift = 0;
  const selectionRanges = blocks.map((block, index) => {
    const start = block.source.startOffset + shift;
    const end = start + restored[index]!.length;
    shift += restored[index]!.length - (block.source.endOffset - block.source.startOffset);
    return { start, end };
  });
  return transaction(source, next, blocks, `Enable ${blocks.length} block${blocks.length === 1 ? "" : "s"}`, selectionRanges);
}

/** Rebind a source-changing operation's selection to blocks in the new parse. */
export function blocksInSelectionRanges(nodes: PreviewNode[], ranges: Array<{ start: number; end: number }>): StructuralBlock[] {
  const matches: string[] = [];
  const visit = (children: PreviewNode[]) => {
    for (const node of children) {
      if (node.kind !== "block") continue;
      if (ranges.some(({ start, end }) => start <= node.source.startOffset && node.source.startOffset < end)) matches.push(node.id);
      visit(node.children);
    }
  };
  visit(nodes);
  return normalizeBlockSelection(nodes, matches);
}
