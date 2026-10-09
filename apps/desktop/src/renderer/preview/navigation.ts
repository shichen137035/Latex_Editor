import type { PreviewNode, SourceSpan } from "./types.js";

/** Source ranges are half-open; a boundary belongs to the following node. */
export function previewSpanContains(span: Pick<SourceSpan, "startOffset" | "endOffset">, offset: number): boolean {
  return span.startOffset <= offset && (offset < span.endOffset || span.startOffset === span.endOffset && offset === span.startOffset);
}

export function previewNodeAtOffset(nodes: PreviewNode[], offset: number): PreviewNode | undefined {
  const containing = (items: PreviewNode[]): PreviewNode | undefined => {
    const node = items.find((item) => item.source.startOffset !== item.source.endOffset && previewSpanContains(item.source, offset))
      ?? items.find((item) => previewSpanContains(item.source, offset));
    return node?.kind === "block" ? containing(node.children) ?? node : node;
  };
  // Preamble, whitespace gaps, and EOF still have a useful visible destination.
  return containing(nodes) ?? nodes.find((node) => node.source.startOffset >= offset) ?? nodes.at(-1);
}

/** Re-parsing changes node identities/ranges, but must not replay a UI event. */
export class PreviewNavigationEvents {
  private consumed = new Map<"navigation" | "highlight" | "relation", string>();

  consume(kind: "navigation" | "highlight" | "relation", fileId: string, nonce: number): boolean {
    const token = `${fileId}:${nonce}`;
    if (this.consumed.get(kind) === token) return false;
    this.consumed.set(kind, token);
    return true;
  }
}
