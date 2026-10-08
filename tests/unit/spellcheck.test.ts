import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { detectLanguage } from "../../apps/desktop/src/renderer/spellcheck/LanguageDetector.js";
import { extractLatexText, extractWords } from "../../apps/desktop/src/renderer/spellcheck/LatexTextExtractor.js";
import { flattenHunspellDictionary } from "../../apps/desktop/src/main/spellcheck-dictionaries.js";
import { isEnglishSpellDictionary } from "../../packages/contracts/src/spellcheck.js";

const nspell = createRequire(import.meta.url)("nspell") as (dictionary: { aff: Buffer; dic: Buffer }) => { correct(word: string): boolean };

describe("v0.2.6 spell-check extraction", () => {
  it("keeps prose offsets while excluding LaTeX syntax, math and references", () => {
    const source = String.raw`\begin{theorem}
Suppose $X_t \in \mathbb{R}$ satisfies \ref{ass:mixing}.
This is a recieve test. % recieve in a comment
\textbf{Important prose}.
\end{theorem}`;
    const words = extractWords(extractLatexText(source));
    const values = words.map((item) => item.word);
    expect(values).toContain("Suppose");
    expect(values).toContain("satisfies");
    expect(values).toContain("recieve");
    expect(values).toContain("Important");
    expect(values).not.toContain("theorem");
    expect(values).not.toContain("mathbb");
    expect(values).not.toContain("mixing");
    expect(values).not.toContain("comment");
    const typo = words.find((item) => item.word === "recieve");
    expect(typo && source.slice(typo.sourceStart, typo.sourceEnd)).toBe("recieve");
  });

  it("uses English as the safe fallback and recognizes script evidence", () => {
    expect(detectLanguage("Proof.").language).toBe("en-US");
    expect(detectLanguage("これは日本語の文章です。これは十分なサンプルです。").language).toBe("ja-JP");
    expect(detectLanguage("Қазақ тілі өте бай.").language).toBe("kk-KZ");
    expect(detectLanguage("This is a long English sentence with the words that and from repeated for confidence.").language).toBe("en-US");
  });

  it("keeps every English locale protected from dictionary removal", () => {
    expect(isEnglishSpellDictionary("en-US")).toBe(true);
    expect(isEnglishSpellDictionary("en_AU", "en-AU")).toBe(true);
    expect(isEnglishSpellDictionary("de", "de-DE")).toBe(false);
  });

  it("normalizes the legacy Kazakh Hunspell package to its explicit Unicode word forms", () => {
    const manyWords = Array.from({ length: 1000 }, (_, index) => `сөз${index.toString(2).replaceAll("0", "а").replaceAll("1", "ә")}`);
    const source = [`\uFEFF${manyWords.length + 4}`, "қазақ/ABbCc", "кітап/MmNn", "кітап/MmNn", "Қазақстан", ...manyWords].join("\n");
    const normalized = flattenHunspellDictionary(source);
    expect(normalized.split(/\r?\n/).slice(0, 4)).toEqual(["1003", "қазақ", "кітап", "Қазақстан"]);
    const engine = nspell({ aff: Buffer.from("SET UTF-8\n"), dic: Buffer.from(normalized, "utf8") });
    expect(engine.correct("қазақ")).toBe(true);
    expect(engine.correct("кітап")).toBe(true);
    expect(() => flattenHunspellDictionary("\uFEFF2\nтек\n")).toThrow("empty or incomplete");
  });
});
