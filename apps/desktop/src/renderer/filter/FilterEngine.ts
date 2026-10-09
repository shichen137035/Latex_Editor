import type { PreviewNode } from "../preview/types.js";
import { maskLatexComments } from "@latex-editor/editor-core/latex-source";
import { mergeSearchRanges } from "../search/SearchEngine.js";
import type { ContentProperty, FilterEvaluation, FilterGroupId, FilterOptions, FilterQuery, FilterState, LocationOption } from "./types.js";

const sectionTypes = new Set(["chapter", "section", "subsection", "subsubsection", "paragraph"]);

function blockType(node: PreviewNode): string { return node.kind === "content" ? "paragraph" : node.environmentId.replace(/-star$/, ""); }
function propertyMatches(property: ContentProperty, raw: string): boolean {
  if (property === "hasMath") return /(?<!\\)\$|(?<!\\)\\[([]|(?<!\\)\\begin\s*\{(?:equation|align|gather|multline|displaymath|math|eqnarray)\*?\}/.test(raw);
  if (property === "hasCitation") return /(?<!\\)\\[A-Za-z]*cite[A-Za-z]*\*?\s*(?:\[[^\]]*\]\s*)*\{/.test(raw);
  if (property === "hasLabel") return /(?<!\\)\\label\s*\{/.test(raw);
  if (property === "hasFigure") return /(?<!\\)\\begin\s*\{figure\*?\}|(?<!\\)\\includegraphics\b/.test(raw);
  if (property === "hasTable") return /(?<!\\)\\begin\s*\{(?:table|tabular|tabularx|longtable|tabularray|tblr)\*?\}/.test(raw);
  return /(?<!\\)\\[A-Za-z]*ref[A-Za-z]*\*?\s*\{/.test(raw);
}

/** Location identity is independent of source offsets and renderer IDs. */
function locationIndex(nodes: PreviewNode[], fileId: string) {
  const ids = new Map<string, string>(), locations: LocationOption[] = [], counts = new Map<string, number>();
  const visit = (node: PreviewNode, ancestors: string[], depth: number) => {
    let next = ancestors;
    if (node.kind === "block" && sectionTypes.has(blockType(node))) {
      const base = JSON.stringify(node.latexLabel ? [fileId, "label", node.latexLabel] : [fileId, ...ancestors, blockType(node), node.title ?? ""]);
      const ordinal = counts.get(base) ?? 0; counts.set(base, ordinal + 1);
      const id = `location:${base}:${ordinal}`;
      ids.set(node.id, id); locations.push({ id, title: node.title ?? blockType(node), depth, fileId });
      next = [...ancestors, `${blockType(node)}:${node.title ?? ""}:${ordinal}`]; depth++;
    }
    if (node.kind === "block") node.children.forEach(child => visit(child, next, depth));
  };
  nodes.forEach(node => visit(node, [], 0));
  return { ids, locations };
}
export function hasFilterConditions(query: FilterQuery): boolean {
  return query.enabled && query.blockTypes.length + query.locations.length + query.files.length + query.properties.length > 0;
}
export function fileMatchesFilter(fileId: string, query: FilterQuery): boolean {
  const match = query.files.includes(fileId);
  return !query.enabled || !query.files.length || (query.groupModes.file === "exclude" ? !match : match);
}

export class FilterEngine {
  evaluate(nodes: PreviewNode[], source: string, fileId: string, query: FilterQuery): FilterEvaluation {
    const states = new Map<string, FilterState>();
    const matches = new Set<string>();
    const context = new Set<string>();
    const unmatched = new Set<string>();
    const hasConditions = query.blockTypes.length + query.locations.length + query.files.length + query.properties.length > 0;
    const locationIds = locationIndex(nodes, fileId).ids;
    const visit = (node: PreviewNode, locations: string[], inheritedMatch = false): boolean => {
      const locationId = locationIds.get(node.id);
      const nextLocations = locationId ? [...locations, locationId] : locations;
      const raw = maskLatexComments(source.slice(node.source.startOffset, node.source.endOffset));
      const group = (id: FilterGroupId, active: boolean, match: boolean) => !active || (query.groupModes[id] === "exclude" ? !match : match);
      const ownMatch = !query.enabled || !hasConditions || (
        group("blockType", query.blockTypes.length > 0, query.blockTypes.includes(blockType(node))) &&
        group("location", query.locations.length > 0, query.locations.some((id) => nextLocations.includes(id))) &&
        group("file", query.files.length > 0, query.files.includes(fileId)) &&
        group("properties", query.properties.length > 0, query.properties.every((property) => propertyMatches(property, raw)))
      );
      // An included structural block owns the content below it. Keep that
      // subtree visible even when its child blocks have another type; the
      // filter is selecting the containing block and its contents together.
      // Do not inherit an exclude rule, otherwise excluding one child type
      // would accidentally make that child visible through its parent.
      const ownsContent = ownMatch && node.kind === "block" && query.blockTypes.length > 0 && query.groupModes.blockType !== "exclude" && query.blockTypes.includes(blockType(node));
      const excluded = query.enabled && (
        query.blockTypes.length > 0 && query.groupModes.blockType === "exclude" && query.blockTypes.includes(blockType(node)) ||
        query.locations.length > 0 && query.groupModes.location === "exclude" && query.locations.some(id => nextLocations.includes(id)) ||
        !fileMatchesFilter(fileId, query) ||
        query.properties.length > 0 && query.groupModes.properties === "exclude" && query.properties.every(property => propertyMatches(property, raw))
      );
      const direct = !excluded && (inheritedMatch || ownMatch);
      if (direct) matches.add(node.id);
      let descendantMatch = false;
      if (node.kind === "block") for (const child of node.children) descendantMatch = visit(child, nextLocations, !excluded && (inheritedMatch || ownsContent)) || descendantMatch;
      if (!direct && descendantMatch) context.add(node.id);
      return direct || descendantMatch;
    };
    for (const node of nodes) visit(node, []);
    const collect = (node: PreviewNode) => { if (!matches.has(node.id) && !context.has(node.id)) unmatched.add(node.id); if (node.kind === "block") node.children.forEach(collect); };
    nodes.forEach(collect);
    for (const id of matches) states.set(id, "match");
    for (const id of context) states.set(id, "context");
    for (const id of unmatched) states.set(id, "unmatched");
    const ranges: Array<[number, number]> = [];
    const addRanges = (node: PreviewNode) => {
      if (matches.has(node.id)) {
        let cursor = node.source.startOffset;
        const children = node.kind === "block" ? [...node.children].sort((a, b) => a.source.startOffset - b.source.startOffset) : [];
        for (const child of children) {
          if (cursor < child.source.startOffset) ranges.push([cursor, child.source.startOffset]);
          cursor = Math.max(cursor, child.source.endOffset);
        }
        if (cursor < node.source.endOffset) ranges.push([cursor, node.source.endOffset]);
      }
      if (node.kind === "block") node.children.forEach(addRanges);
    };
    nodes.forEach(addRanges);
    return { states, matches, context, unmatched, ranges: mergeSearchRanges(ranges) };
  }

  options(nodes: PreviewNode[], files: string[]): FilterOptions {
    const types = new Set<string>();
    const locations = locationIndex(nodes, nodes[0]?.source.filePath ?? files[0] ?? "").locations;
    const visit = (node: PreviewNode, depth: number) => {
      types.add(blockType(node));
      if (node.kind === "block") {
        node.children.forEach((child) => visit(child, sectionTypes.has(blockType(node)) ? depth + 1 : depth));
      }
    };
    nodes.forEach((node) => visit(node, 0));
    return { blockTypes: [...types].sort(), locations, files };
  }
}
