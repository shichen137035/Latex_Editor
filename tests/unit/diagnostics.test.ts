import { describe, expect, it } from "vitest";
import { parseLatexDiagnostics } from "../../packages/diagnostics/src/index.js";

describe("Diagnostic parser", () => {
  it("CO-002 parses file-line and TeX errors", () => {
    const diagnostics = parseLatexDiagnostics("main.tex:7: Undefined control sequence.\n! Another error.\nl.9 bad");
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", file: "main.tex", line: 7 }),
      expect.objectContaining({ severity: "error", line: 9, message: "Another error." })
    ]));
  });

  it("CO-003 CO-004 parses warnings and missing files without crashing on unknown lines", () => {
    const diagnostics = parseLatexDiagnostics([
      "unknown custom output",
      "LaTeX Warning: Reference `sec:intro' on page 1 undefined.",
      "LaTeX Error: File `missing-package.sty' not found.",
      "Overfull \\hbox (1.0pt too wide) in paragraph at lines 6--7"
    ].join("\n"));
    expect(diagnostics.some((item) => item.code === "UNDEFINED_REFERENCE")).toBe(true);
    expect(diagnostics.some((item) => item.code === "MISSING_FILE")).toBe(true);
    expect(diagnostics.some((item) => item.code === "BOX_WARNING")).toBe(true);
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "BOX_WARNING", line: 6 }));
  });

  it("attaches contextual warning locations to the compilation main file", () => {
    const diagnostics = parseLatexDiagnostics("LaTeX Warning: Reference `sec:intro' on input line 12 undefined.", "D:/paper", "main.tex");
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "UNDEFINED_REFERENCE", file: "main.tex", line: 12 }));
  });

  it("collects TeX errors across lines and avoids duplicate missing-file reports", () => {
    const diagnostics = parseLatexDiagnostics("! LaTeX Error: File `custom.sty' not found.\nl.4 \\usepackage{custom}");
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: "error", category: "package", code: "MISSING_FILE", line: 4 });
    expect(diagnostics[0]?.rawExcerpt).toContain("! LaTeX Error");
  });

  it("recognizes a missing package when TeX wraps 'not found' mid-word", () => {
    const diagnostics = parseLatexDiagnostics([
      "! LaTeX Error: File `example-package.sty' not fou",
      "nd.",
      "Type X to quit or <RETURN> to proceed,",
      "main.tex:3: Emergency stop."
    ].join("\n"), undefined, "main.tex");
    expect(diagnostics).toContainEqual(expect.objectContaining({
      severity: "error",
      category: "package",
      code: "MISSING_FILE",
      message: "Required file or package not found: example-package.sty"
    }));
  });

  it("classifies package diagnostics, identifies Biber output, and aggregates repeated layout warnings", () => {
    const diagnostics = parseLatexDiagnostics([
      "Package cleveref Warning: cref reference format for label type `lemma' undefined.",
      "This is Biber 2.19",
      "ERROR - Cannot find 'references.bib'!",
      "Overfull \\hbox (2pt too wide) in paragraph at lines 8--9",
      "Overfull \\hbox (2pt too wide) in paragraph at lines 8--9"
    ].join("\n"), undefined, "main.tex");
    expect(diagnostics).toContainEqual(expect.objectContaining({ source: "package", category: "reference", severity: "warning" }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ source: "biber", category: "bibliography", severity: "error" }));
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: "BOX_WARNING", occurrences: 2, line: 8 }));
  });
});
