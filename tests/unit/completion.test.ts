import { describe, expect, it } from "vitest";
import { analyzeCompletionContext, analyzeDocumentWordContext, analyzeLexicalCompletionContext } from "../../apps/desktop/src/renderer/completion/context.js";
import { completionEndColumn } from "../../apps/desktop/src/renderer/completion/CompletionController.js";
import { ProjectIndex } from "../../apps/desktop/src/renderer/completion/ProjectIndex.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";

function context(line: string) {
  return analyzeCompletionContext({ getLineContent: () => line }, { lineNumber: 1, column: line.length + 1 });
}

function wordContext(line: string) {
  return analyzeDocumentWordContext({ getLineContent: () => line }, { lineNumber: 1, column: line.length + 1 });
}

function lexicalContext(source: string, cursorOffset = source.length) {
  const before = source.slice(0, cursorOffset);
  const lines = source.split("\n");
  const lineNumber = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  const position = { lineNumber, column: cursorOffset - lineStart + 1 };
  return analyzeLexicalCompletionContext({
    getLineContent: (requestedLine) => lines[requestedLine - 1] ?? "",
    getValue: () => source,
    getOffsetAt: () => cursorOffset,
    getVersionId: () => 1
  }, position);
}

describe("v0.2.5 completion index", () => {
  it("detects command, environment, reference, citation, and file contexts", () => {
    expect(context("\\sec")).toMatchObject({ mode: "command", prefix: "sec" });
    expect(context("\\begin{the")).toMatchObject({ mode: "environment", prefix: "the" });
    expect(context("\\ref{thm:")).toMatchObject({ mode: "reference", prefix: "thm:" });
    expect(context("\\cite{chen2006,pat")).toMatchObject({ mode: "citation", prefix: "pat" });
    expect(context("\\citet{chen2006,pat")).toMatchObject({ mode: "citation", prefix: "pat" });
    expect(context("\\citep{chen")).toMatchObject({ mode: "citation", prefix: "chen" });
    expect(context("\\includegraphics{fig")).toMatchObject({ mode: "image-file", prefix: "fig" });
  });

  it("detects document words only in natural-language text", () => {
    expect(wordContext("This com")).toMatchObject({ mode: "document-word", prefix: "com" });
    expect(wordContext("Value $com")).toMatchObject({ mode: "unknown" });
    expect(context("\\cite{com")).toMatchObject({ mode: "citation" });
  });

  it("keeps prose words and mathematical symbols in separate contexts", () => {
    expect(lexicalContext("A normal wor")).toMatchObject({ mode: "document-word", prefix: "wor" });
    expect(lexicalContext("A value $theta + sig", "A value $theta + sig".length)).toMatchObject({ mode: "math-symbol", prefix: "sig" });
    const display = "Before\n\\begin{equation}\nvariance + est\n\\end{equation}\nAfter";
    expect(lexicalContext(display, display.indexOf("est") + 3)).toMatchObject({ mode: "math-symbol", prefix: "est" });
  });

  it("merges project declarations, labels, bibliography entries, environments, and files", () => {
    const index = new ProjectIndex();
    index.rebuild([
      { name: "main.tex", relativePath: "main.tex", kind: "file" },
      { name: "sections", relativePath: "sections", kind: "directory", children: [{ name: "theory.tex", relativePath: "sections/theory.tex", kind: "file" }] },
      { name: "figures", relativePath: "figures", kind: "directory", children: [{ name: "model.png", relativePath: "figures/model.png", kind: "file" }] },
      { name: "references.bib", relativePath: "references.bib", kind: "file" }
    ], [
      { path: "main.tex", content: "\\newcommand{\\Var}{\\operatorname{Var}}\n\\newtheorem{consistency}{Consistency}\n\\label{thm:main}" },
      { path: "references.bib", content: "@article{chen2006,\n  author={Chen and Fan},\n  year={2006},\n  title={Copula models}\n}" }
    ], DEFAULT_ENVIRONMENTS, [{ id: "latex.section", name: "section", insertText: "\\section{${1:title}}", detail: "Section heading", category: "structure" }]);

    expect(index.complete(context("\\Va"), "main.tex").map((item) => item.label)).toContain("\\Var");
    expect(index.complete(context("\\begin{con"), "main.tex").map((item) => item.label)).toContain("consistency");
    expect(index.complete(context("\\ref{thm:"), "main.tex").map((item) => item.label)).toContain("thm:main");
    expect(index.complete(context("\\cite{che"), "main.tex").map((item) => item.label)).toContain("chen2006");
    expect(index.complete(context("\\input{sec"), "main.tex").map((item) => item.insertText)).toContain("sections/theory");
    expect(index.complete(context("\\includegraphics{fig"), "main.tex").map((item) => item.insertText)).toContain("figures/model.png");
    expect(index.complete(wordContext("The con"), "main.tex").map((item) => item.label)).toContain("consistency");
  });

  it("indexes prose words outside math and symbols only inside math", () => {
    const index = new ProjectIndex();
    const content = "A common estimator. $theta + sigma$\\n\\begin{equation}variance + score\\end{equation}\\n\\[matrix + vector\\]";
    index.rebuild([{ name: "main.tex", relativePath: "main.tex", kind: "file" }], [{ path: "main.tex", content }], DEFAULT_ENVIRONMENTS, []);

    const prose = index.complete(lexicalContext("com"), "main.tex").map((item) => item.label);
    expect(prose).toContain("common");
    expect(prose).not.toContain("theta");
    expect(prose).not.toContain("variance");

    const math = index.complete(lexicalContext("$th"), "main.tex").map((item) => item.label);
    expect(math).toContain("theta");
    expect(math).not.toContain("common");
  });

  it("keeps begin completion separate from environment completion", () => {
    const index = new ProjectIndex();
    index.rebuild([], [], DEFAULT_ENVIRONMENTS, [{ id: "latex.begin", name: "begin", insertText: "\\begin{${1}}", detail: "Begin an environment", category: "environment" }]);

    const begin = index.complete(context("\\be"), "main.tex").find((item) => item.label === "\\begin");
    const environment = index.complete(context("\\begin{the"), "main.tex").find((item) => item.label === "theorem");

    expect(begin).toMatchObject({ insertText: "begin{${1}}", snippet: true });
    expect(environment).toMatchObject({ insertText: "theorem}\n\t$0\n\\end{theorem}", snippet: true });
  });

  it("consumes Monaco's auto-closed brace for environment completion", () => {
    expect(completionEndColumn("environment", "\\begin{the}", 11)).toBe(12);
    expect(completionEndColumn("environment", "\\begin{the", 11)).toBe(11);
    expect(completionEndColumn("command", "\\sec", 5)).toBe(5);
  });
});
