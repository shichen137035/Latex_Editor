export interface LineDiffRange { oldStart: number; oldEnd: number; newStart: number; newEnd: number }
export function textLines(text: string): string[] { return text.match(/[^\n]*\n|[^\n]+$/g) ?? []; }

/** Myers diff: sparse changes scale with edit distance rather than file length squared. */
export function lineDiffRanges(before: readonly string[], after: readonly string[], depthLimit = 0): LineDiffRange[] {
  let prefix = 0, suffix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  const n = before.length - prefix - suffix, m = after.length - prefix - suffix;
  if (!n && !m) return [];
  const entire = [{ oldStart: prefix, oldEnd: prefix + n, newStart: prefix, newEnd: prefix + m }];
  if (!n || !m) return entire;
  const budget = Math.min(n + m, 1024), offset = budget + 1;
  const vector = new Int32Array(2 * budget + 3).fill(-1);
  vector[offset + 1] = 0;
  const trace: Int32Array[] = [];
  let complete = false;
  for (let depth = 0; depth <= budget && !complete; depth++) {
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const index = offset + diagonal;
      let x = diagonal === -depth || diagonal !== depth && vector[index - 1]! < vector[index + 1]!
        ? vector[index + 1]! : vector[index - 1]! + 1;
      let y = x - diagonal;
      while (x < n && y < m && before[prefix + x] === after[prefix + y]) { x++; y++; }
      vector[index] = x;
      if (x >= n && y >= m) { complete = true; break; }
    }
    trace.push(vector.slice());
  }
  // Bound work for wholesale rewrites; retain exact source so review/application remain safe.
  if (!complete) {
    if (depthLimit >= 16) return entire;
    // Patience anchors split extensive edits around unique unchanged lines.
    const positions = (lines: readonly string[], length: number) => {
      const map = new Map<string, number>();
      for (let i = 0; i < length; i++) { const text = lines[prefix + i]!; map.set(text, map.has(text) ? -1 : i); }
      return map;
    };
    const left = positions(before, n), right = positions(after, m);
    const pairs = [...left].filter(([text, position]) => position >= 0 && (right.get(text) ?? -1) >= 0).map(([text, position]) => ({ old: position, next: right.get(text)! }));
    const tails: number[] = [], previous: number[] = [];
    pairs.forEach((pair, index) => {
      let low = 0, high = tails.length;
      while (low < high) { const middle = (low + high) >> 1; if (pairs[tails[middle]!]!.next < pair.next) low = middle + 1; else high = middle; }
      previous[index] = low ? tails[low - 1]! : -1;
      tails[low] = index;
    });
    if (!tails.length) return entire;
    const anchors: typeof pairs = [];
    for (let index = tails.at(-1)!; index >= 0; index = previous[index]!) anchors.push(pairs[index]!);
    anchors.reverse();
    const ranges: LineDiffRange[] = [];
    let old = prefix, next = prefix;
    for (const anchor of [...anchors, { old: n, next: m }]) {
      const oldEnd = prefix + anchor.old, newEnd = prefix + anchor.next;
      for (const range of lineDiffRanges(before.slice(old, oldEnd), after.slice(next, newEnd), depthLimit + 1)) ranges.push({ oldStart: old + range.oldStart, oldEnd: old + range.oldEnd, newStart: next + range.newStart, newEnd: next + range.newEnd });
      old = oldEnd + 1; next = newEnd + 1;
    }
    return ranges;
  }
  let x = n, y = m;
  const operations: Array<"equal" | "delete" | "insert"> = [];
  for (let depth = trace.length - 1; depth > 0; depth--) {
    const previous = trace[depth - 1]!, diagonal = x - y;
    const prior = diagonal === -depth || diagonal !== depth && previous[offset + diagonal - 1]! < previous[offset + diagonal + 1]! ? diagonal + 1 : diagonal - 1;
    const priorX = previous[offset + prior]!, priorY = priorX - prior;
    while (x > priorX && y > priorY) { operations.push("equal"); x--; y--; }
    if (x === priorX) { operations.push("insert"); y--; }
    else { operations.push("delete"); x--; }
  }
  while (x > 0 && y > 0) { operations.push("equal"); x--; y--; }
  while (x-- > 0) operations.push("delete");
  while (y-- > 0) operations.push("insert");
  let oldPosition = prefix, newPosition = prefix;
  const ranges: LineDiffRange[] = [];
  let range: LineDiffRange | undefined;
  for (const operation of operations.reverse()) {
    if (operation === "equal") { range = undefined; oldPosition++; newPosition++; continue; }
    if (!range) { range = { oldStart: oldPosition, oldEnd: oldPosition, newStart: newPosition, newEnd: newPosition }; ranges.push(range); }
    if (operation === "delete") range.oldEnd = ++oldPosition;
    else range.newEnd = ++newPosition;
  }
  return ranges;
}
