import { describe, expect, it } from "vitest";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";
import { buildPreviewRenderIndex, estimatedPreviewHeight, previewPath, reusePreviewDocument } from "../../apps/desktop/src/renderer/preview/renderModel.js";
import { virtualWindow } from "../../apps/desktop/src/renderer/preview/VirtualPreview.js";
import { MathRenderService } from "../../apps/desktop/src/renderer/math/MathRenderService.js";
import { MathMacroRegistry } from "../../apps/desktop/src/renderer/math/MathMacroRegistry.js";

describe("v0.6.1 preview render model", () => {
  it("recognizes balanced section titles and keeps nested references out of the body", () => {
    const title = String.raw`Proof of Theorem~\ref{thm:identification}`;
    const source = `\\section{${title}}\nProof body.\n\\subsection*[Short]{A \\textbf{nested {title}}}\nNext body.`;
    const entries = buildPreviewRenderIndex(parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS).nodes).entries;
    const section = entries.find(entry => entry.node.kind === "block" && entry.node.environmentId === "section")?.node;
    expect(section?.kind).toBe("block");
    if (!section || section.kind !== "block") throw new Error("Missing section");
    expect(section.title).toBe(title);
    expect(section.semanticKind).toBe("structural");
    expect(section.body.startOffset).toBe(source.indexOf("\nProof body."));
    expect(section.children.some(node => node.kind === "block" && node.title === String.raw`A \textbf{nested {title}}`)).toBe(true);
  });

  it("does not create sections from commented, escaped or macro-contained commands", () => {
    const source = String.raw`% \section{Ignored}
\newcommand{\fake}{\section{Macro}}
\\section{Escaped}
\section{Real \emph{heading}}`;
    const entries = buildPreviewRenderIndex(parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS).nodes).entries;
    const sections = entries.filter(entry => entry.node.kind === "block" && entry.node.environmentId === "section");
    expect(sections.map(entry => entry.node.kind === "block" ? entry.node.title : "")).toEqual([String.raw`Real \emph{heading}`]);
  });

  it("treats paragraph headings as structural while keeping their prose independently editable", () => {
    const source = "\\section{Section}\n\\paragraph{Heading}\nFirst body paragraph.\n\nSecond body paragraph.\n\\begin{theorem}Nested theorem.\\end{theorem}";
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const entries = buildPreviewRenderIndex(document.nodes).entries;
    const heading = entries.find((entry) => entry.node.kind === "block" && entry.node.environmentId === "paragraph")?.node;
    expect(heading?.kind).toBe("block");
    if (!heading || heading.kind !== "block") throw new Error("Missing paragraph heading");
    expect(heading.semanticKind).toBe("structural");
    expect(heading.children.filter((node) => node.kind === "content" && node.contentType === "paragraph")).toHaveLength(2);
    expect(heading.children.some((node) => node.kind === "block" && node.environmentId === "theorem")).toBe(true);
  });

  it("keeps a block's visual identity after an earlier insertion and reuses unchanged subtrees", () => {
    const firstSource = "\\begin{document}\n\\section{One}\nFirst paragraph.\n\\section{Two}\\label{sec:two}\nSecond paragraph.\n\\end{document}";
    const shiftedSource = firstSource.replace("\\section{One}", "\\section{One}\nExtra opening paragraph.");
    let sequence = 0;
    const nextId = () => `visual:${++sequence}`;
    const first = reusePreviewDocument(undefined, undefined, parsePreview(firstSource, "main.tex", DEFAULT_ENVIRONMENTS), firstSource, nextId);
    const shifted = reusePreviewDocument(first, firstSource, parsePreview(shiftedSource, "main.tex", DEFAULT_ENVIRONMENTS), shiftedSource, nextId);
    const originalSecond = buildPreviewRenderIndex(first.nodes).entries.find((entry) => entry.node.kind === "block" && entry.node.title === "Two");
    const nextSecond = buildPreviewRenderIndex(shifted.nodes).entries.find((entry) => entry.node.kind === "block" && entry.node.title === "Two");
    expect(nextSecond?.id).toBe(originalSecond?.id);
    expect(nextSecond?.node.source.startOffset).toBeGreaterThan(originalSecond!.node.source.startOffset);
    expect(nextSecond?.node.parserId).not.toBe(originalSecond?.node.parserId);
    expect(previewPath(buildPreviewRenderIndex(shifted.nodes), nextSecond!.id).has(nextSecond!.id)).toBe(true);

    const same = reusePreviewDocument(shifted, shiftedSource, parsePreview(shiftedSource, "main.tex", DEFAULT_ENVIRONMENTS), shiftedSource, nextId);
    expect(same.nodes[0]).toBe(shifted.nodes[0]);
  });

  it("windows a long list around the viewport without accumulating visited rows", () => {
    const heights = Array.from({ length: 1500 }, () => 100);
    const first = virtualWindow(heights, 0, 700, 500);
    const middle = virtualWindow(heights, 75_000, 700, 500);
    const last = virtualWindow(heights, 149_300, 700, 500);
    expect(first.indices.length).toBeLessThan(25);
    expect(middle.indices.length).toBeLessThan(25);
    expect(last.indices.length).toBeLessThan(25);
    expect(middle.indices[0]).toBeGreaterThan(700);
    expect(last.indices.at(-1)).toBe(1499);
  });

  it("keeps the identity but refreshes a same-length edited formula and estimates long lists", () => {
    const beforeSource = "\\begin{equation}x+y\\end{equation}";
    const afterSource = "\\begin{equation}x+z\\end{equation}";
    let sequence = 0;
    const nextId = () => `math:${++sequence}`;
    const before = reusePreviewDocument(undefined, undefined, parsePreview(beforeSource, "main.tex", DEFAULT_ENVIRONMENTS), beforeSource, nextId);
    const after = reusePreviewDocument(before, beforeSource, parsePreview(afterSource, "main.tex", DEFAULT_ENVIRONMENTS), afterSource, nextId);
    expect(after.nodes[0]?.id).toBe(before.nodes[0]?.id);
    expect(after.nodes[0]).not.toBe(before.nodes[0]);
    const listSource = `\\begin{itemize}\n${Array.from({ length: 500 }, (_, index) => `\\item Item ${index}\n`).join("")}\\end{itemize}`;
    const list = parsePreview(listSource, "main.tex", DEFAULT_ENVIRONMENTS).nodes[0];
    expect(list && estimatedPreviewHeight(list)).toBeGreaterThan(20_000);
  });

  it("reuses KaTeX output and invalidates the cache when macros change", () => {
    const service = new MathRenderService();
    const context = { macros: { "\\R": "\\mathbb{R}" }, operators: {}, sourceVersion: 1 };
    const first = service.render("\\R", context, { displayMode: false });
    const again = service.render("\\R", context, { displayMode: false });
    expect(again).toBe(first);
    expect(service.stats().hits).toBe(1);
    const changed = service.render("\\R", { macros: { "\\R": "\\mathbb{Q}" }, operators: {}, sourceVersion: 1 }, { displayMode: false });
    expect(changed.html).not.toBe(first.html);

    const registry = new MathMacroRegistry();
    const originalVersion = registry.rebuild([{ path: "main.tex", content: "\\newcommand{\\R}{\\mathbb{R}}\nText" }]).sourceVersion;
    const proseVersion = registry.rebuild([{ path: "main.tex", content: "\\newcommand{\\R}{\\mathbb{R}}\nEdited text" }]).sourceVersion;
    expect(proseVersion).toBe(originalVersion);
    expect(registry.rebuild([{ path: "main.tex", content: "\\newcommand{\\R}{\\mathbb{Q}}" }]).sourceVersion).not.toBe(originalVersion);
  });
});
