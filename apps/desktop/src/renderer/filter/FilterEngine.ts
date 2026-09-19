import type { PreviewNode } from "../preview/types.js";
import type { ContentProperty, FilterEvaluation, FilterGroupId, FilterOptions, FilterQuery, FilterState, LocationOption } from "./types.js";

const sectionTypes = new Set(["chapter", "section", "subsection", "subsubsection", "paragraph"]);

function blockType(node: PreviewNode): string { return node.kind === "content" ? "paragraph" : node.environmentId.replace(/-star$/, ""); }
function propertyMatches(property: ContentProperty, raw: string): boolean {
  if (property === "hasMath") return /\$|\\\(|\\\[|\\begin\{(?:equation|align|gather|multline)/.test(raw);
  if (property === "hasCitation") return /\\[A-Za-z]*cite[A-Za-z]*\s*\{/.test(raw);
  if (property === "hasLabel") return /\\label\s*\{/.test(raw);
  if (property === "hasFigure") return /\\begin\{figure\}|\\includegraphics/.test(raw);
  if (property === "hasTable") return /\\begin\{(?:table|tabular)\}/.test(raw);
  return /\\[A-Za-z]*ref[A-Za-z]*\s*\{/.test(raw);
}

export class FilterEngine {
  evaluate(nodes: PreviewNode[], source: string, fileId: string, query: FilterQuery): FilterEvaluation {
    const states = new Map<string, FilterState>();
    const matches = new Set<string>();
    const context = new Set<string>();
    const unmatched = new Set<string>();
    const hasConditions = query.blockTypes.length + query.locations.length + query.files.length + query.properties.length > 0;
    const visit = (node: PreviewNode, ancestors: PreviewNode[], locations: string[]): boolean => {
      const nextLocations = node.kind === "block" && sectionTypes.has(node.environmentId) ? [...locations, node.id] : locations;
      const raw = source.slice(node.source.startOffset, node.source.endOffset);
      const group = (id: FilterGroupId, active: boolean, match: boolean) => !active || (query.groupModes[id] === "exclude" ? !match : match);
      const direct = !query.enabled || !hasConditions || (
        group("blockType", query.blockTypes.length > 0, query.blockTypes.includes(blockType(node))) &&
        group("location", query.locations.length > 0, query.locations.some((id) => nextLocations.includes(id))) &&
        group("file", query.files.length > 0, query.files.includes(fileId)) &&
        group("properties", query.properties.length > 0, query.properties.every((property) => propertyMatches(property, raw)))
      );
      if (direct) matches.add(node.id);
      let descendantMatch = false;
      if (node.kind === "block") for (const child of node.children) descendantMatch = visit(child, [...ancestors, node], nextLocations) || descendantMatch;
      if (!direct && descendantMatch) context.add(node.id);
      return direct || descendantMatch;
    };
    for (const node of nodes) visit(node, [], []);
    const collect = (node: PreviewNode) => { if (!matches.has(node.id) && !context.has(node.id)) unmatched.add(node.id); if (node.kind === "block") node.children.forEach(collect); };
    nodes.forEach(collect);
    for (const id of matches) states.set(id, "match");
    for (const id of context) states.set(id, "context");
    for (const id of unmatched) states.set(id, "unmatched");
    const ranges: Array<[number, number]> = [];
    const addRanges = (node: PreviewNode) => { if (matches.has(node.id)) ranges.push([node.source.startOffset, node.source.endOffset]); if (node.kind === "block") node.children.forEach(addRanges); };
    nodes.forEach(addRanges);
    return { states, matches, context, unmatched, ranges };
  }

  options(nodes: PreviewNode[], files: string[]): FilterOptions {
    const types = new Set<string>();
    const locations: LocationOption[] = [];
    const visit = (node: PreviewNode, depth: number) => {
      types.add(blockType(node));
      if (node.kind === "block") {
        if (sectionTypes.has(node.environmentId)) locations.push({ id: node.id, title: node.title ?? node.environmentId, depth });
        node.children.forEach((child) => visit(child, sectionTypes.has(node.environmentId) ? depth + 1 : depth));
      }
    };
    nodes.forEach((node) => visit(node, 0));
    return { blockTypes: [...types].sort(), locations, files };
  }
}
