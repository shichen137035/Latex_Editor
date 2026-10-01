import { describe, expect, it } from "vitest";
import { EditHistory, applyTextPatch, patchFromEdits, textPatch, type EditOperation, type HistoryDirection } from "../../apps/desktop/src/renderer/workbench/EditHistory.js";

describe("shared Code/Visual operation history", () => {
  it("supports multiple independent Preview operations and redoes them in order", async () => {
    const history = new EditHistory();
    let content = "Original";
    const apply = (op: EditOperation, direction: HistoryDirection) => { if (op.kind === "text") content = applyTextPatch(content, op.patch, direction); };
    for (const next of ["Original\n\\begin{theorem}A\\end{theorem}", "Changed\n\\begin{theorem}A\\end{theorem}", "Changed"]) {
      history.recordText("main.tex", content, next); content = next;
    }
    for (let i = 0; i < 3; i++) await history.replay("undo", apply);
    expect(content).toBe("Original"); expect(history.canUndo).toBe(false);
    for (let i = 0; i < 3; i++) await history.replay("redo", apply);
    expect(content).toBe("Changed"); expect(history.canRedo).toBe(false);
  });
  it("groups nearby typing, but keeps Preview actions separate", async () => {
    const history = new EditHistory(); let content = "abc";
    for (const [before, after, time] of [["", "a", 1], ["a", "ab", 2], ["ab", "abc", 3]] as const) history.recordText("main.tex", before, after, true, time);
    const apply = (op: EditOperation, direction: HistoryDirection) => { if (op.kind === "text") content = applyTextPatch(content, op.patch, direction); };
    history.recordText("main.tex", content, "ABC"); content = "ABC";
    await history.replay("undo", apply); expect(content).toBe("abc");
    await history.replay("undo", apply); expect(content).toBe("");
    await history.replay("redo", apply); expect(content).toBe("abc");
  });
  it("starts a new group after a pause, cursor jump or explicit boundary", async () => {
    const history = new EditHistory();
    history.recordText("a", "", "x", true, 1);
    history.recordText("a", "x", "xy", true, 800);
    history.breakGroup(); history.recordText("a", "xy", "xyz", true, 801);
    let steps = 0;
    while (history.canUndo) await history.replay("undo", () => { steps++; });
    expect(steps).toBe(3);
  });
  it("clears redo after a new edit, not after a no-op", async () => {
    const history = new EditHistory();
    history.recordText("a", "a", "b");
    await history.replay("undo", () => undefined);
    history.recordText("a", "a", "a"); expect(history.canRedo).toBe(true);
    history.recordText("a", "a", "c"); expect(history.canRedo).toBe(false);
  });
  it("orders custom-block metadata changes with document changes", async () => {
    const history = new EditHistory(), order: string[] = [];
    history.recordText("a", "a", "b"); history.recordStructure(); history.recordText("a", "b", "c");
    const apply = (op: EditOperation, direction: HistoryDirection) => { order.push(`${direction}:${op.kind}`); };
    await Promise.all([history.replay("undo", apply), history.replay("undo", apply), history.replay("undo", apply)]);
    await Promise.all([history.replay("redo", apply), history.replay("redo", apply), history.replay("redo", apply)]);
    expect(order).toEqual(["undo:text", "undo:structure", "undo:text", "redo:text", "redo:structure", "redo:text"]);
  });
  it("keeps failed operations available for retry", async () => {
    const history = new EditHistory(); history.recordStructure();
    await expect(history.replay("undo", () => { throw new Error("write failed"); })).rejects.toThrow("write failed");
    expect(history.canUndo).toBe(true); expect(history.canRedo).toBe(false); expect(history.busy).toBe(false);
    await history.replay("undo", () => undefined); expect(history.canRedo).toBe(true);
  });
  it("retains history across files and follows renames", async () => {
    const history = new EditHistory(), files: string[] = [];
    history.recordText("chapter/main.tex", "a", "b"); history.recordText("notes.tex", "x", "y"); history.renameFile("chapter", "part");
    const apply = (op: EditOperation) => { if (op.kind === "text") files.push(op.fileId); };
    await history.replay("undo", apply); await history.replay("undo", apply);
    expect(files).toEqual(["notes.tex", "part/main.tex"]);
    history.forgetFile("part"); expect(history.canRedo).toBe(true);
    await history.replay("redo", apply); expect(history.canRedo).toBe(false);
  });
  it("stores only the edit in a large document and bounds the operation count", async () => {
    const before = "x".repeat(1000000), after = before.slice(0, 500000) + "changed" + before.slice(500000);
    expect(textPatch(before, after)).toEqual({ start: 500000, removed: "", inserted: "changed" });
    const history = new EditHistory();
    for (let i = 0; i < 110; i++) history.recordText("a", String(i), String(i + 1));
    let steps = 0;
    while (history.canUndo) await history.replay("undo", () => { steps++; });
    expect(steps).toBe(100);
  });
  it("rejects conflicting content rather than overwriting an external edit", () => {
    const patch = textPatch("abc", "aXc");
    expect(() => applyTextPatch("aYc", patch, "undo")).toThrow("protect");
    expect(applyTextPatch("aXc", patch, "undo")).toBe("abc");
    expect(applyTextPatch("abc", patch, "redo")).toBe("aXc");
  });
  it("combines grouped insertion/deletion without retaining the whole document", async () => {
    const prefix = "x".repeat(100000), history = new EditHistory();
    let content = prefix + "end";
    const original = content;
    for (const [next, edit] of [
      [prefix + "aend", { start: 100000, end: 100000, newLength: 1 }],
      [prefix + "abend", { start: 100001, end: 100001, newLength: 1 }],
      [prefix + "aend", { start: 100001, end: 100002, newLength: 0 }],
      [prefix + "acend", { start: 100001, end: 100001, newLength: 1 }]
    ] as const) {
      const patch = patchFromEdits(content, next, [edit]);
      history.recordText("a", content, next, true, 1, patch); content = next;
    }
    await history.replay("undo", (op, direction) => { if (op.kind === "text") { expect(op.patch.removed.length + op.patch.inserted.length).toBe(2); content = applyTextPatch(content, op.patch, direction); } });
    expect(content).toBe(original); expect(history.canUndo).toBe(false);
  });
  it("handles multiple Monaco edits in one transaction", () => {
    const before = "abcdef", after = "aXXcdYf";
    const patch = patchFromEdits(before, after, [{ start: 1, end: 2, newLength: 2 }, { start: 4, end: 5, newLength: 1 }]);
    expect(applyTextPatch(before, patch, "redo")).toBe(after);
    expect(applyTextPatch(after, patch, "undo")).toBe(before);
    const nested = patchFromEdits(before, "AFTERBLOCK" + before, [{ start: 0, end: 0, newLength: 1 }]);
    expect(applyTextPatch("AFTERBLOCK" + before, nested, "undo")).toBe(before);
  });
});
