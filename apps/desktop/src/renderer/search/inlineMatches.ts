import { searchPattern } from "./SearchEngine.js";
import type { InlineSearchQuery } from "./types.js";

/** User regexes are evaluated only by the disposable search worker. */
export function inlineMatchRanges(value: string, query: InlineSearchQuery, sourceOffset?: number): Array<[number, number]> {
  if (!value || !query.text) return [];
  if (query.resolvedMatches !== undefined) return sourceOffset === undefined ? [] : query.resolvedMatches
    .filter(match => match.matchStart >= sourceOffset && match.matchEnd <= sourceOffset + value.length && match.matchEnd > match.matchStart)
    .map(match => [match.matchStart - sourceOffset, match.matchEnd - sourceOffset]);
  if (query.useRegex) return [];
  const pattern = searchPattern(query).expression;
  return pattern ? [...value.matchAll(pattern)].filter(match => match[0].length > 0).map(match => [match.index!, match.index! + match[0].length]) : [];
}
