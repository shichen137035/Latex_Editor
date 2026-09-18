import { useMemo, type CSSProperties } from "react";
import { mathRenderService } from "./MathRenderService.js";
import type { MathContext } from "./types.js";
import "katex/dist/katex.min.css";
import "./math-preview.css";

export function MathPreviewPopover({ source, displayMode, context, anchor, className = "" }: { source: string; displayMode: boolean; context: MathContext; anchor?: DOMRect | undefined; className?: string }) {
  const result = useMemo(() => mathRenderService.render(source, context, { displayMode }), [source, displayMode, context]);
  if (!source.trim()) return null;
  const spaceAbove = anchor?.top ?? 0;
  const spaceBelow = anchor ? window.innerHeight - anchor.bottom : 0;
  const above = !anchor || spaceAbove >= 110 || spaceAbove >= spaceBelow;
  const style = anchor ? {
    left: Math.max(10, Math.min(window.innerWidth - 290, anchor.left)),
    top: above ? anchor.top - 7 : anchor.bottom + 7,
    maxHeight: Math.max(64, (above ? spaceAbove : spaceBelow) - 16),
    transform: above ? "translateY(-100%)" : undefined
  } as CSSProperties : undefined;
  return <aside className={`math-preview-popover ${above ? "above" : "below"} ${className}`} style={style} role="status">
    {result.html ? <div className="math-preview-result" dangerouslySetInnerHTML={{ __html: result.html }}/> : <code className="math-preview-raw">{source}</code>}
    {result.error && <small title={result.error.message}>⚠ {result.error.message}</small>}
  </aside>;
}
