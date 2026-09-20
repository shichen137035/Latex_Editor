import { describe, expect, it } from "vitest";
import { symbolPairAction } from "../../apps/desktop/src/renderer/editor/symbolPairing.js";

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
});
