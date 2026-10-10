import { describe, expect, it } from "vitest";
import { SearchEngine, nextSearchResult, replaceRanges, searchResultLimit } from "../../apps/desktop/src/renderer/search/SearchEngine.js";
import { FilterEngine } from "../../apps/desktop/src/renderer/filter/FilterEngine.js";
import { combineFilterStates, defaultFilterQuery, filterDisposition } from "../../apps/desktop/src/renderer/filter/types.js";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";
import { defaultSearchQuery } from "../../apps/desktop/src/renderer/search/types.js";
import { inlineMatchRanges } from "../../apps/desktop/src/renderer/search/inlineMatches.js";
import { PreviewFilterCache, isSearchableProjectFile, searchFileRanges } from "../../apps/desktop/src/renderer/search/searchDocuments.js";

describe("v0.3.2 search", () => {
  const documents = [{ fileId: "main.tex", content: "Model models model\nGaussian model" }];
  it("supports case, whole-word, regex, invalid regex, and replacement", () => {
    const engine = new SearchEngine();
    const base = { text: "model", caseSensitive: false, wholeWord: false, useRegex: false, scope: "current-file" as const };
    expect(engine.search(base, documents).results).toHaveLength(4);
    expect(engine.search({ ...base, caseSensitive: true }, documents).results).toHaveLength(3);
    const whole = engine.search({ ...base, wholeWord: true }, documents).results;
    expect(whole).toHaveLength(3);
    expect(engine.search({ ...base, text: "G\\w+", useRegex: true }, documents).results[0]?.previewSnippet).toContain("Gaussian");
    expect(engine.search({ ...base, text: "[", useRegex: true }, documents).error).toBeTruthy();
    expect(replaceRanges(documents[0]!.content, whole, "term")).toBe("term models term\nGaussian term");
  });
});

describe("search boundaries and replacements", () => {
  const engine = new SearchEngine();
  it("starts at the first/last result when no result is selected", () => {
    const results = engine.search({ ...defaultSearchQuery, text: "a" }, [{ fileId: "main.tex", content: "a a a" }]).results;
    expect(nextSearchResult(results, undefined, 1)).toBe(results[0]);
    expect(nextSearchResult(results, "outdated", -1)).toBe(results[2]);
    expect(nextSearchResult(results, results[2]!.id, 1)).toBe(results[0]);
  });
  it("respects Unicode whole words and multiline zero-width matches", () => {
    expect(engine.search({ ...defaultSearchQuery, text: "é", wholeWord: true }, [{ fileId: "a", content: "é été é_2" }]).results).toHaveLength(1);
    const document = { fileId: "a", content: "first\nsecond" };
    const query = { ...defaultSearchQuery, text: "^", useRegex: true };
    const results = engine.search(query, [document]).results;
    expect(results.map(result => [result.line, result.column])).toEqual([[1, 1], [2, 1]]);
    expect(replaceRanges(document.content, results, "> ", query)).toBe("> first\n> second");
    expect(engine.search(query, [{ fileId: "empty.tex", content: "" }], new Map([["empty.tex", [[0, 0]]]])).results).toHaveLength(1);
  });
  it("honors capture substitution for a selected subset without renumbering captures", () => {
    const content = "x=12 y=34", query = { ...defaultSearchQuery, text: "(?<name>[xy])=(\\d+)", useRegex: true };
    const matches = engine.search(query, [{ fileId: "a", content }]).results;
    expect(replaceRanges(content, [matches[1]!], "$<name>:$2/$$/$&/$12", query)).toBe("x=12 y:34/$/y=34/y2");
    expect(replaceRanges(content, matches, "$2:$1", query)).toBe("12:x 34:y");
  });
  it("fails closed for missing file ranges, merges overlaps, and caps results explicitly", () => {
    const document = { fileId: "a", content: "abc abc abc" }, query = { ...defaultSearchQuery, text: "abc" };
    expect(engine.search(query, [document], new Map()).results).toHaveLength(0);
    expect(engine.search(query, [document], new Map([["a", [[0, 3], [2, 5], [4, 7]]]])).results).toHaveLength(2);
    const many = engine.search({ ...query, text: "a" }, [{ fileId: "a", content: "a".repeat(searchResultLimit + 1) }]);
    expect(many.results).toHaveLength(searchResultLimit); expect(many.truncated).toBe(true);
    expect(many.results.at(-1)?.column).toBe(searchResultLimit);
  });
  it("never executes user regexes in Preview and uses only validated source offsets", () => {
    const query = { ...defaultSearchQuery, text: "(a+)+$", useRegex: true };
    expect(inlineMatchRanges("a".repeat(10000) + "!", query)).toEqual([]);
    const matches = engine.search({ ...defaultSearchQuery, text: "abc" }, [{ fileId: "a", content: "--abc--" }]).results;
    expect(inlineMatchRanges("abc", { ...query, resolvedMatches: matches }, 2)).toEqual([[0, 3]]);
    expect(inlineMatchRanges("abc", { ...query, resolvedMatches: [] }, 2)).toEqual([]);
  });
});

