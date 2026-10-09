import { describe, expect, it } from "vitest";
import { indexProjectReferences, filterProjectReferences } from "../../apps/desktop/src/renderer/references/projectReferences.js";
import { citationInsertionOffset, citationText, insertPreviewCitation, registerCitationTarget } from "../../apps/desktop/src/renderer/references/citationInsertion.js";
import { citationOccurrences } from "../../apps/desktop/src/renderer/references/bibtex.js";

describe("project bibliography browser", () => {
  it("indexes all project bib files and the latest working content without importing", () => {
    const index = indexProjectReferences([
      { fileId: "refs.bib", content: "@article{one,title={Latest unsaved title},author={Alice}}" },
      { fileId: "nested/other.BIB", content: "@book{two,title={Other}}\n@misc{ONE,title={Duplicate}}\n@misc{bad, broken-field}" },
      { fileId: "main.tex", content: "% \\cite{one}\nText \\citep*[see {note}][p.2]{one,two}." },
      { fileId: "notes.txt", content: "\\cite{one}" }
    ]);
    expect(index.files.map(file => file.path)).toEqual(["nested/other.BIB", "refs.bib"]);
    expect(index.entries).toHaveLength(4);
    expect(index.entries.find(entry => entry.citationKey === "one")).toMatchObject({ uses: 1, duplicate: true, fields: { title: "Latest unsaved title" } });
    expect(index.entries.find(entry => entry.citationKey === "two")).toMatchObject({ uses: 1, duplicate: false });
    expect(index.entries.find(entry => entry.citationKey === "bad")?.valid).toBe(false);
    expect(filterProjectReferences(index.entries, "alice", "refs.bib", "article")).toHaveLength(1);
    expect(filterProjectReferences(index.entries, "alice", "nested/other.BIB")).toHaveLength(0);
  });

  it("ignores commented citations while preserving exact source locations", () => {
    const content = "% \\cite{hidden}\r\nVisible \\% \\cite[see {x}][p.4]{a,b}.\n\\\\% \\cite{alsoHidden}";
    const occurrences = citationOccurrences([{ filePath: "main.tex", content }]);
    expect(occurrences.map(item => item.key)).toEqual(["a", "b"]);
    for (const item of occurrences) {
      expect(content.slice(item.start, item.end)).toBe(item.key);
      expect(item.line).toBe(2);
    }
  });

  it("keeps citations inside the document and rejects unsafe keys", () => {
    expect(citationText("Smith:2024")).toBe("\\cite{Smith:2024}");
    expect(() => citationText("bad%key")).toThrow();
    expect(() => citationText("bad\\command")).toThrow();
    const source = "Body\n\\end{document}";
    expect(citationInsertionOffset(source)).toBe(source.indexOf("\\end"));
    expect(citationInsertionOffset(source, -4)).toBe(0);
    expect(citationInsertionOffset(source, 999)).toBe(source.length);
  });

  it("scopes local editor insertion to its file/project and releases it on close", () => {
    const inserted: string[] = [];
    const dispose = registerCitationTarget("project", "chapter.tex", text => { inserted.push(text); return true; });
    try {
      expect(insertPreviewCitation("other", "chapter.tex", "citation")).toBe(false);
      expect(insertPreviewCitation("project", "main.tex", "citation")).toBe(false);
      expect(insertPreviewCitation("project", "chapter.tex", "citation")).toBe(true);
      expect(inserted).toEqual(["citation"]);
    } finally { dispose(); }
    expect(insertPreviewCitation("project", "chapter.tex", "citation")).toBe(false);
  });
});
