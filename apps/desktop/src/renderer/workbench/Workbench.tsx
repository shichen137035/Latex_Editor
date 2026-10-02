import { DiffEditor, Editor, type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal, flushSync } from "react-dom";
import type { AIChangeSet, BlockGraphSnapshot, BlockId, BlockTextEdit, BlockTextRange, CompileResult, Diagnostic, Project, ProjectTreeNode, RelationDirection, RelationNeighborhood, SemanticBlock, SpellCheckStatus, StructuralHistoryState, SyncTexPdfPosition } from "@latex-editor/contracts";
import toolbarActions from "../resources/toolbar-actions.json" with { type: "json" };
import { t, type MessageKey } from "../i18n/index.js";
import { PreviewPane } from "../preview/PreviewPane.js";
import { SettingsDialog, type SettingsSection } from "../settings/SettingsDialog.js";
import { useSettings, settings } from "../settings/service.js";
import { bindings, commands, displayBinding } from "../settings/commands.js";
import { EnvironmentQuickAction, environmentCursorOffset, environmentInsertion } from "../preview/EnvironmentPicker.js";
import { addCommandLabel, addEnvironmentLabel, nextAutomaticLabel } from "../preview/labels.js";
import { useUnsavedChanges } from "../lifecycle/unsavedChanges.js";
import { EditHistory, applyTextPatch, patchFromEdits, textPatch, type HistoryDirection } from "./EditHistory.js";
import { isHunkApplied, reviewFileContents, transitionAIFile } from "../ai/changeOperations.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { CompletionController } from "../completion/CompletionController.js";
import { SpellCheckController, type SpellContextRequest } from "../spellcheck/SpellCheckController.js";
import { toolbarInsertion } from "./toolbarInsertion.js";
import { MathMacroRegistry, type ProjectMathSource } from "../math/MathMacroRegistry.js";
import { MathNodeIndex } from "../math/MathNodeLocator.js";
import { extractMathExpression } from "../math/MathRenderService.js";
import { MathPreviewPopover } from "../math/MathPreviewPopover.js";
import { AdvancedSearchPanel } from "../search/AdvancedSearchPanel.js";
import { SearchEngine, replaceRanges } from "../search/SearchEngine.js";
import { defaultSearchQuery, type SearchDocument, type SearchQuery, type SearchResult } from "../search/types.js";
import { FilterEngine } from "../filter/FilterEngine.js";
import { defaultFilterQuery, type FilterGroupId, type FilterQuery } from "../filter/types.js";
import { parsePreview } from "../preview/parser.js";
import { previewBlocksForReconciliation } from "../preview/reconciliation.js";
import { installEditorContextActions } from "./editorContextActions.js";
import { editorThemeName } from "../themes/runtime.js";
import { boundaryRepairCandidates, normalizeDocumentSelection, type BoundaryRepairCandidate, type DocumentSelection } from "../custom-blocks/selection.js";
import { installSymbolPairing } from "../editor/symbolPairing.js";
import { RelationBrowser } from "../relations/RelationBrowser.js";
import { RelationInspector } from "../relations/RelationInspector.js";
import { RelationGraphView } from "../relations/RelationGraphView.js";
import { candidateRelationState, projectRelationCandidates, relationEndpoints, type RelationFilters, type UnmatchedBehavior } from "../relations/model.js";
import { ImageQuickAction } from "../figure/ImageQuickAction.js";
import { ImageInsertDialog, type ImageInsertChoice } from "../figure/ImageInsertDialog.js";
import { FigureInspector, type FigureSelection } from "../figure/FigureInspector.js";
import { emptyFigureInsertion, emptyMultiImageInsertion, imageInsertion, multiImageInsertion, uniqueFigureLabels } from "../figure/insert.js";
import { patchFigureSource } from "../figure/patch.js";
import { TableInsertDialog, type TableInsertChoice } from "../table/TableInsertDialog.js";
import { TableInspector } from "../table/TableInspector.js";
import type { TableSelection } from "../table/model.js";
import { addLatexPackage, tableInsertion, uniqueTableLabel } from "../table/insert.js";
import { ReferenceLibraryPanel } from "../references/ReferenceLibraryPanel.js";
import { BibtexPreviewPane } from "../references/BibtexPreviewPane.js";
import { AIView } from "../ai/AIView.js";
import { ContextMenu, DiagnosticRow, EntryNameInput, Icon, Logo, Menu, Placeholder, SpellContextMenu, Tree, spellLanguageLabel, type FileContext } from "./WorkbenchComponents.js";

type SidebarMode = "files" | "search" | "library" | "ai" | "settings" | "help";
type PaneType = "source" | "preview" | "pdf";
type BottomTab = "problems" | "output" | "compileLog" | "versions";
type MenuName = "file" | "edit" | "view" | "history" | "projects";

interface EditorTab { path: string; content: string; dirty: boolean }
interface SourceMathPreview { source: string; displayMode: boolean; anchor: DOMRect; kind: "source-cursor" | "source-hover" }
interface PersistedLayout { sidebarWidth: number; fileTreeHeight: number; splitRatio: number; bottomPanelHeight: number; sidebarVisible: boolean; mode: "single" | "split"; singlePane: PaneType; leftPane: "source" | "preview"; rightPane: "preview" | "pdf" }

const emptyBlockSnapshot: BlockGraphSnapshot = { version: 2, blocks: [], dependencies: [], structuralParents: [] };
const defaultRelationFilters: RelationFilters = { hierarchyScope: "all", role: "all", origin: "all", label: "all", textQuery: "" };

const defaultLayout: PersistedLayout = { sidebarWidth: 280, fileTreeHeight: 330, splitRatio: 52, bottomPanelHeight: 220, sidebarVisible: true, mode: "split", singlePane: "source", leftPane: "source", rightPane: "pdf" };

function restoreLayout(): PersistedLayout {
  return { ...defaultLayout, ...settings.get("layout") };
}

function relativeAssetPath(filePath: string, assetPath: string): string {
  const from = filePath.replaceAll("\\", "/").split("/").slice(0, -1);
  const to = assetPath.replaceAll("\\", "/").split("/");
  while (from.length && to.length && from[0]?.toLocaleLowerCase() === to[0]?.toLocaleLowerCase()) { from.shift(); to.shift(); }
  return [...from.map(() => ".."), ...to].join("/");
}

function projectFilePaths(nodes: ProjectTreeNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "file" ? [node.relativePath] : node.children ? projectFilePaths(node.children) : []);
}

type FileDropDetail = { paths: string[]; destination: string };
type BlockContext = { x: number; y: number; selection: DocumentSelection };
type BlockCreationAvailability = { kind: "none" | "checking" | "valid" | "repair" | "invalid" } | { kind: "edit"; block: SemanticBlock };
type BoundaryRepairPrompt = { conflictName: string; candidates: BoundaryRepairCandidate[] };
type ImageDialogState = { kind: "insert" } | { kind: "replace"; selection: FigureSelection; imageIndex: number };


