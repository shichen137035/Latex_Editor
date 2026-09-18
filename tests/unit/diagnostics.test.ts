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
      "LaTeX Warning: There were undefined references.",
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
});
