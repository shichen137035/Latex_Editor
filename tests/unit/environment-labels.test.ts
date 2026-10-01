import { describe, expect, it } from "vitest";
import { addCommandLabel, addEnvironmentLabel, findBlockLabel, isAutomaticEnvironmentLabel, nextAutomaticEnvironmentLabel, nextAutomaticLabel, upsertBlockLabel } from "../../apps/desktop/src/renderer/preview/labels.js";
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

describe("Preview label commit ownership", () => {
  it("adds labels to compact one-line environments", () => {
    const result = upsertBlockLabel(String.raw`\begin{equation}x=y\end{equation}`, "eq:new", null);
    expect(result).toContain(String.raw`\label{eq:new}`);
    expect(parsePreview(result, "main.tex", DEFAULT_ENVIRONMENTS).nodes[0]).toMatchObject({ latexLabel: "eq:new" });
  });

  it("keeps required environment arguments before inserted labels", () => {
    expect(addEnvironmentLabel(String.raw`\begin{tabular}{>{\bfseries}ll}A&B\\\end{tabular}`, "tab:new"))
      .toContain(String.raw`\begin{tabular}{>{\bfseries}ll}` + "\n  \\label{tab:new}\n");
  });

  it("round-trips bracketed display math labels", () => {
    const result = upsertBlockLabel(String.raw`\[x=y\]`, "eq:display", null);
    expect(parsePreview(result, "main.tex", DEFAULT_ENVIRONMENTS).nodes[0]).toMatchObject({ latexLabel: "eq:display", labelSource: { startOffset: result.indexOf("\\label{") } });
  });

  it("does not inherit or overwrite a descendant's label", () => {
    const source = String.raw`\section{Parent}
\begin{theorem}
\label{thm:child}
Text.
\end{theorem}`;
    const section = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS).nodes[0];
    expect(section).not.toHaveProperty("latexLabel");
    const edited = upsertBlockLabel(source, "sec:parent", null);
    expect(edited).toContain(String.raw`\label{thm:child}`);
    expect(parsePreview(edited, "main.tex", DEFAULT_ENVIRONMENTS).nodes[0]).toMatchObject({ latexLabel: "sec:parent" });
  });

  it("ignores comments and escaped label-like text, but accepts label whitespace", () => {
    const source = String.raw`\begin{theorem}
% \label{comment}
\\label{escaped}
\label {real:label}
\end{theorem}`;
    expect(findBlockLabel(source)?.label).toBe("real:label");
    expect(parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS).nodes[0]).toMatchObject({ latexLabel: "real:label" });
  });

  it("keeps labels inside an equation's aligned body owned by that equation", () => {
    const source = String.raw`\begin{equation}\begin{aligned}x&=y\label{eq:aligned}\end{aligned}\end{equation}`;
    expect(parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS).nodes[0]).toMatchObject({ latexLabel: "eq:aligned" });
  });

  it("treats label contents as literal replacement text", () => {
    expect(upsertBlockLabel(String.raw`\begin{equation}\label{old}x=y\end{equation}`, "eq:$&")).toContain(String.raw`\label{eq:$&}`);
    expect(upsertBlockLabel(String.raw`\[x=y\]`, "eq:$&", null)).toContain(String.raw`\label{eq:$&}`);
  });
});
