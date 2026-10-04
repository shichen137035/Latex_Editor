import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { BlockGraphSnapshot, BlockTextEdit, Project, ProjectTreeNode } from "@latex-editor/contracts";
import { settings } from "../settings/service.js";
import { FilterEngine } from "../filter/FilterEngine.js";
import { defaultFilterQuery, type FilterQuery } from "../filter/types.js";
import { parsePreview } from "../preview/parser.js";
import { previewBlocksForReconciliation } from "../preview/reconciliation.js";
import { SearchEngine, replaceRanges } from "../search/SearchEngine.js";
import { defaultSearchQuery, type SearchDocument, type SearchQuery, type SearchResult } from "../search/types.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import type { ProjectMathSource } from "../math/MathMacroRegistry.js";
import type { EditorTab } from "./fileActions.js";
import { projectFilePaths } from "./layout.js";

interface SearchControllerOptions {
  api: Window["latexEditor"];
  project: Project;
  tree: ProjectTreeNode[];
  tabs: EditorTab[];
  activePath: string | undefined;
  previewEnvironments: EnvironmentDefinition[];
  tabsRef: MutableRefObject<EditorTab[]>;
  savedContents: MutableRefObject<Map<string, string>>;
  changeDocument(path: string, content: string, typing?: boolean, edits?: BlockTextEdit[], record?: boolean, captureLargeDelete?: boolean): void;
  navigateTo(path: string, position?: { offset?: number | undefined }): Promise<void>;
  setBlockSnapshot: Dispatch<SetStateAction<BlockGraphSnapshot | undefined>>;
  setPreviewSemanticIds: Dispatch<SetStateAction<Record<string, string>>>;
  setProjectMathSources: Dispatch<SetStateAction<ProjectMathSource[]>>;
}

