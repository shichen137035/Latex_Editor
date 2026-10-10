import { latexHeadingFields } from "@latex-editor/editor-core/latex-source";
import { tokenizeInlineSource, type InlineSourceToken } from "../preview/inlineSource.js";

const levels: Record<string, number> = { chapter: 0, section: 1, subsection: 2, subsubsection: 3, paragraph: 4 };
const symbols: Record<string, string> = { LaTeX: "LaTeX", TeX: "TeX", ldots: "…", dots: "…", alpha: "α", beta: "β", gamma: "γ", delta: "δ", theta: "θ", lambda: "λ", mu: "μ", pi: "π", sigma: "σ", omega: "ω", infty: "∞", times: "×", leq: "≤", geq: "≥" };

/** Compact plain text for navigation; source and formatting stay in the document. */
export function outlineTitle(raw: string): string {
  const flatten = (tokens: InlineSourceToken[]): string => tokens.map(token => {
    if (token.kind === "format") return flatten(token.children ?? []);
    if (token.kind === "citation" || token.kind === "reference") return `[${token.value}]`;
    return token.value;
  }).join("");
  return flatten(tokenizeInlineSource(raw)).replace(/\\[{}]|[{}]/g, token => token.length === 2 ? token[1]! : "").replace(/\\([A-Za-z]+)(?:\{\})?/g, (match, name: string) => symbols[name] ?? match).replace(/~/g, " ").replace(/\s+/g, " ").trim();
}

export function buildOutline(source: string): Array<{ title: string; level: number; line: number }> {
  const result: Array<{ title: string; level: number; line: number }> = [];
  for (const field of latexHeadingFields(source, Object.keys(levels))) {
    result.push({ title: outlineTitle(field.body.value), level: levels[field.command]!, line: source.slice(0, field.start).split(/\r\n|\r|\n/).length });
  }
  return result;
}
