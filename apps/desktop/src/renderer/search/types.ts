export type SearchScope = "current-file" | "entire-project";

export interface SearchQuery {
  text: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  scope: SearchScope;
}

export interface SearchDocument {
  fileId: string;
  content: string;
}

export interface SearchResult {
  id: string;
  fileId: string;
  sourceStart: number;
  sourceEnd: number;
  matchStart: number;
  matchEnd: number;
  previewSnippet: string;
  line: number;
  column: number;
}

export interface SearchResponse {
  results: SearchResult[];
  error?: string;
  truncated?: boolean;
  incomplete?: boolean;
}

/** Preview consumes verified source matches instead of rerunning user regexes on the UI thread. */
export interface InlineSearchQuery extends SearchQuery { resolvedMatches?: readonly SearchResult[]; activeMatchId?: string | undefined; }

export const defaultSearchQuery: SearchQuery = { text: "", caseSensitive: false, wholeWord: false, useRegex: false, scope: "current-file" };
