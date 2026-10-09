export const DIRECTORY_PAGE_SIZE = 10;
export function projectPage(total: number, requested: number) {
  const count = Math.max(1, Math.ceil(total / DIRECTORY_PAGE_SIZE));
  const index = Math.max(0, Math.min(count - 1, requested));
  const start = index * DIRECTORY_PAGE_SIZE;
  return { index, count, start, end: Math.min(total, start + DIRECTORY_PAGE_SIZE) };
}
export function directoryPageNumbers(index: number, count: number): Array<number | "gap"> {
  if (count <= 7) return Array.from({ length: count }, (_, page) => page);
  const start = Math.max(0, Math.min(index - 2, count - 5));
  const visible = [...new Set([0, ...Array.from({ length: 5 }, (_, page) => start + page), count - 1])].sort((a, b) => a - b);
  return visible.flatMap((page, position): Array<number | "gap"> => position && page - visible[position - 1]! > 1 ? ["gap", page] : [page]);
}
