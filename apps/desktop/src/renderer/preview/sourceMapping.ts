const markerSelector = "[data-preview-source-start][data-preview-source-end]";
const pointerMappings = new WeakMap<object, { owner: Element | null; offset: number | undefined }>();

/** Resolve a DOM caret only inside its owning block and exact inline source run. */
export function sourceOffsetAtDomPoint(container: HTMLElement, node: Node, offset: number): number | undefined {
  const element = (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest<HTMLElement>(markerSelector);
  if (!element || !container.contains(element)) return undefined;
  const start = Number(element.dataset.previewSourceStart), end = Number(element.dataset.previewSourceEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  if (element.dataset.previewSourceMode === "atomic") return start;
  try {
    // Walk only this continuous run (including nested search highlights), not
    // the containing paragraph, other blocks, or KaTeX's hidden MathML tree.
    const range = container.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, offset);
    return Math.min(end, start + range.toString().length);
  } catch { return start; }
}

type SourcePointer = { clientX: number; clientY: number; target?: EventTarget | null; nativeEvent?: object };

export function sourceOffsetAtPoint(container: HTMLElement, point: SourcePointer): number | undefined {
  const key = point.nativeEvent ?? point;
  const owner = container.closest("[data-source-start-offset]");
  const cached = pointerMappings.get(key);
  if (cached?.owner === owner) return cached.offset;
  const offset = resolveSourceOffsetAtPoint(container, point);
  pointerMappings.set(key, { owner, offset });
  return offset;
}

function resolveSourceOffsetAtPoint(container: HTMLElement, point: SourcePointer): number | undefined {
  const doc = container.ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  // Prefer the clicked mathematical atom, whose descendants contain duplicate
  // accessibility text and have no meaningful linear source character offset.
  const clicked = point.target instanceof Element ? point.target : point.target instanceof Node ? point.target.parentElement : undefined;
  const atom = clicked?.closest<HTMLElement>(markerSelector);
  if (atom?.dataset.previewSourceMode === "atomic" && container.contains(atom)) return Number(atom.dataset.previewSourceStart);
  const caret = doc.caretPositionFromPoint?.(point.clientX, point.clientY);
  const range = caret ? undefined : doc.caretRangeFromPoint?.(point.clientX, point.clientY);
  const offset = caret ? sourceOffsetAtDomPoint(container, caret.offsetNode, caret.offset) : range ? sourceOffsetAtDomPoint(container, range.startContainer, range.startOffset) : undefined;
  if (offset !== undefined) return offset;
  const marker = clicked?.closest<HTMLElement>(markerSelector);
  if (marker && container.contains(marker)) return Number(marker.dataset.previewSourceStart);
  const region = container.closest<HTMLElement>("[data-source-start-offset]");
  const start = Number(region?.dataset.sourceStartOffset);
  return Number.isFinite(start) ? start : undefined;
}
