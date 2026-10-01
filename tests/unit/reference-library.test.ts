import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBibtex, citationOccurrences } from "../../apps/desktop/src/renderer/references/bibtex.js";
import { ReferenceLibraryRepository } from "../../apps/desktop/src/main/references.js";

describe("reference library", () => {
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
});