export function useSearchController(options: SearchControllerOptions) {
  const [searchQuery, setSearchQuery] = useState<SearchQuery>(defaultSearchQuery);
  const [replacement, setReplacement] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState<FilterQuery>(defaultFilterQuery);
  const [activeSearchResult, setActiveSearchResult] = useState<SearchResult>();
  const [projectSearchDocuments, setProjectSearchDocuments] = useState<SearchDocument[]>([]);
  const searchEngineRef = useRef(new SearchEngine());
  const filterEngineRef = useRef(new FilterEngine());

  const searchDocuments = useMemo(() => {
    const documents = new Map(projectSearchDocuments.map((document) => [document.fileId, document]));
    for (const tab of options.tabs) documents.set(tab.path, { fileId: tab.path, content: tab.content });
    return [...documents.values()];
  }, [projectSearchDocuments, options.tabs]);
  const filterDocuments = useMemo(() => searchDocuments
    .filter((item) => item.fileId.toLocaleLowerCase().endsWith(".tex"))
    .map((item) => ({ ...item, preview: parsePreview(item.content, item.fileId, options.previewEnvironments) })),
  [searchDocuments, options.previewEnvironments]);
  const reconciliationInput = useMemo(() => {
    const document = filterDocuments.find((item) => item.fileId === options.activePath);
    return document ? previewBlocksForReconciliation(document.preview, document.content) : undefined;
  }, [filterDocuments, options.activePath]);
  const filterEvaluations = useMemo(() => new Map(filterDocuments.map((item) => [item.fileId,
    filterEngineRef.current.evaluate(item.preview.nodes, item.content, item.fileId, filterQuery)])), [filterDocuments, filterQuery]);
  const searchedDocuments = useMemo(() => searchQuery.scope === "current-file"
    ? searchDocuments.filter((item) => item.fileId === options.activePath) : searchDocuments,
  [searchDocuments, searchQuery.scope, options.activePath]);
  const allowedSearchRanges = useMemo(() => {
    if (!filterQuery.enabled) return undefined;
    const ranges = new Map<string, Array<[number, number]>>();
    for (const document of searchedDocuments) ranges.set(document.fileId, filterEvaluations.get(document.fileId)?.ranges ?? []);
    return ranges;
  }, [filterQuery.enabled, filterEvaluations, searchedDocuments]);
  const searchResponse = useMemo(() => searchEngineRef.current.search(searchQuery, searchedDocuments, allowedSearchRanges),
    [searchQuery, searchedDocuments, allowedSearchRanges]);
  const filterOptions = useMemo(() => {
    const current = filterDocuments.find((item) => item.fileId === options.activePath) ?? filterDocuments[0];
    const result = filterEngineRef.current.options(current?.preview.nodes ?? [], searchDocuments.map((item) => item.fileId));
    for (const item of filterDocuments) {
      for (const type of filterEngineRef.current.options(item.preview.nodes, []).blockTypes) {
        if (!result.blockTypes.includes(type)) result.blockTypes.push(type);
      }
    }
    result.blockTypes.sort();
    return result;
  }, [filterDocuments, searchDocuments, options.activePath]);

  useEffect(() => {
    if (!options.api) return;
    let cancelled = false;
    const paths = projectFilePaths(options.tree).filter((path) => /\.(?:tex|sty|cls|bib|txt|md)$/i.test(path));
    void Promise.all(paths.map(async (path): Promise<SearchDocument | undefined> => {
      try { return { fileId: path, content: (await options.api!.files.read(options.project.id, path)).content }; }
      catch { return undefined; }
    })).then((documents) => {
      if (!cancelled) setProjectSearchDocuments(documents.filter((item): item is SearchDocument => !!item));
    });
    return () => { cancelled = true; };
  }, [options.api, options.project.id, options.tree]);

  useEffect(() => {
    if (!options.api || !reconciliationInput) return;
    const timer = window.setTimeout(() => {
      void options.api!.blockGraph.reconcileParsedBlocks(options.project.id, reconciliationInput).then((result) => {
        options.setBlockSnapshot(result.snapshot);
        options.setPreviewSemanticIds(result.transientToBlockId);
      }).catch((error: unknown) => console.warn("Unable to reconcile parsed blocks", error));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [options.api, options.project.id, reconciliationInput, options.setBlockSnapshot, options.setPreviewSemanticIds]);

  const selectSearchResult = async (result: SearchResult) => {
    setActiveSearchResult(result);
    await options.navigateTo(result.fileId, { offset: result.matchStart });
  };

  const updateSearchDocument = async (path: string, content: string) => {
    const open = options.tabs.some((tab) => tab.path === path);
    if (open) options.changeDocument(path, content);
    else if (options.api) {
      const file = await options.api.files.read(options.project.id, path);
      options.savedContents.current.set(path, file.content);
      options.tabsRef.current = [...options.tabsRef.current, { path, content: file.content, dirty: false }];
      options.changeDocument(path, content);
    }
    setProjectSearchDocuments((current) => current.map((document) => document.fileId === path ? { ...document, content } : document));
    if (/\.(?:tex|sty)$/i.test(path)) {
      options.setProjectMathSources((current) => current.map((source) => source.path === path ? { ...source, content } : source));
    }
  };

  const replaceCurrentSearchResult = async () => {
    const result = searchResponse.results.find((item) => item.id === activeSearchResult?.id);
    const document = result && searchDocuments.find((item) => item.fileId === result.fileId);
    if (!result || !document) return;
    await updateSearchDocument(document.fileId, replaceRanges(document.content, [result], replacement));
    setActiveSearchResult(undefined);
  };

  const replaceAllSearchResults = async () => {
    const grouped = new Map<string, SearchResult[]>();
    for (const result of searchResponse.results) grouped.set(result.fileId, [...(grouped.get(result.fileId) ?? []), result]);
    if (grouped.size && settings.get("history").beforeLargeDelete) {
      await options.api?.history.snapshot(options.project.id, "pre-delete", "Before replacing search results",
        options.tabsRef.current.filter((tab) => tab.dirty).map(({ path, content }) => ({ path, content })));
    }
    await Promise.all([...grouped].map(async ([path, results]) => {
      const document = searchDocuments.find((item) => item.fileId === path);
      if (document) await updateSearchDocument(path, replaceRanges(document.content, results, replacement));
    }));
    setActiveSearchResult(undefined);
  };

  return {
    searchQuery, setSearchQuery, replacement, setReplacement, replaceOpen, setReplaceOpen,
    filterQuery, setFilterQuery, activeSearchResult, setActiveSearchResult, projectSearchDocuments,
    searchDocuments, searchResponse, filterOptions,
    selectSearchResult, replaceCurrentSearchResult, replaceAllSearchResults
  };
}
