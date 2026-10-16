import { describe, expect, it } from "vitest";
import { inlineTokenSourceOffset, tokenizeInlineSource, type InlineSourceToken } from "../../apps/desktop/src/renderer/preview/inlineSource.js";
import { automaticLabelOccurrences, isAutomaticLabel } from "../../apps/desktop/src/renderer/preview/labels.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";

function leaves(tokens: InlineSourceToken[]): InlineSourceToken[] {
  return tokens.flatMap(token => token.children ? leaves(token.children) : [token]);
}

describe("block-local, lossless Preview source mapping", () => {
  it.each([
    String.raw`Before \textrm{middle} after ordinary words.`,
    "Alpha % hidden comment\nBeta ordinary words.",
    String.raw`Prefix \textbf{bf} suffix.`,
    String.raw`Before \textbf{bold \emph{nested words}} after.`,
    String.raw`Escaped \% and \$ are text, not comment or math.`,
    "  中文😀 and words\r\nnext line.  ",
    String.raw`Hidden \label{thm:1} then readable words.`,
    String.raw`\IF{\textbf{condition} $x>0$} return words.`
  ])("preserves literal character positions: %s", source => {
    const base = 123456;
    for (const token of leaves(tokenizeInlineSource(source, base))) {
      if (token.kind !== "text" || token.atomic) continue;
      expect(source.slice(token.contentStart - base, token.contentEnd - base)).toBe(token.value);
      for (let i = 0; i <= token.value.length; i++) expect(inlineTokenSourceOffset(token, i)).toBe(token.contentStart + i);
    }
  });

  it("anchors bf at the argument, never the command name", () => {
    const source = String.raw`Prefix \textbf{bf} suffix.`;
    const token = leaves(tokenizeInlineSource(source)).find(token => token.value === "bf")!;
    expect(token.contentStart).toBe(source.indexOf("{bf}") + 1);
  });

  it("retains source gaps around comments and escaped percent", () => {
    const source = "Alpha % removed\nBeta \\% kept.";
    const tokens = leaves(tokenizeInlineSource(source));
    expect(tokens.map(token => token.value).join("")).toBe("Alpha \nBeta % kept.");
    expect(tokens.find(token => token.value.includes("Beta"))?.contentStart).toBe(source.indexOf("\nBeta"));
  });

  it("uses deterministic inner math anchors instead of proportional glyph offsets", () => {
    const source = String.raw`Start $  x^2 + \frac{a}{b}  $ end \[ y=z \].`;
    const math = tokenizeInlineSource(source, 100).filter(token => token.kind === "math");
    expect(math.map(token => token.value)).toEqual([String.raw`x^2 + \frac{a}{b}`, "y=z"]);
    expect(math[0]?.display).toBe(false);
    expect(math[1]?.display).toBe(true);
    expect(inlineTokenSourceOffset(math[0]!, 999)).toBe(100 + source.indexOf("x^2"));
  });

  it("does not create one token per ordinary character", () => {
    const tokens = tokenizeInlineSource("a".repeat(100000), 500000);
    expect(tokens).toHaveLength(1);
    expect(inlineTokenSourceOffset(tokens[0]!, 98765)).toBe(598765);
  });

  it.each([
    [String.raw`\citep[Theorem 5.1]{munkres2000topology}`, ["Theorem 5.1"]],
    [String.raw`\citep*[see][\textbf{Theorem 5.1}]{munkres2000topology}`, ["see", "Theorem 5.1"]],
    ["\\citet [see {a]b}]\n [p. 2]{munkres2000topology}", ["see {a]b}", "p. 2"]],
    [String.raw`\cite{munkres2000topology}`, []],
    [String.raw`\parencite[][p. 2]{munkres2000topology}`, ["", "p. 2"]]
  ])("recognizes citation notes and preserves exact source anchors: %s", (citation, notes) => {
    const source = `Before ${citation} after.`;
    const tokens = tokenizeInlineSource(source, 500);
    const token = tokens.find(item => item.kind === "citation")!;
    expect(token).toBeDefined();
    expect(token.value).toBe("munkres2000topology");
    expect(source.slice(token.start - 500, token.end - 500)).toBe(citation);
    expect(token.contentStart).toBe(500 + source.indexOf("munkres2000topology"));
    expect(inlineTokenSourceOffset(token, 999)).toBe(token.contentStart);
    expect((token.citationNotes ?? []).map(note => leaves(note).map(part => part.value).join(""))).toEqual(notes);
    expect(tokens.at(-1)?.value).toBe(" after.");
  });

  it.each([String.raw`\citep[unfinished{key}`, String.raw`\citep[note]`, String.raw`\citep[note]{unfinished`])("keeps incomplete citation input visible: %s", source => {
    const tokens = tokenizeInlineSource(source);
    expect(tokens.some(token => token.kind === "citation")).toBe(false);
    expect(tokens.map(token => token.value).join("")).toBe(source);
  });
});

describe("single-pass automatic-label occurrence index", () => {
  it("agrees with existing occurrence rules for repeated, nested and starred constructs", () => {
    const source = String.raw`\section{One}\label{section:1}
\begin{equation}\label{equation:1}x=y\end{equation}
\section*{Two}\label{section:2}
\begin{equation}\label{equation:2}a=b\end{equation}`;
    const index = automaticLabelOccurrences(source);
    for (const name of ["section", "equation"]) {
      const definition = DEFAULT_ENVIRONMENTS.find(definition => definition.id === name)!;
      const pattern = name === "section" ? /\\section\*?\{/g : /\\begin\{equation\}/g;
      for (const [i, match] of [...source.matchAll(pattern)].entries()) {
        expect(isAutomaticLabel(source, match.index, definition, `${name}:${i + 1}`, index)).toBe(true);
        expect(isAutomaticLabel(source, match.index, definition, `${name}:${i + 1}`, index)).toBe(isAutomaticLabel(source, match.index, definition, `${name}:${i + 1}`));
      }
    }
  });
});
