import { randomUUID } from "node:crypto";
import { lineDiffRanges, textLines as splitLines } from "@latex-editor/contracts/line-diff";

/** Build compact, independently reviewable line hunks from a workspace diff. */
export function makeHunks(path: string, oldText: string, newText: string) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const ranges = lineDiffRanges(oldLines, newLines);
  if (!ranges.length) return [];
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.oldStart - previous.oldEnd <= 4 && range.newStart - previous.newEnd <= 4) {
      previous.oldEnd = range.oldEnd; previous.newEnd = range.newEnd;
    } else merged.push({ ...range });
  }
  return merged.map((range) => {
    const oldStart = Math.max(0, range.oldStart - 2); const newStart = Math.max(0, range.newStart - 2);
    const oldEnd = Math.min(oldLines.length, range.oldEnd + 2); const newEnd = Math.min(newLines.length, range.newEnd + 2);
    const original = oldLines.slice(oldStart, oldEnd).join(""); const proposed = newLines.slice(newStart, newEnd).join("");
    return { id: `${path}:${randomUUID()}`, oldStart, oldLines: oldEnd - oldStart, newStart, newLines: newEnd - newStart, oldText: original, newText: proposed, decision: "pending" as const };
  });
}
