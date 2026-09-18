import { MATH_ENVIRONMENTS } from "./MathEnvironmentRegistry.js";
import type { MathNode } from "./types.js";

function escaped(source: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function commented(source: string, index: number): boolean {
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  for (let cursor = lineStart; cursor < index; cursor += 1) if (source[cursor] === "%" && !escaped(source, cursor)) return true;
  return false;
}

function node(start: number, end: number, contentStart: number, contentEnd: number, kind: MathNode["kind"], displayMode: boolean, environmentName?: string): MathNode {
  return { id: `math:${kind}:${start}:${end}`, start, end, contentStart, contentEnd, kind, displayMode, ...(environmentName ? { environmentName } : {}) };
}

/** Parses math ranges once per editor model version; mouse lookup then uses an interval index. */
export function parseMathNodes(source: string): MathNode[] {
  const candidates: MathNode[] = [];
  const environmentStack: Array<{ name: string; start: number; contentStart: number }> = [];
  const environmentPattern = /\\begin\{([^}]+)\}|\\end\{([^}]+)\}/g;
  for (const match of source.matchAll(environmentPattern)) {
    const offset = match.index ?? 0;
    if (commented(source, offset)) continue;
    if (match[1] && MATH_ENVIRONMENTS.has(match[1])) environmentStack.push({ name: match[1], start: offset, contentStart: offset + match[0].length });
    else if (match[2] && MATH_ENVIRONMENTS.has(match[2])) {
      let index = -1;
      for (let candidate = environmentStack.length - 1; candidate >= 0; candidate -= 1) {
        if (environmentStack[candidate]?.name === match[2]) { index = candidate; break; }
      }
      if (index < 0) continue;
      const entry = environmentStack[index]!;
      environmentStack.splice(index, 1);
      candidates.push(node(entry.start, offset + match[0].length, entry.contentStart, offset, "environment", true, entry.name));
    }
  }

  const paired = (open: string, close: string, kind: MathNode["kind"], display: boolean) => {
    let cursor = 0;
    while ((cursor = source.indexOf(open, cursor)) >= 0) {
      if (commented(source, cursor) || escaped(source, cursor)) { cursor += open.length; continue; }
      const end = source.indexOf(close, cursor + open.length);
      if (end < 0) break;
      candidates.push(node(cursor, end + close.length, cursor + open.length, end, kind, display));
      cursor = end + close.length;
    }
  };
  paired("\\(", "\\)", "inline-paren", false);
  paired("\\[", "\\]", "display-bracket", true);

  for (let cursor = 0; cursor < source.length;) {
    if (source[cursor] !== "$" || escaped(source, cursor) || commented(source, cursor)) { cursor += 1; continue; }
    const delimiter = source[cursor + 1] === "$" ? "$$" : "$";
    let end = cursor + delimiter.length;
    while ((end = source.indexOf(delimiter, end)) >= 0 && escaped(source, end)) end += delimiter.length;
    if (end < 0) break;
    candidates.push(node(cursor, end + delimiter.length, cursor + delimiter.length, end, delimiter === "$$" ? "display-dollar" : "inline-dollar", delimiter === "$$"));
    cursor = end + delimiter.length;
  }

  candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  const outer: MathNode[] = [];
  for (const candidate of candidates) {
    if (outer.some((existing) => existing.start <= candidate.start && existing.end >= candidate.end)) continue;
    outer.push(candidate);
  }
  return outer;
}

export class MathNodeIndex {
  readonly #nodes: MathNode[];
  constructor(nodes: MathNode[]) { this.#nodes = [...nodes].sort((left, right) => left.start - right.start); }
  static fromSource(source: string): MathNodeIndex { return new MathNodeIndex(parseMathNodes(source)); }
  all(): MathNode[] { return this.#nodes.map((item) => ({ ...item })); }
  findMathNodeAtOffset(offset: number): MathNode | null {
    let low = 0;
    let high = this.#nodes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.#nodes[middle]?.start ?? Number.MAX_SAFE_INTEGER) <= offset) low = middle + 1; else high = middle;
    }
    for (let index = low - 1; index >= 0; index -= 1) {
      const candidate = this.#nodes[index]!;
      if (candidate.end < offset) break;
      if (candidate.start <= offset && offset <= candidate.end) return { ...candidate };
    }
    return null;
  }
}