describe("precise structural search scope", () => {
  const engine = new FilterEngine(), search = new SearchEngine();
  it("distinguishes paragraph headings from unrelated body text and retains only the selected subtree", () => {
    const source = String.raw`\section{Outer}
Unrelated opening.
\begin{theorem}Unrelated theorem.\end{theorem}
\paragraph{Selected}
Selected body.
\begin{lemma}Selected child.\end{lemma}
\paragraph{Also selected}
Second body.
\section{Other}
Unrelated ending.`;
    const parsed = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const evaluated = engine.evaluate(parsed.nodes, source, "main.tex", { ...defaultFilterQuery, enabled: true, blockTypes: ["paragraph"] });
    const matchedText = evaluated.ranges.map(([start, end]) => source.slice(start, end)).join("\n");
    expect(matchedText).toContain("Selected body.");
    expect(matchedText).toContain("Selected child.");
    expect(matchedText).toContain("Second body.");
    expect(matchedText).not.toContain("Unrelated");
    expect(engine.options(parsed.nodes, ["main.tex"]).blockTypes).toEqual(expect.arrayContaining(["paragraph", "content:paragraph"]));
    const excluded = engine.evaluate(parsed.nodes, source, "main.tex", { ...defaultFilterQuery, enabled: true, blockTypes: ["paragraph"], groupModes: { ...defaultFilterQuery.groupModes, blockType: "exclude" } });
    const remaining = excluded.ranges.map(([start, end]) => source.slice(start, end)).join("\n");
    expect(remaining).toContain("Unrelated opening.");
    expect(remaining).toContain("Unrelated ending.");
    expect(remaining).not.toContain("Selected body.");
    expect(remaining).not.toContain("Selected child.");
    expect(remaining).not.toContain("Second body.");
  });

  it("does not match ordinary text as paragraph headings when none exist", () => {
    const source = String.raw`\section{Heading}Body.\begin{theorem}Other body.\end{theorem}\newpage`;
    const parsed = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
    const evaluation = engine.evaluate(parsed.nodes, source, "main.tex", { ...defaultFilterQuery, enabled: true, blockTypes: ["paragraph"] });
    expect(evaluation.matches.size).toBe(0);
    expect(evaluation.context.size).toBe(0);
    expect(evaluation.ranges).toEqual([]);
    expect(engine.options(parsed.nodes, ["main.tex"]).blockTypes).not.toContain("paragraph");
  });

  const source = String.raw`\section{Methods}
keep \begin{equation}keep=1\end{equation} keep
\section*{Results}
keep results`;
  const parsed = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
  it("cannot replace an excluded child through a matched parent's span", () => {
    const query = { ...defaultFilterQuery, enabled: true, blockTypes: ["equation"], groupModes: { ...defaultFilterQuery.groupModes, blockType: "exclude" as const } };
    const evaluated = engine.evaluate(parsed.nodes, source, "main.tex", query);
    const results = search.search({ ...defaultSearchQuery, text: "keep" }, [{ fileId: "main.tex", content: source }], new Map([["main.tex", evaluated.ranges]])).results;
    expect(results).toHaveLength(3);
    const next = replaceRanges(source, results, "new");
    expect(next).toContain("keep=1"); expect(next).toContain("new results");
  });
  it("uses stable location identities across renderer IDs and body offsets, including starred headings", () => {
    const options = engine.options(parsed.nodes, ["main.tex"]);
    expect(options.locations).toHaveLength(2);
    const selected = options.locations[1]!.id;
    const modifiedSource = source.replace("keep=1", "keep=1234567");
    const modified = parsePreview(modifiedSource, "main.tex", DEFAULT_ENVIRONMENTS);
    const changeIds = (nodes: typeof modified.nodes) => nodes.forEach(node => { node.id = `render:${node.id}`; if (node.kind === "block") changeIds(node.children); });
    changeIds(modified.nodes);
    expect(engine.options(modified.nodes, ["main.tex"]).locations[1]!.id).toBe(selected);
    const evaluated = engine.evaluate(modified.nodes, modifiedSource, "main.tex", { ...defaultFilterQuery, enabled: true, locations: [selected] });
    const results = search.search({ ...defaultSearchQuery, text: "keep" }, [{ fileId: "main.tex", content: modifiedSource }], new Map([["main.tex", evaluated.ranges]])).results;
    expect(results).toHaveLength(1); expect(results[0]!.previewSnippet).toContain("results");
    expect(engine.options(parsePreview(source, "other.tex", DEFAULT_ENVIRONMENTS).nodes, ["other.tex"]).locations[1]!.id).not.toBe(selected);
  });
  it("enforces exclusions even under an included containing block", () => {
    const nested = String.raw`\section{Parent}keep\subsection{Child}excluded`;
    const document = parsePreview(nested, "main.tex", DEFAULT_ENVIRONMENTS);
    const location = engine.options(document.nodes, ["main.tex"]).locations[1]!.id;
    const evaluation = engine.evaluate(document.nodes, nested, "main.tex", { ...defaultFilterQuery, enabled: true, blockTypes: ["section"], locations: [location], groupModes: { ...defaultFilterQuery.groupModes, location: "exclude" } });
    expect(search.search({ ...defaultSearchQuery, text: "excluded" }, [{ fileId: "main.tex", content: nested }], new Map([["main.tex", evaluation.ranges]])).results).toHaveLength(0);
  });
  it("ignores commented commands and recognizes optional citation arguments", () => {
    const content = "plain % \\cite{ignored}\n\nreal \\citep[see][p. 2]{key}";
    const document = parsePreview(content, "main.tex", DEFAULT_ENVIRONMENTS);
    const evaluated = engine.evaluate(document.nodes, content, "main.tex", { ...defaultFilterQuery, enabled: true, properties: ["hasCitation"] });
    const ranges = new Map([["main.tex", evaluated.ranges]]);
    expect(search.search({ ...defaultSearchQuery, text: "plain" }, [{ fileId: "main.tex", content }], ranges).results).toHaveLength(0);
    expect(search.search({ ...defaultSearchQuery, text: "real" }, [{ fileId: "main.tex", content }], ranges).results).toHaveLength(1);
  });
  it("leaves an empty enabled filter unrestricted and allows file-only filtering on BibTeX/preambles", () => {
    const documents = [{ fileId: "a.bib", content: "@book{key}" }, { fileId: "main.tex", content: "\\documentclass{article}" }];
    expect(searchFileRanges(documents, [], { ...defaultFilterQuery, enabled: true })).toBeUndefined();
    expect(searchFileRanges(documents, [], { ...defaultFilterQuery, enabled: true, files: ["a.bib"] })).toEqual(new Map([["a.bib", [[0, 10]]], ["main.tex", []]]));
    expect(searchFileRanges(documents, [], { ...defaultFilterQuery, enabled: true, blockTypes: ["theorem"] })?.get("a.bib")).toEqual([]);
  });
  it("excludes internal caches and attachments but includes project bibliography resources", () => {
    for (const path of [".git/a.tex", ".latex-editor/build/main.tex", ".texweave/settings.json", ".texweave/ai-attachments/a/note.md", "node_modules/pkg/a.txt", ".texweave/cache/a.tex"]) expect(isSearchableProjectFile(path)).toBe(false);
    expect(isSearchableProjectFile(".texweave/generated-references.bib")).toBe(true);
    expect(isSearchableProjectFile("chapters/a.tex")).toBe(true);
  });
  it("reuses unchanged parsed files, invalidates configuration, and releases removed files", () => {
    const cache = new PreviewFilterCache(), directives: [] = [], documents = [{ fileId: "a.tex", content: source }, { fileId: "b.tex", content: source }];
    const first = cache.documents(documents, DEFAULT_ENVIRONMENTS, directives, parsePreview);
    const next = cache.documents([{ ...documents[0]!, content: source + " new" }, documents[1]!], DEFAULT_ENVIRONMENTS, directives, parsePreview);
    expect(next[0]).not.toBe(first[0]); expect(next[1]).toBe(first[1]);
    cache.documents([], DEFAULT_ENVIRONMENTS, directives, parsePreview);
    expect(cache.documents(documents, DEFAULT_ENVIRONMENTS, directives, parsePreview)[1]).not.toBe(first[1]);
    cache.clear();
  });
});

