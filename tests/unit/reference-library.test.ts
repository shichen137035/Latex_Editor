import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { citationKeyIdentity, citationOccurrences, isValidCitationKey, parseBibtex, renderBibtexEntry } from "../../apps/desktop/src/renderer/references/bibtex.js";
import { ReferenceLibraryRepository } from "../../apps/desktop/src/main/references.js";

describe("reference library", () => {
  it("rejects invalid library keys, missing link targets, and conflicting project aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "texweave-reference-links-"));
    const repository = new ReferenceLibraryRepository(root);
    try {
      await repository.initialize();
      await expect(repository.saveEntry({ citationKey: "bad%key", entryType: "book", fields: {} })).rejects.toThrow("Invalid citation key");
      const first = await repository.saveEntry({ citationKey: "first", entryType: "book", fields: {} });
      const second = await repository.saveEntry({ citationKey: "second", entryType: "book", fields: {} });
      const link = { projectId: "project", libraryEntryId: first.id, citationKeyInProject: "alias", mode: "link" as const };
      repository.setProjectLink(link);
      expect(() => repository.setProjectLink({ ...link, libraryEntryId: second.id, citationKeyInProject: "ALIAS" })).toThrow("already linked");
      expect(() => repository.setProjectLink({ ...link, libraryEntryId: "missing" })).toThrow("not found");
      expect(() => repository.setProjectLink({ ...link, citationKeyInProject: "bad,key" })).toThrow("Invalid project");
      expect(repository.snapshot("project").projectLinks).toHaveLength(1);
    } finally { repository.close(); await rm(root, { recursive: true, force: true }); }
  });
  it("parses entries without losing comments, macros, or source ranges", () => {
    const source = `% keep this comment\n@string{venue = "Journal"}\n@article{chen2006,\n  author = {Chen and Fan},\n  title = {A model},\n  journal = venue,\n  year = {2006}\n}`;
    const parsed = parseBibtex(source);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({ citationKey: "chen2006", entryType: "article", fields: { author: "Chen and Fan", title: "A model" } });
    expect(parsed.entries[0]?.rawBibtex).toContain("@article");
    expect(parsed.entries[0]?.start).toBe(source.indexOf("@article"));
  });

  it("parses parenthesized BibTeX entries and ignores entry-like comment or field text", () => {
    const source = `% @article{commented, title={Not an entry}}
@article(key, title={A (nested), useful title}, author="Doe, Jane", note={literal @book{not-a-record}})
`;
    const parsed = parseBibtex(source);
    expect(parsed.invalid).toHaveLength(0);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]).toMatchObject({
      citationKey: "key",
      fields: { title: "A (nested), useful title", author: "Doe, Jane" }
    });
  });

  it("shares validation, key identity, and serialization across BibTeX surfaces", () => {
    const parsed = parseBibtex("@article{bad, not-a-field}\n@book{GoodKey, title={A title}}");
    expect(parsed.entries.map((entry) => entry.valid)).toEqual([false, true]);
    expect(parsed.invalid).toHaveLength(1);
    expect(citationKeyIdentity(" GoodKey ")).toBe(citationKeyIdentity("goodkey"));
    expect(isValidCitationKey("good-key")).toBe(true);
    expect(isValidCitationKey("bad,key")).toBe(false);
    expect(renderBibtexEntry({ entryType: "book", citationKey: "GoodKey", fields: { title: "A title" } }))
      .toBe("@book{GoodKey,\n  title = {A title}\n}");
  });

  it("keeps citation locations tied to the supplied source text and exact character offsets", () => {
    const source = "\\section{Old}\r\nEdited text.\\cite{first, second}.";
    const occurrences = citationOccurrences([{ filePath: "chapter.tex", content: source }]);
    const second = occurrences.find((item) => item.key === "second");
    expect(second).toMatchObject({ filePath: "chapter.tex", line: 2 });
    expect(second && source.slice(second.start, second.end)).toBe("second");
    expect(second?.start).toBe(source.indexOf("second"));
  });

  it("indexes multi-key citations and persists imported entries locally", async () => {
    const root = await mkdtemp(join(tmpdir(), "texweave-reference-library-"));
    try {
      const path = join(root, "references.bib");
      await writeFile(path, "@book(one, title={One (first), continued})\n@article(two, title={Two})", "utf8");
      const repository = new ReferenceLibraryRepository(root);
      await repository.initialize();
      const result = await repository.importBibFile(path);
      expect(result.entries.map((entry) => entry.citationKey)).toEqual(["one", "two"]);
      expect(repository.snapshot().entries).toHaveLength(2);
      const originalId = result.entries.find((entry) => entry.citationKey === "one")?.id;
      const sameEntry = await repository.saveEntry({ citationKey: "one", entryType: "book", fields: { title: "Replacement" } });
      expect(sameEntry.id).toBe(originalId);
      expect(sameEntry.fields.title).toBe("One (first), continued");
      repository.removeEntry(sameEntry.id);
      const restored = await repository.saveEntry({ citationKey: "one", entryType: "book", fields: { title: "Restored" } });
      expect(restored.id).toBe(originalId);
      expect(restored.fields.title).toBe("Restored");
      expect(repository.snapshot().entries).toHaveLength(2);
      expect(citationOccurrences([{ filePath: "main.tex", content: "Text \\cite{one,two}." }])).toHaveLength(2);
      repository.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("imports only valid entries and treats duplicate keys consistently regardless of case", async () => {
    const root = await mkdtemp(join(tmpdir(), "texweave-bibtex-rules-"));
    try {
      const path = join(root, "references.bib");
      await writeFile(path, "@article{Key, title={First}}\n@article{key, title={Duplicate}}\n@book{invalid, missing-equals}", "utf8");
      const repository = new ReferenceLibraryRepository(root);
      await repository.initialize();
      const result = await repository.importBibFile(path);
      expect(result.entries.map((entry) => entry.citationKey)).toEqual(["Key"]);
      expect(result.duplicates).toEqual(["key"]);
      expect(result.invalid).toHaveLength(1);
      expect(repository.snapshot().entries).toHaveLength(1);
      repository.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
