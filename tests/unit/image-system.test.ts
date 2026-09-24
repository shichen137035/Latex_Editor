import { describe, expect, it } from "vitest";
import { defaultImagePreferences } from "@latex-editor/contracts";
import { emptyFigureInsertion, emptyMultiImageInsertion, imageInsertion, multiImageInsertion } from "../../apps/desktop/src/renderer/figure/insert.js";
import { parseFigure, parseGraphicPaths } from "../../apps/desktop/src/renderer/figure/parser.js";
import { patchFigureSource } from "../../apps/desktop/src/renderer/figure/patch.js";

describe("image system", () => {
  const source = String.raw`\begin{figure}[tb]
  \centering
  \includegraphics[width=.7\textwidth,custom={a,b}]{figures/old}
  \caption{Old caption}
  \label{fig:old}
\end{figure}`;

  it("parses figure metadata and unknown options", () => {
    const figure = parseFigure(source)!;
    expect(figure.environment).toBe("figure");
    expect(figure.placement).toBe("tb");
    expect(figure.images[0]?.sourcePath).toBe("figures/old");
    expect(figure.images[0]?.options.map((item) => item.key)).toEqual(["width", "custom"]);
  });

  it("patches supported fields without replacing unknown LaTeX", () => {
    const result = patchFigureSource(source, { width: ".5\\textwidth", caption: "New", alignment: "right" });
    expect(result).toContain("custom={a,b}");
    expect(result).toContain("width=.5\\textwidth");
    expect(result).toContain("\\raggedleft");
    expect(result).toContain("\\caption{New}");
  });

  it("creates configured figure source and parses graphicspath", () => {
    const insertion = imageInsertion("figures/chart.png", defaultImagePreferences, "figure");
    expect(insertion.text).toContain("\\includegraphics[width=0.8\\textwidth]{figures/chart.png}");
    expect(insertion.text).toContain("\\label{fig:chart}");
    expect(parseGraphicPaths(String.raw`\graphicspath{{figures/}{assets/plots/}}`)).toEqual(["figures/", "assets/plots/"]);
  });

  it("creates a subfigure layout for multiple selected images", () => {
    const insertion = multiImageInsertion(["figures/a.png", "figures/b.pdf"], defaultImagePreferences);
    expect(insertion.text.match(/\\begin\{subfigure\}/g)).toHaveLength(2);
    expect(parseFigure(insertion.text)?.images).toHaveLength(2);
  });

  it("creates editable empty single and multi-image slots", () => {
    const empty = emptyFigureInsertion(defaultImagePreferences);
    expect(parseFigure(empty.text)?.images[0]?.sourcePath).toBe("");
    expect(patchFigureSource(empty.text, { imageIndex: 0, sourcePath: "figures/chosen.png" })).toContain("{figures/chosen.png}");
    const grid = emptyMultiImageInsertion(2, 2, defaultImagePreferences);
    expect(parseFigure(grid.text)?.images).toHaveLength(4);
  });
});
