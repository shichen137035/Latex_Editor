import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENTS, environmentWithOverrides } from "../../apps/desktop/src/renderer/preview/environments.js";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import { plainLatex } from "../../apps/desktop/src/renderer/preview/inlineText.js";
import { tokenizeInlineSource } from "../../apps/desktop/src/renderer/preview/inlineSource.js";
import { previewBlocksForReconciliation } from "../../apps/desktop/src/renderer/preview/reconciliation.js";
import { unwrapLatexEnvironment } from "../../apps/desktop/src/renderer/preview/sourceOperations.js";
import type { PreviewNode, StructuralBlock } from "../../apps/desktop/src/renderer/preview/types.js";

function blocks(nodes: PreviewNode[]): StructuralBlock[] {
  return nodes.flatMap((node) => node.kind === "block" ? [node, ...blocks(node.children)] : []);
}

describe("v0.2.2 structured Preview parser", () => {
  it("does not construct formula blocks from a commented-out array", () => {
    const source = String.raw`% \[
% \begin{array}{c|c|c}
% \text{Mode}
% &
% \text{candidate/search mechanism}
% &
% \text{role}
% \\ \hline
% \mathsf{standard}
% &
% \text{SSI + full-space local refinement}
% &
% \text{default practical estimator}
% \\
% \mathsf{complete}
% &
% \delta_n\text{-net + optional local refinement}
% &
% \text{numerically certified reference}
% \\
% \mathsf{fast}
% &
% \text{SSI + adaptive low-dimensional subspace}
% &
% \text{large-}d\text{ computation}
% \end{array}
% \]`;
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    expect(document.nodes).toEqual([]);
    expect(document.diagnostics).toEqual([]);
  });

  it("ignores commented opening/closing delimiters inside active display math", () => {
    const source = String.raw`\[
x=y
% \]
% \[
z=w
\]`;
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    expect(blocks(document.nodes)).toHaveLength(1);
    expect(document.nodes[0]?.source.endOffset).toBe(source.length);
    expect(document.diagnostics).toEqual([]);
  });

  it("keeps blank lines inside display-dollar formulas in one preview source block", () => {
    const source = ["Before.", "", "$$", "x &= y " + "\\\\", "", "z &= w", "$$", "", "After."].join("\n");
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const content = document.nodes.filter((node) => node.kind === "content");
    expect(content).toHaveLength(3);
    const raw = content.map((node) => node.kind === "content" ? node.raw : "");
    expect(raw[1]?.startsWith("$$")).toBe(true);
    expect(raw[1]?.endsWith("$$")).toBe(true);
    expect(raw[1]).toContain("x &= y " + "\\\\" + "\n\nz &= w");
    const formula = tokenizeInlineSource(raw[1] ?? "").find((token) => token.kind === "math");
    expect(formula).toMatchObject({ display: true });
    expect(formula?.value).toContain("\n\n");
  });

  it("recognizes inline dollar math that spans source lines", () => {
    const source = String.raw`Before $\mathcal G_j=\{(\theta,\theta^\top x):\theta\in\Theta,\\
  x\in G_{j,\theta}\}$ after.`;
    const tokens = tokenizeInlineSource(source);
    const formulas = tokens.filter((token) => token.kind === "math");
    expect(formulas).toHaveLength(1);
    expect(formulas[0]?.value).toContain("\\\n");
    expect(formulas[0]?.value).toContain("x\\in G_{j,\\theta}");
    expect(tokens.map((token) => token.kind)).toEqual(["text", "math", "text"]);
  });

  it("distinguishes literal escaped percent from an actual comment", () => {
    const source = String.raw`\% literal percent \begin{equation}x=y\end{equation}
\% followed by % \[commented\]`;
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    expect(blocks(document.nodes).map(block => block.environmentId)).toEqual(["equation"]);
    expect(document.diagnostics).toEqual([]);
  });

  it("preserves spaces around inline text commands", () => {
    expect(plainLatex("Before ")).toBe("Before ");
    expect(plainLatex(" after")).toBe(" after");
  });

  it("emits offset-independent reconciliation fingerprints", () => {
    const source = "\\section{Stable title}\nA stable paragraph.";
    const shifted = `\n\n${source}`;
    const firstDocument = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const secondDocument = parsePreview(shifted, "main.tex", DEFAULT_ENVIRONMENTS);
    const first = previewBlocksForReconciliation(firstDocument, source).blocks.find((block) => block.role === "section");
    const second = previewBlocksForReconciliation(secondDocument, shifted).blocks.find((block) => block.role === "section");
    expect(first?.transientId).not.toBe(second?.transientId);
    expect(first?.fingerprint).toBe(second?.fingerprint);
    expect(first?.origin).toBe("environment");
  });

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

  it("recognizes an empty placeholder as a structural virtual block", () => {
    const source = String.raw`\begin{document}


% tw:block-begin type=placeholder

% tw:block-end
\end{document}`;
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    expect(blocks(document.nodes)).toMatchObject([{ environmentId: "placeholder", origin: "virtual", children: [] }]);
    expect(blocks(document.nodes)[0]!.source.startOffset).toBe(source.indexOf("% tw:block-begin"));
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
    expect(blocks(document.nodes).filter((node) => ["display-math", "equation"].includes(node.environmentId)).every((node) => node.children.length === 0)).toBe(true);
    expect(document.diagnostics).toEqual([]);
  });

  it("preserves algorithmic steps inside an algorithm float", () => {
    const source = String.raw`\begin{algorithm}[H]
\caption{Full BFGS direction optimization on the sphere}
\label{alg:full-bfgs}
\begin{algorithmic}[1]
\Require Differentiable criterion $Q_{k,n}(\theta,h)$
\Ensure Direction estimate $\widehat\theta$
\State Initialize current direction $\theta\gets\theta_0$.
\For{$k=0,\ldots,J_{\max}-1$}
  \State Compute $g_k=\nabla_\theta Q_{k,n}(\theta,h)$.
  \If{$\lVert G_k\rVert\leq\epsilon$}
    \State \textbf{break}
  \EndIf
\EndFor
\State \Return current direction $\theta$.
\end{algorithmic}
\end{algorithm}`;
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const algorithm = blocks(document.nodes).find((node) => node.environmentId === "algorithm");
    const algorithmic = algorithm?.children.find((node): node is StructuralBlock => node.kind === "block" && node.environmentId === "algorithmic");
    expect(algorithm?.semanticKind).toBe("structural");
    expect(algorithm?.latexLabel).toBe("alg:full-bfgs");
    expect(algorithm?.children.some((node) => node.kind === "content" && node.raw.includes("Full BFGS"))).toBe(true);
    expect(algorithmic?.semanticKind).toBe("structural");
    expect(algorithmic?.children.some((node) => node.kind === "content" && node.raw.includes("\\Require") && node.raw.includes("\\EndFor"))).toBe(true);
    expect(document.diagnostics).toEqual([]);
  });

  it("keeps verbatim code as one atomic content block", () => {
    const source = String.raw`\begin{lstlisting}
\begin{theorem}This is literal code.\end{theorem}
\end{lstlisting}`;
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const listing = blocks(document.nodes).find((node) => node.environmentId === "lstlisting");
    expect(listing?.semanticKind).toBe("content");
    expect(listing?.children).toEqual([]);
  });

  it("treats the equation body as owned content rather than a virtual paragraph", () => {
    const source = "\\begin{equation}\n  x^2 + y^2 = z^2\n\\end{equation}";
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const equation = blocks(document.nodes).find((node) => node.environmentId === "equation");
    const descriptors = previewBlocksForReconciliation(document, source).blocks;

    expect(equation?.children).toEqual([]);
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]).toMatchObject({ role: "equation", kind: "content", origin: "environment" });
  });

  it("keeps an empty heading structural without inserting a virtual node in the document tree", () => {
    const source = "\\section{Empty}\n\\section{Next}\nContent.";
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const section = blocks(document.nodes).find((node) => node.environmentId === "section");
    expect(section?.children).toEqual([]);
    expect(section).toBeDefined();
    if (section) expect(source.slice(section.body.startOffset, section.body.endOffset).trim()).toBe("");
  });

  it("renders the body following a paragraph heading as child prose", () => {
    const source = String.raw`\begin{document}
\paragraph{Overview}
Paragraph body that should be visible.
\section{Next}
Following section text.
\end{document}`;
    const paragraph = blocks(parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS).nodes).find((node) => node.environmentId === "paragraph");

    expect(paragraph?.title).toBe("Overview");
    expect(paragraph?.children.some((node) => node.kind === "content" && node.raw.includes("Paragraph body that should be visible."))).toBe(true);
  });

  it("keeps empty structural and content blocks free of synthetic child nodes", () => {
    const source = String.raw`\begin{theorem}\end{theorem}
\section{Part}
\begin{lemma}\end{lemma}
\begin{equation}\end{equation}`;
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const theorem = blocks(document.nodes).find((node) => node.environmentId === "theorem");
    const section = blocks(document.nodes).find((node) => node.environmentId === "section");
    const lemma = blocks(document.nodes).find((node) => node.environmentId === "lemma");
    const equation = blocks(document.nodes).find((node) => node.environmentId === "equation");
    expect(theorem?.children).toEqual([]);
    expect(section?.children.some((child) => child.kind === "content" && child.origin === "virtual")).toBe(false);
    expect(lemma?.children).toEqual([]);
    expect(equation?.children).toEqual([]);
    expect(theorem?.body.startOffset).toBe(theorem?.body.endOffset);
    expect(equation?.body.startOffset).toBe(equation?.body.endOffset);
  });

  it("unwraps a LaTeX environment and preserves nested same-name environments", () => {
    const source = String.raw`\begin{theorem}
Outer text.
\begin{theorem}Nested text.\end{theorem}
\end{theorem}`;
    expect(unwrapLatexEnvironment(source, "theorem")).toBe(String.raw`
Outer text.
\begin{theorem}Nested text.\end{theorem}
`);
    expect(unwrapLatexEnvironment("plain text", "theorem")).toBeUndefined();
  });

  it("omits zero-length virtual text regions from block-graph reconciliation", () => {
    const source = "\\section{Empty}\n\\section{Next}\nContent.";
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const reconciliation = previewBlocksForReconciliation(document, source);

    expect(reconciliation.blocks.length).toBeGreaterThan(0);
    expect(reconciliation.blocks.every(({ range }) => range.end > range.start)).toBe(true);
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
