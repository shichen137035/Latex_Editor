import { memo, type ReactNode } from "react";
import { mathRenderService } from "../math/MathRenderService.js";
import { EMPTY_MATH_CONTEXT, type MathContext } from "../math/types.js";
import "katex/dist/katex.min.css";

interface MathRendererProps {
  expression: string;
  display?: boolean;
  context?: MathContext;
}

/** React adapter for the shared project-aware math rendering service. */
export const MathRenderer = memo(function MathRenderer({ expression, display = false, context = EMPTY_MATH_CONTEXT }: MathRendererProps): ReactNode {
  const source = expression.trim();
  if (!source) return null;
  const result = mathRenderService.render(source, context, { displayMode: display, throwOnError: false });
  if (result.html) return <span className={display ? "preview-display-math" : "preview-inline-math"} dangerouslySetInnerHTML={{ __html: result.html }} />;
  return <code className={display ? "preview-display-math preview-math-fallback" : "preview-inline-math preview-math-fallback"}>{source}</code>;
});
