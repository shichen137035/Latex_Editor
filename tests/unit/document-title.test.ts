import { describe, expect, it } from "vitest";
import { parsePreview } from "../../packages/editor-core/src/preview/parser.js";
import { tryIncrementalPreviewUpdate } from "../../packages/editor-core/src/preview/incremental.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";

const parse = (source: string) => parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
describe("document title source object", () => {
  it("retains complex preamble metadata and its exact source range", () => {
    const prefix = "\\documentclass{article}\n\\usepackage{authblk}\n";
    const titleSource = "\\title[Short]{A \\textbf{complex $x$} title}\n% author layout\n\\author[1]{Alice\\thanks{Nested {note}}}\n\\affil[1]{University \\textit{Lab}}\n\\date{}\n\\begin{document}\n\\maketitle";
    const suffix = "\n\\section{Intro}\nBody text.\n\\end{document}";
    const document = parse(prefix + titleSource + suffix);
    expect(document.title).toMatchObject({ title: "A \\textbf{complex $x$} title", author: "Alice\\thanks{Nested {note}}", date: "" });
    expect((prefix + titleSource + suffix).slice(document.title!.source.startOffset, document.title!.source.endOffset)).toBe(titleSource);
    const replacement = titleSource.replace("complex", "updated");
    const range = document.title!.source;
    const next = (prefix + titleSource + suffix).slice(0, range.startOffset) + replacement + (prefix + titleSource + suffix).slice(range.endOffset);
    expect(next).toBe(prefix + replacement + suffix);
    expect(parse(next).title?.title).toContain("updated");
  });
  it("recognizes title declarations inside the document and keeps publisher metadata out of prose", () => {
    const source = "\\begin{document}\nBefore.\n\n\\title{Body title}\n\\author{Author}\n\\affiliation{Custom institute}\n\\maketitle\n\nAfter.\n\\end{document}";
    const document = parse(source);
    expect(document.title?.title).toBe("Body title");
    expect(document.nodes.map(node => source.slice(node.source.startOffset, node.source.endOffset)).join("\n")).toBe("Before.\nAfter.");
  });
  it("ignores comments, escaped commands and macro definitions and uses the latest declaration", () => {
    const source = "\\newcommand{\\dummy}{\\title{Fake}\\maketitle}\n% \\title{Comment}\n\\title{Old}\n\\title{Actual {nested} title}\n\\begin{document}\n% \\maketitle\n\\maketitle\nBody.\\end{document}";
    expect(parse(source).title?.title).toBe("Actual {nested} title");
    expect(parse("\\title{Hidden}\n\\begin{document}\n\\\\maketitle\nBody.\\end{document}").title).toBeUndefined();
    expect(parse("\\title{Hidden}\n\\begin{document}\n% \\maketitle\nBody.\\end{document}").title).toBeUndefined();
  });
  it("refreshes title ranges when earlier text changes while keeping later prose incremental", () => {
    const source = "\\title{Title}\n\\begin{document}\n\\maketitle\n\nBody text.\n\\end{document}";
    const document = parse(source);
    expect(tryIncrementalPreviewUpdate(document, source, "% Prefix\n" + source, "main.tex", DEFAULT_ENVIRONMENTS)).toMatchObject({ fallbackReason: "structural-change" });
    const next = source.replace("Body text.", "Updated text.");
    const result = tryIncrementalPreviewUpdate(document, source, next, "main.tex", DEFAULT_ENVIRONMENTS);
    expect("document" in result && result.document.title).toEqual(document.title);
  });
});
