import type { SearchDocument, SearchQuery, SearchResponse, SearchResult } from "./types.js";

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
export const searchResultLimit = 5000;

export function searchPattern(query: SearchQuery): { expression?: RegExp; error?: string } {
  if (!query.text) return {};
  try {
    const source = query.useRegex ? query.text : escapeRegex(query.text);
    const pattern = query.wholeWord && !query.useRegex ? `(?<![\\p{L}\\p{N}\\p{M}_])(?:${source})(?![\\p{L}\\p{N}\\p{M}_])` : source;
    return { expression: new RegExp(pattern, `gu${query.useRegex ? "m" : ""}${query.caseSensitive ? "" : "i"}`) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function mergeSearchRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const [start, end] of [...ranges].filter(([start, end]) => end >= start).sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export class SearchEngine {
  search(query: SearchQuery, documents: SearchDocument[], allowedRanges?: Map<string, Array<[number, number]>>): SearchResponse {
    const compiled = searchPattern(query);
    if (compiled.error) return { results: [], error: compiled.error };
    if (!compiled.expression) return { results: [] };
    const results: SearchResult[] = [];
    for (const document of documents) {
      const ranges = allowedRanges ? mergeSearchRanges(allowedRanges.get(document.fileId) ?? []) : undefined;
      if (ranges && !ranges.length) continue;
      let rangeIndex = 0, lineStart = 0, line = 1;
      let newline = document.content.indexOf("\n");
      const expression = new RegExp(compiled.expression.source, compiled.expression.flags);
      for (const match of document.content.matchAll(expression)) {
        const start = match.index ?? 0;
        const value = match[0] ?? "";
        const end = start + value.length;
        if (ranges) {
          while (rangeIndex < ranges.length && ranges[rangeIndex]![1] <= start && !(start === end && start === document.content.length && ranges[rangeIndex]![1] === start)) rangeIndex++;
          const range = ranges[rangeIndex];
          if (!range || start < range[0] || end > range[1]) continue;
        }
        if (results.length >= searchResultLimit) return { results, truncated: true };
        while (newline >= 0 && newline < start) { line++; lineStart = newline + 1; newline = document.content.indexOf("\n", lineStart); }
        const lineEnd = newline < 0 || end <= newline ? newline : document.content.indexOf("\n", end);
        const snippetStart = Math.max(lineStart, start - 60), last = lineEnd < 0 ? document.content.length : lineEnd;
        const snippetEnd = Math.min(last, snippetStart + 180);
        const snippet = `${snippetStart > lineStart ? "…" : ""}${document.content.slice(snippetStart, snippetEnd).replace(/\s+/g, " ")}${last > snippetEnd ? "…" : ""}`;
        results.push({ id: `${document.fileId}:${start}:${end}`, fileId: document.fileId, sourceStart: start, sourceEnd: end, matchStart: start, matchEnd: end, previewSnippet: snippet, line, column: start - lineStart + 1 });
      }
    }
    return { results };
  }
}

function substitution(template: string, match: string, captures: Array<string | undefined>, groups: Record<string, string | undefined> | undefined, source: string, offset: number): string {
  return template.replace(/\$(\$|&|`|'|<[^>]*>|\d{1,2})/g, (literal: string, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match;
    if (token === "`") return source.slice(0, offset);
    if (token === "'") return source.slice(offset + match.length);
    if (token.startsWith("<")) return groups ? groups[token.slice(1, -1)] ?? "" : literal;
    const index = Number(token);
    if (index > 0 && index <= captures.length) return captures[index - 1] ?? "";
    const first = Number(token[0]);
    return token.length === 2 && first > 0 && first <= captures.length ? (captures[first - 1] ?? "") + token[1] : literal;
  });
}

export interface ReplacementPlan { fileId: string; before: string; after: string; edits: Array<{ start: number; end: number; newLength: number }>; }
export function planReplacement(document: SearchDocument, results: SearchResult[], replacement: string, query?: SearchQuery): ReplacementPlan {
  const sorted = [...new Map(results.map(result => [result.id, result])).values()].sort((a, b) => a.matchStart - b.matchStart);
  let previousEnd = -1;
  for (const result of sorted) {
    if (result.fileId !== document.fileId || result.matchStart < previousEnd || result.matchStart < 0 || result.matchEnd < result.matchStart || result.matchEnd > document.content.length) throw new Error("ui.SearchEngine.invalid_or_overlapping_replacement_ranges");
    previousEnd = result.matchEnd;
  }
  const edits: ReplacementPlan["edits"] = [], parts: string[] = [];
  const replacements = new Map<string, string>();
  if (query?.useRegex) {
    const expression = searchPattern(query).expression;
    if (!expression) throw new Error("ui.SearchEngine.invalid_search_expression");
    const wanted = new Set(sorted.map(result => `${result.matchStart}:${result.matchEnd}`));
    let projectedLength = document.content.length;
    for (const match of document.content.matchAll(expression)) {
      const key = `${match.index}:${match.index! + match[0].length}`;
      if (wanted.has(key)) {
        const inserted = substitution(replacement, match[0], match.slice(1), match.groups, document.content, match.index!);
        projectedLength += inserted.length - match[0].length;
        if (projectedLength > Math.max(20_000_000, document.content.length + 5_000_000)) throw new Error("ui.SearchEngine.replacement_output_is_too_large");
        replacements.set(key, inserted);
      }
    }
  }
  let cursor = 0, length = document.content.length;
  for (const result of sorted) {
    const inserted = query?.useRegex ? replacements.get(`${result.matchStart}:${result.matchEnd}`) : replacement;
    if (inserted === undefined) throw new Error("ui.SearchEngine.search_results_changed_run_the_search_again");
    length += inserted.length - (result.matchEnd - result.matchStart);
    if (length > Math.max(20_000_000, document.content.length + 5_000_000)) throw new Error("ui.SearchEngine.replacement_output_is_too_large");
    parts.push(document.content.slice(cursor, result.matchStart), inserted);
    edits.push({ start: result.matchStart, end: result.matchEnd, newLength: inserted.length }); cursor = result.matchEnd;
  }
  parts.push(document.content.slice(cursor));
  return { fileId: document.fileId, before: document.content, after: parts.join(""), edits };
}
export function replaceRanges(content: string, results: SearchResult[], replacement: string, query?: SearchQuery): string {
  return planReplacement({ fileId: results[0]?.fileId ?? "", content }, results, replacement, query).after;
}
export function nextSearchResult(results: SearchResult[], activeId: string | undefined, direction: -1 | 1): SearchResult | undefined {
  if (!results.length) return undefined;
  const current = results.findIndex(result => result.id === activeId);
  return results[current < 0 ? direction === 1 ? 0 : results.length - 1 : (current + direction + results.length) % results.length];
}
