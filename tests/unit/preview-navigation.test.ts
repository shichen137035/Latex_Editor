import { describe, expect, it } from "vitest";
import { PreviewNavigationEvents, previewNodeAtOffset, previewSpanContains } from "../../apps/desktop/src/renderer/preview/navigation.js";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";

describe("Preview navigation boundaries and event lifetime", () => {
  const source = String.raw`\documentclass{article}
\begin{document}
\section{One}
First paragraph.
\section{Two}\label{sec:two}
Second paragraph.
\end{document}`;
  const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);

  it("locates the following section at a shared source boundary", () => {
    const node = previewNodeAtOffset(document.nodes, source.indexOf(String.raw`\section{Two}`));
    expect(node?.kind).toBe("block");
    expect(node && "title" in node && node.title).toBe("Two");
  });

  it("resolves labels to the section header and text positions to their content region", () => {
    const header = previewNodeAtOffset(document.nodes, source.indexOf(String.raw`\label{sec:two}`));
    expect(header && "title" in header && header.title).toBe("Two");
    expect(previewNodeAtOffset(document.nodes, source.indexOf("Second paragraph") + 3)?.kind).toBe("content");
  });

  it("can navigate to preamble and EOF instead of silently discarding the request", () => {
    expect(previewNodeAtOffset(document.nodes, 0)).toBe(document.nodes[0]);
    expect(previewNodeAtOffset(document.nodes, source.length)).toBe(document.nodes.at(-1));
    expect(previewNodeAtOffset([], 0)).toBeUndefined();
  });

  it("uses the same half-open rule for DOM source spans and supports empty insertion regions", () => {
    expect(previewSpanContains({ startOffset: 10, endOffset: 20 }, 20)).toBe(false);
    expect(previewSpanContains({ startOffset: 20, endOffset: 30 }, 20)).toBe(true);
    expect(previewSpanContains({ startOffset: 20, endOffset: 20 }, 20)).toBe(true);
  });

  it("does not replay a locate or relation event after an edit, or after leaving and returning to a file", () => {
    const events = new PreviewNavigationEvents();
    expect(events.consume("navigation", "main.tex", 10)).toBe(true);
    expect(events.consume("relation", "main.tex", 11)).toBe(true);
    parsePreview(source.replace("First paragraph", "Edited first paragraph"), "main.tex", DEFAULT_ENVIRONMENTS);
    expect(events.consume("navigation", "main.tex", 10)).toBe(false);
    expect(events.consume("relation", "main.tex", 11)).toBe(false);
    expect(events.consume("highlight", "notes.tex", 12)).toBe(true);
    expect(events.consume("relation", "main.tex", 11)).toBe(false);
    expect(events.consume("relation", "main.tex", 13)).toBe(true);
  });
});
