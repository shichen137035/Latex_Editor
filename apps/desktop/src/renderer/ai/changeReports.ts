import type { AIChangeSet, AIFileChange } from "@latex-editor/contracts";
import { lineDiffRanges } from "@latex-editor/contracts/line-diff";
import { fileWithAppliedHunks } from "./changeOperations.js";

export interface AIChangeReport extends AIChangeSet {
  members: AIChangeSet[];
  fileStats: Record<string, { added: number; removed: number }>;
}

const reportCache = new WeakMap<AIChangeSet, AIChangeReport>();

/** Display checkpoints together while keeping their application/undo coordinates intact. */
export function groupChangeReports(changes: AIChangeSet[]): AIChangeReport[] {
  const groups = new Map<string, AIChangeSet[]>();
  for (const changeset of changes.slice().sort((a, b) => a.createdAt - b.createdAt)) {
    if (!changeset.files.some(file => file.hunks.some(hunk => hunk.decision === "pending"))) continue;
    const key = changeset.messageId ? `report:${changeset.conversationId}:${changeset.messageId}` : changeset.id;
    const members = groups.get(key) ?? [];
    members.push(changeset);
    groups.set(key, members);
  }
  return [...groups].map(([id, members]) => {
    const cached = reportCache.get(members[0]!);
    if (cached && cached.id === id && cached.members.length === members.length && cached.members.every((member, index) => member === members[index])) return cached;
    const fileSteps = new Map<string, AIFileChange[]>();
    for (const member of members) for (const file of member.files) {
      if (!file.hunks.some(hunk => hunk.decision === "pending")) continue;
      const steps = fileSteps.get(file.path) ?? [];
      steps.push(file);
      fileSteps.set(file.path, steps);
    }
    const files: AIFileChange[] = [];
    for (const [path, steps] of fileSteps) {
      const original = reportContents(steps[0]!).original;
      const modified = reportContents(steps.at(-1)!).modified;
      files.push({
        path, type: original === undefined ? "create" : modified === undefined ? "delete" : "modify",
        ...(original === undefined ? {} : { originalContent: original }), ...(modified === undefined ? {} : { proposedContent: modified }),
        hunks: steps.flatMap(file => file.hunks.filter(hunk => hunk.decision === "pending")), status: "pending"
      });
    }
    const fileStats: AIChangeReport["fileStats"] = {};
    for (const file of files) {
      const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
      fileStats[file.path] = lineDiffRanges(lines(file.originalContent ?? ""), lines(file.proposedContent ?? "")).reduce((stats, range) => ({
        added: stats.added + range.newEnd - range.newStart, removed: stats.removed + range.oldEnd - range.oldStart
      }), { added: 0, removed: 0 });
    }
    const error = members.map(member => member.autoApplyError).filter(Boolean).join("\n");
    const report = { ...members[0]!, id, files, members, fileStats, ...(error ? { autoApplyError: error } : {}) };
    reportCache.set(members[0]!, report);
    return report;
  });
}

function reportContents(file: AIFileChange): { original: string | undefined; modified: string | undefined } {
  try { return { original: fileWithAppliedHunks(file, hunk => hunk.decision === "accepted"), modified: fileWithAppliedHunks(file, hunk => hunk.decision !== "rejected") }; }
  catch { return { original: file.originalContent, modified: file.proposedContent }; }
}
