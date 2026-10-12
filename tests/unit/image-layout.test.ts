import { describe, expect, it, vi } from "vitest";
import { defaultImagePreferences } from "@latex-editor/contracts";
import { figureLayout, resizeFigureLayout, swapFigureSlots, preferredSubfigureSyntax, automaticSubfigureWidth } from "../../apps/desktop/src/renderer/figure/layout.js";
import { parseFigure } from "../../apps/desktop/src/renderer/figure/parser.js";
import { patchFigureSource } from "../../apps/desktop/src/renderer/figure/patch.js";
import { addFigurePackage } from "../../apps/desktop/src/renderer/figure/packages.js";
import { planFigureEdit } from "../../apps/desktop/src/renderer/workbench/figureEditing.js";

const single = String.raw`\begin{figure*}[tb]
  \centering
  \includegraphics*[width=.8\textwidth,angle=5,custom={a,b}]{figures/a.pdf}
  \caption[Short]{Outer \textbf{caption}}
  \label{fig:outer}
\end{figure*}`;

describe("image grid geometry and drag operations", () => {
  it("converts a single image to an explicit vertical grid with a selectable empty slot", () => {
    const grid = resizeFigureLayout(single, 2, 1, defaultImagePreferences);
    const layout = figureLayout(grid)!;
    expect([layout.rows, layout.columns]).toEqual([2, 1]);
    expect(layout.slots.map(slot => slot.image?.sourcePath)).toEqual(["figures/a.pdf", ""]);
    expect(grid).toContain(String.raw`\begin{figure*}[tb]`);
    expect(grid).toContain(String.raw`\caption[Short]{Outer \textbf{caption}}`);
    expect(grid).toContain("custom={a,b}");
    expect(grid).toContain("\\includegraphics*");
    expect(parseFigure(grid)?.label).toBe("fig:outer");
    expect(grid).toContain(String.raw`\[1em]`);
    const moved = swapFigureSlots(grid, 0, 1);
    expect(figureLayout(moved)?.slots.map(slot => slot.image?.sourcePath)).toEqual(["", "figures/a.pdf"]);
    expect([figureLayout(moved)?.rows, figureLayout(moved)?.columns]).toEqual([2, 1]);
    expect(swapFigureSlots(moved, 1, 0)).toBe(grid);
  });

  it("reflows existing subfigure units while keeping captions, labels, custom content and comments", () => {
    const input = String.raw`\begin{figure}
\begin{subfigure}[t]{.4\textwidth}\includegraphics[angle=90]{a.png}\caption{A}\label{fig:a}\mycustom{keep}\end{subfigure}
\hfill % keep comment
\begin{subfigure}{.4\textwidth}\includegraphics{b.png}\caption{B}\label{fig:b}\end{subfigure}
\caption{Outer}\label{fig:outer}\end{figure}`;
    const grid = resizeFigureLayout(input, 2, 1, defaultImagePreferences);
    const swapped = swapFigureSlots(grid, 0, 1);
    expect(parseFigure(swapped)?.subfigures.map(child => [child.caption, child.label, child.images[0]?.sourcePath])).toEqual([["B", "fig:b", "b.png"], ["A", "fig:a", "a.png"]]);
    expect(swapped).toContain("\\mycustom{keep}"); expect(swapped).toContain("% keep comment");
    expect(parseFigure(swapped)?.caption).toBe("Outer");
    expect(parseFigure(swapped)?.label).toBe("fig:outer");
  });

  it("supports subfig syntax and patches outer labels without corrupting child labels", () => {
    const input = String.raw`\begin{figure}\subfloat[First]{\includegraphics[width=.4\textwidth]{a.pdf}\label{fig:a}}\hfill\subfloat[Second]{\includegraphics{b.pdf}\label{fig:b}}\caption{Outer}\label{fig:outer}\end{figure}`;
    const grid = resizeFigureLayout(input, 2, 1, defaultImagePreferences);
    expect(figureLayout(grid)?.syntax).toBe("subfloat");
    expect(parseFigure(grid)?.subfigures.map(child => child.caption)).toEqual(["First", "Second"]);
    const moved = swapFigureSlots(grid, 0, 1);
    expect(parseFigure(moved)?.subfigures.map(child => child.label)).toEqual(["fig:b", "fig:a"]);
    const patched = patchFigureSource(moved, { label: "fig:renamed", caption: "Changed outer" });
    expect(parseFigure(patched)?.label).toBe("fig:renamed");
    expect(parseFigure(patched)?.subfigures.map(child => child.label)).toEqual(["fig:b", "fig:a"]);
    expect(parseFigure(patched)?.caption).toBe("Changed outer");
  });

  it("does not discard filled cells or metadata when a grid is reduced", () => {
    const grid = resizeFigureLayout(single, 1, 2, defaultImagePreferences);
    const filled = patchFigureSource(grid, { imageIndex: 1, sourcePath: "b.pdf" });
    expect(() => resizeFigureLayout(filled, 1, 1, defaultImagePreferences)).toThrow("capacity");
    const withMetadata = grid.replace(/\\caption\{\}/, "\\caption{Preserved child}");
    expect(parseFigure(resizeFigureLayout(withMetadata, 1, 1, defaultImagePreferences))?.subfigures[0]?.caption).toBe("Preserved child");
    const emptyChild = parseFigure(grid)!.subfigures[1]!;
    const beforeEnd = emptyChild.sourceRange.end - "\\end{subfigure}".length;
    const emptyButCustom = grid.slice(0, beforeEnd) + "\\mycustom{keep}" + grid.slice(beforeEnd);
    expect(() => resizeFigureLayout(emptyButCustom, 1, 1, defaultImagePreferences)).toThrow("capacity");
  });

  it("refuses complex wrappers and unknown inter-image source rather than deleting them", () => {
    expect(figureLayout(String.raw`\begin{figure}\resizebox{.8\textwidth}{!}{\includegraphics{a.pdf}}\end{figure}`)?.supported).toBe(false);
    const customGap = String.raw`\begin{figure}\includegraphics{a.pdf}\unknowncommand{keep}\includegraphics{b.pdf}\end{figure}`;
    expect(() => resizeFigureLayout(customGap, 2, 1, defaultImagePreferences)).toThrow("complex");
    expect(swapFigureSlots(customGap, 0, 1)).toContain("\\unknowncommand{keep}");
  });

  it("uses package-aware syntax and sane widths for custom six-column grids", () => {
    expect(preferredSubfigureSyntax(String.raw`\documentclass{IEEEtran}`)).toBe("subfloat");
    expect(preferredSubfigureSyntax(String.raw`% \usepackage{subfig}
\documentclass{article}`)).toBe("subfigure");
    const grid = resizeFigureLayout(single, 1, 6, defaultImagePreferences, "subfloat");
    expect(parseFigure(grid)?.subfigures).toHaveLength(6);
    expect(parseFloat(automaticSubfigureWidth(6)) * 6).toBeLessThan(1);
    expect(figureLayout(resizeFigureLayout(single, Number.NaN, Number.POSITIVE_INFINITY, defaultImagePreferences))?.slots).toHaveLength(1);
  });
});

