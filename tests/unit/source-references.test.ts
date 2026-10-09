import { describe, expect, it } from "vitest";
import { commentedOnLine, sourceReferenceAtOffset } from "../../apps/desktop/src/renderer/editor/sourceReferences.js";

describe("source editor reference navigation", () => {
  it("only links to existing uncommented labels with exact source offsets", () => {
    const source = "See \\eqref{eq:one}.\n% \\label{eq:one}\n\\label{eq:one}";
    expect(sourceReferenceAtOffset(source, source.indexOf("eq:one"))).toEqual({ label: "eq:one", offset: 4, text: "\\eqref{eq:one}", targetOffset: source.lastIndexOf("\\label") });
    expect(sourceReferenceAtOffset("\\ref{missing}", 6)).toBeUndefined();
    expect(sourceReferenceAtOffset("\\ref{commented}\n% \\label{commented}", 6)).toBeUndefined();
    expect(sourceReferenceAtOffset(source, source.indexOf("."))).toBeUndefined();
  });
  it("ignores comments even when a later percent sign is escaped", () => {
    expect(commentedOnLine("% comment \\% \\ref{x}", 17)).toBe(true);
    expect(commentedOnLine("Text \\% \\ref{x}", 9)).toBe(false);
    const source = "% comment \\% \\ref{x}\n\\label{x}";
    expect(sourceReferenceAtOffset(source, source.indexOf("ref") + 4)).toBeUndefined();
    expect(sourceReferenceAtOffset("\\\\ref{x}\n\\label{x}", 6)).toBeUndefined();
  });
});
