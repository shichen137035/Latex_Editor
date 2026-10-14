import { describe, expect, it } from "vitest";
import { latexFoldingRanges } from "../../apps/desktop/src/renderer/editor/latexFolding.js";

describe("LaTeX source folding", () => {
  it("folds nested and custom environments at matched delimiters without indentation", () => {
    expect(latexFoldingRanges("\\begin{document}\n\\begin{custom}\ncontent\n\\end{custom}\noutside\n\\end{document}")).toEqual([{ start: 1, end: 6 }, { start: 2, end: 4 }]);
    expect(latexFoldingRanges("plain\n  indented\n    more indented\nplain")).toEqual([]);
  });
  it("ends sections at the next appropriate heading and the enclosing environment", () => {
    expect(latexFoldingRanges("\\begin{document}\n\\section{Proof of Theorem~\\ref{thm:a}}\ntext\n\\subsection*[Short]{Nested {title}}\nbody\n\\section{Next}\nbody\n\\end{document}\nafter")).toEqual([{ start: 1, end: 8 }, { start: 2, end: 5 }, { start: 4, end: 5 }, { start: 6, end: 7 }]);
  });
  it("ignores comments, escaped commands and literal source environments", () => {
    expect(latexFoldingRanges("% \\begin{fake}\n\\\\begin{fake}\n\\begin{verbatim}\n\\section{Not a heading}\n$$\n\\end{verbatim}\nafter")).toEqual([{ start: 3, end: 6 }]);
  });
  it("uses display math boundaries across lines and ignores commands inside math", () => {
    expect(latexFoldingRanges("$$\nx +\n y\n$$\n\\[\nx = \\text{\\section{literal}}\n\\]\n$x\n+y$\nafter")).toEqual([{ start: 1, end: 4 }, { start: 5, end: 7 }]);
  });
  it("folds balanced multiline groups without inventing unmatched environment ends", () => {
    expect(latexFoldingRanges("\\command{\ntext\n}\n\\begin{unfinished}\ntext")).toEqual([{ start: 1, end: 3 }]);
  });
});
