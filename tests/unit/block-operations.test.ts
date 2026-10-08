import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import {
  blockSourceForCopy, blocksInSelectionRanges, decodeDisabledSource, encodeDisabledSource, normalizeBlockSelection,
  planDeleteBlocks, planDisableBlocks, planEnableBlocks, planMoveBlocks, planPasteBlocks, prepareCopiedLabels
} from "../../apps/desktop/src/renderer/preview/blockOperations.js";
import { adjacentVisibleBlockId, buildPreviewRenderIndex } from "../../apps/desktop/src/renderer/preview/renderModel.js";
import type { PreviewNode, StructuralBlock } from "../../apps/desktop/src/renderer/preview/types.js";

const latex = String.raw`\section{First}
First paragraph.
\begin{theorem}\label{th:first}
The claim. See \ref{th:first}.
\end{theorem}
\section{Second}
Second paragraph.
`;

function allBlocks(nodes: PreviewNode[]): StructuralBlock[] {
  return nodes.flatMap((node) => node.kind === "block" ? [node, ...allBlocks(node.children)] : []);
}

function parsed(source = latex) {
  return parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
}

describe("block operations on parent source subtrees", () => {
  it("normalizes parent and child to one root for copying and deleting", () => {
    const document = parsed();
    const blocks = allBlocks(document.nodes);
    const first = blocks.find((node) => node.environmentId === "section" && node.title === "First")!;
    const theorem = blocks.find((node) => node.environmentId === "theorem")!;
    expect(normalizeBlockSelection(document.nodes, [theorem.id, first.id, theorem.id]).map((node) => node.id)).toEqual([first.id]);
    const copied = blockSourceForCopy(latex, document.nodes, [theorem.id, first.id]);
    expect(copied.rawLatex).toContain("The claim.");
    expect(copied.rawLatex.match(/\\begin\{theorem\}/g)).toHaveLength(1);
    const deleted = planDeleteBlocks(latex, document.nodes, [first.id, theorem.id])!;
    expect(deleted.source).not.toContain("First paragraph.");
    expect(deleted.source).not.toContain("The claim.");
    expect(deleted.source).toContain("Second paragraph.");
    expect(deleted.changes).toHaveLength(1);
  });

  it("moves a parent together with its children, and rejects moving it into its descendant", () => {
    const document = parsed();
    const blocks = allBlocks(document.nodes);
    const first = blocks.find((node) => node.environmentId === "section" && node.title === "First")!;
    const second = blocks.find((node) => node.environmentId === "section" && node.title === "Second")!;
    const theorem = blocks.find((node) => node.environmentId === "theorem")!;
    const moved = planMoveBlocks(latex, document.nodes, [first.id, theorem.id], second.id, "after", DEFAULT_ENVIRONMENTS)!;
    expect(moved.source.indexOf("Second paragraph.")).toBeLessThan(moved.source.indexOf("First paragraph."));
    expect(moved.source.indexOf("First paragraph.")).toBeLessThan(moved.source.indexOf("The claim."));
    expect(moved.source.match(/\\begin\{theorem\}/g)).toHaveLength(1);
    expect(moved.changes).toHaveLength(1);
    expect(blocksInSelectionRanges(parsed(moved.source).nodes, moved.selectionRanges!).map((block) => block.title)).toEqual(["First"]);
    expect(() => planMoveBlocks(latex, document.nodes, [first.id], theorem.id, "inside", DEFAULT_ENVIRONMENTS)).toThrow();
  });

  it("keeps every moved root selected after a multi-block reorder", () => {
    const source = `${latex}\\section{Third}\nThird paragraph.\n`;
    const document = parsed(source);
    const sections = allBlocks(document.nodes).filter((node) => node.environmentId === "section");
    const moved = planMoveBlocks(source, document.nodes, [sections[0]!.id, sections[1]!.id], sections[2]!.id, "after", DEFAULT_ENVIRONMENTS)!;
    expect(blocksInSelectionRanges(parsed(moved.source).nodes, moved.selectionRanges!).map((block) => block.title)).toEqual(["First", "Second"]);
  });

  it("duplicates the whole parent while regenerating labels and its internal references", () => {
    const document = parsed();
    const first = allBlocks(document.nodes).find((node) => node.environmentId === "section" && node.title === "First")!;
    const copied = blockSourceForCopy(latex, document.nodes, [first.id]);
    const pasted = planPasteBlocks(latex, document.nodes, first.id, "after", copied.rawLatex, DEFAULT_ENVIRONMENTS)!;
    expect(pasted.source).toContain(String.raw`\label{th:first-copy}`);
    expect(pasted.source).toContain(String.raw`\ref{th:first-copy}`);
    expect(pasted.source.match(/The claim\./g)).toHaveLength(2);
    expect(blocksInSelectionRanges(parsed(pasted.source).nodes, pasted.selectionRanges!).map((block) => block.title)).toEqual(["First"]);
    expect(prepareCopiedLabels("", String.raw`\label{new}\ref{new}`)).toBe(String.raw`\label{new}\ref{new}`);
  });

  it("rejects moving a block that shares a physical source line with other content", () => {
    const source = String.raw`\begin{theorem}A\end{theorem} trailing text
\begin{theorem}B\end{theorem}
`;
    const document = parsed(source);
    const theorems = allBlocks(document.nodes).filter((node) => node.environmentId === "theorem");
    expect(theorems).toHaveLength(2);
    expect(() => planMoveBlocks(source, document.nodes, [theorems[0]!.id], theorems[1]!.id, "after", DEFAULT_ENVIRONMENTS)).toThrow(/source line/);
  });

  it("disables and re-enables the full parent source without changing its contents", () => {
    const document = parsed();
    const first = allBlocks(document.nodes).find((node) => node.environmentId === "section" && node.title === "First")!;
    const disabled = planDisableBlocks(latex, document.nodes, [first.id])!;
    expect(disabled.source).toContain("%TW% \\begin{theorem}");
    const disabledDocument = parsed(disabled.source);
    const disabledBlock = allBlocks(disabledDocument.nodes).find((node) => node.environmentId === "texweave-disabled")!;
    expect(disabledBlock).toBeDefined();
    expect(blocksInSelectionRanges(disabledDocument.nodes, disabled.selectionRanges!).map((node) => node.id)).toEqual([disabledBlock.id]);
    expect(allBlocks(disabledDocument.nodes).filter((node) => node.environmentId === "theorem")).toHaveLength(0);
    const enabled = planEnableBlocks(disabled.source, disabledDocument.nodes, [disabledBlock.id])!;
    expect(enabled.source).toBe(latex);
    expect(blocksInSelectionRanges(parsed(enabled.source).nodes, enabled.selectionRanges!).map((node) => node.title)).toEqual(["First"]);
  });

  it("navigates nested visible blocks in source order and skips collapsed descendants", () => {
    const index = buildPreviewRenderIndex(parsed().nodes);
    const blocks = index.entries.filter((entry) => entry.node.kind === "block");
    const first = blocks.find((entry) => entry.node.kind === "block" && entry.node.title === "First")!;
    const theorem = blocks.find((entry) => entry.node.kind === "block" && entry.node.environmentId === "theorem")!;
    const second = blocks.find((entry) => entry.node.kind === "block" && entry.node.title === "Second")!;
    expect(adjacentVisibleBlockId(index, [first.id], new Set(), "down")).toBe(theorem.id);
    expect(adjacentVisibleBlockId(index, [theorem.id], new Set(), "down")).toBe(second.id);
    expect(adjacentVisibleBlockId(index, [first.id], new Set([first.id]), "down")).toBe(second.id);
    expect(adjacentVisibleBlockId(index, [first.id], new Set(), "down", (entry) => entry.id !== theorem.id)).toBe(second.id);
    expect(adjacentVisibleBlockId(index, [second.id], new Set(), "up")).toBe(theorem.id);
    expect(adjacentVisibleBlockId(index, [first.id], new Set(), "up")).toBeUndefined();
  });

  it("round-trips CRLF, comments, blank lines and a missing final newline", () => {
    for (const source of ["first\n\n% existing comment\nlast\n", "first\r\n\r\n% comment\r\nlast", "no newline"]) {
      expect(decodeDisabledSource(encodeDisabledSource(source))).toBe(source);
    }
  });
});
