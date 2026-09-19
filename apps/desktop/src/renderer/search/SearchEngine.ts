import type { SearchDocument, SearchQuery, SearchResponse, SearchResult } from "./types.js";

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function searchPattern(query: SearchQuery): { expression?: RegExp; error?: string } {
  if (!query.text) return {};
  try {
    const source = query.useRegex ? query.text : escapeRegex(query.text);
    return { expression: new RegExp(query.wholeWord && !query.useRegex ? `\\b(?:${source})\\b` : source, query.caseSensitive ? "g" : "gi") };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function inRanges(start: number, end: number, ranges: Array<[number, number]> | undefined): boolean {
  return !ranges || ranges.some(([from, to]) => start >= from && end <= to);
}

export class SearchEngine {
  search(query: SearchQuery, documents: SearchDocument[], allowedRanges?: Map<string, Array<[number, number]>>): SearchResponse {
    const compiled = searchPattern(query);
    if (compiled.error) return { results: [], error: compiled.error };
    if (!compiled.expression) return { results: [] };
    const results: SearchResult[] = [];
    for (const document of documents) {
      const expression = new RegExp(compiled.expression.source, compiled.expression.flags);
      for (const match of document.content.matchAll(expression)) {
        const start = match.index ?? 0;
        const value = match[0] ?? "";
        if (!value) { expression.lastIndex += 1; continue; }
        const end = start + value.length;
        if (!inRanges(start, end, allowedRanges?.get(document.fileId))) continue;
        const before = document.content.slice(0, start);
        const lineStart = document.content.lastIndexOf("\n", start - 1) + 1;
        const lineEnd = document.content.indexOf("\n", end);
        const snippet = document.content.slice(lineStart, lineEnd < 0 ? document.content.length : lineEnd).trim();
        results.push({ id: `${document.fileId}:${start}:${end}`, fileId: document.fileId, sourceStart: start, sourceEnd: end, matchStart: start, matchEnd: end, previewSnippet: snippet.slice(0, 180), line: before.split("\n").length, column: start - lineStart + 1 });
      }
    }
    return { results };
  }
}

export function replaceRanges(content: string, results: SearchResult[], replacement: string): string {
  return [...results].sort((left, right) => right.matchStart - left.matchStart).reduce((value, result) => value.slice(0, result.matchStart) + replacement + value.slice(result.matchEnd), content);
}
