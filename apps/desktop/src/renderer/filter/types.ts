import type { PreviewNode } from "../preview/types.js";

export type FilterGroupId = "blockType" | "location" | "file" | "properties";
export type FilterGroupMode = "include" | "exclude";
export type FilterViewMode = "original" | "dim" | "collapse" | "remove";
export type FilterState = "match" | "context" | "unmatched";
export type ContentProperty = "hasMath" | "hasCitation" | "hasLabel" | "hasFigure" | "hasTable" | "hasReference";

export interface FilterQuery {
  enabled: boolean;
  viewMode: FilterViewMode;
  blockTypes: string[];
  locations: string[];
  files: string[];
  properties: ContentProperty[];
  /** Each group can independently act as an allow-list or a deny-list. */
  groupModes: Record<FilterGroupId, FilterGroupMode>;
  /** Last mode applied by the master control; individual changes do not alter it. */
  masterMode: FilterGroupMode;
}

export interface FilterEvaluation {
  states: Map<string, FilterState>;
  matches: Set<string>;
  context: Set<string>;
  unmatched: Set<string>;
  ranges: Array<[number, number]>;
}

export interface LocationOption { id: string; title: string; depth: number }
export interface FilterOptions { blockTypes: string[]; locations: LocationOption[]; files: string[] }
export interface FilterDocument { fileId: string; source: string; nodes: PreviewNode[] }

export const defaultFilterQuery: FilterQuery = {
  enabled: false,
  viewMode: "dim",
  blockTypes: [],
  locations: [],
  files: [],
  properties: [],
  groupModes: { blockType: "include", location: "include", file: "include", properties: "include" },
  masterMode: "include"
};