describe("v0.3.2 structural filter", () => {
  const source = String.raw`\section{Methods}
Intro text.
\begin{theorem}\label{thm:a} A result with $x$.\begin{equation}x=1\end{equation}\end{theorem}
Closing text.`;
  const document = parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS);
  const engine = new FilterEngine();

  it("uses OR inside block types and keeps structural ancestors as context", () => {
    const result = engine.evaluate(document.nodes, source, "main.tex", { ...defaultFilterQuery, enabled: true, blockTypes: ["equation", "lemma"] });
    const equation = [...result.matches].find((id) => id.includes("equation"));
    expect(equation).toBeTruthy();
    expect(result.context.size).toBeGreaterThan(0);
    expect(result.unmatched.size).toBeGreaterThan(0);
  });

  it("combines groups with AND and properties with AND", () => {
    const matches = engine.evaluate(document.nodes, source, "main.tex", { ...defaultFilterQuery, enabled: true, blockTypes: ["theorem"], files: ["main.tex"], properties: ["hasMath", "hasLabel"] });
    expect([...matches.matches].some((id) => id.includes("theorem"))).toBe(true);
    expect([...matches.matches].some((id) => id.includes("equation"))).toBe(true);
    const excluded = engine.evaluate(document.nodes, source, "main.tex", { ...defaultFilterQuery, enabled: true, blockTypes: ["theorem"], files: ["other.tex"] });
    expect(excluded.matches.size).toBe(0);
  });

  it("keeps all descendants visible when their containing block type matches", () => {
    const result = engine.evaluate(document.nodes, source, "main.tex", { ...defaultFilterQuery, enabled: true, blockTypes: ["theorem"] });
    expect([...result.matches].some((id) => id.includes("theorem"))).toBe(true);
    expect([...result.matches].some((id) => id.includes("equation"))).toBe(true);
    expect(result.context.size).toBeGreaterThan(0);
  });

  it("treats an empty enabled filter as matching everything", () => {
    const result = engine.evaluate(document.nodes, source, "main.tex", { ...defaultFilterQuery, enabled: true });
    expect(result.unmatched.size).toBe(0);
  });

  it("supports independent deny-list groups without changing the master mode", () => {
    const query = { ...defaultFilterQuery, enabled: true, blockTypes: ["equation"], groupModes: { ...defaultFilterQuery.groupModes, blockType: "exclude" as const } };
    const result = engine.evaluate(document.nodes, source, "main.tex", query);
    expect([...result.matches].some((id) => id.includes("equation"))).toBe(false);
    expect(query.masterMode).toBe("include");
  });

  it("applies one display mode to unmatched and context states from any filter source", () => {
    expect(combineFilterStates("match", "context")).toBe("context");
    expect(combineFilterStates("context", "unmatched")).toBe("unmatched");
    expect(filterDisposition("unmatched", "original")).toBe("show");
    expect(filterDisposition("unmatched", "dim")).toBe("dim");
    expect(filterDisposition("unmatched", "collapse")).toBe("collapse");
    expect(filterDisposition("unmatched", "remove")).toBe("remove");
    expect(filterDisposition("context", "collapse")).toBe("show");
    expect(filterDisposition("context", "dim")).toBe("dim");
  });
});
