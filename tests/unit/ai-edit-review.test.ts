import { describe, expect, it, vi } from "vitest";
import type { AIApprovalRequest, AIChangeSet, AIFileChange, AIChangeHunk } from "@latex-editor/contracts";
import { preferenceDefaults, validPreference } from "@latex-editor/contracts";
import { AIApprovalRequests } from "../../apps/desktop/src/main/ai/approval-requests.js";
import { codexPermissionPolicy, isReadOnlyPermissionRequest, requiresAIApproval } from "../../apps/desktop/src/main/ai/ai-approvals.js";
import { automaticHunkIds, fileWithAppliedHunks, hunkLineStats, reviewFileContents, transitionAIFile } from "../../apps/desktop/src/renderer/ai/changeOperations.js";
import { EditHistory, applyTextPatch } from "../../apps/desktop/src/renderer/workbench/EditHistory.js";
import { makeHunks } from "../../apps/desktop/src/main/ai/changeHunks.js";
import { groupChangeReports } from "../../apps/desktop/src/renderer/ai/changeReports.js";

it("merges checkpoints of one response into a stable report with cumulative file differences", () => {
  const checkpoint = (id: string, createdAt: number, originalContent: string, proposedContent: string): AIChangeSet => ({
    id, conversationId: "conversation", messageId: "response", createdAt, status: "pending", files: [{
      path: "main.tex", type: "modify", originalContent, proposedContent, status: "pending",
      hunks: makeHunks("main.tex", originalContent, proposedContent).map(hunk => ({ ...hunk, applied: true }))
    }]
  });
  const first = checkpoint("first", 1, "Original\n", "Intermediate\n");
  const second = checkpoint("second", 2, "Intermediate\n", "Final\n");
  const initialReport = groupChangeReports([first])[0]!;
  const reports = groupChangeReports([second, first]);
  expect(reports).toHaveLength(1);
  const report = reports[0]!;
  expect(report.id).toBe(initialReport.id);
  expect(report.createdAt).toBe(1);
  expect(report.members.map(member => member.id)).toEqual(["first", "second"]);
  expect(report.files).toHaveLength(1);
  expect(report.files[0]).toMatchObject({ originalContent: "Original\n", proposedContent: "Final\n" });
  expect(report.fileStats["main.tex"]).toEqual({ added: 1, removed: 1 });
  expect(groupChangeReports([second, first])[0]).toBe(report);
  let current: string | undefined = "Final\n";
  for (const member of report.members.slice().reverse()) current = transitionAIFile(member.files[0]!, current, new Set(member.files[0]!.hunks.map(hunk => hunk.id)), false);
  expect(current).toBe("Original\n");
  const nextTurn = { ...checkpoint("third", 3, "Final\n", "Next\n"), messageId: "next-response" };
  expect(groupChangeReports([first, second, nextTurn])).toHaveLength(2);
  expect(groupChangeReports([first, { ...second, conversationId: "other" }])).toHaveLength(2);
  const legacy = structuredClone([first, second]);
  for (const member of legacy) delete member.messageId;
  expect(groupChangeReports(legacy)).toHaveLength(2);
});

it("reviews sparse edits in a ten-thousand-line paper without counting unchanged rewritten blocks", () => {
  const lines = Array.from({ length: 10000 }, (_, index) => `Paragraph ${index}.\n`);
  const before = lines.join("");
  for (const index of [100, 3000, 9500]) lines[index] = `Edited paragraph ${index}.\n`;
  const after = lines.join("");
  const hunks = makeHunks("main.tex", before, after);
  expect(hunks).toHaveLength(3);
  expect(hunks.reduce((total, hunk) => total + hunkLineStats(hunk).added, 0)).toBe(3);
  const file: AIFileChange = { path: "main.tex", type: "modify", originalContent: before, proposedContent: after, hunks, status: "pending" };
  expect(fileWithAppliedHunks(file, () => true)).toBe(after);
  expect(hunkLineStats({ ...hunks[0]!, oldText: before, newText: after })).toEqual({ added: 3, removed: 3 });
  const dense = Array.from({ length: 3000 }, (_, index) => `line ${index}\n`);
  const denseChanged = dense.map((line, index) => index % 2 ? `edited ${index}\n` : line).join("");
  expect(hunkLineStats({ ...hunks[0]!, oldText: dense.join(""), newText: denseChanged })).toEqual({ added: 1500, removed: 1500 });
  for (let seed = 0; seed < 30; seed++) {
    const oldText = Array.from({ length: 25 }, (_, index) => `repeated ${index % 4}\n`).join("");
    const changed = oldText.split("\n");
    changed.splice(seed % 20, seed % 3, `inserted ${seed}`, "inserted again");
    const newText = changed.join("\n");
    const proposal: AIFileChange = { path: "main.tex", type: "modify", originalContent: oldText, proposedContent: newText, hunks: makeHunks("main.tex", oldText, newText), status: "pending" };
    expect(fileWithAppliedHunks(proposal, () => true)).toBe(newText);
  }
});

