import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { compilationTargets, pdfFileForSource, projectPdfFile, previewDocumentForSource, projectPdfLink } from "../../apps/desktop/src/renderer/workbench/compileTargets.js";
import { documentOutputDirectory, targetOutputArguments } from "../../packages/compiler-latexmk/src/output.js";
import { externalDocumentPlan } from "../../packages/compiler-latexmk/src/document-dependencies.js";
import { isStandaloneLatexDocument, latexDocumentLinks, latexDocumentPathCandidates } from "../../packages/editor-core/src/latex-source.js";
import type { ProjectPdfDocument } from "@latex-editor/contracts";

describe("multiple document compilation", () => {
  it("selects only TeX files and avoids compiling the primary twice", () => {
    expect(compilationTargets("nested/main.tex", "nested\\main.tex")).toEqual(["nested/main.tex"]);
    expect(compilationTargets("main.tex", "other.TEX")).toEqual(["main.tex", "other.TEX"]);
    expect(compilationTargets("main.tex", "refs.bib")).toEqual(["main.tex"]);
    expect(compilationTargets("main.tex")).toEqual(["main.tex"]);
    expect(pdfFileForSource("nested\\other.TEX")).toBe("other.pdf");
  });
  it("uses only project PDFs for synchronization", () => {
    expect(projectPdfFile("D:\\Project", "d:\\project\\.texweave\\build\\targets\\abc\\main.pdf")).toBe(".texweave/build/targets/abc/main.pdf");
    expect(projectPdfFile("/project", "/project/main.pdf")).toBe("main.pdf");
    expect(projectPdfFile("/project", "/project2/main.pdf")).toBeUndefined();
    expect(projectPdfFile("/project", "/project/../scratch/main.pdf")).toBeUndefined();
    expect(projectPdfFile("/project", "/scratch/main.pdf")).toBeUndefined();
  });
  it("isolates different documents with the same basename, but keeps primary output at root", () => {
    const root = resolve("project");
    expect(documentOutputDirectory(root, "main.tex", "main.tex")).toBe(root);
    expect(documentOutputDirectory(root, "nested/main.tex", "nested/main.tex")).toBe(root);
    const first = documentOutputDirectory(root, "a/main.tex", "main.tex");
    const second = documentOutputDirectory(root, "b/main.tex", "main.tex");
    expect(first).not.toBe(second);
    expect(first).toBe(documentOutputDirectory(root, "a\\main.tex", "main.tex"));
    expect(first.startsWith(resolve(root, ".texweave/build/targets"))).toBe(true);
  });
  it("overrides only output directories while retaining compiler flags", () => {
    expect(targetOutputArguments(["-interaction=nonstopmode", "-outdir=old", "-auxdir", "aux", "--output-directory", "other", "-synctex=1"], "target with spaces")).toEqual(["-interaction=nonstopmode", "-synctex=1", "-outdir=target with spaces"]);
  });
  it("follows document roots and include owners without mistaking fragments for independent PDFs", () => {
    const docs: ProjectPdfDocument[] = [
      { id: "main.tex", sourceFile: "main.tex", pdfFile: "main.pdf", available: true, sourceFiles: ["main.tex", "parts/shared.tex"] },
      { id: "supplement/main.tex", sourceFile: "supplement/main.tex", pdfFile: ".texweave/build/targets/id/main.pdf", available: true, sourceFiles: ["supplement/main.tex", "parts/shared.tex", "parts/extra.tex"] }
    ];
    expect(previewDocumentForSource(docs, "supplement\\main.tex", "main.tex")?.id).toBe("supplement/main.tex");
    expect(previewDocumentForSource(docs, "parts/extra.tex", "main.tex")?.id).toBe("supplement/main.tex");
    expect(previewDocumentForSource(docs, "parts/shared.tex", "main.tex", "supplement/main.tex")?.id).toBe("supplement/main.tex");
    expect(previewDocumentForSource(docs, "refs.bib", "main.tex")?.id).toBe("main.tex");
    expect(projectPdfLink(docs, docs[0]!, "supplement/main.pdf#page=3", "main.tex")).toEqual({ id: "supplement/main.tex", destination: "page=3" });
    expect(projectPdfLink(docs, docs[1]!, "../main.pdf#section.1", "main.tex")).toEqual({ id: "main.tex", destination: "section.1" });
    expect(projectPdfLink(docs, docs[1]!, "../../main.pdf", "main.tex")).toBeUndefined();
    expect(projectPdfLink(docs, docs[0]!, "https://example.org/main.pdf", "main.tex")).toBeUndefined();
  });
  it("discovers only explicit document links with comments and macro definitions excluded", () => {
    const source = String.raw`% \externaldocument{ignored}
\newcommand{\example}{\externaldocument{macro}}
\externaldocument[other-]{supplement/notes}[notes.pdf]
\input{parts/body}`;
    expect(latexDocumentLinks(source)).toEqual([{ kind: "external", path: "supplement/notes" }, { kind: "include", path: "parts/body" }]);
    expect(latexDocumentPathCandidates("nested/main.tex", "../other")).toEqual(["other.tex"]);
    expect(latexDocumentPathCandidates("main.tex", "../../outside")).toEqual([]);
    expect(isStandaloneLatexDocument("% \\documentclass{article}\nBody.")).toBe(false);
    expect(isStandaloneLatexDocument("\\documentclass{article}")).toBe(true);
  });
  it("orders external dependencies discovered through includes and seeds mutual references twice", async () => {
    const sources: Record<string, string> = { "main.tex": "\\input{preamble}", "preamble.tex": "\\externaldocument[S-]{supplement/notes}", "supplement/notes.tex": "Notes." };
    const read = async (file: string) => sources[file];
    expect(await externalDocumentPlan("main.tex", read)).toEqual(["supplement/notes.tex", "main.tex"]);
    sources["supplement/notes.tex"] = "\\externaldocument[M-]{main}";
    expect(await externalDocumentPlan("main.tex", read)).toEqual(["supplement/notes.tex", "main.tex", "supplement/notes.tex", "main.tex"]);
    sources["main.tex"] = "\\externaldocument{aux-only}";
    expect(await externalDocumentPlan("main.tex", read)).toEqual(["main.tex"]);
  });
});
