import { describe, expect, it } from "vitest";
import { symbolPairAction, symbolPairActions } from "../../apps/desktop/src/renderer/editor/symbolPairing.js";

describe("LaTeX symbol pairing", () => {
  it.each([["{", "{}"], ["(", "()"], ["[", "[]"], ["$", "$$"]])("pairs %s and keeps the cursor inside", (key, text) => {
    expect(symbolPairAction("", 0, 0, key)).toMatchObject({ kind: "edit", text, cursor: 1 });
  });

  it("uses LaTeX closing delimiters for escaped display and inline math", () => {
    expect(symbolPairAction("\\", 1, 1, "[")).toMatchObject({ text: "[\\]", cursor: 2 });
    expect(symbolPairAction("\\", 1, 1, "(")).toMatchObject({ text: "(\\)", cursor: 2 });
  });

  it("does not duplicate an existing matching closer", () => {
    expect(symbolPairAction(")", 0, 0, "(")).toMatchObject({ text: "(", cursor: 1 });
    expect(symbolPairAction("}", 0, 0, "}")).toMatchObject({ kind: "skip", cursor: 1 });
    expect(symbolPairAction("$", 0, 0, "$")).toMatchObject({ kind: "skip", cursor: 1 });
  });

  it("wraps a selected range", () => {
    expect(symbolPairAction("word", 0, 4, "{")).toEqual({ kind: "edit", start: 0, end: 4, text: "{word}", cursor: 1, selectionEnd: 5 });
  });
  it("treats escaped literal symbols differently from math delimiters", () => {
    expect(symbolPairAction("\\", 1, 1, "$" )).toBeUndefined();
    expect(symbolPairAction("\\", 1, 1, "{")).toBeUndefined();
    expect(symbolPairAction("\\\\", 2, 2, "[")).toMatchObject({ text: "[]" });
    expect(symbolPairAction("}word", 0, 5, "}")).toBeUndefined();
  });
  it("wraps every cursor and maps the selections after all edits", () => {
    expect(symbolPairActions("aa\nbb", [{ start: 0, end: 2 }, { start: 3, end: 5 }], "{")).toEqual([
      { kind: "edit", start: 0, end: 2, text: "{aa}", cursor: 1, selectionEnd: 3 },
      { kind: "edit", start: 3, end: 5, text: "{bb}", cursor: 6, selectionEnd: 8 }
    ]);
    expect(symbolPairActions("\\\nx", [{ start: 1, end: 1 }, { start: 3, end: 3 }], "$" )).toMatchObject([
      { text: "$", cursor: 2 }, { text: "$$", cursor: 5 }
    ]);
  });
});
