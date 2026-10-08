import { describe, expect, it, vi } from "vitest";
import type { AIApprovalRequest, AIFileChange, AIChangeHunk } from "@latex-editor/contracts";
import { preferenceDefaults, validPreference } from "@latex-editor/contracts";
import { AIApprovalRequests } from "../../apps/desktop/src/main/ai/approval-requests.js";
import { codexPermissionPolicy, isReadOnlyPermissionRequest, requiresAIApproval } from "../../apps/desktop/src/main/ai/ai-approvals.js";
import { automaticHunkIds, fileWithAppliedHunks, hunkLineStats, reviewFileContents, transitionAIFile } from "../../apps/desktop/src/renderer/ai/changeOperations.js";
import { EditHistory, applyTextPatch } from "../../apps/desktop/src/renderer/workbench/EditHistory.js";

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
  it("expires unanswered requests rather than leaving the provider stuck", async () => {
    vi.useFakeTimers();
    try {
      const approvals = new AIApprovalRequests(() => undefined);
      const pending = approvals.request({ conversationId: "chat", description: "Edit", paths: [] });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      await expect(pending).resolves.toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
