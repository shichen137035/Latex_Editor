import { randomUUID } from "node:crypto";

function splitLines(value: string): string[] {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function makeWholeFileHunk(path: string, oldText: string, newText: string) {
  return { id: `${path}:${randomUUID()}`, oldStart: 0, oldLines: splitLines(oldText).length, newStart: 0, newLines: splitLines(newText).length, oldText, newText, decision: "pending" as const };
}

/** Build compact, independently reviewable line hunks from a workspace diff. */
export function makeHunks(path: string, oldText: string, newText: string) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const columns = newLines.length + 1;
  if (oldLines.length * newLines.length > 1_000_000) return [makeWholeFileHunk(path, oldText, newText)];
  const lcs = new Uint32Array((oldLines.length + 1) * columns);
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      const index = i * columns + j;
      lcs[index] = oldLines[i] === newLines[j] ? 1 + lcs[(i + 1) * columns + j + 1]! : Math.max(lcs[(i + 1) * columns + j]!, lcs[index + 1]!);
    }
  }
  const ranges: Array<{ oldStart: number; oldEnd: number; newStart: number; newEnd: number }> = [];
  let i = 0; let j = 0; let current: { oldStart: number; oldEnd: number; newStart: number; newEnd: number } | undefined;
  const flush = () => { if (current) ranges.push(current); current = undefined; };
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) { flush(); i += 1; j += 1; continue; }
    current ??= { oldStart: i, oldEnd: i, newStart: j, newEnd: j };
    const insert = j < newLines.length && (i >= oldLines.length || lcs[i * columns + j + 1]! > lcs[(i + 1) * columns + j]!);
    if (insert) { j += 1; current.newEnd = j; } else { i += 1; current.oldEnd = i; }
  }
  flush();
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
