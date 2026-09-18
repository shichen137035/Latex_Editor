import { describe, expect, it } from "vitest";
import { detectLanguage } from "../../apps/desktop/src/renderer/spellcheck/LanguageDetector.js";
import { extractLatexText, extractWords } from "../../apps/desktop/src/renderer/spellcheck/LatexTextExtractor.js";

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
    expect(detectLanguage("This is a long English sentence with the words that and from repeated for confidence.").language).toBe("en-US");
  });
});
