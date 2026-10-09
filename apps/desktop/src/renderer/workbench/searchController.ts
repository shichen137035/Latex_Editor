import { useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { includeNewBuiltInDirectives, type BlockTextEdit, type PreviewDirectiveDefinition, type Project, type ProjectTreeNode } from "@latex-editor/contracts";
import { settings } from "../settings/service.js";
import { t } from "../i18n/index.js";
import { FilterEngine, hasFilterConditions } from "../filter/FilterEngine.js";
import { defaultFilterQuery, type FilterQuery } from "../filter/types.js";
import { parsePreview } from "../preview/parser.js";
import { runSearchJob } from "../search/searchJob.js";
import { defaultSearchQuery, type SearchDocument, type SearchQuery, type SearchResponse, type SearchResult } from "../search/types.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import type { ProjectMathSource } from "../math/MathMacroRegistry.js";
import type { EditorTab } from "./fileActions.js";
import { projectFilePaths } from "./layout.js";
import { applySearchReplacements } from "./searchReplacement.js";
import { searchFileRanges, isSearchableProjectFile, isSearchableProjectPath, PreviewFilterCache } from "../search/searchDocuments.js";

interface SearchControllerOptions {
  api: Window["latexEditor"];
  project: Project;
  tree: ProjectTreeNode[];
  tabs: EditorTab[];
  activePath: string | undefined;
  previewEnvironments: EnvironmentDefinition[];
  previewDirectives: PreviewDirectiveDefinition[];
  tabsRef: MutableRefObject<EditorTab[]>;
  savedContents: MutableRefObject<Map<string, string>>;
  changeDocument(path: string, content: string, typing?: boolean, edits?: BlockTextEdit[], record?: boolean, captureLargeDelete?: boolean): void;
  navigateTo(path: string, position?: { offset?: number | undefined }): Promise<void>;
  prepareNavigation(): boolean;
  setProjectMathSources: Dispatch<SetStateAction<ProjectMathSource[]>>;
}

const emptyResponse: SearchResponse = { results: [] };
const filterEngine = new FilterEngine();

export function useSearchController(options: SearchControllerOptions) {
  const [searchQuery, setSearchQuery] = useState<SearchQuery>(defaultSearchQuery);
  const [replacement, setReplacement] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState<FilterQuery>(defaultFilterQuery);
  const [activeSearchResult, setActiveSearchResult] = useState<SearchResult>();
  const [projectSearchDocuments, setProjectSearchDocuments] = useState<SearchDocument[]>([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [unreadFiles, setUnreadFiles] = useState<string[]>([]);
  const [searchNotice, setSearchNotice] = useState("");
  const [replacing, setReplacing] = useState(false);
  const operation = useRef(false), navigationSequence = useRef(0);
  const lifecycle = useRef(new AbortController());
  const cache = useRef(new PreviewFilterCache());
  useEffect(() => {
    lifecycle.current = new AbortController();
    return () => { lifecycle.current.abort(); cache.current.clear(); };
  }, []);

  const searchDocuments = useMemo(() => {
    const documents = new Map(projectSearchDocuments.map(document => [document.fileId, document]));
    for (const tab of options.tabs) if (isSearchableProjectPath(tab.path)) documents.set(tab.path, { fileId: tab.path, content: tab.content });
    return [...documents.values()];
  }, [projectSearchDocuments, options.tabs]);
  const directives = useMemo(() => includeNewBuiltInDirectives(options.previewDirectives), [options.previewDirectives]);
  const filterDocuments = useMemo(() => cache.current.documents(searchDocuments, options.previewEnvironments, directives, parsePreview), [searchDocuments, options.previewEnvironments, directives]);
  const searchedDocuments = useMemo(() => searchQuery.scope === "current-file"
    ? searchDocuments.filter(item => item.fileId === options.activePath) : searchDocuments,
  [searchDocuments, searchQuery.scope, options.activePath]);
  const allowedSearchRanges = useMemo(() => searchFileRanges(searchedDocuments, filterDocuments, filterQuery), [searchedDocuments, filterDocuments, filterQuery]);
  const request = useMemo(() => ({ query: searchQuery, documents: searchedDocuments, ranges: allowedSearchRanges }), [searchQuery, searchedDocuments, allowedSearchRanges]);
  const latest = useRef(request); latest.current = request;
  const [completed, setCompleted] = useState<{ request: typeof request; response: SearchResponse }>();
  const searching = !!searchQuery.text && (completed?.request !== request || searchQuery.scope === "entire-project" && !documentsLoaded);
  const failures = useMemo(() => unreadFiles.filter(path => !options.tabs.some(tab => tab.path === path) && (searchQuery.scope === "entire-project" || path === options.activePath)), [unreadFiles, options.tabs, searchQuery.scope, options.activePath]);
  const filterOptions = useMemo(() => {
    const result = filterEngine.options([], searchDocuments.map(item => item.fileId));
    for (const item of filterDocuments) {
      const options = filterEngine.options(item.preview.nodes, [item.fileId]);
      result.locations.push(...options.locations);
      for (const type of options.blockTypes) if (!result.blockTypes.includes(type)) result.blockTypes.push(type);
    }
    result.blockTypes.sort(); return result;
  }, [filterDocuments, searchDocuments]);
  // A deleted/renamed selection must not silently broaden a replacement scope.
  const invalidFilters = documentsLoaded && filterQuery.enabled && (
    filterQuery.locations.some(id => !filterOptions.locations.some(item => item.id === id)) ||
    filterQuery.files.some(id => !filterOptions.files.includes(id)) ||
    filterQuery.blockTypes.some(id => !filterOptions.blockTypes.includes(id))
  );
  const searchResponse = useMemo<SearchResponse>(() => {
    if (searching || completed?.request !== request) return emptyResponse;
    const error = failures.length ? t("search.readFailed", { count: failures.length, files: failures.join(", ") }) : invalidFilters ? t("filter.unavailable") : undefined;
    return error ? { ...completed.response, incomplete: true, error: completed.response.error ?? error } : completed.response;
  }, [searching, completed, request, failures, invalidFilters]);

  useEffect(() => {
    const controller = new AbortController();
    if (!request.query.text) return;
    const timer = setTimeout(() => {
      void runSearchJob({ kind: "search", query: request.query, documents: request.documents, ...(request.ranges ? { ranges: [...request.ranges] } : {}) }, controller.signal)
        .then(result => {
          if (!controller.signal.aborted) setCompleted({ request, response: "error" in result ? { results: [], error: result.error } : result.kind === "search" ? result.value : emptyResponse });
        }).catch(error => {
          if (!controller.signal.aborted) setCompleted({ request, response: { results: [], error: error instanceof Error ? error.message : String(error) } });
        });
    }, 120);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [request]);
  useEffect(() => setSearchNotice(""), [searchQuery, filterQuery]);

  useEffect(() => {
    if (!options.api) return;
    let cancelled = false;
    setDocumentsLoaded(false);
    const paths = projectFilePaths(options.tree).filter(isSearchableProjectFile);
    const savedAtStart = new Map(options.savedContents.current);
    const failed: string[] = [];
    void Promise.all(paths.map(async (path): Promise<SearchDocument | undefined> => {
      try { return { fileId: path, content: (await options.api!.files.read(options.project.id, path)).content }; }
      catch { failed.push(path); return undefined; }
    })).then(documents => {
      if (!cancelled) {
        // A save may complete while initial disk reads are in flight.
        setProjectSearchDocuments(documents.filter((item): item is SearchDocument => !!item).map(item => ({ ...item, content: options.savedContents.current.get(item.fileId) !== savedAtStart.get(item.fileId) ? options.savedContents.current.get(item.fileId) ?? item.content : item.content })));
        setDocumentsLoaded(true);
        setUnreadFiles(failed);
      }
    });
    return () => { cancelled = true; };
  }, [options.api, options.project.id, options.tree, options.savedContents]);

  const updateSavedSearchDocument = (path: string, content: string) => {
    if (isSearchableProjectPath(path)) setProjectSearchDocuments(current => {
      const documents = new Map(current.map(item => [item.fileId, item])); documents.set(path, { fileId: path, content }); return [...documents.values()];
    });
  };
  const reportError = (error: unknown) => { if (!lifecycle.current.signal.aborted) setSearchNotice(error instanceof Error ? error.message : String(error)); };
  const selectSearchResult = async (result: SearchResult) => {
    const selectedRequest = request, sequence = ++navigationSequence.current;
    try {
      if (searching || !searchResponse.results.some(item => item.id === result.id) || !options.prepareNavigation()) return;
      const baseline = request.documents.find(item => item.fileId === result.fileId);
      const open = options.tabsRef.current.find(tab => tab.path === result.fileId);
      const content = open?.content ?? (await options.api?.files.read(options.project.id, result.fileId))?.content;
      if (lifecycle.current.signal.aborted || sequence !== navigationSequence.current) return;
      if (!baseline || baseline.content !== content || latest.current !== selectedRequest) {
        if (!open && content !== undefined) updateSavedSearchDocument(result.fileId, content);
        throw new Error("Search results changed. Search again before jumping.");
      }
      await options.navigateTo(result.fileId, { offset: result.matchStart });
      if (!lifecycle.current.signal.aborted && sequence === navigationSequence.current) setActiveSearchResult(result);
    } catch (error) { reportError(error); }
  };

  const replaceSearchResults = async (all: boolean) => {
    if (operation.current || searching || !options.project.writable || all && (searchResponse.truncated || searchResponse.incomplete)) return;
    const results = all ? searchResponse.results : searchResponse.results.filter(item => item.id === activeSearchResult?.id);
    if (!results.length) return;
    try { if (!options.prepareNavigation()) return; } catch (error) { reportError(error); return; }
    const selectedRequest = request, signal = lifecycle.current.signal;
    operation.current = true; setReplacing(true); setSearchNotice("");
    try {
      const files = new Set(results.map(item => item.fileId));
      const response = await runSearchJob({ kind: "replace", query: searchQuery, documents: request.documents.filter(item => files.has(item.fileId)), results, replacement }, signal);
      if ("error" in response) throw new Error(response.error);
      if (response.kind !== "replace") throw new Error("Invalid replacement response.");
      await applySearchReplacements({
        plans: response.value, tabs: () => options.tabsRef.current,
        read: async path => { if (!options.api) throw new Error("Project unavailable."); return (await options.api.files.read(options.project.id, path)).content; },
        isCurrent: () => !signal.aborted && latest.current === selectedRequest,
        beforeApply: async () => {
          const removed = response.value.reduce((sum, plan) => sum + Math.max(0, plan.before.length - plan.after.length), 0);
          if (removed >= 500 && settings.get("history").beforeLargeDelete) await options.api?.history.snapshot(options.project.id, "pre-delete", "Before replacing search results", options.tabsRef.current.filter(tab => tab.dirty).map(({ path, content }) => ({ path, content })));
        },
        open: tabs => {
          for (const tab of tabs) options.savedContents.current.set(tab.path, tab.content);
          options.tabsRef.current = [...options.tabsRef.current, ...tabs];
        },
        change: plan => {
          options.changeDocument(plan.fileId, plan.after, false, plan.edits, true, false);
          if (/\.(?:tex|sty)$/i.test(plan.fileId)) options.setProjectMathSources(current => current.map(source => source.path === plan.fileId ? { ...source, content: plan.after } : source));
        }
      });
      setActiveSearchResult(undefined);
    } catch (error) { if (!signal.aborted) reportError(error); }
    finally { operation.current = false; if (!signal.aborted) setReplacing(false); }
  };

  return {
    searchQuery, setSearchQuery, replacement, setReplacement, replaceOpen, setReplaceOpen,
    filterQuery, setFilterQuery, activeSearchResult: searchResponse.results.find(item => item.id === activeSearchResult?.id), setActiveSearchResult, projectSearchDocuments,
    searchDocuments, searchResponse, filterOptions, searching, replacing, searchNotice,
    searchReady: !searching && (!searchQuery.text || completed?.request === request),
    filterActive: hasFilterConditions(filterQuery), updateSavedSearchDocument,
    selectSearchResult, replaceCurrentSearchResult: () => replaceSearchResults(false), replaceAllSearchResults: () => replaceSearchResults(true)
  };
}
