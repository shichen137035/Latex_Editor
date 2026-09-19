import { describe, expect, it } from "vitest";
import { SearchEngine, replaceRanges } from "../../apps/desktop/src/renderer/search/SearchEngine.js";
import { FilterEngine } from "../../apps/desktop/src/renderer/filter/FilterEngine.js";
import { defaultFilterQuery } from "../../apps/desktop/src/renderer/filter/types.js";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";

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
    expect(matches.matches.size).toBe(1);
    const excluded = engine.evaluate(document.nodes, source, "main.tex", { ...defaultFilterQuery, enabled: true, blockTypes: ["theorem"], files: ["other.tex"] });
    expect(excluded.matches.size).toBe(0);
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
});
