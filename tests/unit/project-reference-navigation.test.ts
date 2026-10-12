import { describe, expect, it } from "vitest";
import { ProjectReferenceIndex } from "../../apps/desktop/src/renderer/editor/ProjectReferenceIndex.js";
import { sourceReferenceAtOffset } from "../../apps/desktop/src/renderer/editor/sourceReferences.js";
import { ProjectIndex } from "../../apps/desktop/src/renderer/completion/ProjectIndex.js";

const main = String.raw`\documentclass{article}\usepackage{local}\input{chapters/body}\externaldocument[S-][nocite]{supplement/notes}[notes.pdf]\ref{S-thm:result}`;
const documents = [
  { path: "main.tex", content: main },
  { path: "local.sty", content: String.raw`\externaldocument[A-]{appendix}` },
  { path: "chapters/body.tex", content: String.raw`See \ref{sec:main} and \ref{S-thm:result}.\label { sec:main }` },
  { path: "supplement/notes.tex", content: String.raw`\documentclass{article}\input{supplement/results}\label{sec:main}` },
  { path: "supplement/results.tex", content: String.raw`\label{thm:result}` },
  { path: "appendix.tex", content: String.raw`\documentclass{article}\label{app:proof}` },
  { path: "unrelated.tex", content: String.raw`\documentclass{article}\label{unrelated}\label{thm:result}` }
];

describe("connected project reference navigation", () => {
  it("resolves xr/xr-hyper prefixes and included labels from declarations in local packages", () => {
    const index = new ProjectReferenceIndex(); index.update(documents, "main.tex");
    expect(index.resolve("main.tex", "S-thm:result")).toEqual({ path: "supplement/results.tex", label: "thm:result", offset: 0 });
    expect(index.resolve("chapters/body.tex", "A-app:proof")?.path).toBe("appendix.tex");
    expect(index.resolve("main.tex", "sec:main")?.path).toBe("chapters/body.tex");
    expect(index.resolve("main.tex", "thm:result")).toBeUndefined();
    expect(index.resolve("main.tex", "unrelated")).toBeUndefined();
    expect(index.resolve("supplement/notes.tex", "sec:main")?.path).toBe("supplement/notes.tex");
    expect(index.resolve("supplement/notes.tex", "A-app:proof")).toBeUndefined();
    const source = documents[2]!.content;
    const jump = sourceReferenceAtOffset(source, source.indexOf("S-thm"), key => index.resolve("chapters/body.tex", key));
    expect(jump).toMatchObject({ label: "S-thm:result", targetPath: "supplement/results.tex", targetLabel: "thm:result", targetOffset: 0 });
  });

  it("updates unsaved targets and removes vanished declarations, comments and ambiguous labels", () => {
    const index = new ProjectReferenceIndex(); index.update(documents, "main.tex");
    const updated = documents.map(file => file.path === "supplement/results.tex" ? { ...file, content: String.raw`% \label{thm:result}
Intro. \label {thm:result}` } : file);
    index.update(updated, "main.tex");
    expect(index.resolve("main.tex", "S-thm:result")?.offset).toBe(updated[4]!.content.lastIndexOf("\\label"));
    index.update(updated.map(file => file.path === "supplement/results.tex" ? { ...file, content: "Deleted label." } : file), "main.tex");
    expect(index.resolve("main.tex", "S-thm:result")).toBeUndefined();
    index.update([...documents, { path: "duplicate.tex", content: String.raw`\label{sec:main}` }].map(file => file.path === "main.tex" ? { ...file, content: file.content + String.raw`\input{duplicate}` } : file), "main.tex");
    expect(index.resolve("main.tex", "sec:main")).toBeUndefined();
    index.update(documents.map(file => file.path === "main.tex" ? { ...file, content: String.raw`\documentclass{article}% \externaldocument[S-]{supplement/notes}
\ref{S-thm:result}` } : file), "main.tex");
    expect(index.resolve("main.tex", "S-thm:result")).toBeUndefined();
  });

  it("handles cycles, relative external links and includes with identical basenames", () => {
    const index = new ProjectReferenceIndex();
    index.update([
      { path: "nested/main.tex", content: String.raw`\documentclass{article}\input{one/shared}\input{two/shared}\externaldocument[X-]{../external}` },
      { path: "one/shared.tex", content: String.raw`\label{first}\input{nested/main}` },
      { path: "two/shared.tex", content: String.raw`\label{second}` },
      { path: "external.tex", content: String.raw`\label{external}` }
    ], "nested/main.tex");
    expect(index.resolve("nested/main.tex", "first")?.path).toBe("one/shared.tex");
    expect(index.resolve("nested/main.tex", "second")?.path).toBe("two/shared.tex");
    expect(index.resolve("nested/main.tex", "X-external")?.path).toBe("external.tex");
  });

  it("offers effective prefixed keys in source completion and selects the clicked key in cref", () => {
    const index = new ProjectIndex(); index.rebuild([], documents, [], []);
    expect(index.complete({ mode: "reference", prefix: "S-thm", startColumn: 1 }, "chapters/body.tex").map(item => item.insertText)).toContain("S-thm:result");
    const refs = new ProjectReferenceIndex(); refs.update(documents, "main.tex");
    const source = String.raw`\cref{sec:main,S-thm:result}`;
    expect(sourceReferenceAtOffset(source, source.indexOf("S-thm"), key => refs.resolve("main.tex", key))).toMatchObject({ label: "S-thm:result", targetPath: "supplement/results.tex" });
  });
});
