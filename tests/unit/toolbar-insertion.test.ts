import { describe, expect, it } from "vitest";
import { toolbarInsertion } from "../../apps/desktop/src/renderer/workbench/toolbarInsertion.js";

describe("toolbar insertion", () => {
  it("creates an empty bold command with the cursor inside braces", () => {
    expect(toolbarInsertion("bold", "")).toEqual({ text: "\\textbf{}", cursorOffset: 8 });
  });

  it("wraps selected text instead of adding placeholder text", () => {
    expect(toolbarInsertion("bold", "important")).toEqual({ text: "\\textbf{important}", cursorOffset: 17 });
  });

  it("creates empty reference and citation arguments and requests suggestions", () => {
    expect(toolbarInsertion("reference", "")).toEqual({ text: "\\ref{}", cursorOffset: 5, triggerSuggestions: true });
    expect(toolbarInsertion("citation", "")).toEqual({ text: "\\cite{}", cursorOffset: 6, triggerSuggestions: true });
  });

  it("keeps selected display math inside the math wrapper", () => {
    expect(toolbarInsertion("math", "x+y")).toEqual({ text: "\\[\nx+y\n\\]", cursorOffset: 7 });
  });
});
