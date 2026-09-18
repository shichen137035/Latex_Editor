import { describe, expect, it } from "vitest";
import { analyzeCompletionContext, analyzeDocumentWordContext } from "../../apps/desktop/src/renderer/completion/context.js";
import { completionEndColumn } from "../../apps/desktop/src/renderer/completion/CompletionController.js";
import { ProjectIndex } from "../../apps/desktop/src/renderer/completion/ProjectIndex.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";

function context(line: string) {
  return analyzeCompletionContext({ getLineContent: () => line }, { lineNumber: 1, column: line.length + 1 });
}

function wordContext(line: string) {
  return analyzeDocumentWordContext({ getLineContent: () => line }, { lineNumber: 1, column: line.length + 1 });
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
