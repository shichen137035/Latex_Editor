import type { PreviewDirectiveDefinition } from "@latex-editor/contracts";
import { FilterEngine, fileMatchesFilter, hasFilterConditions } from "../filter/FilterEngine.js";
import type { FilterQuery } from "../filter/types.js";
import type { EnvironmentDefinition, PreviewDocument } from "../preview/types.js";
import type { SearchDocument } from "./types.js";

export function isSearchableProjectFile(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return /\.(?:tex|sty|cls|bib|txt|md|ltx|dtx|ins|def|fd|json|xml|css|yaml|yml)$/i.test(path) && isSearchableProjectPath(path)
    && (!normalized.toLowerCase().startsWith(".texweave/") || normalized.toLowerCase() === ".texweave/generated-references.bib");
}
export function isSearchableProjectPath(path: string): boolean {
  return !/(?:^|[/\\])(?:\.git|\.latex-editor|node_modules)(?:[/\\]|$)/i.test(path)
    && !/(?:^|[/\\])\.texweave[/\\](?:history|cache|build|ai-attachments)(?:[/\\]|$)/i.test(path);
}
export type FilterDocument = SearchDocument & { preview: PreviewDocument };
export function searchFileRanges(documents: SearchDocument[], parsed: FilterDocument[], query: FilterQuery): Map<string, Array<[number, number]>> | undefined {
  if (!hasFilterConditions(query)) return undefined;
  const structural = query.blockTypes.length + query.locations.length + query.properties.length > 0;
  const engine = new FilterEngine(), previews = new Map(parsed.map(item => [item.fileId, item]));
  return new Map(documents.map(document => {
    if (!fileMatchesFilter(document.fileId, query)) return [document.fileId, []];
    if (!structural) return [document.fileId, [[0, document.content.length]]];
    const parsed = previews.get(document.fileId);
    return [document.fileId, parsed ? engine.evaluate(parsed.preview.nodes, document.content, document.fileId, query).ranges : []];
  }));
}

/** Retain only current project files, and parse only files whose text or configuration changed. */
export class PreviewFilterCache {
  private entries = new Map<string, FilterDocument>();
  private definitions: EnvironmentDefinition[] | undefined;
  private directives: PreviewDirectiveDefinition[] | undefined;
  documents(documents: SearchDocument[], definitions: EnvironmentDefinition[], directives: PreviewDirectiveDefinition[], parse: (source: string, path: string, definitions: EnvironmentDefinition[], directives: PreviewDirectiveDefinition[]) => PreviewDocument): FilterDocument[] {
    if (this.definitions !== definitions || this.directives !== directives) this.entries.clear();
    this.definitions = definitions; this.directives = directives;
    const files = documents.filter(item => item.fileId.toLowerCase().endsWith(".tex")), live = new Set(files.map(item => item.fileId));
    for (const path of this.entries.keys()) if (!live.has(path)) this.entries.delete(path);
    return files.map(item => {
      const cached = this.entries.get(item.fileId);
      if (cached?.content === item.content) return cached;
      const entry = { ...item, preview: parse(item.content, item.fileId, definitions, directives) }; this.entries.set(item.fileId, entry); return entry;
    });
  }
  clear(): void { this.entries.clear(); this.definitions = undefined; this.directives = undefined; }
}
