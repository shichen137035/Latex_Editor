import { t } from "../i18n/index.js";
import { lineDiffRanges } from "@latex-editor/contracts/line-diff";
import type { AIChangeHunk, AIChangeSet, AIFileChange } from "@latex-editor/contracts";
import { isAIEditableProjectPath } from "@latex-editor/contracts/ai-paths";

export type AIApplyResult = { appliedIds: string[]; staleStructureIds: string[] };

export function isHunkApplied(hunk: AIChangeHunk): boolean {
  return hunk.applied === true || (hunk.applied === undefined && hunk.decision === "accepted");
}

/** Structure metadata always waits for an explicit Keep decision. */
export function automaticHunkIds(changes: AIChangeSet): string[] {
  return changes.files.flatMap((file) => !isAIEditableProjectPath(file.path) ? []
    : file.hunks.filter((hunk) => hunk.decision === "pending" && !isHunkApplied(hunk)).map((hunk) => hunk.id));
}

function lines(content: string): string[] { return content.match(/[^\n]*\n|[^\n]+$/g) ?? []; }

function lineOffset(content: string, line: number): number {
  let offset = 0;
  for (let current = 0; current < line && offset < content.length; current += 1) {
    const newline = content.indexOf("\n", offset);
    if (newline < 0) return content.length;
    offset = newline + 1;
  }
  return offset;
}

/** Apply or undo hunks in a newer buffer only when their context still matches. */
function replaceHunksInCurrent(file: AIFileChange, current: string, selected: AIChangeHunk[], reverse = false): string {
  let result = current;
  for (const hunk of selected.slice().sort((a, b) => (reverse ? b.newStart - a.newStart : b.oldStart - a.oldStart))) {
    const expected = reverse ? hunk.newText : hunk.oldText;
    const replacement = reverse ? hunk.oldText : hunk.newText;
    if (!expected) {
      if (result !== "") throw new Error(`AI_CHANGE_CONFLICT:${file.path}`);
      result = replacement;
      continue;
    }
    const candidates: number[] = [];
    let from = 0;
    while (from <= result.length - expected.length) {
      const found = result.indexOf(expected, from);
      if (found < 0) break;
      candidates.push(found);
      from = found + 1;
    }
    const expectedOffset = lineOffset(result, reverse ? hunk.newStart : hunk.oldStart);
    const ordered = candidates.slice().sort((a, b) => Math.abs(a - expectedOffset) - Math.abs(b - expectedOffset));
    const closest = ordered[0];
    const nextClosest = ordered[1];
    if (closest === undefined || (nextClosest !== undefined && Math.abs(closest - expectedOffset) === Math.abs(nextClosest - expectedOffset))) {
      throw new Error(`AI_CHANGE_CONFLICT:${file.path}`);
    }
    result = result.slice(0, closest) + replacement + result.slice(closest + expected.length);
  }
  return result;
}

/** Reconstruct a proposal subset in original-file coordinates, not shifted newStart positions. */
export function fileWithAppliedHunks(file: AIFileChange, included: (hunk: AIChangeHunk) => boolean = isHunkApplied): string | undefined {
  const selected = file.hunks.filter(included);
  if (file.type === "create") return selected.length ? file.proposedContent ?? selected[0]!.newText : undefined;
  if (file.type === "delete") return selected.length ? undefined : file.originalContent;
  const result = lines(file.originalContent ?? "");
  for (const hunk of selected.slice().sort((a, b) => b.oldStart - a.oldStart)) {
    if (result.slice(hunk.oldStart, hunk.oldStart + hunk.oldLines).join("") !== hunk.oldText) throw new Error(t("ui.changeOperations.invalid_ai_diff_in", { value1: file.path }));
    result.splice(hunk.oldStart, hunk.oldLines, ...lines(hunk.newText));
  }
  return result.join("");
}

/** Preview edits are reversible until explicitly kept. Never overwrite newer user edits. */
export function transitionAIFile(file: AIFileChange, current: string | undefined, ids: Set<string>, apply: boolean): string | undefined {
  if (!apply && file.hunks.some(hunk => ids.has(hunk.id) && hunk.decision === "accepted")) throw new Error(t("ui.changeOperations.accepted_ai_changes_use_the_editor_undo"));
  const before = fileWithAppliedHunks(file);
  const after = fileWithAppliedHunks(file, hunk => hunk.decision !== "rejected" && (ids.has(hunk.id) ? apply : isHunkApplied(hunk)));
  // Retry after a successful edit whose acknowledgement failed is safe. A
  // stale applied flag must never accept an edit the user has since undone.
  if (current === after || (!apply && before === after)) return current;
  if (apply && file.hunks.some(hunk => ids.has(hunk.id) && isHunkApplied(hunk))) throw new Error(`AI_CHANGE_CONFLICT:${file.path}`);
  if (file.type === "modify" && current !== undefined) {
    return replaceHunksInCurrent(file, current, file.hunks.filter(hunk => ids.has(hunk.id)), !apply);
  }
  if (current !== before) throw new Error(`AI_CHANGE_CONFLICT:${file.path}`);
  return after;
}

export function pendingHunkIds(file: AIFileChange): string[] { return file.hunks.filter(hunk => hunk.decision === "pending").map(hunk => hunk.id); }

/** Accepted edits are the comparison baseline; rejected edits never reappear. */
export function reviewFileContents(file: AIFileChange): { original: string; modified: string } {
  try {
    return {
      original: fileWithAppliedHunks(file, hunk => hunk.decision === "accepted") ?? "",
      modified: fileWithAppliedHunks(file, hunk => hunk.decision !== "rejected") ?? ""
    };
  } catch {
    // A stale/malformed saved proposal must not take down the editor renderer.
    return { original: file.originalContent ?? "", modified: file.proposedContent ?? "" };
  }
}

/** Exclude unchanged diff context from the compact + / - counters. */
export function hunkLineStats(hunk: AIChangeHunk): { added: number; removed: number } {
  return lineDiffRanges(lines(hunk.oldText), lines(hunk.newText)).reduce((stats, range) => ({ added: stats.added + range.newEnd - range.newStart, removed: stats.removed + range.oldEnd - range.oldStart }), { added: 0, removed: 0 });
}
