import { describe, expect, it } from "vitest";
import { formatLatexSource } from "../../apps/desktop/src/renderer/editor/latexFormatter.js";

const spaces = { insertSpaces: true, tabSize: 2 };

describe("LaTeX source formatter", () => {
  it("indents environment bodies and aligns closing environments", () => {
    const source = [
      "\\begin{document}",
      "\\section{Intro}",
      "\\begin{itemize}",
      "\\item First",
      "\\end{itemize}",
      "\\end{document}"
    ].join("\n");

    expect(formatLatexSource(source, spaces)).toBe([
      "\\begin{document}",
      "  \\section{Intro}",
      "  \\begin{itemize}",
      "    \\item First",
      "  \\end{itemize}",
      "\\end{document}"
    ].join("\n"));
  });

  it("ignores environment commands in comments and inline verbatim", () => {
    const source = [
      "\\begin{document}",
      "% \\end{document}",
      "\\verb|\\end{document}|",
      "Text \\% literal",
      "\\end{document}"
    ].join("\n");

    expect(formatLatexSource(source, spaces)).toBe([
      "\\begin{document}",
      "  % \\end{document}",
      "  \\verb|\\end{document}|",
      "  Text \\% literal",
      "\\end{document}"
    ].join("\n"));
  });

  it("preserves verbatim environment contents and line endings", () => {
    const source = "\\begin{verbatim}\r\n  keep this indentation  \r\n\\end{verbatim}\r\n\\begin{document}\r\ntext\r\n\\end{document}\r\n";
    expect(formatLatexSource(source, spaces)).toBe("\\begin{verbatim}\r\n  keep this indentation  \r\n\\end{verbatim}\r\n\\begin{document}\r\n  text\r\n\\end{document}\r\n");
  });

  it("uses tabs when the editor requests them and leaves already formatted source unchanged", () => {
    expect(formatLatexSource("\\begin{document}\ntext\n\\end{document}", { insertSpaces: false, tabSize: 4 }))
      .toBe("\\begin{document}\n\ttext\n\\end{document}");
    const formatted = "\\begin{document}\n  text\n\\end{document}";
    expect(formatLatexSource(formatted, spaces)).toBe(formatted);
  });
});