export function Workbench({ project, projects, environments, onHome, onSwitch, onOpenLibrary }: { project: Project; projects: Project[]; environments: EnvironmentDefinition[]; onHome(): void; onSwitch(project: Project): void; onOpenLibrary(): void }) {
  const store = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitial, setSettingsInitial] = useState<SettingsSection>("general");
  const api = window.latexEditor;
  const [layout, setLayout] = useState(restoreLayout);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [tree, setTree] = useState<ProjectTreeNode[]>([]);
  const [treeFilter, setTreeFilter] = useState("");
  const [outlineMode, setOutlineMode] = useState<"outline" | "relations">("outline");
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const tabsRef = useRef(tabs);
  const savedContents = useRef(new Map<string, string>());
  const editHistory = useRef(new EditHistory());
  const [, refreshHistoryUi] = useState(0);
  useEffect(() => editHistory.current.subscribe(() => refreshHistoryUi(value => value + 1)), []);
  const [aiReviewChanges, setAiReviewChanges] = useState<AIChangeSet[]>([]);
  const [aiDiffFile, setAiDiffFile] = useState<{ id: string; path: string }>();
  const [activePath, setActivePath] = useState<string>();
  useEffect(() => { editHistory.current.breakGroup(); }, [activePath, layout.mode, layout.singlePane, layout.leftPane]);
  const [saveState, setSaveState] = useState<"saved" | "unsaved" | "saving" | "failed">("saved");
  const [activeMenu, setActiveMenu] = useState<MenuName>();
  const [fileContext, setFileContext] = useState<FileContext>();
  const [blockContext, setBlockContext] = useState<BlockContext>();
  const [sourceSelection, setSourceSelection] = useState<DocumentSelection>();
  const [previewSelection, setPreviewSelection] = useState<DocumentSelection>();
  const [blockSnapshot, setBlockSnapshot] = useState<BlockGraphSnapshot>();
  const [previewSemanticIds, setPreviewSemanticIds] = useState<Record<string, BlockId>>({});
  const [relationFocusId, setRelationFocusId] = useState<BlockId | null>(null);
  const [relationFocusHistory, setRelationFocusHistory] = useState<BlockId[]>([]);
  const [relationDirection, setRelationDirection] = useState<RelationDirection>("both");
  const [relationDepth, setRelationDepth] = useState<number | "all">(2);
  const [relationFilters, setRelationFilters] = useState<RelationFilters>(defaultRelationFilters);
  const [relationUnmatched, setRelationUnmatched] = useState<UnmatchedBehavior>("dim");
  const [relationLocateRequest, setRelationLocateRequest] = useState<{ blockId: BlockId; nonce: number }>();
  const [relationChooser, setRelationChooser] = useState<{ candidateId: BlockId; x: number; y: number }>();
  const [relationGraphOpen, setRelationGraphOpen] = useState(false);
  const [relationGraphFocusId, setRelationGraphFocusId] = useState<BlockId | null>(null);
  const [relationNeighborhood, setRelationNeighborhood] = useState<RelationNeighborhood>();
  const [, setStructuralHistory] = useState<StructuralHistoryState>({ canUndo: false, canRedo: false });
  const structuralHistory = { canUndo: editHistory.current.canUndo, canRedo: editHistory.current.canRedo };
  const [blockCreationAvailability, setBlockCreationAvailability] = useState<BlockCreationAvailability>({ kind: "none" });
  const [boundaryRepair, setBoundaryRepair] = useState<BoundaryRepairPrompt>();
  const [inspectorBlock, setInspectorBlock] = useState<SemanticBlock>();
  const [figureSelection, setFigureSelection] = useState<FigureSelection>();
  const [imageDialog, setImageDialog] = useState<ImageDialogState>();
  const [tableDialogOpen, setTableDialogOpen] = useState(false);
  const [tableSelection, setTableSelection] = useState<TableSelection>();
  const [blockNotice, setBlockNotice] = useState<string>();
  const [createdBlockHighlight, setCreatedBlockHighlight] = useState<{ fileId: string; start: number; end: number; nonce: number }>();
  const [nameRequest, setNameRequest] = useState<{ message: string; fallback: string; resolve(value?: string): void }>();
  const [deleteRequest, setDeleteRequest] = useState<{ path: string; resolve(value: boolean): void }>();
  const [compileState, setCompileState] = useState<"idle" | "running">("idle");
  const [compileResult, setCompileResult] = useState<CompileResult>();
  const [pendingDiagnostic, setPendingDiagnostic] = useState<{ path: string; line: number; column?: number }>();
  const [pdfDataUrl, setPdfDataUrl] = useState<string>();
  const [pdfTarget, setPdfTarget] = useState<(SyncTexPdfPosition & { requestId: number })>();
  const [bottomVisible, setBottomVisible] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>("problems");
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [spellStatus, setSpellStatus] = useState<SpellCheckStatus>();
  const [detectedSpellLanguage, setDetectedSpellLanguage] = useState("en-US");
  const [spellContextMenu, setSpellContextMenu] = useState<SpellContextRequest>();
  const [spellMenuOpen, setSpellMenuOpen] = useState(false);
  const [projectMathSources, setProjectMathSources] = useState<ProjectMathSource[]>([]);
  const [projectSearchDocuments, setProjectSearchDocuments] = useState<SearchDocument[]>([]);
  const [sourceMathPreview, setSourceMathPreview] = useState<SourceMathPreview>();
  const [searchQuery, setSearchQuery] = useState<SearchQuery>(defaultSearchQuery);
  const [replacement, setReplacement] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [filterQuery, setFilterQuery] = useState<FilterQuery>(defaultFilterQuery);
  const [activeSearchResult, setActiveSearchResult] = useState<SearchResult>();
  const [pendingSearchResult, setPendingSearchResult] = useState<SearchResult>();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const aiFileNavigationRef = useRef<(path: string, line?: number) => void>(() => undefined);
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const completionController = useRef<CompletionController | null>(null);
  const spellCheckController = useRef<SpellCheckController | null>(null);
  const referenceMouseListener = useRef<{ dispose(): void } | null>(null);
  const symbolPairingListener = useRef<{ dispose(): void } | null>(null);
  const treeRef = useRef<ProjectTreeNode[]>([]);
  const activePathRef = useRef<string | undefined>(undefined);
  const environmentsRef = useRef<EnvironmentDefinition[]>([]);
  const mathRegistryRef = useRef(new MathMacroRegistry());
  const searchEngineRef = useRef(new SearchEngine());
  const filterEngineRef = useRef(new FilterEngine());
  const searchDecorationsRef = useRef<ReturnType<Parameters<OnMount>[0]["createDecorationsCollection"]> | null>(null);
  const resizeCleanup = useRef<(() => void) | undefined>(undefined);
  const lastTextPane = useRef<"source" | "preview">("source");
  const activeContentRef = useRef("");
  const pendingRangeTransactions = useRef(new Map<string, BlockTextEdit[][]>());
  const aiOperationQueue = useRef<Promise<void>>(Promise.resolve());
  const aiAutoAttempts = useRef(new Set<string>());
  const rangeMappingTimers = useRef(new Map<string, number>());
  const previewViewportAnchor = useRef<{ fileId: string; offset: number } | undefined>(undefined);
  const previewClickAnchor = useRef<{ fileId: string; offset: number } | undefined>(undefined);
  const previewInsertionAnchor = useRef<{ fileId: string; offset: number } | undefined>(undefined);
  const pendingVisualToCodeAnchor = useRef<{ fileId: string; offset: number } | undefined>(undefined);
  useEffect(() => () => resizeCleanup.current?.(), []);

  const activeTab = tabs.find((tab) => tab.path === activePath);
  useEffect(() => { previewClickAnchor.current = undefined; }, [activePath, activeTab?.content]);
  const aiReviewFile = useMemo(() => aiDiffFile ? aiReviewChanges.find(changes => changes.id === aiDiffFile.id)?.files.find(file => file.path === aiDiffFile.path && file.hunks.some(hunk => hunk.decision === "pending")) : undefined, [aiReviewChanges, aiDiffFile]);
  const aiReviewContent = useMemo(() => aiReviewFile ? reviewFileContents(aiReviewFile) : undefined, [aiReviewFile]);
  const pdfFile = project.mainFile?.replace(/\.tex$/i, ".pdf");
  const sourceEditorVisible = layout.mode === "single" ? layout.singlePane === "source" : layout.leftPane === "source";
  const visualEditorVisible = layout.mode === "single" ? layout.singlePane === "preview" : layout.leftPane === "preview";
  const creationSelection = sourceEditorVisible ? sourceSelection : previewSelection;
  const relationModeActive = outlineMode === "relations";
  const relationProjection = useMemo(() => projectRelationCandidates(blockSnapshot ?? emptyBlockSnapshot, relationFocusId, relationFilters), [blockSnapshot, relationFocusId, relationFilters]);
  const chooserPrerequisiteState = relationChooser && blockSnapshot
    ? candidateRelationState(blockSnapshot, relationFocusId, relationChooser.candidateId, "prerequisite")
    : undefined;
  const diagnostics = compileResult?.diagnostics ?? [];
  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  const configuredEnvironments = store.get("environments") as EnvironmentDefinition[];
  const previewEnvironments = configuredEnvironments.length ? configuredEnvironments : environments;
  const mathContext = useMemo(() => {
    const sources = new Map(projectMathSources.map((source) => [source.path.replaceAll("\\", "/").toLocaleLowerCase(), source]));
    for (const tab of tabs) if (/\.(?:tex|sty)$/i.test(tab.path)) sources.set(tab.path.replaceAll("\\", "/").toLocaleLowerCase(), { path: tab.path, content: tab.content });
    return mathRegistryRef.current.rebuild([...sources.values()], project.mainFile ?? activePath);
  }, [projectMathSources, tabs, project.mainFile, activePath]);
  const searchDocuments = useMemo(() => {
    const documents = new Map(projectSearchDocuments.map((document) => [document.fileId, document]));
    for (const tab of tabs) documents.set(tab.path, { fileId: tab.path, content: tab.content });
    return [...documents.values()];
  }, [projectSearchDocuments, tabs]);
  const filterDocuments = useMemo(() => searchDocuments.filter((item) => item.fileId.toLocaleLowerCase().endsWith(".tex")).map((item) => ({ ...item, preview: parsePreview(item.content, item.fileId, previewEnvironments) })), [searchDocuments, previewEnvironments]);
  const reconciliationInput = useMemo(() => {
    const document = filterDocuments.find((item) => item.fileId === activePath);
    return document ? previewBlocksForReconciliation(document.preview, document.content) : undefined;
  }, [filterDocuments, activePath]);
  const filterEvaluations = useMemo(() => new Map(filterDocuments.map((item) => [item.fileId, filterEngineRef.current.evaluate(item.preview.nodes, item.content, item.fileId, filterQuery)])), [filterDocuments, filterQuery]);
  const searchedDocuments = useMemo(() => searchQuery.scope === "current-file" ? searchDocuments.filter((item) => item.fileId === activePath) : searchDocuments, [searchDocuments, searchQuery.scope, activePath]);
  const allowedSearchRanges = useMemo(() => {
    if (!filterQuery.enabled) return undefined;
    const ranges = new Map<string, Array<[number, number]>>();
    for (const document of searchedDocuments) ranges.set(document.fileId, filterEvaluations.get(document.fileId)?.ranges ?? []);
    return ranges;
  }, [filterQuery.enabled, filterEvaluations, searchedDocuments]);
  const searchResponse = useMemo(() => searchEngineRef.current.search(searchQuery, searchedDocuments, allowedSearchRanges), [searchQuery, searchedDocuments, allowedSearchRanges]);
  const filterOptions = useMemo(() => {
    const current = filterDocuments.find((item) => item.fileId === activePath) ?? filterDocuments[0];
    const options = filterEngineRef.current.options(current?.preview.nodes ?? [], searchDocuments.map((item) => item.fileId));
    for (const item of filterDocuments) for (const type of filterEngineRef.current.options(item.preview.nodes, []).blockTypes) if (!options.blockTypes.includes(type)) options.blockTypes.push(type);
    options.blockTypes.sort();
    return options;
  }, [filterDocuments, searchDocuments, activePath]);
  const spellMode = store.get("spellCheckMode");
  const spellManualLanguage = store.get("spellCheckLanguage");
  treeRef.current = tree;
  activePathRef.current = activePath;
  tabsRef.current = tabs;
  activeContentRef.current = activeTab?.content ?? "";
  environmentsRef.current = previewEnvironments;

  useEffect(() => {
    setSourceMathPreview(undefined);
  }, [sourceEditorVisible, activePath]);
  useEffect(() => {
    setSourceSelection(undefined);
    setPreviewSelection(undefined);
    setPreviewSemanticIds({});
    setBlockCreationAvailability({ kind: "none" });
    setBoundaryRepair(undefined);
    setBlockContext(undefined);
  }, [activePath]);
  useEffect(() => {
    if (!api || !activeTab || !creationSelection || creationSelection.fileId !== activeTab.path) {
      setBlockCreationAvailability({ kind: "none" });
      return;
    }
    const selection = normalizeDocumentSelection(activeTab.content, creationSelection);
    if (!selection) { setBlockCreationAvailability({ kind: "none" }); return; }
    const existing = blockSnapshot?.blocks.find((block) => block.origin === "user" && block.fileId === selection.fileId
      && block.range?.start === selection.start && block.range.end === selection.end);
    if (existing) { setBlockCreationAvailability({ kind: "edit", block: existing }); return; }
    setBlockCreationAvailability({ kind: "checking" });
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.blockGraph.validateUserBlock(project.id, { fileId: selection.fileId, range: { start: selection.start, end: selection.end }, role: "custom" })
        .then((validation) => {
          if (cancelled) return;
          setBlockCreationAvailability({ kind: validation.status === "valid" ? "valid" : validation.reason === "partial-overlap" ? "repair" : "invalid" });
        }).catch(() => { if (!cancelled) setBlockCreationAvailability({ kind: "invalid" }); });
    }, 100);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [api, project.id, activeTab, creationSelection, blockSnapshot]);
  useEffect(() => {
    const pane = layout.mode === "single" ? layout.singlePane : layout.leftPane;
    if (pane === "source" || pane === "preview") lastTextPane.current = pane;
  }, [layout.mode, layout.singlePane, layout.leftPane]);

  useEffect(() => {
    const timer = setTimeout(() => { void settings.set("layout", { ...layout }, "project"); }, 300);
    return () => clearTimeout(timer);
  }, [layout]);
  useEffect(() => {
    if (!api) return;
    void api.spellcheck.status().then((status) => { if (status) setSpellStatus(status); });
  }, [api]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void Promise.all([api.blockGraph.snapshot(project.id), api.blockGraph.historyState(project.id)]).then(([snapshot, history]) => {
      if (cancelled) return;
      setBlockSnapshot(snapshot);
      setStructuralHistory(history);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [api, project.id]);
  useEffect(() => {
    if (!api || !reconciliationInput) return;
    const timer = setTimeout(() => {
      void api.blockGraph.reconcileParsedBlocks(project.id, reconciliationInput).then((result) => {
        setBlockSnapshot(result.snapshot);
        setPreviewSemanticIds(result.transientToBlockId);
      }).catch((error: unknown) => {
        console.warn("Unable to reconcile parsed blocks", error);
      });
    }, 450);
    return () => clearTimeout(timer);
  }, [api, project.id, reconciliationInput]);
  useEffect(() => {
    if (!api || !relationGraphOpen) return;
    let cancelled = false;
    void api.blockGraph.getRelationNeighborhood(project.id, relationGraphFocusId, relationGraphFocusId ? relationDirection : "both", relationGraphFocusId ? relationDepth : "all").then((neighborhood) => {
      if (!cancelled) setRelationNeighborhood(neighborhood);
    }).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)));
    return () => { cancelled = true; };
  }, [api, project.id, relationGraphOpen, relationGraphFocusId, relationDirection, relationDepth, blockSnapshot]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const paths = projectFilePaths(tree).filter((path) => /\.(?:tex|sty)$/i.test(path));
    void Promise.all(paths.map(async (path): Promise<ProjectMathSource | undefined> => {
      try { return { path, content: (await api.files.read(project.id, path)).content }; } catch { return undefined; }
    })).then((sources) => { if (!cancelled) setProjectMathSources(sources.filter((source): source is ProjectMathSource => !!source)); });
    return () => { cancelled = true; };
  }, [api, project.id, tree]);
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const paths = projectFilePaths(tree).filter((path) => /\.(?:tex|sty|cls|bib|txt|md)$/i.test(path));
    void Promise.all(paths.map(async (path): Promise<SearchDocument | undefined> => {
      try { return { fileId: path, content: (await api.files.read(project.id, path)).content }; } catch { return undefined; }
    })).then((documents) => { if (!cancelled) setProjectSearchDocuments(documents.filter((item): item is SearchDocument => !!item)); });
    return () => { cancelled = true; };
  }, [api, project.id, tree]);
  useEffect(() => {
    spellCheckController.current?.refresh();
  }, [spellMode, spellManualLanguage]);
  useEffect(() => {
    if (!activeMenu) return;
    const closeWhenOutside = (event: MouseEvent) => { if (!workbenchRef.current?.contains(event.target as Node)) setActiveMenu(undefined); };
    document.addEventListener("mousedown", closeWhenOutside);
    return () => document.removeEventListener("mousedown", closeWhenOutside);
  }, [activeMenu]);
  useEffect(() => {
    if (!spellMenuOpen) return;
    const closeWhenOutside = (event: MouseEvent) => { if (!(event.target as Element).closest(".spell-status-control")) setSpellMenuOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSpellMenuOpen(false); };
    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeWhenOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [spellMenuOpen]);
  useEffect(() => {
    if (!fileContext) return;
    // A menu mousedown precedes its click. Only dismiss for events outside it.
    const closeWhenOutside = (event: MouseEvent) => { if (!(event.target as Element).closest(".context-menu")) setFileContext(undefined); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setFileContext(undefined); };
    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeWhenOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [fileContext]);
  useEffect(() => {
    if (!blockContext) return;
    const closeWhenOutside = (event: MouseEvent) => { if (!(event.target as Element).closest(".context-menu")) setBlockContext(undefined); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setBlockContext(undefined); };
    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeWhenOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [blockContext]);
  useEffect(() => {
    if (!blockNotice) return;
    const timer = window.setTimeout(() => setBlockNotice(undefined), 2200);
    return () => window.clearTimeout(timer);
  }, [blockNotice]);
  useEffect(() => {
    if (!spellContextMenu) return;
    const closeWhenOutside = (event: MouseEvent) => { if (!(event.target as Element).closest(".spell-context-menu")) setSpellContextMenu(undefined); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSpellContextMenu(undefined); };
    document.addEventListener("mousedown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("mousedown", closeWhenOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [spellContextMenu]);
  useEffect(() => {
    const handleFileContext = (event: Event) => {
      const detail = (event as CustomEvent<FileContext>).detail;
      setFileContext(detail);
      setActiveMenu(undefined);
    };
    window.addEventListener("texweave:file-context", handleFileContext);
    return () => window.removeEventListener("texweave:file-context", handleFileContext);
  }, []);
  useEffect(() => {
    const handleFileDrop = (event: Event) => {
      const detail = (event as CustomEvent<FileDropDetail>).detail;
      if (!api || detail.paths.length === 0) return;
      const destination = detail.destination;
      void Promise.all(detail.paths.map(async (sourcePath) => {
        const name = sourcePath.split(/[\\/]/).at(-1);
        if (name) await api.files.import(project.id, sourcePath, pathJoin(destination, name));
      })).then(() => refreshTree()).catch((error: unknown) => window.alert(error instanceof Error ? error.message : String(error)));
    };
    window.addEventListener("texweave:file-drop", handleFileDrop);
    return () => window.removeEventListener("texweave:file-drop", handleFileDrop);
  }, [api, project.id, tree]);
  const refreshTree = async () => { if (api) setTree(await api.files.tree(project.id)); };
  const pathParent = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const pathJoin = (parent: string, name: string) => parent ? `${parent}/${name}` : name;
  const promptEntryName = (message: string, fallback: string) => {
    return new Promise<string | undefined>((resolve) => setNameRequest({ message, fallback, resolve }));
  };
  const createEntry = async (directory: boolean, forcedParent?: string) => {
    if (!api) return;
    const parent = forcedParent ?? (fileContext?.path && fileContext.kind === "directory" ? fileContext.path : "");
    const name = await promptEntryName(directory ? t("files.newFolderPrompt") : t("files.newFilePrompt"), directory ? t("files.newFolderDefault") : t("files.newFileDefault"));
    if (!name) return;
    try {
      if (directory) await api.files.createDirectory(project.id, pathJoin(parent, name));
      else await api.files.createFile(project.id, pathJoin(parent, name));
      await refreshTree();
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };
  const renameEntry = async () => {
    if (!api || !fileContext?.path) return;
    const currentPath = fileContext.path;
    const oldName = currentPath.split("/").at(-1) ?? currentPath;
    const newName = await promptEntryName(t("files.renamePrompt"), oldName);
    if (!newName || newName === oldName) return;
    try {
      const nextPath = pathJoin(pathParent(currentPath), newName);
      await api.files.rename(project.id, currentPath, nextPath);
      const movedPath = (path: string) => path === currentPath || path.startsWith(currentPath + "/") ? nextPath + path.slice(currentPath.length) : path;
      editHistory.current.renameFile(currentPath, nextPath);
      savedContents.current = new Map([...savedContents.current].map(([path, content]) => [movedPath(path), content]));
      setTabs((current) => current.map((tab) => ({ ...tab, path: movedPath(tab.path) })));
      setActivePath((value) => value ? movedPath(value) : value);
      if (project.mainFile && movedPath(project.mainFile) !== project.mainFile && movedPath(project.mainFile).toLowerCase().endsWith(".tex")) {
        onSwitch(await api.projects.setMainFile(project.id, movedPath(project.mainFile)));
      }
      await refreshTree();
    }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };
  const copyEntry = async () => {
    if (!api || !fileContext?.path || fileContext.kind !== "file") return;
    const oldName = fileContext.path.split("/").at(-1) ?? fileContext.path;
    const dot = oldName.lastIndexOf(".");
    const fallback = dot > 0 ? `${oldName.slice(0, dot)} copy${oldName.slice(dot)}` : `${oldName} copy`;
    const newName = await promptEntryName(t("files.copyPrompt"), fallback);
    if (!newName) return;
    try { await api.files.copy(project.id, fileContext.path, pathJoin(pathParent(fileContext.path), newName)); await refreshTree(); }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };
  const removeEntry = async () => {
    if (!api || !fileContext?.path) return;
    const confirmed = await new Promise<boolean>((resolve) => setDeleteRequest({ path: fileContext.path!, resolve }));
    if (!confirmed) return;
    const removedPath = fileContext.path;
    try { await api.files.remove(project.id, removedPath); editHistory.current.forgetFile(removedPath); setTabs((current) => current.filter((tab) => tab.path !== removedPath && !tab.path.startsWith(`${removedPath}/`))); if (activePath === removedPath || activePath?.startsWith(`${removedPath}/`)) setActivePath(undefined); await refreshTree(); }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };
  const setAsMainFile = async () => {
    if (!api || !fileContext?.path || fileContext.kind !== "file" || !fileContext.path.toLocaleLowerCase().endsWith(".tex")) return;
    try { const updated = await api.projects.setMainFile(project.id, fileContext.path); onSwitch(updated); }
    catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };
  const fileContextItems = () => {
    const hasEntry = Boolean(fileContext?.path);
    const isFile = fileContext?.kind === "file";
    const isTex = isFile && fileContext?.path?.toLocaleLowerCase().endsWith(".tex");
    if (!hasEntry) return [
      { label: t("files.newFile"), action: () => void createEntry(false) },
      { label: t("files.newFolder"), action: () => void createEntry(true) }
    ];
    if (!isFile) return [
      { label: t("files.rename"), action: () => void renameEntry() },
      { label: t("files.newFile"), action: () => void createEntry(false) },
      { label: t("files.newFolder"), action: () => void createEntry(true) },
      { label: t("files.delete"), action: () => void removeEntry() }
    ];
    return [
      { label: t("files.setMainFile"), disabled: !isTex, action: () => void setAsMainFile() },
      { label: t("files.delete"), action: () => void removeEntry() },
      { label: t("files.rename"), action: () => void renameEntry() },
      { label: t("files.copy"), action: () => void copyEntry() }
    ];
  };
  useEffect(() => { void refreshTree(); }, [project.id]);
  useEffect(() => { setFigureSelection(undefined); }, [project.id, activePath]);
  useEffect(() => { setTableSelection(undefined); }, [project.id, activePath]);
  useEffect(() => { if (!visualEditorVisible) setFigureSelection(undefined); }, [visualEditorVisible]);
  useEffect(() => { if (!visualEditorVisible) setTableSelection(undefined); }, [visualEditorVisible]);
  useEffect(() => {
    if (!figureSelection) return;
    const closeOutsideImageEditor = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest(".figure-inspector")) return;
      const block = target.closest<HTMLElement>(".preview-block[data-source-start-offset]");
      if (block && Number(block.dataset.sourceStartOffset) === figureSelection.start) return;
      setFigureSelection(undefined);
    };
    document.addEventListener("pointerdown", closeOutsideImageEditor, true);
    return () => document.removeEventListener("pointerdown", closeOutsideImageEditor, true);
  }, [figureSelection]);
  useEffect(() => {
    if (!tableSelection) return;
    const closeOutsideTableEditor = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest(".table-inspector") || target.closest(".structured-table")) return;
      setTableSelection(undefined);
    };
    document.addEventListener("pointerdown", closeOutsideTableEditor, true);
    return () => document.removeEventListener("pointerdown", closeOutsideTableEditor, true);
  }, [tableSelection]);
  useEffect(() => () => { completionController.current?.dispose(); spellCheckController.current?.dispose(); symbolPairingListener.current?.dispose(); }, [project.id]);
  useEffect(() => {
    setPdfDataUrl(undefined);
    if (!api || !project.mainFile) return;
    const extensionIndex = project.mainFile.toLocaleLowerCase().lastIndexOf(".tex");
    if (extensionIndex < 0) return;
    const pdfPath = `${project.mainFile.slice(0, extensionIndex)}.pdf`;
    void api.files.readPdf(project.id, pdfPath).then((dataUrl) => {
      if (dataUrl) setPdfDataUrl(dataUrl);
    }).catch(() => undefined);
  }, [project.id, project.mainFile]);
  useEffect(() => { if (project.mainFile) void openFile(project.mainFile); }, [project.id]);


  const openFile = async (path: string) => {
    setAiDiffFile(undefined);
    const existing = tabs.find((tab) => tab.path === path);
    if (existing) { setActivePath(path); return; }
    if (!api) return;
    try { const file = await api.files.read(project.id, path); savedContents.current.set(path, file.content); setTabs((current) => [...current, { path, content: file.content, dirty: false }]); setActivePath(path); setSaveState("saved"); }
    catch { /* Binary and unsupported files stay unopened until dedicated viewers exist. */ }
  };

  const forwardSyncToPdf = async (path: string, line: number, column = 1) => {
    if (!api || !pdfFile || !path.toLocaleLowerCase().endsWith(".tex")) return;
    try {
      const target = await api.synctex.forward(project.id, path, pdfFile, line, column);
      setPdfTarget({ ...target, requestId: Date.now() });
      setLayout((value) => value.mode === "split" ? { ...value, rightPane: "pdf" } : { ...value, singlePane: "pdf" });
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const reverseSyncFromPdf = async (page: number, x: number, y: number) => {
    if (!api || !pdfFile) return;
    try {
      const target = await api.synctex.reverse(project.id, pdfFile, page, x, y);
      const pane = lastTextPane.current;
      setLayout((value) => value.mode === "split" ? { ...value, leftPane: pane } : { ...value, singlePane: pane });
      setPendingDiagnostic({ path: target.file, line: target.line, column: target.column });
      if (target.file !== activePath) await openFile(target.file);
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };

  const saveTabs = async (all: boolean, flush: (update: () => void) => void = update => update()) => {
    if (!api) return;
    const pending = tabs.filter((tab) => tab.dirty && (all || tab.path === activePath));
    if (!pending.length) return;
    editHistory.current.breakGroup();
    setSaveState("saving");
    try {
      for (const tab of pending) {
        await api.files.write(project.id, tab.path, tab.content);
        savedContents.current.set(tab.path, tab.content);
        flush(() => setTabs((current) => current.map((value) => value.path === tab.path && value.content === tab.content ? { ...value, dirty: false } : value)));
      }
      completionController.current?.invalidate();
      setSaveState("saved");
    } catch { setSaveState("failed"); throw new Error(t("save.failed")); }
  };
  const saveActive = () => saveTabs(false);
  useUnsavedChanges({ hasChanges: () => tabs.some((tab) => tab.dirty), save: () => saveTabs(true, flushSync) });
  const highlightCreatedBlock = (block: SemanticBlock) => {
    if (!block.fileId || !block.range) return;
    setCreatedBlockHighlight({ fileId: block.fileId, ...block.range, nonce: Date.now() });
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor && model && block.fileId === activePath) {
      const start = model.getPositionAt(block.range.start);
      const end = model.getPositionAt(block.range.end);
      const decorations = editor.createDecorationsCollection([{
        range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column },
        options: { inlineClassName: "texweave-created-block-highlight" }
      }]);
      window.setTimeout(() => decorations.clear(), 900);
    }
  };
  const createUserBlockAtRange = async (range: BlockTextRange) => {
    if (!api || !activeTab) return;
    await flushRangeMappings();
    const block = await api.blockGraph.createUserBlock(project.id, { fileId: activeTab.path, range, role: "custom" });
    editHistory.current.recordStructure();
    setInspectorBlock(block);
    setBoundaryRepair(undefined);
    setBlockContext(undefined);
    const normalizedSelection: DocumentSelection = { fileId: activeTab.path, ...range, origin: sourceEditorVisible ? "source" : "preview" };
    if (sourceEditorVisible) setSourceSelection(normalizedSelection); else setPreviewSelection(normalizedSelection);
    highlightCreatedBlock(block);
    const [snapshot, history] = await Promise.all([api.blockGraph.snapshot(project.id), api.blockGraph.historyState(project.id)]);
    setBlockSnapshot(snapshot);
    setStructuralHistory(history);
  };
  const createUserBlockFromSelection = async (override?: DocumentSelection) => {
    if (!api || !activeTab) return;
    const selection = normalizeDocumentSelection(activeTab.content, override ?? creationSelection ?? { fileId: activeTab.path, start: 0, end: 0, origin: "source" });
    if (!selection || selection.fileId !== activeTab.path) { setBlockNotice(t("block.selectRange")); return; }
    const existing = blockSnapshot?.blocks.find((block) => block.origin === "user" && block.fileId === selection.fileId
      && block.range?.start === selection.start && block.range.end === selection.end);
    if (existing) { setInspectorBlock(existing); return; }
    const input = { fileId: selection.fileId, range: { start: selection.start, end: selection.end }, role: "custom" };
    const validation = await api.blockGraph.validateUserBlock(project.id, input);
    if (validation.status === "valid") { await createUserBlockAtRange(input.range); return; }
    if (validation.reason !== "partial-overlap") { setBlockNotice(t(validation.reason === "duplicate-range" ? "block.duplicateRange" : "block.invalidRange")); return; }
    const snapshot = blockSnapshot ?? await api.blockGraph.snapshot(project.id);
    setBlockSnapshot(snapshot);
    const candidates = boundaryRepairCandidates(input.range, snapshot.blocks, selection.fileId);
    const checked = await Promise.all(candidates.map(async (candidate) => ({ candidate, validation: await api.blockGraph.validateUserBlock(project.id, { ...input, range: candidate.range }) })));
    const validCandidates = checked.filter((item) => item.validation.status === "valid").map((item) => item.candidate);
    if (!validCandidates.length) { setBlockNotice(t("block.noRepair")); return; }
    const conflict = snapshot.blocks.find((block) => block.id === validation.conflictingBlockId);
    setBoundaryRepair({ conflictName: conflict?.name ?? conflict?.title ?? conflict?.label ?? conflict?.role ?? conflict?.type ?? t("block.existingBlock"), candidates: validCandidates });
  };
  const updateInspectorBlock = async (patch: Partial<Omit<SemanticBlock, "id">>) => {
    if (!api || !inspectorBlock) return;
    await flushRangeMappings();
    const original = blockSnapshot?.blocks.find(block => block.id === inspectorBlock.id);
    const changed = !original || Object.entries(patch).some(([key, value]) => JSON.stringify(original[key as keyof SemanticBlock]) !== JSON.stringify(value));
    const updated = await api.blockGraph.updateBlock(project.id, inspectorBlock.id, patch);
    if (changed) editHistory.current.recordStructure();
    setInspectorBlock(updated);
    setBlockSnapshot((snapshot) => snapshot ? { ...snapshot, blocks: snapshot.blocks.map((block) => block.id === updated.id ? updated : block) } : snapshot);
  };
  const trackPreviewViewport = useCallback((anchor: { fileId: string; offset: number }) => {
    previewViewportAnchor.current = anchor;
  }, []);
  const trackPreviewClick = useCallback((anchor: { fileId: string; offset: number }) => {
    previewClickAnchor.current = anchor;
  }, []);
  const trackPreviewInsertion = useCallback((anchor?: { fileId: string; offset: number }) => {
    previewInsertionAnchor.current = anchor;
  }, []);
  const previewToCodeAnchor = () => {
    const clicked = previewClickAnchor.current;
    if (clicked?.fileId === activePath) return clicked;
    const viewport = previewViewportAnchor.current;
    return viewport?.fileId === activePath ? viewport : undefined;
  };
  const refreshRelationState = async () => {
    if (!api) return;
    const [snapshot, history] = await Promise.all([api.blockGraph.snapshot(project.id), api.blockGraph.historyState(project.id)]);
    setBlockSnapshot(snapshot);
    setStructuralHistory(history);
  };
  const removeRelation = async (from: BlockId, to: BlockId) => {
    if (!api) return;
    await flushRangeMappings();
    await api.blockGraph.removeDependency(project.id, from, to);
    editHistory.current.recordStructure();
    await refreshRelationState();
  };
  const focusRelationBlock = (blockId: BlockId) => {
    if (blockId === relationFocusId) return;
    if (relationFocusId) setRelationFocusHistory((history) => [...history, relationFocusId]);
    setRelationFocusId(blockId);
    setInspectorBlock(undefined);
  };
  const relationBack = () => setRelationFocusHistory((history) => {
    const previous = history.at(-1);
    if (previous) setRelationFocusId(previous);
    return previous ? history.slice(0, -1) : history;
  });
  const locateRelationBlock = async (blockId: BlockId) => {
    const block = blockSnapshot?.blocks.find((item) => item.id === blockId);
    const path = block?.fileId ?? block?.source?.relativePath;
    if (!block || !path) return;
    const text = tabs.find((tab) => tab.path === path)?.content ?? projectSearchDocuments.find((document) => document.fileId === path)?.content;
    const offset = block.range?.start;
    const prefix = text !== undefined && offset !== undefined ? text.slice(0, offset) : undefined;
    const line = block.source?.startLine ?? (prefix === undefined ? undefined : prefix.split("\n").length);
    const column = block.source?.startColumn ?? (prefix === undefined ? undefined : (prefix.length - (prefix.lastIndexOf("\n") + 1)) + 1);
    const pane = layout.mode === "single" ? (layout.singlePane === "pdf" ? lastTextPane.current : layout.singlePane) : layout.leftPane;
    if (layout.mode === "single" && layout.singlePane === "pdf") setLayout((value) => ({ ...value, singlePane: pane }));
    if (path !== activePath) {
      await openFile(path);
      if (pane === "preview") setRelationLocateRequest({ blockId, nonce: Date.now() });
      else if (line !== undefined) setPendingDiagnostic({ path, line, ...(column !== undefined ? { column } : {}) });
      return;
    }
    if (pane === "preview") setRelationLocateRequest({ blockId, nonce: Date.now() });
    else if (line !== undefined) navigateToLocation(line, column ?? 1);
  };
  const mutateRelation = async (candidateId: BlockId, requestedDirection?: Exclude<RelationDirection, "both">) => {
    if (!api || !blockSnapshot || !relationFocusId) return;
    await flushRangeMappings();
    const state = candidateRelationState(blockSnapshot, relationFocusId, candidateId, relationDirection);
    if (state.existing) {
      await api.blockGraph.removeDependency(project.id, state.existing.from, state.existing.to);
      editHistory.current.recordStructure();
      await refreshRelationState();
      return;
    }
    const direction = requestedDirection ?? (relationDirection === "both" ? undefined : relationDirection);
    if (!direction) return;
    const edge = relationEndpoints(relationFocusId, candidateId, direction);
    const validation = await api.blockGraph.validateDependency(project.id, edge.from, edge.to);
    if (validation.status === "invalid") { setBlockNotice(validation.message); return; }
    if (validation.status === "warning" && !window.confirm(`${validation.message}\n\n${t("relation.cycleConfirm")}`)) return;
    const result = await api.blockGraph.addDependency(project.id, edge.from, edge.to);
    if (result.outcome === "created") editHistory.current.recordStructure();
    setRelationChooser(undefined);
    await refreshRelationState();
  };
  const toggleRelation = (candidateId: BlockId, x: number, y: number) => {
    if (!blockSnapshot || !relationFocusId) return;
    const state = candidateRelationState(blockSnapshot, relationFocusId, candidateId, relationDirection);
    if (state.disabledReason) { setBlockNotice(t(`relation.invalid.${state.disabledReason}`)); return; }
    if (relationDirection === "both" && !state.existing) { setRelationChooser({ candidateId, x, y }); return; }
    void mutateRelation(candidateId).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)));
  };
  const undoStructure = () => replayHistory("undo");
  const redoStructure = () => replayHistory("redo");
  useEffect(() => {
    const openGraph = (event: Event) => {
      const full = (event as CustomEvent<{ full?: boolean }>).detail?.full === true;
      setRelationGraphFocusId(full ? null : relationFocusId);
      setRelationNeighborhood(undefined);
      setRelationGraphOpen(true);
    };
    window.addEventListener("texweave:relation-graph-open", openGraph);
    return () => window.removeEventListener("texweave:relation-graph-open", openGraph);
  }, [relationFocusId]);
  useEffect(() => {
    if (store.get("autoSave") !== "afterDelay" || !tabs.some((tab) => tab.dirty)) return;
    const timer = setTimeout(() => { void saveTabs(true).catch(() => undefined); }, 1200);
    return () => clearTimeout(timer);
  }, [tabs, store.get("autoSave")]);
  useEffect(() => {
    const registrations = [
      commands.register("edit.undo", { execute: () => replayHistory("undo"), when: documentHistoryFocused }),
      commands.register("edit.redo", { execute: () => replayHistory("redo"), when: documentHistoryFocused }),
      commands.register("file.save", { execute: () => saveActive().catch(() => undefined) }),
      commands.register("file.saveAll", { execute: () => saveTabs(true).catch(() => undefined) }),
      commands.register("latex.compile", { execute: () => compile().catch(() => undefined) }),
      commands.register("edit.find", { execute: () => editorRef.current?.trigger("command", "actions.find", null), when: () => !!document.querySelector(".editor-surface .monaco-editor") }),
      commands.register("edit.replace", { execute: () => editorRef.current?.trigger("command", "editor.action.startFindReplaceAction", null), when: () => !!document.querySelector(".editor-surface .monaco-editor") }),
      commands.register("settings.open", { execute: () => { setSettingsInitial("general"); setSettingsOpen(true); } }),
      commands.register("ai.open", { execute: () => { setSidebarMode("ai"); setLayout((value) => ({ ...value, sidebarVisible: true })); } }),
      commands.register("block.createFromSelection", { execute: () => createUserBlockFromSelection().catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error))) })
    ];
    return () => registrations.forEach((dispose) => dispose());
  });

  const compile = async () => {
    if (!api || compileState === "running") return;
    const mainFile = resolveMainTexFile();
    if (!mainFile) { setCompileResult({ compilationId: "ui-error", status: "failed", exitCode: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0, mainFile: "", diagnostics: [{ severity: "error", source: "system", message: "No LaTeX main file is configured." }], stdoutTail: "", stderrTail: "" }); setBottomTab("problems"); return; }
    await saveActive(); setCompileState("running");
    try { const result = await api.compile.run(project.id, mainFile); setCompileResult(result); setPdfDataUrl(result.pdfDataUrl); setLayout((value) => ({ ...value, rightPane: "pdf" })); setBottomTab(result.diagnostics.length ? "problems" : "compileLog"); setBottomVisible(false); }
    catch (reason) { setCompileResult({ compilationId: "ui-error", status: "failed", exitCode: null, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), durationMs: 0, mainFile, diagnostics: [{ severity: "error", source: "system", message: reason instanceof Error ? reason.message : String(reason) }], stdoutTail: "", stderrTail: "" }); setBottomTab("problems"); setBottomVisible(false); }
    finally { setCompileState("idle"); }
  };

  const resolveMainTexFile = () => project.mainFile
    ?? (activeTab?.path.toLocaleLowerCase().endsWith(".tex") ? activeTab.path : undefined)
    ?? projectFilePaths(tree).find((path) => path.toLocaleLowerCase().endsWith(".tex"));
  const exportSourceArchive = async () => {
    if (!api || compileState === "running") return;
    try {
      await saveTabs(true);
      const path = await api.exports.sourceArchive(project.id, resolveMainTexFile());
      if (path) window.alert(t("export.saved", { path }));
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };
  const exportMainTex = async () => {
    if (!api || compileState === "running") return;
    const mainFile = resolveMainTexFile();
    if (!mainFile) { window.alert(t("export.noMainTex")); return; }
    try {
      await saveTabs(true);
      const path = await api.exports.mainTex(project.id, mainFile);
      if (path) window.alert(t("export.saved", { path }));
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
  };
  const exportPdf = async () => {
    if (!api || compileState === "running") return;
    const mainFile = resolveMainTexFile();
    if (!mainFile) { window.alert(t("export.noMainTex")); return; }
    setCompileState("running");
    try {
      await saveTabs(true);
      const result = await api.exports.pdf(project.id, mainFile);
      if (result.status === "cancelled") return;
      setCompileResult(result.compilation);
      if (result.status === "failed") {
        setBottomTab("problems");
        setBottomVisible(true);
        const diagnostic = result.compilation.diagnostics.find((item) => item.severity === "error");
        window.alert(diagnostic?.message ?? t("export.pdfFailed"));
        return;
      }
      setPdfDataUrl(result.pdfDataUrl);
      setLayout((value) => ({ ...value, rightPane: "pdf" }));
      setBottomTab(result.compilation.diagnostics.length ? "problems" : "compileLog");
      setBottomVisible(false);
      window.alert(t("export.saved", { path: result.path }));
    } catch (error) { window.alert(error instanceof Error ? error.message : String(error)); }
    finally { setCompileState("idle"); }
  };

  const closeTab = (path: string) => { setTabs((current) => current.filter((tab) => tab.path !== path)); if (activePath === path) { const remaining = tabs.filter((tab) => tab.path !== path); setActivePath(remaining.at(-1)?.path); } };
  const queueRangeMapping = (fileId: string, edits: BlockTextEdit[]) => {
    if (!api || !fileId.toLocaleLowerCase().endsWith(".tex") || edits.length === 0) return;
    const pending = pendingRangeTransactions.current.get(fileId) ?? [];
    pending.push(edits);
    pendingRangeTransactions.current.set(fileId, pending);
    const previousTimer = rangeMappingTimers.current.get(fileId);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    rangeMappingTimers.current.set(fileId, window.setTimeout(() => {
      rangeMappingTimers.current.delete(fileId);
      const transactions = pendingRangeTransactions.current.get(fileId) ?? [];
      pendingRangeTransactions.current.delete(fileId);
      if (transactions.length > 0) void api.blockGraph.mapUserBlockRanges(project.id, { fileId, transactions }).then((result) => setBlockSnapshot(result.snapshot)).catch((error: unknown) => {
        console.warn("Unable to map custom block ranges", error);
      });
    }, 180));
  };
  const setEditorContent = (content: string, edits?: BlockTextEdit[]) => {
    if (!activePath) return;
    changeDocument(activePath, content, edits !== undefined, edits);
  };
  const changeDocument = (path: string, content: string, typing = false, edits?: BlockTextEdit[], record = true) => {
    const before = tabsRef.current.find(tab => tab.path === path)?.content;
    if (before === undefined || before === content) return;
    const patch = edits ? patchFromEdits(before, content, edits) : textPatch(before, content);
    if (record) editHistory.current.recordText(path, before, content, typing, Date.now(), patch);
    const editDelta = edits?.reduce((sum, edit) => sum + edit.newLength - (edit.end - edit.start), 0);
    queueRangeMapping(path, edits && editDelta === content.length - before.length ? edits : [{ start: patch.start, end: patch.start + patch.removed.length, newLength: patch.inserted.length }]);
    if (path === activePathRef.current) activeContentRef.current = content;
    tabsRef.current = tabsRef.current.map(tab => tab.path === path ? { ...tab, content, dirty: savedContents.current.get(path) !== content } : tab);
    setTabs(tabsRef.current);
    setSaveState(tabsRef.current.some(tab => tab.dirty) ? "unsaved" : "saved");
  };
  const flushRangeMappings = async () => {
    if (!api) return;
    for (const [fileId, transactions] of pendingRangeTransactions.current) {
      window.clearTimeout(rangeMappingTimers.current.get(fileId));
      rangeMappingTimers.current.delete(fileId);
      pendingRangeTransactions.current.delete(fileId);
      if (transactions.length) setBlockSnapshot((await api.blockGraph.mapUserBlockRanges(project.id, { fileId, transactions })).snapshot);
    }
  };
  const replayHistory = (direction: HistoryDirection) => editHistory.current.replay(direction, async (operation, replayDirection) => {
    if (operation.kind === "structure") {
      if (!api) return;
      await flushRangeMappings();
      setBlockSnapshot(await api.blockGraph[replayDirection](project.id));
      setStructuralHistory(await api.blockGraph.historyState(project.id));
    } else if (operation.kind === "file") {
      if (!api) throw new Error(t("save.failed"));
      const expected = replayDirection === "undo" ? operation.after : operation.before;
      const target = replayDirection === "undo" ? operation.before : operation.after;
      const exists = projectFilePaths(await api.files.tree(project.id)).includes(operation.fileId);
      const actual = tabsRef.current.find(tab => tab.path === operation.fileId)?.content ?? (exists ? (await api.files.read(project.id, operation.fileId)).content : undefined);
      if (actual !== expected) throw new Error(t("ai.undoConflict", { path: operation.fileId }));
      if (target === undefined) {
        if (exists) await api.files.remove(project.id, operation.fileId);
        savedContents.current.delete(operation.fileId);
        tabsRef.current = tabsRef.current.filter(tab => tab.path !== operation.fileId);
        if (activePathRef.current === operation.fileId) setActivePath(undefined);
      } else {
        if (!exists) await api.files.createFile(project.id, operation.fileId);
        await api.files.write(project.id, operation.fileId, target);
        savedContents.current.set(operation.fileId, target);
        tabsRef.current = [...tabsRef.current.filter(tab => tab.path !== operation.fileId), { path: operation.fileId, content: target, dirty: false }];
        setActivePath(operation.fileId);
      }
      setTabs(tabsRef.current); await refreshTree();
    } else {
      let tab = tabsRef.current.find(item => item.path === operation.fileId);
      if (!tab && api) {
        const file = await api.files.read(project.id, operation.fileId);
        tab = { path: operation.fileId, content: file.content, dirty: false };
        savedContents.current.set(tab.path, tab.content);
        tabsRef.current = [...tabsRef.current, tab];
      }
      if (!tab) throw new Error(t("save.failed"));
      const next = applyTextPatch(tab.content, operation.patch, replayDirection);
      const replaced = replayDirection === "undo" ? operation.patch.inserted : operation.patch.removed;
      const restored = replayDirection === "undo" ? operation.patch.removed : operation.patch.inserted;
      flushSync(() => {
        changeDocument(operation.fileId, next, false, [{ start: operation.patch.start, end: operation.patch.start + replaced.length, newLength: restored.length }], false);
        setActivePath(operation.fileId);
      });
      const offset = operation.patch.start;
      const prefix = next.slice(0, offset);
      setPendingDiagnostic({ path: operation.fileId, line: prefix.split("\n").length, column: offset - prefix.lastIndexOf("\n") });
    }
    setInspectorBlock(undefined); setFigureSelection(undefined); setTableSelection(undefined);
    setBlockContext(undefined); setBoundaryRepair(undefined);
    window.dispatchEvent(new CustomEvent("texweave:history-replayed"));
  }).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)));
  const documentHistoryFocused = () => {
    const target = document.activeElement;
    // Local drafts, table cells, labels, search boxes and chat retain their own
    // text undo. The main Code editor shares the committed document history.
    return !target?.closest("input, textarea, select, [contenteditable='true'], .monaco-editor") || !!target.closest(".editor-surface .monaco-editor:not(.monaco-diff-editor)");
  };
  const mutateAIChanges = (requested: AIChangeSet, hunkIds: string[], apply: boolean): Promise<void> => {
    const run = async () => {
      if (!api) throw new Error(t("save.failed"));
      // Refetch decisions inside the queue: auto-apply and a quick Keep click
      // can arrive together, and must never apply the same edit twice.
      const changes = (await api.ai.conversations(project.id))?.changeSets.find(item => item.id === requested.id);
      if (!changes) throw new Error(t("ai.changeUnavailable"));
      const ids = new Set(hunkIds.filter(id => changes.files.some(file => file.hunks.some(hunk => hunk.id === id && hunk.decision === "pending"))));
      const diskPaths = new Set(projectFilePaths(await api.files.tree(project.id)));
      const updates: Array<{ path: string; before: string | undefined; after: string | undefined; buffer: string | undefined }> = [];
      for (const file of changes.files) {
        if (!file.hunks.some(hunk => ids.has(hunk.id))) continue;
        const buffer = tabsRef.current.find(tab => tab.path === file.path)?.content;
        const current = buffer ?? (diskPaths.has(file.path) ? (await api.files.read(project.id, file.path)).content : undefined);
        let after: string | undefined;
        try { after = transitionAIFile(file, current, ids, apply); }
        catch { throw new Error(t(apply ? "ai.bufferConflict" : "ai.undoConflict", { path: file.path })); }
        if (after !== current) updates.push({ path: file.path, before: current, after, buffer });
      }
      // Preflight every file before mutating any of them; protect edits made
      // while the IPC reads were in flight as well.
      for (const update of updates) {
        if (tabsRef.current.find(tab => tab.path === update.path)?.content !== update.buffer) throw new Error(t("ai.bufferConflict", { path: update.path }));
      }
      const changedOnDisk: typeof updates = [];
      try {
        for (const update of updates) {
          if (update.before === undefined && update.after !== undefined) {
            await api.files.createFile(project.id, update.path);
            changedOnDisk.push(update);
            await api.files.write(project.id, update.path, update.after);
          } else if (update.after === undefined) {
            await api.files.remove(project.id, update.path);
            changedOnDisk.push(update);
          }
        }
        for (const update of updates) if (tabsRef.current.find(tab => tab.path === update.path)?.content !== update.buffer) throw new Error(t("ai.bufferConflict", { path: update.path }));
      } catch (reason) {
        for (const update of changedOnDisk.reverse()) {
          if (update.before === undefined) await api.files.remove(project.id, update.path);
          else { await api.files.createFile(project.id, update.path); await api.files.write(project.id, update.path, update.before); }
        }
        throw reason;
      }
      editHistory.current.breakGroup();
      for (const update of updates) {
        if (update.before === undefined && update.after !== undefined) {
          editHistory.current.recordFile(update.path, undefined, update.after);
          savedContents.current.set(update.path, update.after);
          tabsRef.current = [...tabsRef.current, { path: update.path, content: update.after, dirty: false }];
        } else if (update.after === undefined) {
          editHistory.current.recordFile(update.path, update.before, undefined);
          savedContents.current.delete(update.path);
          tabsRef.current = tabsRef.current.filter(tab => tab.path !== update.path);
          if (activePathRef.current === update.path) setActivePath(undefined);
        } else {
          if (!tabsRef.current.some(tab => tab.path === update.path)) {
            savedContents.current.set(update.path, update.before!);
            tabsRef.current = [...tabsRef.current, { path: update.path, content: update.before!, dirty: false }];
          }
          changeDocument(update.path, update.after);
        }
      }
      setTabs(tabsRef.current);
      setSaveState(tabsRef.current.some(tab => tab.dirty) ? "unsaved" : "saved");
      if (apply) await api.ai.markChangeSetApplied(changes.id, [...ids]);
      else await api.ai.resolveChangeSet(changes.id, Object.fromEntries([...ids].map(id => [id, "rejected" as const])), false);
      if (changedOnDisk.length) await refreshTree();
    };
    const next = aiOperationQueue.current.then(run);
    aiOperationQueue.current = next.catch(() => undefined);
    return next;
  };
  const applyAIChanges = (changes: AIChangeSet, ids: string[]) => mutateAIChanges(changes, ids, true);
  const undoAIChanges = (changes: AIChangeSet, ids: string[]) => mutateAIChanges(changes, ids, false);
  const applyAIRef = useRef(applyAIChanges);
  applyAIRef.current = applyAIChanges;
  useEffect(() => {
    if (!api) return;
    let mounted = true;
    const processChanges = (changes: AIChangeSet) => {
      if (!mounted || !changes.permissionMode || changes.permissionMode === "ask" || changes.autoApplyError || aiAutoAttempts.current.has(changes.id)) return;
      const ids = changes.files.flatMap(file => file.hunks.filter(hunk => hunk.decision === "pending" && !isHunkApplied(hunk)).map(hunk => hunk.id));
      if (!ids.length) return;
      aiAutoAttempts.current.add(changes.id);
      void applyAIRef.current(changes, ids).catch(async (reason: unknown) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        if (mounted) setBlockNotice(message);
        await api.ai.markChangeSetApplied(changes.id, [], message);
      }).catch(() => undefined);
    };
    const load = () => {
      void api.ai.conversations(project.id).then(snapshot => {
        if (!mounted || !snapshot) return;
        setAiReviewChanges(snapshot.changeSets);
        for (const changes of snapshot.changeSets) processChanges(changes);
      }).catch(() => undefined);
    };
    load();
    const unsubscribe = api.ai.onUpdate(update => { if (update.kind === "changes") load(); });
    return () => { mounted = false; unsubscribe(); };
  }, [api, project.id]);
  const viewAIChanges = (changes: AIChangeSet, path: string) => {
    void (async () => {
      // Deleted files and not-yet-approved new files have no live editor tab.
      // Their diff is still available without creating a phantom project file.
      if (api && projectFilePaths(await api.files.tree(project.id)).includes(path)) await openFile(path);
      setAiDiffFile({ id: changes.id, path });
      setLayout(value => value.mode === "single" ? { ...value, singlePane: "source" } : { ...value, leftPane: "source" });
    })().catch((reason: unknown) => setBlockNotice(reason instanceof Error ? reason.message : String(reason)));
  };
  const insertText = (text: string, cursorOffset?: number, triggerSuggestions = false) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!editor || !model || !selection) return;
    const startOffset = model.getOffsetAt(selection.getStartPosition());
    editor.executeEdits("latex-toolbar", [{ range: selection, text, forceMoveMarkers: true }]);
    if (cursorOffset !== undefined) editor.setPosition(model.getPositionAt(startOffset + cursorOffset));
    editor.focus();
    if (triggerSuggestions) editor.trigger("latex-toolbar", "editor.action.triggerSuggest", {});
  };
  const insertToolbarAction = (id: string) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!editor || !model || !selection) return;
    const selectedText = model.getValueInRange(selection);
    const insertion = toolbarInsertion(id, selectedText);
    if (!insertion) return;
    const text = id === "section" && store.get("autoEnvironmentLabels")
      ? addCommandLabel(insertion.text, nextAutomaticLabel(model.getValue(), previewEnvironments.find((definition) => definition.match.kind === "command" && definition.match.command === "section" ) ?? { match: { kind: "command", command: "section" } } as EnvironmentDefinition))
      : insertion.text;
    insertText(text, insertion.cursorOffset, insertion.triggerSuggestions);
  };
  const insertImageSnippets = (generated: Array<{ text: string; cursorOffset: number }>, requestedAnchor?: number) => {
    if (!activeTab || !generated.length) return;
    const snippets = generated.map((snippet) => uniqueFigureLabels(snippet, activeTab.content));
    const joined = snippets.map((item) => item.text).join("\n\n");
    const firstCursor = snippets[0]?.cursorOffset;
    const editor = editorRef.current;
    if (sourceEditorVisible && editor?.getModel() && editor.getSelection()) { insertText(joined, firstCursor); return; }
    const insertionAnchor = previewInsertionAnchor.current?.fileId === activeTab.path ? previewInsertionAnchor.current.offset : undefined;
    const anchor = requestedAnchor ?? insertionAnchor ?? (previewViewportAnchor.current?.fileId === activeTab.path ? previewViewportAnchor.current.offset : activeTab.content.length);
    const prefix = anchor > 0 && !activeTab.content.slice(0, anchor).endsWith("\n") ? "\n\n" : "";
    const suffix = anchor < activeTab.content.length && !activeTab.content.slice(anchor).startsWith("\n") ? "\n\n" : "";
    previewInsertionAnchor.current = undefined;
    setEditorContent(activeTab.content.slice(0, anchor) + prefix + joined + suffix + activeTab.content.slice(anchor));
  };
  const importImages = async (paths: string[], type: "figure" | "inline", requestedAnchor?: number) => {
    if (!api || !activeTab || !paths.length) return;
    const imported = await api.images.import(project.id, paths, store.get("images").defaultDirectory);
    await refreshTree();
    const relativePaths = imported.filter((item) => item.kind === "file" && /\.(?:png|jpe?g|webp|svg|pdf)$/i.test(item.relativePath)).map((item) => relativeAssetPath(activeTab.path, item.relativePath));
    if (!relativePaths.length) return;
    insertImageSnippets(type === "figure" && relativePaths.length > 1 ? [multiImageInsertion(relativePaths, store.get("images"))] : relativePaths.map((path) => imageInsertion(path, store.get("images"), type)), requestedAnchor);
  };
  const chooseImagePath = async (choice: Extract<ImageInsertChoice, { kind: "project" | "local" }>): Promise<string | undefined> => {
    if (!api || !activeTab) return undefined;
    if (choice.kind === "project") return relativeAssetPath(activeTab.path, choice.path);
    const picked = await api.images.pick(false);
    if (!picked.length) return undefined;
    const [imported] = await api.images.import(project.id, picked, store.get("images").defaultDirectory);
    if (!imported || imported.kind !== "file") return undefined;
    await refreshTree();
    return relativeAssetPath(activeTab.path, imported.relativePath);
  };
  const applyImageChoice = async (choice: ImageInsertChoice) => {
    const dialog = imageDialog;
    if (!activeTab || !dialog) return;
    if (dialog.kind === "insert") {
      if (choice.kind === "empty") insertImageSnippets([emptyFigureInsertion(store.get("images"))]);
      else if (choice.kind === "multi") insertImageSnippets([emptyMultiImageInsertion(choice.rows, choice.columns, store.get("images"))]);
      else {
        const path = await chooseImagePath(choice);
        if (path) insertImageSnippets([imageInsertion(path, store.get("images"), "figure")]);
      }
      setImageDialog(undefined);
      return;
    }
    if (choice.kind !== "project" && choice.kind !== "local") return;
    const path = await chooseImagePath(choice);
    if (!path || activeTab.path !== dialog.selection.fileId) { setImageDialog(undefined); return; }
    const replacement = patchFigureSource(dialog.selection.source, { imageIndex: dialog.imageIndex, sourcePath: path });
    setEditorContent(activeTab.content.slice(0, dialog.selection.start) + replacement + activeTab.content.slice(dialog.selection.end));
    setFigureSelection({ ...dialog.selection, source: replacement, end: dialog.selection.start + replacement.length, imageIndex: dialog.imageIndex });
    setImageDialog(undefined);
  };
  const applyPreviewTableChange = (selection: TableSelection, replacement: string) => {
    if (!activeTab || activeTab.path !== selection.fileId) return;
    let next = activeTab.content.slice(0, selection.start) + replacement + activeTab.content.slice(selection.end);
    let start = selection.start;
    if (replacement.includes("\\multirow{") && !selection.source.includes("\\multirow{")) {
      const packageEdit = addLatexPackage(next, "multirow");
      next = packageEdit.source;
      if (packageEdit.insertedAt <= start) start += packageEdit.length;
    }
    setEditorContent(next);
    setTableSelection({ ...selection, start, source: replacement, end: start + replacement.length });
  };
  const applyTableChoice = (choice: TableInsertChoice) => {
    if (!activeTab) return;
    const preferences = store.get("tables");
    const insertion = uniqueTableLabel(tableInsertion(choice, preferences), activeTab.content);
    const editor = editorRef.current;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    const insertionAnchor = previewInsertionAnchor.current?.fileId === activeTab.path ? previewInsertionAnchor.current.offset : undefined;
    let anchor = sourceEditorVisible && model && selection
      ? model.getOffsetAt(selection.getStartPosition())
      : insertionAnchor ?? (previewViewportAnchor.current?.fileId === activeTab.path ? previewViewportAnchor.current.offset : activeTab.content.length);
    let source = activeTab.content;
    if (choice.addBooktabs) {
      const packageEdit = addLatexPackage(source, "booktabs");
      source = packageEdit.source;
      if (packageEdit.length && packageEdit.insertedAt <= anchor) anchor += packageEdit.length;
    }
    const prefix = anchor > 0 && !source.slice(0, anchor).endsWith("\n") ? "\n\n" : "";
    const suffix = anchor < source.length && !source.slice(anchor).startsWith("\n") ? "\n\n" : "";
    setEditorContent(source.slice(0, anchor) + prefix + insertion.text + suffix + source.slice(anchor));
    previewInsertionAnchor.current = undefined;
    setTableDialogOpen(false);
  };
  const dropImages = (event: DragEvent<HTMLElement>) => {
    if (!api || !event.dataTransfer.files.length) return;
    const paths = Array.from(event.dataTransfer.files).map((file) => api.files.pathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    event.preventDefault();
    let anchor: number | undefined;
    if ((event.target as Element).closest(".editor-surface")) {
      const target = editorRef.current?.getTargetAtClientPoint(event.clientX, event.clientY);
      if (target?.position) editorRef.current?.setPosition(target.position);
    } else {
      const sourceTarget = (event.target as Element).closest<HTMLElement>("[data-source-start-offset][data-source-end-offset]");
      if (sourceTarget) {
        const rect = sourceTarget.getBoundingClientRect();
        anchor = event.clientY < rect.top + rect.height / 2 ? Number(sourceTarget.dataset.sourceStartOffset) : Number(sourceTarget.dataset.sourceEndOffset);
      }
    }
    void importImages(paths, store.get("images").defaultInsert.type, anchor).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)));
  };
  const dropImagesToProject = (event: DragEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    if (!api || !event.dataTransfer.files.length) return;
    const paths = Array.from(event.dataTransfer.files).map((file) => api.files.pathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    event.preventDefault();
    void api.images.import(project.id, paths, store.get("images").defaultDirectory).then(() => refreshTree()).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)));
  };
  const insertEnvironment = (definition: EnvironmentDefinition) => {
    const editor = editorRef.current;
    const withAutomaticLabel = (snippet: string, source: string) => store.get("autoEnvironmentLabels") ? addEnvironmentLabel(snippet, nextAutomaticLabel(source, definition)) : snippet;
    try {
      const selection = editor?.getSelection();
      const model = editor?.getModel();
      if (sourceEditorVisible && editor && model && selection) {
        const selectedText = model.getValueInRange(selection);
        const snippet = withAutomaticLabel(environmentInsertion(definition, selectedText) ?? "", model.getValue());
        if (!snippet) return;
        const startOffset = model.getOffsetAt(selection.getStartPosition());
        editor.executeEdits("latex-environment-picker", [{ range: selection, text: snippet, forceMoveMarkers: true }]);
        editor.setPosition(model.getPositionAt(startOffset + environmentCursorOffset(snippet, selectedText)));
        editor.focus();
        return;
      }
    } catch { /* A single-pane Visual view may have disposed the Monaco instance. */ }
    const snippet = activeTab ? withAutomaticLabel(environmentInsertion(definition) ?? "", activeTab.content) : "";
    if (snippet && activeTab) {
      const anchor = previewInsertionAnchor.current?.fileId === activeTab.path ? previewInsertionAnchor.current.offset : activeTab.content.length;
      const prefix = anchor > 0 && !activeTab.content.slice(0, anchor).endsWith("\n") ? "\n\n" : "";
      const suffix = anchor < activeTab.content.length && !activeTab.content.slice(anchor).startsWith("\n") ? "\n\n" : "";
      previewInsertionAnchor.current = undefined;
      setEditorContent(activeTab.content.slice(0, anchor) + prefix + snippet + suffix + activeTab.content.slice(anchor));
    }
  };
  const revealPendingVisualPosition = (editor = editorRef.current): boolean => {
    const pending = pendingVisualToCodeAnchor.current;
    const model = editor?.getModel();
    if (!pending || !editor || !model || pending.fileId !== activePathRef.current) return false;
    pendingVisualToCodeAnchor.current = undefined;
    const offset = Math.min(Math.max(0, pending.offset), model.getValueLength());
    const position = model.getPositionAt(offset);
    editor.setPosition(position);
    editor.revealPositionInCenter(position);
    editor.focus();
    return true;
  };
  useEffect(() => {
    if (!sourceEditorVisible || !pendingVisualToCodeAnchor.current) return;
    let attempts = 0;
    let frame = 0;
    const applyWhenReady = () => {
      if (revealPendingVisualPosition() || attempts++ >= 8) return;
      frame = requestAnimationFrame(applyWhenReady);
    };
    frame = requestAnimationFrame(applyWhenReady);
    return () => cancelAnimationFrame(frame);
  }, [sourceEditorVisible, activePath, activeTab?.content]);
  const onEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    let attempts = 0;
    const applyWhenReady = () => {
      if (revealPendingVisualPosition(editor) || attempts++ >= 8) return;
      requestAnimationFrame(applyWhenReady);
    };
    requestAnimationFrame(applyWhenReady);
    searchDecorationsRef.current?.clear();
    searchDecorationsRef.current = editor.createDecorationsCollection();
    completionController.current?.dispose();
    spellCheckController.current?.dispose();
    referenceMouseListener.current?.dispose();
    symbolPairingListener.current?.dispose();
    symbolPairingListener.current = installSymbolPairing(editor, () => store.get("autoPairSymbols"));
    const blockAction = editor.addAction({ id: "texweave.createCustomBlock", label: t("block.createFromSelection"), precondition: "editorHasSelection", contextMenuGroupId: "navigation", contextMenuOrder: 0.45, run: () => { commands.execute("block.createFromSelection"); } });
    let indexedVersion = -1;
    let mathIndex = new MathNodeIndex([]);
    let cursorMathActive = false;
    let mathTimer: number | undefined;
    let activeMath: { source: string; displayMode: boolean; kind: SourceMathPreview["kind"]; start: number; end: number } | undefined;
    const currentMathIndex = () => {
      const model = editor.getModel();
      if (model && model.getVersionId() !== indexedVersion) {
        indexedVersion = model.getVersionId();
        mathIndex = MathNodeIndex.fromSource(model.getValue());
      }
      return mathIndex;
    };
    const mathAnchor = (start: number, end: number): DOMRect | undefined => {
      const model = editor.getModel();
      const bounds = editor.getDomNode()?.getBoundingClientRect();
      if (!model || !bounds) return undefined;
      const startVisible = editor.getScrolledVisiblePosition(model.getPositionAt(start));
      const endVisible = editor.getScrolledVisiblePosition(model.getPositionAt(end));
      if (!startVisible && !endVisible) return undefined;
      const rawTop = startVisible ? bounds.top + startVisible.top : bounds.top;
      const rawBottom = endVisible ? bounds.top + endVisible.top + endVisible.height : bounds.bottom;
      const top = Math.max(bounds.top, rawTop);
      const bottom = Math.min(bounds.bottom, Math.max(rawBottom, top + 1));
      if (bottom <= bounds.top || top >= bounds.bottom) return undefined;
      const left = bounds.left + (startVisible?.left ?? endVisible?.left ?? 12);
      return new DOMRect(left, top, 1, Math.max(1, bottom - top));
    };
    const refreshMathPreview = () => {
      if (!activeMath) return;
      const anchor = mathAnchor(activeMath.start, activeMath.end);
      setSourceMathPreview(anchor ? { source: activeMath.source, displayMode: activeMath.displayMode, anchor, kind: activeMath.kind } : undefined);
    };
    const scheduleMathPreview = (position: { lineNumber: number; column: number }, kind: SourceMathPreview["kind"]): boolean => {
      const model = editor.getModel();
      if (!model || !/\.tex$/i.test(activePathRef.current ?? "")) return false;
      const offset = model.getOffsetAt(position);
      const mathNode = currentMathIndex().findMathNodeAtOffset(offset);
      if (!mathNode || !mathAnchor(mathNode.start, mathNode.end)) return false;
      const extracted = extractMathExpression(model.getValue().slice(mathNode.start, mathNode.end));
      if (mathTimer !== undefined) window.clearTimeout(mathTimer);
      mathTimer = window.setTimeout(() => {
        activeMath = { source: extracted.expression, displayMode: extracted.displayMode, kind, start: mathNode.start, end: mathNode.end };
        refreshMathPreview();
      }, 75);
      return true;
    };
    const updateCursorMath = (position: { lineNumber: number; column: number }) => {
      cursorMathActive = scheduleMathPreview(position, "source-cursor");
      if (!cursorMathActive) {
        if (activeMath?.kind === "source-cursor") activeMath = undefined;
        setSourceMathPreview((current) => current?.kind === "source-cursor" ? undefined : current);
      }
    };
    const cursorListener = editor.onDidChangeCursorPosition((event) => {
      setCursor({ line: event.position.lineNumber, column: event.position.column });
      updateCursorMath(event.position);
    });
    const selectionListener = editor.onDidChangeCursorSelection((event) => {
      const model = editor.getModel();
      const path = activePathRef.current;
      if (!model || !path || event.selection.isEmpty()) { setSourceSelection(undefined); return; }
      setSourceSelection({ fileId: path, start: model.getOffsetAt(event.selection.getStartPosition()), end: model.getOffsetAt(event.selection.getEndPosition()), origin: "source" });
    });
    const contentListener = editor.onDidChangeModelContent(() => {
      indexedVersion = -1;
      activeMath = undefined;
      const position = editor.getPosition();
      if (position) updateCursorMath(position);
    });
    const scrollListener = editor.onDidScrollChange(refreshMathPreview);
    const layoutListener = editor.onDidLayoutChange(refreshMathPreview);
    const blurListener = editor.onDidBlurEditorWidget(() => {
      cursorMathActive = false;
      if (activeMath?.kind === "source-cursor") activeMath = undefined;
      setSourceMathPreview((current) => current?.kind === "source-cursor" ? undefined : current);
    });
    const modifierPressed = (event: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }) => {
      const modifier = store.get("referenceLinkModifier");
      return modifier === "ctrl" ? event.ctrlKey : modifier === "alt" ? event.altKey : modifier === "shift" ? event.shiftKey : event.metaKey;
    };
    const isCommented = (value: string, index: number) => {
      const percent = value.lastIndexOf("%", index);
      if (percent < 0) return false;
      let slashes = 0;
      for (let cursor = percent - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1;
      return slashes % 2 === 0;
    };
    const referenceAtPosition = (position: { lineNumber: number; column: number }) => {
      if (!/\.tex$/i.test(activePathRef.current ?? "")) return undefined;
      const model = editor.getModel();
      if (!model) return undefined;
      const line = model.getLineContent(position.lineNumber);
      const referencePattern = /\\([A-Za-z]*ref[A-Za-z]*)\s*\{([^}\n]+)\}/g;
      for (const match of line.matchAll(referencePattern)) {
        if (isCommented(line, match.index ?? 0)) continue;
        const startColumn = (match.index ?? 0) + 1;
        const endColumn = startColumn + match[0].length;
        if (position.column >= startColumn && position.column <= endColumn) {
          const label = (match[2] ?? "").split(",").map((value) => value.trim()).filter(Boolean)[0];
          if (label) return label;
        }
      }
      return undefined;
    };
    const labelPosition = (label: string) => {
      const model = editor.getModel();
      if (!model) return undefined;
      const labelPattern = /\\label\s*\{([^}\n]+)\}/g;
      for (const match of model.getValue().matchAll(labelPattern)) {
        if (match[1]?.trim() !== label) continue;
        const position = model.getPositionAt(match.index ?? 0);
        if (!isCommented(model.getLineContent(position.lineNumber), position.column - 1)) return position;
      }
      return undefined;
    };
    const setReferenceCursor = (enabled: boolean) => editor.getDomNode()?.classList.toggle("texweave-reference-cursor", enabled);
    let hoverPosition: { lineNumber: number; column: number } | undefined;
    const mouseDown = editor.onMouseDown((event) => {
      if (event.event.detail === 2 && event.target.position && activePathRef.current) {
        void forwardSyncToPdf(activePathRef.current, event.target.position.lineNumber, event.target.position.column);
        return;
      }
      if (!modifierPressed(event.event)) return;
      const position = event.target.position;
      const label = position ? referenceAtPosition(position) : undefined;
      const target = label ? labelPosition(label) : undefined;
      if (!target) return;
      event.event.preventDefault();
      editor.revealLineInCenter(target.lineNumber);
      editor.setPosition({ lineNumber: target.lineNumber, column: target.column });
      editor.focus();
    });
    const mouseMove = editor.onMouseMove((event) => {
      hoverPosition = event.target.position ?? undefined;
      setReferenceCursor(Boolean(hoverPosition && modifierPressed(event.event) && referenceAtPosition(hoverPosition)));
      if (!cursorMathActive && hoverPosition && !scheduleMathPreview(hoverPosition, "source-hover")) {
        if (activeMath?.kind === "source-hover") activeMath = undefined;
        setSourceMathPreview((current) => current?.kind === "source-hover" ? undefined : current);
      }
    });
    const mouseLeave = editor.onMouseLeave(() => { hoverPosition = undefined; setReferenceCursor(false); if (!cursorMathActive) { if (activeMath?.kind === "source-hover") activeMath = undefined; setSourceMathPreview(undefined); } });
    const modifierChange = (event: KeyboardEvent) => { if (hoverPosition) setReferenceCursor(Boolean(modifierPressed(event) && referenceAtPosition(hoverPosition))); };
    window.addEventListener("keydown", modifierChange);
    window.addEventListener("keyup", modifierChange);
    const initialPosition = editor.getPosition();
    if (initialPosition) updateCursorMath(initialPosition);
    const contextActions = installEditorContextActions(editor, (line, column) => { if (activePathRef.current) void forwardSyncToPdf(activePathRef.current, line, column); });
    referenceMouseListener.current = { dispose: () => { if (mathTimer !== undefined) window.clearTimeout(mathTimer); activeMath = undefined; blockAction.dispose(); contextActions.dispose(); symbolPairingListener.current?.dispose(); symbolPairingListener.current = null; cursorListener.dispose(); selectionListener.dispose(); contentListener.dispose(); scrollListener.dispose(); layoutListener.dispose(); blurListener.dispose(); mouseDown.dispose(); mouseMove.dispose(); mouseLeave.dispose(); window.removeEventListener("keydown", modifierChange); window.removeEventListener("keyup", modifierChange); setReferenceCursor(false); setSourceMathPreview(undefined); } };
    if (api) {
      completionController.current = new CompletionController({ monaco, api, projectId: project.id, getTree: () => treeRef.current, getCurrentPath: () => activePathRef.current, getEnvironments: () => environmentsRef.current, isDocumentWordCompletionEnabled: () => store.get("documentWordCompletion") });
      spellCheckController.current = new SpellCheckController({ editor, api, getCurrentPath: () => activePathRef.current, getMode: () => store.get("spellCheckMode"), getManualLanguage: () => store.get("spellCheckLanguage"), onDetectedLanguage: setDetectedSpellLanguage, onContextMenu: setSpellContextMenu });
    }
  };

  const outline = useMemo(() => {
    if (!activeTab) return [];
    const result: Array<{ title: string; level: number; line: number }> = [];
    const expression = /\\(chapter|section|subsection|subsubsection|paragraph)\*?\{([^}]*)\}/g;
    for (const match of activeTab.content.matchAll(expression)) {
      const command = match[1] ?? "section";
      const level = command === "chapter" ? 0 : command === "section" ? 1 : command === "subsection" ? 2 : command === "subsubsection" ? 3 : 4;
      const before = activeTab.content.slice(0, match.index ?? 0);
      result.push({ title: match[2] ?? "", level, line: before.split("\n").length });
    }
    return result;
  }, [activeTab]);

  const navigateToLocation = (line: number, column = 1) => {
    const previewVisible = layout.mode === "single" ? layout.singlePane === "preview" : layout.leftPane === "preview";
    if (previewVisible) {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>(`.structured-preview [data-source-line]`));
      const target = candidates.reduce<HTMLElement | undefined>((best, item) => {
        const itemLine = Number(item.dataset.sourceLine ?? 0);
        const bestLine = Number(best?.dataset.sourceLine ?? -1);
        return itemLine <= line && itemLine >= bestLine ? item : best;
      }, undefined) ?? candidates.reduce<HTMLElement | undefined>((best, item) => Math.abs(Number(item.dataset.sourceLine) - line) < Math.abs(Number(best?.dataset.sourceLine ?? Infinity) - line) ? item : best, undefined);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const safeLine = Math.min(Math.max(1, line), model.getLineCount());
    editor.revealLineInCenter(safeLine);
    editor.setPosition({ lineNumber: safeLine, column: Math.min(Math.max(1, column), model.getLineMaxColumn(safeLine)) });
    editor.focus();
  };

  const navigateToOutline = (line: number) => navigateToLocation(line);
  const openAIFileReference = async (path: string, line?: number) => {
    await openFile(path);
    if (line) requestAnimationFrame(() => requestAnimationFrame(() => { if (activePathRef.current === path) navigateToLocation(line); }));
  };
  aiFileNavigationRef.current = openAIFileReference;
  useEffect(() => {
    const openAIFile = (event: Event) => {
      const detail = (event as CustomEvent<{ path?: string; line?: number }>).detail;
      if (typeof detail?.path === "string") aiFileNavigationRef.current(detail.path, detail.line);
    };
    window.addEventListener("texweave:ai-open-file", openAIFile);
    return () => window.removeEventListener("texweave:ai-open-file", openAIFile);
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const decorations = searchDecorationsRef.current;
    if (!editor || !model || !decorations) return;
    decorations.set(searchResponse.results.filter((result) => result.fileId === activePath).map((result) => {
      const start = model.getPositionAt(result.matchStart);
      const end = model.getPositionAt(result.matchEnd);
      return { range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column }, options: { inlineClassName: result.id === activeSearchResult?.id ? "texweave-search-match-active" : "texweave-search-match" } };
    }));
  }, [searchResponse, activeSearchResult, activePath, activeTab?.content]);

  const selectSearchResult = async (result: SearchResult) => {
    setActiveSearchResult(result);
    setPendingSearchResult(result);
    if (result.fileId !== activePath) await openFile(result.fileId);
  };

  useEffect(() => {
    if (!pendingSearchResult || pendingSearchResult.fileId !== activePath || !activeTab || !sourceEditorVisible) return;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const position = model.getPositionAt(Math.min(pendingSearchResult.matchStart, model.getValueLength()));
    editor.revealPositionInCenter(position);
    editor.setPosition(position);
    editor.focus();
    setPendingSearchResult(undefined);
  }, [pendingSearchResult, activePath, activeTab?.content, sourceEditorVisible]);

  const updateSearchDocument = async (path: string, content: string) => {
    const open = tabs.some((tab) => tab.path === path);
    if (open) {
      changeDocument(path, content);
    } else if (api) {
      const file = await api.files.read(project.id, path);
      savedContents.current.set(path, file.content);
      tabsRef.current = [...tabsRef.current, { path, content: file.content, dirty: false }];
      changeDocument(path, content);
    }
    setProjectSearchDocuments((current) => current.map((document) => document.fileId === path ? { ...document, content } : document));
    if (/\.(?:tex|sty)$/i.test(path)) setProjectMathSources((current) => current.map((document) => document.path === path ? { ...document, content } : document));
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
    await Promise.all([...grouped].map(async ([path, results]) => {
      const document = searchDocuments.find((item) => item.fileId === path);
      if (document) await updateSearchDocument(path, replaceRanges(document.content, results, replacement));
    }));
    setActiveSearchResult(undefined);
  };

  useEffect(() => {
    if (!pendingDiagnostic || pendingDiagnostic.path !== activePath || !activeTab) return;
    const timer = window.setTimeout(() => {
      navigateToLocation(pendingDiagnostic.line, pendingDiagnostic.column);
      setPendingDiagnostic(undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingDiagnostic, activePath, activeTab?.content, layout.mode, layout.singlePane, layout.leftPane]);

  const filePaths = (nodes: ProjectTreeNode[]): string[] => nodes.flatMap((node) => node.kind === "file" ? [node.relativePath] : node.children ? filePaths(node.children) : []);
  const resolveDiagnosticPath = (file: string | undefined) => {
    if (!file) return activePath ?? project.mainFile;
    const normalized = file.replaceAll("\\", "/").replace(/^\.\//, "").toLocaleLowerCase();
    const paths = filePaths(tree);
    return paths.find((path) => path.toLocaleLowerCase() === normalized)
      ?? paths.find((path) => normalized.endsWith(`/${path.toLocaleLowerCase()}`) || path.toLocaleLowerCase().endsWith(`/${normalized}`))
      ?? (file.includes(":") || file.startsWith("/") ? undefined : file.replaceAll("\\", "/").replace(/^\.\//, ""));
  };

  const openDiagnostic = async (diagnostic: Diagnostic) => {
    if (!diagnostic.line) return;
    const path = resolveDiagnosticPath(diagnostic.file);
    if (!path) return;
    if (path !== activePath) {
      setPendingDiagnostic({ path, line: diagnostic.line, ...(diagnostic.column ? { column: diagnostic.column } : {}) });
      await openFile(path);
      return;
    }
    navigateToLocation(diagnostic.line, diagnostic.column);
  };

  const startResize = (kind: "sidebar" | "tree" | "split" | "bottom", event: React.PointerEvent) => {
    if (event.button !== 0) return;
    resizeCleanup.current?.();
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    const root = handle.closest<HTMLElement>(".workbench");
    const target = kind === "split" ? handle.parentElement : root?.querySelector<HTMLElement>(kind === "sidebar" ? ".sidebar" : kind === "tree" ? ".tree-section" : ".bottom-panel");
    if (!target || !root) return;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const bounds = target.getBoundingClientRect();
    const key = kind === "split" ? "splitRatio" : kind === "sidebar" ? "sidebarWidth" : kind === "tree" ? "fileTreeHeight" : "bottomPanelHeight";
    const initial = layout[key];
    let value = initial;
    let frame = 0;
    const left = target.firstElementChild as HTMLElement;
    const right = target.lastElementChild as HTMLElement;
    const availableWidth = Math.max(1, bounds.width - handle.offsetWidth);
    const initialLeftWidth = kind === "split" ? left.getBoundingClientRect().width : 0;
    // Resize only DOM containers during a gesture: React/KaTeX and settings
    // persistence run once on release, not for every incoming pointer event.
    const paint = () => {
      frame = 0;
      if (kind === "split") {
        left.style.width = `${value}%`;
        right.style.width = `${100 - value}%`;
      } else if (kind === "sidebar") target.style.width = `${value}px`;
      else target.style.height = `${value}px`;
    };
    const update = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (kind === "split") value = Math.min(72, Math.max(28, (initialLeftWidth + e.clientX - startX) / availableWidth * 100));
      else if (kind === "sidebar") value = Math.min(480, Math.max(210, initial + e.clientX - startX));
      else if (kind === "tree") value = Math.min(560, Math.max(150, initial + e.clientY - startY));
      else value = Math.min(420, Math.max(120, initial - e.clientY + startY));
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", update);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finish);
      handle.removeEventListener("lostpointercapture", finish);
      root.removeAttribute("data-resizing");
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      resizeCleanup.current = undefined;
    };
    const finish = () => {
      cancelAnimationFrame(frame);
      paint();
      cleanup();
      setLayout((current) => ({ ...current, [key]: value }));
    };
    root.dataset.resizing = kind === "tree" || kind === "bottom" ? "row" : "column";
    handle.setPointerCapture(pointerId);
    window.addEventListener("pointermove", update);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finish);
    handle.addEventListener("lostpointercapture", finish);
    resizeCleanup.current = cleanup;
  };

  const selectActivity = (mode: SidebarMode) => { if (mode === "settings") { commands.execute("settings.open"); return; } if (sidebarMode === mode && layout.sidebarVisible) setLayout((value) => ({ ...value, sidebarVisible: false })); else { setSidebarMode(mode); setLayout((value) => ({ ...value, sidebarVisible: true })); } };
  const configureSpell = async (mode: "auto" | "manual" | "disabled", language: string) => {
    if (mode === "manual") await settings.set("spellCheckLanguage", language);
    await settings.set("spellCheckMode", mode);
    if (api) {
      const status = await api.spellcheck.configure(mode, language);
      if (status) setSpellStatus(status);
    }
    setSpellMenuOpen(false);
  };
  const spellDisplayLanguage = spellMode === "manual" ? spellManualLanguage : detectedSpellLanguage;
  const spellLanguages = [...new Set(["en-US", ...(spellStatus?.availableLanguages ?? [])])];
  const spellStatusControl = <div className="spell-status-control"><button onClick={() => setSpellMenuOpen((value) => !value)}>{spellMode === "disabled" ? t("spell.status.off") : spellMode === "manual" ? t("spell.status.manual", { language: spellLanguageLabel(spellDisplayLanguage) }) : t("spell.status.auto", { language: spellLanguageLabel(spellDisplayLanguage) })}</button>{spellMenuOpen && <div className="spell-status-menu"><button onClick={() => void configureSpell("auto", detectedSpellLanguage)}>{spellMode === "auto" && "✓ "}{t("spell.menu.auto", { language: spellLanguageLabel(detectedSpellLanguage) })}</button>{spellLanguages.map((language) => <button key={language} onClick={() => void configureSpell("manual", language)}>{spellMode === "manual" && spellManualLanguage === language && "✓ "}{spellLanguageLabel(language)}</button>)}<div className="menu-divider"/><button onClick={() => void configureSpell("disabled", spellDisplayLanguage)}>{spellMode === "disabled" && "✓ "}{t("spell.menu.disable")}</button></div>}</div>;
  const menuItems = (menu: Exclude<MenuName, "projects">) => {
    if (menu === "file") return [{ label: t("menu.newFile"), action: () => void createEntry(false, "") }, { label: t("menu.openFile"), disabled: true }, { label: t("menu.save"), action: () => { commands.execute("file.save"); } }, { label: t("menu.saveAll"), action: () => { commands.execute("file.saveAll"); } }, { label: "", divider: true }, { label: t("export.sourceArchive"), action: () => void exportSourceArchive() }, { label: t("export.pdf"), action: () => void exportPdf() }, { label: t("export.mainTex"), action: () => void exportMainTex() }, { label: "", divider: true }, { label: t("menu.closeProject"), action: onHome }];
    if (menu === "edit") return [{ label: t("menu.undo"), action: () => { commands.execute("edit.undo"); } }, { label: t("menu.redo"), action: () => { commands.execute("edit.redo"); } }, { label: t("menu.find"), action: () => { commands.execute("edit.find"); } }, { label: t("menu.replace"), action: () => { commands.execute("edit.replace"); } }];
    if (menu === "view") return [{ label: t("menu.source"), action: () => { if ((layout.mode === "single" ? layout.singlePane === "preview" : layout.leftPane === "preview")) pendingVisualToCodeAnchor.current = previewToCodeAnchor(); setLayout((value) => ({ ...value, mode: "single", singlePane: "source" })); } }, { label: t("menu.preview"), action: () => setLayout((value) => ({ ...value, mode: "single", singlePane: "preview" })) }, { label: t("menu.pdf"), action: () => setLayout((value) => ({ ...value, mode: "single", singlePane: "pdf" })) }, { label: "", divider: true }, { label: t("menu.single"), action: () => setLayout((value) => ({ ...value, mode: "single" })) }, { label: t("menu.split"), action: () => setLayout((value) => ({ ...value, mode: "split" })) }];
    return [{ label: t("menu.automaticHistory"), action: () => { setBottomTab("versions"); setBottomVisible(true); } }, { label: t("menu.namedVersions"), action: () => { setBottomTab("versions"); setBottomVisible(true); } }];
  };

  const switchTextView = (target: "source" | "preview", single: boolean) => {
    const switchingFromPreview = target === "source" && (single ? layout.singlePane === "preview" : layout.leftPane === "preview");
    if (switchingFromPreview) pendingVisualToCodeAnchor.current = previewToCodeAnchor();
    setLayout((value) => single ? { ...value, singlePane: target } : { ...value, leftPane: target });
  };
  const viewSwitch = (active: "source" | "preview", single = false) => <div className="view-switch"><button className={active === "source" ? "active" : ""} onClick={() => switchTextView("source", single)}>{t("menu.code")}</button><button className={active === "preview" ? "active" : ""} onClick={() => switchTextView("preview", single)}>{t("menu.visual")}</button></div>;
  const blockButtonDisabled = blockCreationAvailability.kind === "none" || blockCreationAvailability.kind === "checking" || blockCreationAvailability.kind === "invalid";
  const blockButton = <button key="custom-block" className={`custom-block-button ${blockCreationAvailability.kind === "repair" ? "warning" : ""} ${blockCreationAvailability.kind === "edit" ? "editing" : ""}`} disabled={blockButtonDisabled} title={blockButtonDisabled ? t("block.selectRange") : t("block.createHint", { shortcut: displayBinding(bindings()["block.createFromSelection"] ?? "") })} onClick={() => {
    if (blockCreationAvailability.kind === "edit") { setInspectorBlock(blockCreationAvailability.block); return; }
    void createUserBlockFromSelection().catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)));
  }}><b>{blockCreationAvailability.kind === "repair" ? "+⚠" : blockCreationAvailability.kind === "edit" ? "✎" : "+"}</b><span>{t(blockCreationAvailability.kind === "edit" ? "block.edit" : "block.add")}{blockCreationAvailability.kind === "edit" ? " ▾" : ""}</span></button>;
  const quickActions = [blockButton, ...toolbarActions.map((action) => { const shortTitleKey = action.shortTitleKey; const icon = "icon" in action ? action.icon : undefined; return action.id === "environment" ? <EnvironmentQuickAction key={action.id} definitions={previewEnvironments} onInsert={insertEnvironment}/> : action.id === "figure" ? <ImageQuickAction key={action.id} onOpen={() => setImageDialog({ kind: "insert" })}/> : action.id === "table" ? <button key={action.id} title={t(action.titleKey as MessageKey)} onClick={() => setTableDialogOpen(true)}><b>{action.glyph}</b><span>{t(shortTitleKey as MessageKey)}</span></button> : <button key={action.id} title={t(action.titleKey as MessageKey)} onClick={() => insertToolbarAction(action.id)}>{icon ? <Icon name={icon}/> : <b>{action.glyph}</b>}<span>{t(shortTitleKey as MessageKey)}</span></button>; })];
  const isBibFile = activeTab?.path.toLocaleLowerCase().endsWith(".bib") ?? false;
  const editorQuickActions = isBibFile ? [] : quickActions;
  const sourceTabs = <div className="editor-tabs">{tabs.map((tab) => <button className={tab.path === activePath ? "active" : ""} key={tab.path} onClick={() => { setAiDiffFile(undefined); setActivePath(tab.path); }}><span>{tab.path.split("/").at(-1)}</span>{tab.dirty && <i/>}<span className="tab-close" title={t("editor.closeTab")} onClick={(event) => { event.stopPropagation(); closeTab(tab.path); }}><Icon name="close"/></span></button>)}</div>;
  const sourceEditor = <div className="editor-surface" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={dropImages}>{aiReviewFile ? <div className="ai-inline-diff"><div className="ai-inline-diff-heading"><strong>{t("ai.inlineDiffTitle")}</strong><span>{aiReviewFile.path}</span><button className="ai-diff-close" onClick={() => setAiDiffFile(undefined)}>{t("ai.closeDiff")}</button></div><DiffEditor height="calc(100% - 34px)" language={aiReviewFile.path.endsWith(".bib") ? "bibtex" : aiReviewFile.path.endsWith(".json") ? "json" : "latex"} original={aiReviewContent?.original ?? ""} modified={aiReviewContent?.modified ?? ""} theme={editorThemeName(store.get("theme"))} options={{ readOnly: true, originalEditable: false, renderSideBySide: true, automaticLayout: true, minimap: { enabled: false }, fontSize: store.get("fontSize"), lineHeight: Math.round(store.get("fontSize") * 1.5), wordWrap: store.get("wordWrap") ? "on" : "off", scrollBeyondLastLine: false }} /></div> : activeTab ? <Editor height="100%" language={activeTab.path.endsWith(".bib") ? "bibtex" : activeTab.path.endsWith(".json") ? "json" : "latex"} value={activeTab.content} onChange={(value, event) => setEditorContent(value ?? "", event.changes.map((change) => ({ start: change.rangeOffset, end: change.rangeOffset + change.rangeLength, newLength: change.text.length })))} onMount={onEditorMount} theme={editorThemeName(store.get("theme"))} options={{ minimap: { enabled: true }, fontSize: store.get("fontSize"), tabSize: store.get("tabSize"), lineHeight: Math.round(store.get("fontSize") * 1.5), wordWrap: store.get("wordWrap") ? "on" : "off", quickSuggestions: { other: true, comments: true, strings: true }, suggestOnTriggerCharacters: true, autoClosingBrackets: "never", autoClosingQuotes: "always", autoSurround: "never", automaticLayout: true, padding: { top: 14 }, renderWhitespace: "selection", scrollBeyondLastLine: false }} /> : <div className="editor-empty"><Logo/><p>{t("editor.noFile")}</p></div>}</div>;
  const sourceToolbar = <div className="latex-toolbar">{editorQuickActions}<div className="toolbar-spacer"/>{viewSwitch("source", layout.mode === "single")}</div>;
  const previewToolbar = <div className="latex-toolbar">{editorQuickActions}<div className="toolbar-spacer"/>{viewSwitch("preview", layout.mode === "single")}</div>;
  const enginePicker = <label className="engine-picker" title={t("settings.engine")}><span>{t("build.engine")}</span><select aria-label={t("settings.engine")} value={store.get("engine")} onChange={(event) => void store.set("engine", event.target.value as "pdflatex" | "xelatex" | "lualatex", "project")}><option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option></select></label>;
  const outputToolbar = <div className="output-toolbar"><button className="compile-button" onClick={() => { commands.execute("latex.compile"); }} disabled={compileState === "running"}><Icon name="play"/><span>{t(compileState === "running" ? "build.compiling" : "build.compile")}</span></button>{enginePicker}<button onClick={() => { setBottomTab("compileLog"); setBottomVisible(true); }}>{t("build.log")}</button><div className="toolbar-spacer"/><button className={layout.rightPane === "pdf" ? "active" : ""} onClick={() => setLayout((value) => ({ ...value, rightPane: value.rightPane === "pdf" ? "preview" : "pdf" }))}>{layout.rightPane === "pdf" ? t("menu.preview") : t("menu.pdf")}</button></div>;
  const sourcePaneContent = <section className="work-pane source-pane">{sourceTabs}{sourceEditor}</section>;
  const sourcePane = <section className="work-pane source-pane">{sourceTabs}{sourceToolbar}{sourceEditor}</section>;
  const previewProps = { filePath: activeTab?.path, source: activeTab?.content, definitions: previewEnvironments, mathContext, filterQuery, searchQuery, activeSearchResult, highlightRange: createdBlockHighlight, relation: blockSnapshot ? { active: relationModeActive, snapshot: blockSnapshot, transientToBlockId: previewSemanticIds, focusId: relationFocusId, direction: relationDirection, matchIds: relationProjection.matchIds, contextIds: relationProjection.contextIds, unmatchedBehavior: relationUnmatched, locateRequest: relationLocateRequest, onFocus: focusRelationBlock, onToggle: toggleRelation } : undefined, onSourceChange: setEditorContent, onSelectionChange: setPreviewSelection, onSelectionContextMenu: (selection: DocumentSelection, x: number, y: number) => { setPreviewSelection(selection); setBlockContext({ selection, x, y }); }, onViewportAnchorChange: trackPreviewViewport, onClickSourcePosition: trackPreviewClick, onFigureSelect: (selection?: FigureSelection) => { if (selection) { setInspectorBlock(undefined); setTableSelection(undefined); } setFigureSelection(selection); }, onFigureSlotSelect: (selection: FigureSelection) => { setInspectorBlock(undefined); setTableSelection(undefined); setFigureSelection(selection); setImageDialog({ kind: "replace", selection, imageIndex: selection.imageIndex ?? 0 }); }, onTableSelect: (selection?: TableSelection) => { if (selection) { setInspectorBlock(undefined); setFigureSelection(undefined); } setTableSelection(selection); }, onTableChange: applyPreviewTableChange, api, projectId: project.id, tree, onSpellContextMenu: setSpellContextMenu, onDetectedLanguage: setDetectedSpellLanguage, onForwardSync: forwardSyncToPdf };
  const anchoredPreviewProps = { ...previewProps, onInsertionAnchorChange: trackPreviewInsertion };
  const bibPreview = activeTab?.path.toLocaleLowerCase().endsWith(".bib") ? <BibtexPreviewPane source={activeTab.content} filePath={activeTab.path} projectId={project.id} documents={projectSearchDocuments} onSourceChange={setEditorContent} onLocate={({ filePath, offset, line, column }) => {
    const document = projectSearchDocuments.find((item) => item.fileId === filePath);
    const content = filePath === activePath ? activeTab?.content : document?.content;
    const lineStart = content && offset > 0 ? content.lastIndexOf("\n", offset - 1) : -1;
    const targetLine = line ?? (content ? content.slice(0, offset).split("\n").length : 1);
    const targetColumn = column ?? offset - lineStart;
    setPendingDiagnostic({ path: filePath, line: targetLine, column: targetColumn });
    setLayout((value) => value.mode === "single" ? { ...value, singlePane: "source" } : { ...value, leftPane: "source" });
    if (filePath !== activePath) void openFile(filePath);
  }} /> : <PreviewPane {...anchoredPreviewProps}/>;
  const previewContent = <section className="work-pane" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={dropImages}>{bibPreview}</section>;
  const previewPane = <section className="work-pane" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={dropImages}>{previewToolbar}{bibPreview}</section>;
  const secondaryContent = <section className="work-pane output-pane"><Placeholder type={layout.rightPane} pdfDataUrl={pdfDataUrl} pdfTarget={pdfTarget} onPdfInteract={() => setPdfTarget(undefined)} onPdfDoubleClick={(page, x, y) => void reverseSyncFromPdf(page, x, y)}/></section>;
  const singlePane = layout.singlePane === "source" ? sourcePane : layout.singlePane === "preview" ? previewPane : <section className="work-pane single-output"><div className="output-toolbar"><div className="view-switch"><button onClick={() => setLayout((value) => ({ ...value, singlePane: "source" }))}>{t("menu.code")}</button><button onClick={() => setLayout((value) => ({ ...value, singlePane: "preview" }))}>{t("menu.visual")}</button><button className="active">{t("menu.pdf")}</button></div><div className="toolbar-spacer"/><button className="compile-button" onClick={() => { commands.execute("latex.compile"); }}><Icon name="play"/>{t("build.compile")}</button></div><Placeholder type="pdf" pdfDataUrl={pdfDataUrl} pdfTarget={pdfTarget} onPdfInteract={() => setPdfTarget(undefined)} onPdfDoubleClick={(page, x, y) => void reverseSyncFromPdf(page, x, y)}/></section>;
  const splitLeftContent = layout.leftPane === "preview" ? previewContent : sourcePaneContent;
  const splitToolbar = <div className="split-toolbar"><div className="split-toolbar-left latex-toolbar">{editorQuickActions}<div className="toolbar-spacer"/>{viewSwitch(layout.leftPane)}</div><div className="split-toolbar-right">{outputToolbar}</div></div>;

  return <div className="workbench" data-theme={store.get("theme")}>
    {deleteRequest && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-label={t("files.deleteTitle")}>
      <p>{t("files.deleteMessage", { path: deleteRequest.path })}</p>
      <button onClick={() => { deleteRequest.resolve(false); setDeleteRequest(undefined); }}>{t("project.cancel")}</button>
      <button onClick={() => { deleteRequest.resolve(true); setDeleteRequest(undefined); }}>{t("files.delete")}</button>
    </section></div>}
    {nameRequest && createPortal(<EntryNameInput message={nameRequest.message} fallback={nameRequest.fallback} finish={(value) => { nameRequest.resolve(value); setNameRequest(undefined); }}/>, document.querySelector(".file-tree") ?? document.body)}
    {boundaryRepair && <div className="block-repair-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setBoundaryRepair(undefined); }}><section className="block-repair-popover" role="dialog" aria-modal="true" aria-label={t("block.repairTitle")}><strong>{t("block.partialOverlap", { block: boundaryRepair.conflictName })}</strong><p>{t("block.repairHint")}</p><div>{boundaryRepair.candidates.map((candidate) => <button key={`${candidate.kind}:${candidate.range.start}:${candidate.range.end}`} onClick={() => void createUserBlockAtRange(candidate.range).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)))}>{t(`block.${candidate.kind}`)}</button>)}<button onClick={() => setBoundaryRepair(undefined)}>{t("project.cancel")}</button></div></section></div>}
    {blockNotice && <div className="block-notice" role="status">{blockNotice}</div>}
    {relationChooser && createPortal(<><div className="relation-chooser-dismiss" onMouseDown={() => setRelationChooser(undefined)}/><div className="relation-direction-chooser" role="dialog" style={{ left: Math.min(relationChooser.x, window.innerWidth - 230), top: Math.min(relationChooser.y, window.innerHeight - 110) }}><button disabled={!!chooserPrerequisiteState?.disabledReason} title={chooserPrerequisiteState?.disabledReason ? t(`relation.invalid.${chooserPrerequisiteState.disabledReason}`) : undefined} onClick={() => void mutateRelation(relationChooser.candidateId, "prerequisite").catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)))}>← {t("relation.addPrerequisite")}</button><button onClick={() => void mutateRelation(relationChooser.candidateId, "consequence").catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)))}>→ {t("relation.addConsequence")}</button></div></>, document.body)}
    {relationGraphOpen && relationNeighborhood && createPortal(<RelationGraphView snapshot={blockSnapshot ?? emptyBlockSnapshot} neighborhood={relationNeighborhood} direction={relationDirection} depth={relationDepth} onDirection={setRelationDirection} onDepth={setRelationDepth} onFocus={(id) => { focusRelationBlock(id); setRelationGraphFocusId(id); }} onLocate={(id) => { setRelationGraphOpen(false); void locateRelationBlock(id); }} onClose={() => setRelationGraphOpen(false)}/>, document.body)}
    <header className="workbench-topbar" ref={workbenchRef}><button className="logo-button" onClick={onHome} title={t("project.directory")}><Logo/><span>{t("app.name")}</span></button><nav className="app-menus">{(["file", "edit", "view", "history"] as const).map((menu) => <div className="menu-anchor" key={menu}><button onMouseDown={(event) => { if (menu === "edit") event.preventDefault(); }} onClick={() => setActiveMenu(activeMenu === menu ? undefined : menu)}>{t(`menu.${menu}` as MessageKey)}</button>{activeMenu === menu && <Menu items={menuItems(menu)} onClose={() => setActiveMenu(undefined)}/>}</div>)}</nav><div className="project-switcher menu-anchor"><button onClick={() => setActiveMenu(activeMenu === "projects" ? undefined : "projects")}><strong>{project.name}</strong><Icon name="chevron"/></button>{activeMenu === "projects" && <div className="menu-popover project-menu">{projects.map((item) => <button key={item.id} onClick={() => { setActiveMenu(undefined); onSwitch(item); }}><span>{item.name}</span>{item.id === project.id && <b>✓</b>}</button>)}<div className="menu-divider"/><button onClick={() => { setActiveMenu(undefined); onHome(); }}>{t("project.directory")}</button></div>}</div><button className={`save-status ${saveState}`} onClick={() => { commands.execute("file.save"); }}><Icon name="save"/>{t(`save.${saveState}` as MessageKey)}</button></header>
    <div className="workbench-body"><aside className="activity-bar"><div>{(["files", "search", "library", "ai"] as const).map((mode) => <button key={mode} className={layout.sidebarVisible && sidebarMode === mode ? "active" : ""} title={t(`activity.${mode}` as MessageKey)} onClick={() => selectActivity(mode)}><Icon name={mode}/><span>{t(`activity.${mode}` as MessageKey)}</span></button>)}</div><div><button className={layout.sidebarVisible && sidebarMode === "settings" ? "active" : ""} title={t("activity.settings")} onClick={() => selectActivity("settings")}><Icon name="settings"/><span>{t("activity.settings")}</span></button><button className={layout.sidebarVisible && sidebarMode === "help" ? "active" : ""} title={t("activity.help")} onClick={() => selectActivity("help")}><Icon name="help"/><span>{t("activity.help")}</span></button></div></aside>
      {layout.sidebarVisible && <><aside className="sidebar" style={{ width: layout.sidebarWidth }}>{sidebarMode === "files" && <><div className="sidebar-heading"><strong>{t("sidebar.files")}</strong><div><button onClick={() => void createEntry(false, "")} title={t("files.newFile")}><Icon name="plus"/></button><button onClick={() => void refreshTree()} title={t("sidebar.refresh")}><Icon name="refresh"/></button><button onClick={() => setLayout((value) => ({ ...value, sidebarVisible: false }))} title={t("sidebar.collapse")}>‹</button></div></div><div className="tree-section" style={{ height: layout.fileTreeHeight }} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={dropImagesToProject}><input className="sidebar-input" value={treeFilter} onChange={(event) => setTreeFilter(event.target.value)} placeholder={t("sidebar.fileSearch")}/><Tree nodes={tree} activePath={activePath} mainFile={project.mainFile} filter={treeFilter} hideBuildArtifacts={store.get("hideBuildArtifacts")} onOpen={(path) => void openFile(path)}/></div><div className="horizontal-resizer" onPointerDown={(event) => startResize("tree", event)}/><div className="outline-section"><div className="segment-tabs"><button className={outlineMode === "outline" ? "active" : ""} onClick={() => setOutlineMode("outline")}>{t("sidebar.outline")}</button><button className={outlineMode === "relations" ? "active" : ""} onClick={() => { setOutlineMode("relations"); setInspectorBlock(undefined); }}>{t("sidebar.relations")}</button></div>{outlineMode === "outline" ? <div className="outline-list">{outline.map((item, index) => <button key={`${item.title}-${index}`} style={{ paddingLeft: 14 + item.level * 15 }} onClick={() => navigateToOutline(item.line)}>{item.title}</button>)}</div> : <RelationBrowser snapshot={blockSnapshot ?? emptyBlockSnapshot} focusId={relationFocusId} direction={relationDirection} depth={relationDepth} filters={relationFilters} unmatchedBehavior={relationUnmatched} canGoBack={relationFocusHistory.length > 0} onBack={relationBack} onFocus={focusRelationBlock} onLocate={(id) => void locateRelationBlock(id)} onDirection={setRelationDirection} onDepth={setRelationDepth} onFilters={setRelationFilters} onUnmatchedBehavior={setRelationUnmatched} onToggleRelation={(id, event) => toggleRelation(id, event.clientX, event.clientY)}/>}</div></>}{sidebarMode === "search" && <AdvancedSearchPanel query={searchQuery} response={searchResponse} activeResultId={activeSearchResult?.id} replacement={replacement} replaceOpen={replaceOpen} filter={filterQuery} options={filterOptions} visibleGroups={store.get("visibleFilterGroups") as FilterGroupId[]} setQuery={setSearchQuery} setReplacement={setReplacement} setReplaceOpen={setReplaceOpen} setFilter={setFilterQuery} selectResult={(result) => void selectSearchResult(result)} replaceCurrent={() => void replaceCurrentSearchResult()} replaceAll={() => void replaceAllSearchResults()}/>} {sidebarMode === "library" && <ReferenceLibraryPanel project={project} onOpenLibrary={onOpenLibrary} onReturnToEditor={() => setLayout((value) => ({ ...value, sidebarVisible: false }))} onCite={(key) => insertText(`\\cite{${key}}`, `\\cite{${key}}`.length)}/>} {sidebarMode === "ai" && <AIView projectId={project.id} projectRoot={project.canonicalPath} overrides={tabs.map(({ path, content }) => ({ path, content }))} {...(activeTab ? { currentFile: activeTab.path, currentFileContent: activeTab.content } : {})} {...(creationSelection && activeTab && creationSelection.fileId === activeTab.path ? { selectedText: activeTab.content.slice(creationSelection.start, creationSelection.end) } : {})} onApplyChanges={applyAIChanges} onUndoChanges={undoAIChanges} onViewChanges={viewAIChanges} onOpenFile={(path, line) => { void openFile(path).then(() => { if (line) setPendingDiagnostic({ path, line, column: 1 }); }).catch((reason: unknown) => setBlockNotice(String(reason))); }} onReviewChanges={setAiReviewChanges} onOpenSettings={() => { setSettingsInitial("ai"); setSettingsOpen(true); }}/ >}{sidebarMode === "settings" && <div className="generic-sidebar"><h2>{t("activity.settings")}</h2><p>{t("placeholder.settings")}</p><dl><div><dt>{t("settings.language")}</dt><dd>{t("settings.english")}</dd></div><div><dt>{t("settings.theme")}</dt><dd>{t("settings.light")}</dd></div></dl></div>}{sidebarMode === "help" && <div className="generic-sidebar"><h2>{t("activity.help")}</h2><p>{t("placeholder.help")}</p></div>}</aside><div className="vertical-resizer" onPointerDown={(event) => startResize("sidebar", event)}/></>}
      <main className="workspace"><div className="workspace-main">{layout.mode === "single" ? singlePane : <><div className="split-toolbar-row">{splitToolbar}</div><div className="split-layout"><div style={{ width: `${layout.splitRatio}%` }}>{splitLeftContent}</div><div className="split-resizer" onPointerDown={(event) => startResize("split", event)}/><div style={{ width: `${100 - layout.splitRatio}%` }}>{secondaryContent}</div></div></>}</div>{bottomVisible && <><div className="bottom-resizer" onPointerDown={(event) => startResize("bottom", event)}/><section className="bottom-panel" style={{ height: layout.bottomPanelHeight }}><div className="bottom-tabs">{(["problems", "output", "compileLog", "versions"] as const).map((tab) => <button className={bottomTab === tab ? "active" : ""} key={tab} onClick={() => setBottomTab(tab)}>{t(`panel.${tab}` as MessageKey)}{tab === "problems" && diagnostics.length > 0 && <span>{diagnostics.length}</span>}</button>)}<button className="panel-close" onClick={() => setBottomVisible(false)} title={t("common.close")}><Icon name="close"/></button></div><div className="panel-content">{bottomTab === "problems" && (diagnostics.length ? diagnostics.map((diagnostic, index) => <DiagnosticRow diagnostic={diagnostic} onOpen={() => void openDiagnostic(diagnostic)} key={`${diagnostic.message}-${index}`}/>) : <p>{t("panel.noProblems")}</p>)}{bottomTab === "compileLog" && <pre>{compileResult ? `${compileResult.stdoutTail}\n${compileResult.stderrTail}` : t("panel.noOutput")}</pre>}{bottomTab === "output" && <p>{t("panel.noOutput")}</p>}{bottomTab === "versions" && <p>{t("panel.versionsPlaceholder")}</p>}</div></section></>}</main>
      {figureSelection ? <FigureInspector selection={figureSelection} onClose={() => setFigureSelection(undefined)} onLocate={(imageIndex) => setImageDialog({ kind: "replace", selection: figureSelection, imageIndex })} onChange={(replacement) => {
        if (!activeTab || activeTab.path !== figureSelection.fileId) return;
        setEditorContent(activeTab.content.slice(0, figureSelection.start) + replacement + activeTab.content.slice(figureSelection.end));
        setFigureSelection({ ...figureSelection, source: replacement, end: figureSelection.start + replacement.length });
      }}/> : tableSelection ? <TableInspector selection={tableSelection} onClose={() => setTableSelection(undefined)} onChange={(replacement) => { if (!activeTab || activeTab.path !== tableSelection.fileId) return; setEditorContent(activeTab.content.slice(0, tableSelection.start) + replacement + activeTab.content.slice(tableSelection.end)); setTableSelection({ ...tableSelection, source: replacement, end: tableSelection.start + replacement.length }); }}/> : inspectorBlock ? <aside className="custom-block-inspector" aria-label={t("block.inspector")}><header><div><small>{t("block.customBlock")}</small><strong>{inspectorBlock.name || inspectorBlock.label || t("block.untitled")}</strong></div><button onClick={() => setInspectorBlock(undefined)} title={t("common.close")}><Icon name="close"/></button></header><div><label><span>{t("block.type")}</span><input value={inspectorBlock.role ?? inspectorBlock.type} onChange={(event) => setInspectorBlock((block) => block ? { ...block, role: event.target.value, type: event.target.value } : block)} onBlur={(event) => void updateInspectorBlock({ role: event.target.value || "custom", type: event.target.value || "custom" })}/></label><label><span>{t("block.name")}</span><input value={inspectorBlock.name ?? ""} placeholder={t("block.optional")} onChange={(event) => setInspectorBlock((block) => block ? { ...block, name: event.target.value, title: event.target.value } : block)} onBlur={(event) => void updateInspectorBlock({ name: event.target.value, title: event.target.value })}/></label><label><span>{t("block.label")}</span><input value={inspectorBlock.label ?? ""} placeholder={t("block.optional")} onChange={(event) => setInspectorBlock((block) => block ? { ...block, label: event.target.value } : block)} onBlur={(event) => void updateInspectorBlock({ label: event.target.value })}/></label><dl><div><dt>{t("block.origin")}</dt><dd>{inspectorBlock.origin}</dd></div><div><dt>{t("block.range")}</dt><dd>{inspectorBlock.range ? `${inspectorBlock.range.start}–${inspectorBlock.range.end}` : "—"}</dd></div></dl></div></aside> : relationModeActive && <RelationInspector snapshot={blockSnapshot ?? emptyBlockSnapshot} focusId={relationFocusId} direction={relationDirection} depth={relationDepth} history={structuralHistory} onDirection={setRelationDirection} onDepth={setRelationDepth} onFocus={focusRelationBlock} onRemove={(from, to) => void removeRelation(from, to).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)))} onUndo={() => void undoStructure()} onRedo={() => void redoStructure()} onClose={() => setOutlineMode("outline")}/>}
    </div><footer className="status-bar"><div><span>{activePath ?? project.mainFile ?? "—"}</span><span>{t("status.line", cursor)}</span><span>{t("status.encoding")}</span><span>{t("status.lineEnding")}</span></div><div><span>{t("status.engine")}</span><button onClick={() => { setBottomTab("problems"); setBottomVisible(true); }}>{compileResult?.status === "succeeded" ? `✓ ${t("build.succeeded")}` : compileResult ? `! ${t("build.failed")}` : t("build.notRun")}</button><button onClick={() => { setBottomTab("problems"); setBottomVisible(true); }}>{t("status.errors", { count: errors })}</button><button onClick={() => { setBottomTab("problems"); setBottomVisible(true); }}>{t("status.warnings", { count: warnings })}</button>{spellStatusControl}<button onClick={() => setBottomVisible((value) => !value)} title={t("panel.output")}><Icon name="panel"/></button></div></footer>
  {sourceMathPreview && <MathPreviewPopover source={sourceMathPreview.source} displayMode={sourceMathPreview.displayMode} context={mathContext} anchor={sourceMathPreview.anchor}/>} {settingsOpen && <SettingsDialog initial={settingsInitial} onClose={() => setSettingsOpen(false)}/>} {imageDialog && createPortal(<ImageInsertDialog tree={tree} replacement={imageDialog.kind === "replace"} onClose={() => setImageDialog(undefined)} onChoose={(choice) => void applyImageChoice(choice).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)))}/>, document.body)} {tableDialogOpen && activeTab && createPortal(<TableInsertDialog documentSource={activeTab.content} defaults={{ style: store.get("tables").defaultStyle, headerRow: store.get("tables").defaultInsert.headerRow, addCaption: store.get("tables").defaultInsert.addCaption, addLabel: store.get("tables").defaultInsert.addLabel }} onClose={() => setTableDialogOpen(false)} onChoose={applyTableChoice}/>, document.body)} {fileContext && <ContextMenu context={fileContext} items={fileContextItems()} onClose={() => setFileContext(undefined)}/>} {blockContext && <ContextMenu context={blockContext} items={[{ label: t("block.createFromSelection"), action: () => void createUserBlockFromSelection(blockContext.selection).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error))) }]} onClose={() => setBlockContext(undefined)}/>} {spellContextMenu && <SpellContextMenu request={spellContextMenu} onClose={() => setSpellContextMenu(undefined)}/>}</div>;
}