describe("image layout preamble edits", () => {
  it("adds the required package before the document body and avoids comments/conflicts", () => {
    const source = String.raw`\documentclass{article}
% \usepackage{subcaption}
\begin{document}Body.\end{document}`;
    const added = addFigurePackage(source, "subcaption");
    expect(added.source.indexOf("\\usepackage{subcaption}", added.offset)).toBeLessThan(added.source.indexOf("\\begin{document}"));
    expect(addFigurePackage(added.source, "subcaption").length).toBe(0);
    expect(() => addFigurePackage(source, "subcaption", String.raw`\usepackage[caption=false]{subfig}`)).toThrow("packageConflict");
    expect(addFigurePackage(String.raw`\documentclass{IEEEtran}\begin{document}`, "subfig").source).toContain("\\usepackage[caption=false]{subfig}");
  });

  it("places a chapter's package in the main preamble and preserves edits outside the figure", async () => {
    const replacement = resizeFigureLayout(single, 1, 2, defaultImagePreferences);
    const chapter = { path: "chapter.tex", content: "Before.\n" + single + "\nAfter." };
    const selection = { fileId: chapter.path, start: 8, end: 8 + single.length, source: single };
    const main = String.raw`\documentclass{article}\begin{document}\input{chapter}\end{document}`;
    const read = vi.fn(async () => main);
    const plan = await planFigureEdit(selection, replacement, { mainFile: "main.tex", activePath: () => chapter.path, documents: () => [chapter], documentFiles: () => ["main.tex", "chapter.tex"], read });
    expect(read).toHaveBeenCalledWith("main.tex");
    expect(plan.preamble?.document.path).toBe("main.tex");
    expect(plan.preamble?.document.content).toContain("\\usepackage{subcaption}");
    expect(plan.document.content).not.toContain("\\usepackage");
    expect(plan.document.content).toContain("Before.\n"); expect(plan.document.content).toContain("\nAfter.");
    expect(plan.selection.start).toBe(selection.start);
  });

  it("remaps a figure in the same main file and reuses packages in included preambles", async () => {
    const source = String.raw`\documentclass{article}\begin{document}` + single + String.raw`\end{document}`;
    const start = source.indexOf("\\begin{figure"), replacement = resizeFigureLayout(single, 2, 1, defaultImagePreferences);
    const main = { path: "main.tex", content: source };
    const selection = { fileId: main.path, start, end: start + single.length, source: single };
    const options = { mainFile: main.path, activePath: () => main.path, documents: () => [main], documentFiles: () => [main.path], read: vi.fn(async () => source) };
    const plan = await planFigureEdit(selection, replacement, options);
    expect(plan.selection.start).toBeGreaterThan(start);
    expect(plan.document.content.slice(plan.selection.start, plan.selection.end)).toBe(replacement);
    const loaded = { path: "preamble.sty", content: String.raw`\RequirePackage{subcaption}` };
    const reused = await planFigureEdit(selection, replacement, { ...options, documents: () => [main, loaded], documentFiles: () => [main.path, loaded.path] });
    expect(reused.selection.start).toBe(start);
    expect(reused.document.content).not.toContain("\\usepackage{subcaption}");
  });

  it("rejects a figure that changes while its main preamble is being read", async () => {
    let current = { path: "chapter.tex", content: single };
    await expect(planFigureEdit({ fileId: current.path, start: 0, end: single.length, source: single }, resizeFigureLayout(single, 2, 1, defaultImagePreferences), {
      mainFile: "main.tex", activePath: () => current.path, documents: () => [current], documentFiles: () => [], read: async () => { current = { ...current, content: "Changed chapter" }; return String.raw`\documentclass{article}\begin{document}`; }
    })).rejects.toThrow("changed");
  });
});