function hunk(id: string, oldStart: number, oldText: string, newText: string): AIChangeHunk {
  return { id, oldStart, newStart: oldStart, oldLines: oldText.match(/[^\n]*\n|[^\n]+$/g)?.length ?? 0, newLines: newText.match(/[^\n]*\n|[^\n]+$/g)?.length ?? 0, oldText, newText, decision: "pending" };
}

describe("VS Code-style AI review", () => {
  it("leaves structure metadata for manual review during automatic apply", () => {
    const source: AIFileChange = { path: "main.tex", type: "modify", originalContent: "old", proposedContent: "new", status: "pending", hunks: [hunk("source", 0, "old", "new")] };
    const structure: AIFileChange = { path: ".texweave/structure.json", type: "modify", originalContent: "{}", proposedContent: "{ }", status: "pending", hunks: [hunk("structure", 0, "{}", "{ }")] };
    const otherMetadata: AIFileChange = { ...structure, path: ".texweave/settings.json", hunks: [hunk("settings", 0, "{}", "{ }")] };
    expect(automaticHunkIds({ id: "test", conversationId: "chat", createdAt: 0, files: [source, structure, otherMetadata], status: "pending" })).toEqual(["source"]);
  });
  it("applies, keeps and reverts independent hunks in original coordinates", () => {
    const original = "A\nB\nC\nD\n";
    const file: AIFileChange = { path: "main.tex", type: "modify", originalContent: original, status: "pending", hunks: [hunk("first", 0, "A\n", "X\nY\n"), hunk("second", 3, "D\n", "Z\n")] };
    const all = new Set(["first", "second"]);
    const applied = transitionAIFile(file, original, all, true)!;
    expect(applied).toBe("X\nY\nB\nC\nZ\n");
    file.hunks.forEach(h => { h.applied = true; });
    file.hunks[0]!.decision = "accepted";
    const reverted = transitionAIFile(file, applied, new Set(["second"]), false);
    expect(reverted).toBe("X\nY\nB\nC\nD\n");
    expect(() => transitionAIFile(file, reverted, new Set(["first"]), false)).toThrow("undo history");
  });
  it("applies manual approvals one at a time without requiring the original full buffer again", () => {
    const file: AIFileChange = { path: "main.tex", type: "modify", originalContent: "A\nB\nC\n", status: "pending", hunks: [hunk("a", 0, "A\n", "A1\n"), hunk("c", 2, "C\n", "C1\nC2\n")] };
    const first = transitionAIFile(file, file.originalContent, new Set(["a"]), true);
    file.hunks[0]!.decision = "accepted";
    const second = transitionAIFile(file, first, new Set(["c"]), true);
    expect(second).toBe("A1\nB\nC1\nC2\n");
  });
  it("shows only pending changes in diff, including missing/deleted files", () => {
    const file: AIFileChange = { path: "main.tex", type: "modify", originalContent: "A\nB\nC\n", status: "partially_accepted", hunks: [hunk("a", 0, "A\n", "A1\n"), hunk("b", 1, "B\n", "B1\n"), hunk("c", 2, "C\n", "C1\n")] };
    file.hunks[0]!.decision = "accepted"; file.hunks[2]!.decision = "rejected";
    expect(reviewFileContents(file)).toEqual({ original: "A1\nB\nC\n", modified: "A1\nB1\nC\n" });
    const newFile: AIFileChange = { path: "extra.tex", type: "create", proposedContent: "extra", status: "pending", hunks: [hunk("new", 0, "", "extra")] };
    expect(reviewFileContents(newFile)).toEqual({ original: "", modified: "extra" });
    expect(reviewFileContents({ ...newFile, type: "delete", originalContent: "extra", proposedContent: undefined })).toEqual({ original: "extra", modified: "" });
  });
  it("does not overwrite user changes or untracked existing files", () => {
    const file: AIFileChange = { path: "main.tex", type: "modify", originalContent: "old", status: "pending", hunks: [hunk("a", 0, "old", "new")] };
    expect(() => transitionAIFile(file, "user's text", new Set(["a"]), true)).toThrow("AI_CHANGE_CONFLICT");
    const created: AIFileChange = { ...file, type: "create", originalContent: undefined, proposedContent: "new" };
    expect(() => transitionAIFile(created, "already exists", new Set(["a"]), true)).toThrow("AI_CHANGE_CONFLICT");
  });
  it("auto-applies non-overlapping hunks while preserving newer edits elsewhere in the file", () => {
    const original = "Title\n\nFirst paragraph.\n\nSecond paragraph.\n";
    const file: AIFileChange = {
      path: "main.tex", type: "modify", originalContent: original, proposedContent: original.replace("First paragraph.", "Revised paragraph."), status: "pending",
      hunks: [hunk("edit", 2, "First paragraph.\n", "Revised paragraph.\n")]
    };
    const current = original.replace("Title", "New title");
    expect(transitionAIFile(file, current, new Set(["edit"]), true)).toBe(current.replace("First paragraph.", "Revised paragraph."));
  });
  it("undoes an auto-applied hunk without reverting unrelated newer edits", () => {
    const original = "Title\n\nFirst paragraph.\n\nSecond paragraph.\n";
    const file: AIFileChange = {
      path: "main.tex", type: "modify", originalContent: original, proposedContent: original.replace("First paragraph.", "Revised paragraph."), status: "pending",
      hunks: [{ ...hunk("edit", 2, "First paragraph.\n", "Revised paragraph.\n"), newStart: 2, applied: true }]
    };
    const current = original.replace("Title", "New title").replace("First paragraph.", "Revised paragraph.");
    expect(transitionAIFile(file, current, new Set(["edit"]), false)).toBe(current.replace("Revised paragraph.", "First paragraph."));
  });
  it("keeps overlapping edits as conflicts instead of overwriting newer user text", () => {
    const file: AIFileChange = { path: "main.tex", type: "modify", originalContent: "A\nB\nC\n", proposedContent: "A\nAI edit\nC\n", status: "pending", hunks: [hunk("edit", 1, "B\n", "AI edit\n")] };
    expect(() => transitionAIFile(file, "A\nUser edit\nC\n", new Set(["edit"]), true)).toThrow("AI_CHANGE_CONFLICT");
  });
  it("allows acknowledgement retries but refuses to keep changes that were undone after auto-apply", () => {
    const file: AIFileChange = { path: "main.tex", type: "modify", originalContent: "old", proposedContent: "new", status: "pending", hunks: [hunk("a", 0, "old", "new")] };
    expect(transitionAIFile(file, "new", new Set(["a"]), true)).toBe("new");
    file.hunks[0]!.applied = true;
    expect(() => transitionAIFile(file, "old", new Set(["a"]), true)).toThrow("AI_CHANGE_CONFLICT");
  });
  it("treats create/delete as reversible until accepted and excludes diff context from counts", () => {
    const create: AIFileChange = { path: "new.tex", type: "create", proposedContent: "text", status: "pending", hunks: [hunk("a", 0, "", "text")] };
    expect(transitionAIFile(create, undefined, new Set(["a"]), true)).toBe("text");
    create.hunks[0]!.applied = true;
    expect(transitionAIFile(create, "text", new Set(["a"]), false)).toBeUndefined();
    const remove: AIFileChange = { path: "old.tex", type: "delete", originalContent: "text", status: "pending", hunks: [hunk("b", 0, "text", "")] };
    expect(transitionAIFile(remove, "text", new Set(["b"]), true)).toBeUndefined();
    remove.hunks[0]!.applied = true;
    expect(transitionAIFile(remove, undefined, new Set(["b"]), false)).toBe("text");
    expect(hunkLineStats(hunk("counts", 0, "context\nold\nunchanged\nend\n", "context\nnew\nmore\nunchanged\nend\n"))).toEqual({ added: 2, removed: 1 });
    expect(fileWithAppliedHunks(create)).toBe("text");
  });
  it("keeps accepted edits in ordinary multi-step Ctrl+Z / Ctrl+Y history including file operations", async () => {
    const history = new EditHistory();
    const files = new Map<string, string>();
    files.set("main.tex", "new"); history.recordText("main.tex", "old", "new");
    files.set("extra.tex", "extra"); history.recordFile("extra.tex", undefined, "extra");
    const replay = (direction: "undo" | "redo") => history.replay(direction, (op, action) => {
      if (op.kind === "text") files.set(op.fileId, applyTextPatch(files.get(op.fileId)!, op.patch, action));
      else if (op.kind === "file") { const content = action === "undo" ? op.before : op.after; if (content === undefined) files.delete(op.fileId); else files.set(op.fileId, content); }
    });
    await replay("undo"); expect(files.has("extra.tex")).toBe(false);
    await replay("undo"); expect(files.get("main.tex")).toBe("old");
    await replay("redo"); await replay("redo"); expect(files.get("main.tex")).toBe("new"); expect(files.get("extra.tex")).toBe("extra");
  });
});

