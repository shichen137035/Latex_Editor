import { expect, it } from "vitest";
import { buildOutline, outlineTitle } from "../../apps/desktop/src/renderer/workbench/outline.js";

it("displays simple formatting, escaped symbols and math commands as readable titles", () => {
  expect(outlineTitle(String.raw`A \textbf{B \emph{C}} \& D`)).toBe("A B C & D");
  expect(outlineTitle(String.raw`\LaTeX{} and $\alpha + \beta$`)).toBe("LaTeX and α + β");
});

it("reads balanced starred headings with optional arguments and preserves jump lines", () => {
  const source = String.raw`% \section{Ignored}
\section*[Short]{A \textbf{nested {title}} \& more}
\subsection{Next}`;
  expect(buildOutline(source)).toEqual([
    { title: "A nested title & more", level: 1, line: 2 },
    { title: "Next", level: 2, line: 3 }
  ]);
});

it("ignores headings inside macro arguments and escaped commands", () => {
  expect(buildOutline(String.raw`\newcommand{\fake}{\section{Not real}} \\section{Not real}
\section{Real}`)).toEqual([{ title: "Real", level: 1, line: 2 }]);
});
