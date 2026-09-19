import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENTS, environmentWithOverrides } from "../../apps/desktop/src/renderer/preview/environments.js";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import type { PreviewNode, StructuralBlock } from "../../apps/desktop/src/renderer/preview/types.js";

function blocks(nodes: PreviewNode[]): StructuralBlock[] {
  return nodes.flatMap((node) => node.kind === "block" ? [node, ...blocks(node.children)] : []);
}

describe("v0.2.2 structured Preview parser", () => {
  it("builds sections, paragraphs, nested equations, theorem, proof, and virtual blocks", async () => {
    const source = await readFile(resolve("tests/fixtures/preview-basic/main.tex"), "utf8");
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const allBlocks = blocks(document.nodes);
    const section = allBlocks.find((node) => node.environmentId === "section");
    const theorem = allBlocks.find((node) => node.environmentId === "theorem");
    expect(section?.title).toBe("Introduction");
    expect(theorem).toBeDefined();
    expect(theorem?.children.some((node) => node.kind === "block" && node.environmentId === "equation")).toBe(true);
    expect(theorem?.children.filter((node) => node.kind === "content")).toHaveLength(2);
    expect(allBlocks.some((node) => node.environmentId === "proof")).toBe(true);
    expect(allBlocks.find((node) => node.environmentId === "virtual:intuition")).toMatchObject({ origin: "virtual", title: "Main intuition" });
    expect(document.diagnostics).toEqual([]);
  });

  it("recognizes bracket display math nested inside list environments", () => {
    const source = String.raw`\begin{itemize}
\item Before
\[
  x^2 + y^2 = z^2
\]
\item After
\end{itemize}
\begin{enumerate}
\item Another item
\begin{equation}
  a=b
\end{equation}
\end{enumerate}`;
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const list = blocks(document.nodes).find((node) => node.environmentId === "itemize");
    const numberedList = blocks(document.nodes).find((node) => node.environmentId === "enumerate");
    expect(list?.children.some((node) => node.kind === "block" && node.environmentId === "display-math")).toBe(true);
    expect(numberedList?.children.some((node) => node.kind === "block" && node.environmentId === "equation")).toBe(true);
    expect(document.diagnostics).toEqual([]);
  });

  it("keeps sibling spans disjoint and child spans contained", async () => {
    const source = await readFile(resolve("tests/fixtures/preview-basic/main.tex"), "utf8");
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const verify = (nodes: PreviewNode[], parent?: PreviewNode) => {
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        const next = nodes[index + 1];
        expect(node).toBeDefined();
        if (!node) continue;
        if (next) expect(node.source.endOffset).toBeLessThanOrEqual(next.source.startOffset);
        if (parent) {
          expect(node.source.startOffset).toBeGreaterThanOrEqual(parent.source.startOffset);
          expect(node.source.endOffset).toBeLessThanOrEqual(parent.source.endOffset);
        }
        if (node.kind === "block") verify(node.children, node);
      }
    };
    verify(document.nodes);
  });

  it("renders disabled environments as ordinary readable content", () => {
    const source = "\\begin{document}\n\\begin{remark}\nReadable body.\n\\end{remark}\n\\end{document}";
    const document = parsePreview(source, "main.tex", environmentWithOverrides({ remark: false }));
    expect(blocks(document.nodes).some((node) => node.environmentId === "remark")).toBe(false);
    expect(document.nodes.some((node) => node.kind === "content" && node.raw.includes("Readable body."))).toBe(true);
  });

  it("contains malformed source locally and reports a recovery diagnostic", () => {
    const source = "\\begin{document}\nBefore.\n\n\\begin{theorem}\nBroken theorem.\n\nAfter.\n\\end{document}";
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    expect(document.nodes.some((node) => node.kind === "content" && node.raw.includes("Before."))).toBe(true);
    expect(document.diagnostics.some((message) => message.includes("Unclosed"))).toBe(true);
  });
});
