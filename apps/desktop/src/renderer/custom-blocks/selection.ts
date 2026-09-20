import type { BlockTextRange, SemanticBlock } from "@latex-editor/contracts";

export interface DocumentSelection extends BlockTextRange {
  fileId: string;
  origin: "source" | "preview";
}

export interface BoundaryRepairCandidate {
  kind: "expand" | "trim-before" | "trim-after";
  range: BlockTextRange;
}

export function normalizeDocumentSelection(source: string, selection: DocumentSelection): DocumentSelection | undefined {
  let { start, end } = selection;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
  if (end < start) [start, end] = [end, start];
  start = Math.max(0, Math.min(source.length, start));
  end = Math.max(0, Math.min(source.length, end));
  while (start < end && /\s/.test(source[start] ?? "")) start += 1;
  while (end > start && /\s/.test(source[end - 1] ?? "")) end -= 1;
  return end > start ? { ...selection, start, end } : undefined;
}

function partiallyOverlaps(left: BlockTextRange, right: BlockTextRange): boolean {
  const disjoint = left.end <= right.start || right.end <= left.start;
  const nested = (left.start <= right.start && right.end <= left.end) || (right.start <= left.start && left.end <= right.end);
  return !disjoint && !nested;
}

/**
 * Produces nearby laminar candidates. The backend remains authoritative and
 * revalidates every candidate before creation.
 */
export function boundaryRepairCandidates(selection: BlockTextRange, blocks: SemanticBlock[], fileId: string): BoundaryRepairCandidate[] {
  const ranged = blocks.filter((block) => block.fileId === fileId && block.range && block.state !== "orphaned");
  let expanded = { ...selection };
  let changed = true;
  while (changed) {
    changed = false;
    for (const block of ranged) {
      if (!block.range || !partiallyOverlaps(expanded, block.range)) continue;
      const next = { start: Math.min(expanded.start, block.range.start), end: Math.max(expanded.end, block.range.end) };
      if (next.start !== expanded.start || next.end !== expanded.end) { expanded = next; changed = true; }
    }
  }

  const crossings = ranged.filter((block) => block.range && partiallyOverlaps(selection, block.range));
  const candidates: BoundaryRepairCandidate[] = [];
  if (expanded.start !== selection.start || expanded.end !== selection.end) candidates.push({ kind: "expand", range: expanded });
  const rightBoundaries = crossings.map((block) => block.range!).filter((range) => selection.start < range.start && range.start < selection.end).map((range) => range.start);
  const leftBoundaries = crossings.map((block) => block.range!).filter((range) => selection.start < range.end && range.end < selection.end).map((range) => range.end);
  if (rightBoundaries.length) candidates.push({ kind: "trim-before", range: { start: selection.start, end: Math.min(...rightBoundaries) } });
  if (leftBoundaries.length) candidates.push({ kind: "trim-after", range: { start: Math.max(...leftBoundaries), end: selection.end } });
  return candidates.filter((candidate, index, all) => candidate.range.end > candidate.range.start
    && all.findIndex((other) => other.range.start === candidate.range.start && other.range.end === candidate.range.end) === index);
}

