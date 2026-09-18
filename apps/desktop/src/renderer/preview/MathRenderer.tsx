import katex from "katex";
import { memo, type ReactNode } from "react";
import "katex/dist/katex.min.css";

interface MathRendererProps {
  expression: string;
  display?: boolean;
}

const maxFormulaLength = 24_000;

/** Renders only the formula HTML produced by our local KaTeX engine. */
export const MathRenderer = memo(function MathRenderer({ expression, display = false }: MathRendererProps): ReactNode {
  const source = expression.trim();
  if (!source) return null;
  if (source.length > maxFormulaLength) {
    return <code className={display ? "preview-display-math preview-math-fallback" : "preview-inline-math preview-math-fallback"}>{source}</code>;
  }
  try {
    const html = katex.renderToString(source, {
      displayMode: display,
      throwOnError: false,
      strict: "ignore",
      trust: false,
      output: "htmlAndMathml"
    });
    return <span className={display ? "preview-display-math" : "preview-inline-math"} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    // Invalid/incomplete input must remain visible and editable while the user types.
    return <code className={display ? "preview-display-math preview-math-fallback" : "preview-inline-math preview-math-fallback"}>{source}</code>;
  }
});
