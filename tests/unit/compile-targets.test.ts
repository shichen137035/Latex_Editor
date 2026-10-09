import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { compilationTargets, pdfFileForSource, projectPdfFile } from "../../apps/desktop/src/renderer/workbench/compileTargets.js";
import { documentOutputDirectory, targetOutputArguments } from "../../packages/compiler-latexmk/src/output.js";

describe("multiple document compilation", () => {
  it("selects only TeX files and avoids compiling the primary twice", () => {
    expect(compilationTargets("nested/main.tex", "nested\\main.tex")).toEqual(["nested/main.tex"]);
    expect(compilationTargets("main.tex", "other.TEX")).toEqual(["main.tex", "other.TEX"]);
    expect(compilationTargets("main.tex", "refs.bib")).toEqual(["main.tex"]);
    expect(compilationTargets("main.tex")).toEqual(["main.tex"]);
    expect(pdfFileForSource("nested\\other.TEX")).toBe("other.pdf");
  });
  it("uses only project PDFs for synchronization", () => {
    expect(projectPdfFile("D:\\Project", "d:\\project\\.latex-editor\\build\\targets\\abc\\main.pdf")).toBe(".latex-editor/build/targets/abc/main.pdf");
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
    expect(first.startsWith(resolve(root, ".latex-editor/build/targets"))).toBe(true);
  });
  it("overrides only output directories while retaining compiler flags", () => {
    expect(targetOutputArguments(["-interaction=nonstopmode", "-outdir=old", "-auxdir", "aux", "--output-directory", "other", "-synctex=1"], "target with spaces")).toEqual(["-interaction=nonstopmode", "-synctex=1", "-outdir=target with spaces"]);
  });
});
