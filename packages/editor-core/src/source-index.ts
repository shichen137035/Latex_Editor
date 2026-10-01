import type { SourceRange } from "@latex-editor/contracts";

/** One line index per source revision; queries never rescan a whole file. */
export class SourceIndex {
  readonly #starts = [0];
  constructor(source: string) { for (let offset = 0; offset < source.length; offset++) if (source.charCodeAt(offset) === 10) this.#starts.push(offset + 1); }
  positionAt(offset: number): { line: number; column: number } {
    let low = 0, high = this.#starts.length;
    while (low + 1 < high) { const middle = (low + high) >>> 1; if (this.#starts[middle]! <= offset) low = middle; else high = middle; }
    return { line: low + 1, column: offset - this.#starts[low]! + 1 };
  }
  range(start: number, end: number): SourceRange {
    const first = this.positionAt(start), last = this.positionAt(end);
    return { start, end, startLine: first.line, startColumn: first.column, endLine: last.line, endColumn: last.column };
  }
}
