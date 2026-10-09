export interface PreviewScrollAnchor {
  element: HTMLElement;
  id: string;
  top: number;
  height: number;
  scrollTop: number;
}

/** Prefer a visible leaf row, so nested virtual lists cannot compensate the same shift twice. */
export function capturePreviewScrollAnchor(root: HTMLElement): PreviewScrollAnchor | undefined {
  const bounds = root.getBoundingClientRect();
  const rows = Array.from(root.querySelectorAll<HTMLElement>("[data-virtual-node-id]"))
    .filter(element => !element.querySelector("[data-virtual-node-id]"))
    .map(element => ({ element, rect: element.getBoundingClientRect() }))
    .filter(({ rect }) => rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.top + root.clientHeight);
  const below = rows.filter(({ rect }) => rect.top >= bounds.top).sort((a, b) => a.rect.top - b.rect.top);
  const row = below[0] ?? rows.sort((a, b) => b.rect.top - a.rect.top)[0];
  return row ? { element: row.element, id: row.element.dataset.virtualNodeId!, top: row.rect.top - bounds.top, height: row.rect.height, scrollTop: root.scrollTop } : undefined;
}

/** Preserve layout position while retaining the user's intervening scroll delta. */
export function restorePreviewScrollAnchor(root: HTMLElement, anchor?: PreviewScrollAnchor): number {
  if (!anchor) return 0;
  const element = root.contains(anchor.element) ? anchor.element
    : Array.from(root.querySelectorAll<HTMLElement>("[data-virtual-node-id]")).find(row => row.dataset.virtualNodeId === anchor.id);
  if (!element) return 0;
  const bounds = root.getBoundingClientRect();
  const expectedTop = anchor.top - (root.scrollTop - anchor.scrollTop);
  // An explicit long jump should establish a new anchor, not preserve an offscreen one.
  if (expectedTop + anchor.height < -root.clientHeight || expectedTop > root.clientHeight * 2) return 0;
  const delta = element.getBoundingClientRect().top - bounds.top - expectedTop;
  if (Math.abs(delta) >= .5) root.scrollTop += delta;
  const rect = element.getBoundingClientRect();
  anchor.element = element; anchor.top = rect.top - bounds.top; anchor.height = rect.height; anchor.scrollTop = root.scrollTop;
  return Math.abs(delta) >= .5 ? delta : 0;
}
