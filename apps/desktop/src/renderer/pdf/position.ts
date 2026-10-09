export interface PdfPageBox { page: number; top: number; height: number; }
export interface PdfReadingPosition { page: number; fraction: number; left: number; }

export function capturePdfReadingPosition(pages: PdfPageBox[], top: number, left = 0): PdfReadingPosition | undefined {
  const page = pages.find(item => item.top + item.height > top) ?? pages.at(-1);
  if (!page || page.height <= 0) return undefined;
  return { page: page.page, fraction: Math.max(-.1, Math.min(1, (top - page.top) / page.height)), left };
}
export function restorePdfReadingPosition(position: PdfReadingPosition, pages: PdfPageBox[]) {
  const page = pages.find(item => item.page === position.page) ?? pages.at(-1);
  return page ? { top: Math.max(0, page.top + position.fraction * page.height), left: Math.max(0, position.left) } : undefined;
}
export function pdfPageBoxes(root: HTMLElement): PdfPageBox[] {
  const bounds = root.getBoundingClientRect();
  return Array.from(root.querySelectorAll<HTMLElement>(".pdf-page")).map(element => {
    const box = element.getBoundingClientRect();
    return { page: Number(element.dataset.page), top: box.top - bounds.top + root.scrollTop - root.clientTop, height: box.height };
  });
}
