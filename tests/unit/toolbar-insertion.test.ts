import { describe, expect, it } from "vitest";
import { toolbarInsertion } from "../../apps/desktop/src/renderer/workbench/toolbarInsertion.js";
import { separatedBlockInsertion } from "../../apps/desktop/src/renderer/preview/blockInsertion.js";

describe("toolbar insertion", () => {
  it.each(["", "\n", "\n\n", "\r\n"])("separates environment insertions at either side of a block boundary: %j", gap => {
    const newline = gap.includes("\r") ? "\r\n" : "\n";
    const left = String.raw`\end{theorem}`;
    const right = String.raw`\begin{proof}`;
    const snippet = String.raw`\begin{lemma}New\end{lemma}`;
    const source = left + gap + right;
    for (const offset of [left.length, left.length + gap.length]) {
      const insertion = separatedBlockInsertion(source, offset, offset, snippet);
      expect(source.slice(0, offset) + insertion.text + source.slice(offset)).toBe(left + newline.repeat(2) + snippet + newline.repeat(2) + right);
      expect(insertion.text.slice(insertion.prefixLength).startsWith(snippet)).toBe(true);
    }
  });

  it("does not pad document edges or duplicate a snippet's existing newlines", () => {
    expect(separatedBlockInsertion("", 0, 0, "block").text).toBe("block");
    expect(separatedBlockInsertion("beforeafter", 6, 6, "\n\nblock\n\n").text).toBe("\n\nblock\n\n");
    expect(separatedBlockInsertion("before selected after", 7, 15, "block").text).toBe("\n\nblock\n\n");
  });
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
