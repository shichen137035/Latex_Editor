import { expect, it, vi } from "vitest";
import type { AIChangeSet } from "@latex-editor/contracts";
import { createAIChangeController } from "../../apps/desktop/src/renderer/workbench/aiChangeController.js";
import { EditHistory } from "../../apps/desktop/src/renderer/workbench/EditHistory.js";

function fixture() {
  const changes: AIChangeSet = { id: "changes", conversationId: "chat", createdAt: 0, status: "pending", files: [{ path: "main.tex", type: "modify", originalContent: "old", proposedContent: "new", status: "pending", hunks: [{ id: "hunk", oldStart: 0, newStart: 0, oldLines: 1, newLines: 1, oldText: "old", newText: "new", decision: "pending" }] }] };
  const tabsRef = { current: [{ path: "main.tex", content: "old", dirty: false }] };
  const mark = vi.fn(async (_id: string, ids: string[], error?: string) => {
    if (ids.length) changes.files[0]!.hunks[0]!.applied = true;
    if (error) changes.autoApplyError = error; else delete changes.autoApplyError;
    return structuredClone(changes);
  });
  const changeDocument = vi.fn((path: string, content: string) => { tabsRef.current = tabsRef.current.map(tab => tab.path === path ? { ...tab, content, dirty: true } : tab); });
  const notice = vi.fn();
  const options = {
    api: { ai: { conversations: async () => ({ conversations: [], changeSets: [structuredClone(changes)] }), markChangeSetApplied: mark }, files: { tree: async () => [{ name: "main.tex", relativePath: "main.tex", kind: "file" }] } },
    project: { id: "project" }, tabsRef, savedContents: { current: new Map([["main.tex", "old"]]) }, editHistory: { current: new EditHistory() },
    navigationHistory: { current: { clear: vi.fn() } }, activePathRef: { current: "main.tex" }, aiOperationQueue: { current: Promise.resolve() },
    setActivePath: vi.fn(), setTabs: vi.fn(), setSaveState: vi.fn(), setBlockNotice: notice, setAiDiffFile: vi.fn(), setLayout: vi.fn(), refreshTree: vi.fn(), openFile: vi.fn(), changeDocument
  } as unknown as Parameters<typeof createAIChangeController>[0];
  return { changes, mark, tabsRef, changeDocument, notice, controller: createAIChangeController(options) };
}

it("persists manual application conflicts on the changes card without accepting the proposal", async () => {
  const f = fixture(); f.tabsRef.current[0]!.content = "new user text";
  await expect(f.controller.applyAIChanges(f.changes, ["hunk"])).rejects.toThrow();
  expect(f.changeDocument).not.toHaveBeenCalled(); expect(f.notice).toHaveBeenCalled();
  expect(f.changes.autoApplyError).toBeTruthy(); expect(f.changes.files[0]!.hunks[0]!.decision).toBe("pending");
});

it("does not report success when the editor failed to update its buffer", async () => {
  const f = fixture(); f.changeDocument.mockImplementation(() => undefined);
  await expect(f.controller.applyAIChanges(f.changes, ["hunk"])).rejects.toThrow();
  expect(f.changes.files[0]!.hunks[0]!.applied).not.toBe(true);
  expect(f.changes.autoApplyError).toBeTruthy();
});

it("retries failed application acknowledgements without applying the edit twice", async () => {
  const f = fixture(); f.mark.mockRejectedValueOnce(new Error("History write failed"));
  await expect(f.controller.applyAIChanges(f.changes, ["hunk"])).rejects.toThrow("History write failed");
  expect(f.tabsRef.current[0]!.content).toBe("new"); expect(f.changes.autoApplyError).toContain("History write failed");
  await expect(f.controller.applyAIChanges(f.changes, ["hunk"])).resolves.toMatchObject({ appliedIds: ["hunk"] });
  expect(f.changeDocument).toHaveBeenCalledOnce(); expect(f.changes.autoApplyError).toBeUndefined();
});
