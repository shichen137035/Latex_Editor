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

  it("indexes multi-key citations and persists imported entries locally", async () => {
    const root = await mkdtemp(join(tmpdir(), "texweave-reference-library-"));
    try {
      const path = join(root, "references.bib");
      await writeFile(path, "@book{one, title={One}}\n@article{two, title={Two}}", "utf8");
      const repository = new ReferenceLibraryRepository(root);
      await repository.initialize();
      const result = await repository.importBibFile(path);
      expect(result.entries.map((entry) => entry.citationKey)).toEqual(["one", "two"]);
      expect(repository.snapshot().entries).toHaveLength(2);
      expect(citationOccurrences([{ filePath: "main.tex", content: "Text \\cite{one,two}." }])).toHaveLength(2);
      repository.close();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
