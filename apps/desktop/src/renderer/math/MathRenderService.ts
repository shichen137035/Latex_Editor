import katex from "katex";
import type { MathContext, MathRenderOptions, MathRenderResult } from "./types.js";
import { isMathEnvironment } from "./MathEnvironmentRegistry.js";

const maxFormulaLength = 24_000;

function errorPosition(message: string): number | undefined {
  const match = /at position (\d+)/i.exec(message);
  return match ? Number(match[1]) : undefined;
}

/** Removes only an outer editable math wrapper; nested environments remain. */
export function extractMathExpression(source: string): { expression: string; displayMode: boolean } {
  const value = source.trim().replace(/^\s*%.*$/gm, "").replace(/\\label\{[^}]+\}/g, "").trim();
  if (value.startsWith("$$") && value.endsWith("$$")) return { expression: value.slice(2, -2).trim(), displayMode: true };
  if (value.startsWith("$") && value.endsWith("$")) return { expression: value.slice(1, -1).trim(), displayMode: false };
  if (value.startsWith("\\[") && value.endsWith("\\]")) return { expression: value.slice(2, -2).trim(), displayMode: true };
  if (value.startsWith("\\(") && value.endsWith("\\)")) return { expression: value.slice(2, -2).trim(), displayMode: false };
  const environment = /^\\begin\{([^}]+)\}(?:\[[^\]]*\])?([\s\S]*)\\end\{\1\}$/.exec(value);
  if (environment?.[1] && isMathEnvironment(environment[1])) {
    const name = environment[1];
    const body = (environment[2] ?? "").trim();
    return /^(align\*?|aligned|gather\*?|multline\*?|split|cases)$/.test(name)
      ? { expression: `\\begin{${name}}${body}\\end{${name}}`, displayMode: true }
      : { expression: body, displayMode: true };
  }
  return { expression: value, displayMode: true };
}

/** The only KaTeX configuration entry point used by Preview and both editors. */
export class MathRenderService {
  render(source: string, context: MathContext, options: MathRenderOptions): MathRenderResult {
    const expression = source.trim();
    if (!expression) return {};
    if (expression.length > maxFormulaLength) return { error: { message: "Formula is too long to preview", recoverable: true } };
    const config = { displayMode: options.displayMode, macros: context.macros, strict: "ignore" as const, trust: false, output: "htmlAndMathml" as const };
    try {
      return { html: katex.renderToString(expression, { ...config, throwOnError: options.throwOnError ?? true }) };
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const position = errorPosition(message);
      let html: string | undefined;
      try { html = katex.renderToString(expression, { ...config, throwOnError: false, errorColor: "#d44c55" }); } catch { /* raw fallback is rendered by the caller */ }
      return { ...(html ? { html } : {}), error: { message, ...(position === undefined ? {} : { position }), recoverable: true } };
    }
  }
}

export const mathRenderService = new MathRenderService();
