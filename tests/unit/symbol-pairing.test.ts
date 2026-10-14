import { describe, expect, it } from "vitest";
import { symbolPairAction, symbolPairActions } from "../../apps/desktop/src/renderer/editor/symbolPairing.js";
import { latexLanguageConfiguration } from "../../apps/desktop/src/renderer/editor/latexLanguageConfiguration.js";

describe("LaTeX symbol pairing", () => {
  it.each(["{}", "()", "[]", "$$"])("removes both empty delimiters in %s with Backspace", (source) => {
    expect(symbolPairAction(source, 1, 1, "Backspace")).toEqual({ kind: "edit", start: 0, end: 2, text: "", cursor: 0 });
  });
  it("removes escaped math delimiters together and reduces a display pair one dollar at a time", () => {
    expect(symbolPairAction("\\[\\]", 2, 2, "Backspace")).toMatchObject({ start: 0, end: 4, text: "", cursor: 0 });
    expect(symbolPairAction("\\(\\)", 2, 2, "Backspace")).toMatchObject({ start: 0, end: 4, text: "", cursor: 0 });
    expect(symbolPairAction("$$$$", 2, 2, "Backspace")).toMatchObject({ start: 1, end: 3, text: "", cursor: 1 });
    for (const [source, cursor] of [["{text}", 1], ["\\{}", 2], ["x", 1], ["", 0]] as const) expect(symbolPairAction(source, cursor, cursor, "Backspace")).toBeUndefined();
    expect(symbolPairAction("{}", 0, 1, "Backspace")).toBeUndefined();
  });
  it("supports mixed Backspace cursors without inserting key names or splitting Unicode", () => {
    expect(symbolPairActions("{}\n😀", [{ start: 1, end: 1 }, { start: 5, end: 5 }], "Backspace")).toEqual([
      { kind: "edit", start: 0, end: 2, text: "", cursor: 0 }, { kind: "edit", start: 3, end: 5, text: "", cursor: 1 }
    ]);
  });
  it("configures environment indentation and aligned closers while ignoring commented examples", () => {
    const rules = latexLanguageConfiguration.indentationRules!;
    expect(rules.increaseIndentPattern.test("  \\begin{align} % math")).toBe(true);
    expect(rules.increaseIndentPattern.test("\\begin{figure}[htbp]")).toBe(true);
    expect(rules.increaseIndentPattern.test("% \\begin{align}")).toBe(false);
    expect(rules.increaseIndentPattern.test("\\command{")).toBe(true);
    expect(rules.increaseIndentPattern.test("\\{")).toBe(false);
    expect(rules.decreaseIndentPattern.test("    \\end{align}")).toBe(true);
    expect(rules.decreaseIndentPattern.test("    }")).toBe(true);
  });
  it("promotes an empty inline pair to display math and opens a blank content line", () => {
    let source = "", cursor = 0;
    for (const key of ["$", "$", "Enter"]) {
      const action = symbolPairAction(source, cursor, cursor, key)!;
      source = source.slice(0, action.start) + action.text + source.slice(action.end);
      cursor = action.cursor;
    }
    expect(source).toBe("$$\n\n$$");
    expect(cursor).toBe(3);
    expect(symbolPairAction("$x$", 2, 2, "$")).toMatchObject({ kind: "skip", cursor: 3 });
  });
  it("keeps indentation and Windows line endings for display math", () => {
    expect(symbolPairAction("before\r\n  $$$$", 12, 12, "Enter")).toMatchObject({ text: "\r\n  \r\n  $$", cursor: 16 });
    expect(symbolPairAction("$$", 2, 2, "Enter")).toMatchObject({ text: "\n\n$$", cursor: 3 });
  });
  it("does not expand closing delimiters or duplicate an existing separate closer", () => {
    expect(symbolPairAction("$$\nx\n$$", 7, 7, "Enter")).toBeUndefined();
    expect(symbolPairAction("$$\nx\n$$", 2, 2, "Enter")).toBeUndefined();
    expect(symbolPairAction("text", 4, 4, "Enter")).toBeUndefined();
    expect(symbolPairAction("% $$\n$$$$", 7, 7, "Enter")).toMatchObject({ text: "\n\n$$" });
  });
  it("maps promoted pairs at multiple cursors and inserts real newlines for other cursors", () => {
    expect(symbolPairActions("$$\n$$", [{ start: 1, end: 1 }, { start: 4, end: 4 }], "$" )).toMatchObject([
      { start: 0, end: 2, text: "$$$$", cursor: 2 }, { start: 3, end: 5, text: "$$$$", cursor: 7 }
    ]);
    expect(symbolPairActions("$$$$\ntext", [{ start: 2, end: 2 }, { start: 9, end: 9 }], "Enter")).toMatchObject([
      { text: "\n\n$$", cursor: 3 }, { text: "\n", cursor: 12 }
    ]);
  });
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
