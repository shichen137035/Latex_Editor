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
