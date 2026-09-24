import { describe, expect, it } from "vitest";
import { addCommandLabel, addEnvironmentLabel, isAutomaticEnvironmentLabel, nextAutomaticEnvironmentLabel, nextAutomaticLabel } from "../../apps/desktop/src/renderer/preview/labels.js";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";

describe("automatic environment labels", () => {
  it("creates a unique environment-based label and keeps the body cursor area open", () => {
    const definition = DEFAULT_ENVIRONMENTS.find((item) => item.id === "theorem");
    if (!definition) throw new Error("theorem definition missing");
    const source = String.raw`\documentclass{article}
\begin{document}
\end{document}`;
    const label = nextAutomaticEnvironmentLabel(source, definition);
    expect(label).toBe("theorem:1");
    expect(addEnvironmentLabel(String.raw`\begin{theorem}
  
\end{theorem}`, label)).toContain("\\label{theorem:1}");
  });

  it("marks generated-looking labels while leaving edited labels ordinary", () => {
    const source = String.raw`\begin{theorem}
\label{theorem:1}
A
\end{theorem}
\begin{theorem}
\label{custom:second}
B
\end{theorem}`;
    const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const blocks = document.nodes.filter((node) => node.kind === "block");
    expect(blocks[0]).toMatchObject({ latexLabel: "theorem:1", autoLabel: true });
    expect(blocks[1]).toMatchObject({ latexLabel: "custom:second" });
    expect(blocks[1]).not.toHaveProperty("autoLabel");
    expect(isAutomaticEnvironmentLabel(source, source.indexOf("\\begin{theorem}"), "theorem", "theorem:1")).toBe(true);
  });

  it("supports section commands as labelable blocks", () => {
    const definition = DEFAULT_ENVIRONMENTS.find((item) => item.id === "section");
    if (!definition) throw new Error("section definition missing");
    const source = String.raw`\section{Introduction}
\section{Method}`;
    expect(nextAutomaticLabel(source, definition)).toBe("section:3");
    expect(addCommandLabel(String.raw`\section{Results}`, "section:3")).toBe(String.raw`\section{Results}\label{section:3}`);
    const document = parsePreview(String.raw`\section{Introduction}\label{section:1}
Text`, "main.tex", DEFAULT_ENVIRONMENTS);
    expect(document.nodes[0]).toMatchObject({ latexLabel: "section:1", autoLabel: true });
  });
});