describe("AI permission modes and interactive approvals", () => {
  it("defaults to the second mode, allows web research, and really switches the sandbox policy", () => {
    expect(preferenceDefaults.aiPermissionMode).toBe("auto");
    for (const mode of ["ask", "auto", "full"] as const) {
      expect(validPreference("aiPermissionMode", mode)).toBe(true);
      expect(requiresAIApproval(mode, { description: "Web research", paths: [], external: true, readOnly: true })).toBe(false);
    }
    expect(codexPermissionPolicy("auto", "workspace").sandboxPolicy).toMatchObject({ type: "workspaceWrite", networkAccess: true, writableRoots: ["workspace"] });
    expect(codexPermissionPolicy("full", "workspace")).toMatchObject({ approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } });
    expect(requiresAIApproval("auto", { description: "External edit", paths: [], external: true })).toBe(true);
    expect(requiresAIApproval("auto", { description: "Edit", paths: [], external: false, command: "Set-Content main.tex 'new'" })).toBe(false);
    expect(requiresAIApproval("auto", { description: "Delete", paths: [], external: false, command: "Remove-Item main.tex" })).toBe(true);
    expect(requiresAIApproval("full", { description: "Edit", paths: [], external: true })).toBe(false);
    expect(isReadOnlyPermissionRequest({ network: { enabled: true } })).toBe(true);
    expect(isReadOnlyPermissionRequest({ fileSystem: { read: ["docs.txt"] } })).toBe(true);
    expect(isReadOnlyPermissionRequest({ network: { enabled: true }, fileSystem: { write: ["outside.tex"] } })).toBe(false);
    expect(isReadOnlyPermissionRequest({ fileSystem: { entries: [{ access: "write", path: { path: "outside.tex" } }] } })).toBe(false);
  });
  it("waits for a human answer and cancels approvals on interruption", async () => {
    const events: AIApprovalRequest[] = [];
    const approvals = new AIApprovalRequests(request => events.push(request));
    const first = approvals.request({ conversationId: "chat", description: "External edit", paths: [] });
    expect(approvals.list()).toHaveLength(1);
    approvals.resolve(events[0]!.id, true);
    await expect(first).resolves.toBe(true);
    const second = approvals.request({ conversationId: "chat", description: "Delete", paths: [] });
    approvals.cancel("chat");
    await expect(second).resolves.toBe(false);
    expect(approvals.list()).toHaveLength(0);
  });
  it("keeps unanswered approvals available until a person answers or stops the turn", async () => {
    vi.useFakeTimers();
    try {
      const approvals = new AIApprovalRequests(() => undefined);
      const pending = approvals.request({ conversationId: "chat", description: "Edit", paths: [] });
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(approvals.list()).toHaveLength(1);
      approvals.resolve(approvals.list()[0]!.id, true);
      await expect(pending).resolves.toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
