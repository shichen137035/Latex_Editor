import { buildOutline } from "./outline.js";
import { useExternalFiles } from "./useExternalFiles.js";
import { readWorkspacePosition, writeWorkspacePosition } from "./workspacePosition.js";
import { toolchainReadiness } from "../settings/toolchainReadiness.js";
import { startSnapshotTimer } from "./snapshotTimer.js";
import { DiffEditor, Editor, type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { AIChangeSet, AIConversation, BlockGraphSnapshot, BlockId, BlockTextEdit, CompileResult, Diagnostic, Project, ProjectTreeNode, SemanticBlock, SpellCheckStatus, StructuralHistoryState } from "@latex-editor/contracts";
import toolbarActions from "../resources/toolbar-actions.json" with { type: "json" };
import { t, type MessageKey } from "../i18n/index.js";
import { PreviewPane } from "../preview/PreviewPane.js";
import { releaseFigurePreviewCache } from "../figure/FigurePreview.js";
import { createPreviewTransaction, type PreviewSourceTransaction, type PreviewTextChange } from "../preview/incremental.js";
import { SettingsDialog, type SettingsSection } from "../settings/SettingsDialog.js";
import { useSettings, settings } from "../settings/service.js";
import { bindings, commandBindings, commands, displayBinding, type CommandId } from "../settings/commands.js";
import { EnvironmentQuickAction } from "../preview/EnvironmentPicker.js";
import { addCommandLabel, nextAutomaticLabel } from "../preview/labels.js";
import { unsavedChanges, useUnsavedChanges } from "../lifecycle/unsavedChanges.js";
import { EditHistory, applyTextPatch, patchFromEdits, textPatch, type HistoryDirection } from "./EditHistory.js";
import { NavigationHistory } from "./NavigationHistory.js";
import { ProjectReferenceIndex } from "../editor/ProjectReferenceIndex.js";
import { automaticHunkIds } from "../ai/changeOperations.js";
import { groupChangeReports } from "../ai/changeReports.js";
import type { EnvironmentDefinition, SourceSpan } from "../preview/types.js";
import type { CompletionController } from "../completion/CompletionController.js";
import type { SpellCheckController, SpellContextRequest } from "../spellcheck/SpellCheckController.js";
import { toolbarInsertion } from "./toolbarInsertion.js";
import { MathMacroRegistry, type ProjectMathSource } from "../math/MathMacroRegistry.js";
import { MathPreviewPopover } from "../math/MathPreviewPopover.js";
import { AdvancedSearchPanel } from "../search/AdvancedSearchPanel.js";
import { type FilterGroupId, type FilterQuery } from "../filter/types.js";
import { editorThemeName } from "../themes/runtime.js";
import { normalizeDocumentSelection, type DocumentSelection } from "../custom-blocks/selection.js";
import { formatLatexSource } from "../editor/latexFormatter.js";
import { RelationBrowser } from "../relations/RelationBrowser.js";
import { RelationInspector } from "../relations/RelationInspector.js";
import { RelationGraphView } from "../relations/RelationGraphView.js";
import { ImageQuickAction } from "../figure/ImageQuickAction.js";
import { ImageInsertDialog } from "../figure/ImageInsertDialog.js";
import { FigureInspector, type FigureSelection } from "../figure/FigureInspector.js";
import { preferredSubfigureSyntax, subfigurePackage } from "../figure/layout.js";
import { parseGraphicPaths, parseImages } from "../figure/parser.js";
import { environmentPreview } from "../preview/environment-preview.js";
import { planFigureEdit, type FigureEditPlan } from "./figureEditing.js";
import { TableInsertDialog } from "../table/TableInsertDialog.js";
import { TableInspector } from "../table/TableInspector.js";
import type { TableSelection } from "../table/model.js";
import { ReferenceLibraryPanel } from "../references/ReferenceLibraryPanel.js";
import { AutomaticCompileScheduler } from "./AutomaticCompileScheduler.js";
import { citationInsertionOffset, citationText, insertPreviewCitation } from "../references/citationInsertion.js";
import { BibtexPreviewPane } from "../references/BibtexPreviewPane.js";
import { ProjectHistoryPanel } from "../history/ProjectHistoryPanel.js";
import { AIView } from "../ai/AIView.js";
import { ContextMenu, DiagnosticRow, EntryNameInput, Icon, Logo, Menu, Placeholder, SpellContextMenu, Tree, spellLanguageLabel, type FileContext } from "./WorkbenchComponents.js";
import { projectPathJoin, createWorkbenchFileActions, type DeleteEntryRequest, type EditorTab, type EntryNameRequest } from "./fileActions.js";
import { createFileOpeningController } from "./fileOpening.js";
import { createProjectSessionController } from "./projectSession.js";
import { createHistoryRestoreHandler } from "./historyRestore.js";
import { useEditorStateEffects } from "./editorStateEffects.js";
import { restoreLayout, projectFilePaths, sourceOffsetAtLine } from "./layout.js";
import { createNavigationController, type NavigationRequest } from "./navigationController.js";
import { createWorkbenchEditorMount, type SourceMathPreview } from "./editorMount.js";
import { createAIChangeController } from "./aiChangeController.js";
import { emptyBlockSnapshot, useRelationController } from "./relationController.js";
import { createDocumentInsertions, type ImageDialogState } from "./documentInsertions.js";
import { createDocumentActions } from "./documentActions.js";
import { compileResultMetadata } from "./compileResultMetadata.js";
import { releaseCollapseStateCache } from "../collapseState.js";
import { CompileResultPicker } from "./CompileResultPicker.js";
import { usePdfDocuments } from "./usePdfDocuments.js";
import { useSearchController } from "./searchController.js";
import { useWorkingDocuments } from "./workingDocuments.js";
import { OutlineList } from "./OutlineList.js";
import { createUserBlockController, type BoundaryRepairPrompt } from "./userBlockController.js";

type SidebarMode = "files" | "search" | "library" | "ai" | "history" | "relations" | "help";
const sidebarCommands: Record<SidebarMode, CommandId> = { files: "sidebar.files", search: "sidebar.search", library: "sidebar.library", ai: "ai.open", history: "sidebar.history", relations: "sidebar.relations", help: "sidebar.help" };
type BottomTab = "problems" | "output" | "compileLog";
type MenuName = "file" | "edit" | "view" | "history" | "projects";



type FileDropDetail = { paths: string[]; destination: string };
type BlockContext = { x: number; y: number; selection: DocumentSelection };
type BlockCreationAvailability = { kind: "none" | "checking" | "valid" | "repair" | "invalid" } | { kind: "edit"; block: SemanticBlock };


export function Workbench({ project, projects, environments, onHome, onSwitch, onOpenLibrary }: { project: Project; projects: Project[]; environments: EnvironmentDefinition[]; onHome(): void; onSwitch(project: Project): void; onOpenLibrary(): void }) {
  useEffect(() => () => { releaseFigurePreviewCache(project.id); releaseCollapseStateCache(project.id); }, [project.id]);
  const store = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitial, setSettingsInitial] = useState<SettingsSection>("general");
  const api = window.latexEditor;
  const [layout, setLayout] = useState(restoreLayout);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("files");
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [tree, setTree] = useState<ProjectTreeNode[]>([]);
  const [treeFilter, setTreeFilter] = useState("");
  const [treeSortBy, setTreeSortBy] = useState<"type" | "name">("type");
  const [treeSortDirection, setTreeSortDirection] = useState<"asc" | "desc">("asc");
  const [showSourceWhitespace, setShowSourceWhitespace] = useState(false);
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [importingProjectEntries, setImportingProjectEntries] = useState(false);
  const tabsRef = useRef(tabs);
  const previewSourceTransaction = useRef<PreviewSourceTransaction | undefined>(undefined);
  const openingFilesRef = useRef(new Map<string, Promise<void>>());
  const fileOpenSequence = useRef(0);
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
  const aiWorkingRef = useRef(false);
  const aiEditWarningShown = useRef(false);
  const [createdBlockHighlight, setCreatedBlockHighlight] = useState<{ fileId: string; start: number; end: number; nonce: number }>();
  const [nameRequest, setNameRequest] = useState<EntryNameRequest>();
  const [deleteRequest, setDeleteRequest] = useState<DeleteEntryRequest>();
  const [compileState, setCompileState] = useState<"idle" | "running">("idle");
  const [compileResult, setCompileResult] = useState<CompileResult>();
  const [compileResults, setCompileResults] = useState<CompileResult[]>([]);
  const [compileLogView, setCompileLogView] = useState<{ compilationId: string; text: string; loading: boolean; error?: string }>();
  const [navigationRequest, setNavigationRequest] = useState<NavigationRequest>();
  const [editorMountVersion, setEditorMountVersion] = useState(0);
  const pdfDocuments = usePdfDocuments({ api, project, tree, activePath, follow: store.get("pdfFollowActiveTex") });
  const { pdfDataUrl, setPdfDataUrl, pdfOrigin, pdfSourceFile, pdfFile, pdfOriginRef, pdfViewState, pdfTarget, setPdfTarget } = pdfDocuments;
  const pdfDocumentsRef = useRef(pdfDocuments); pdfDocumentsRef.current = pdfDocuments;
  const compileGuard = useRef({ busy: false, alive: true });
  const projectMainRef = useRef(project.mainFile);
  projectMainRef.current = project.mainFile;
  const compileRef = useRef<() => Promise<void>>(async () => undefined);
  const autoCompiler = useRef<AutomaticCompileScheduler | undefined>(undefined);
  useEffect(() => {
    compileGuard.current.alive = true;
    autoCompiler.current = new AutomaticCompileScheduler({ canRun: () => !compileGuard.current.busy, compile: () => compileRef.current(), onError: error => setBlockNotice(String(error)) });
    return () => { compileGuard.current.alive = false; autoCompiler.current?.dispose(); };
  }, []);
  const [bottomVisible, setBottomVisible] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>("problems");
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [spellStatus, setSpellStatus] = useState<SpellCheckStatus>();
  const [detectedSpellLanguage, setDetectedSpellLanguage] = useState("en-US");
  const [spellContextMenu, setSpellContextMenu] = useState<SpellContextRequest>();
  const [spellMenuOpen, setSpellMenuOpen] = useState(false);
  const [projectMathSources, setProjectMathSources] = useState<ProjectMathSource[]>([]);
  const [sourceMathPreview, setSourceMathPreview] = useState<SourceMathPreview>();
  const clearHoverMathPreviewRef = useRef<() => void>(() => undefined);
  const mathPopoverInteracting = useRef(false);
  const mathPopoverInteractionChangeRef = useRef<(active: boolean) => void>(() => undefined);
  const mathPreviewOnHover = store.get("mathPreviewOnHover");
  useEffect(() => { if (!mathPreviewOnHover) clearHoverMathPreviewRef.current(); }, [mathPreviewOnHover]);
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
  const searchDecorationsRef = useRef<ReturnType<Parameters<OnMount>[0]["createDecorationsCollection"]> | null>(null);
  const resizeCleanup = useRef<(() => void) | undefined>(undefined);
  const lastTextPane = useRef<"source" | "preview">("source");
  const activeContentRef = useRef("");
  const aiOperationQueue = useRef<Promise<void>>(Promise.resolve());
  const aiAutoAttempts = useRef(new Set<string>());
  const treeRefreshSequence = useRef(0);
  const previewViewportAnchor = useRef<{ fileId: string; offset: number } | undefined>(undefined);
  const restoredWorkspace = useMemo(() => readWorkspacePosition(project.id, project.canonicalPath), [project.id, project.canonicalPath]);
  const workspaceReady = useRef(false);
  const previewPositions = useRef(new Map(restoredWorkspace.preview));
  const sourcePositions = useRef(new Map(restoredWorkspace.source));
  const sourceModelPath = useRef<string | undefined>(undefined);
  const sourceRestoredFor = useRef<string | undefined>(undefined);
  const forwardSyncToPdfRef = useRef<(path: string, line: number, column?: number) => Promise<void>>(async () => undefined);
  const navigationNonce = useRef(0);
  const navigationHistory = useRef(new NavigationHistory());
  useEffect(() => { navigationHistory.current.clear(); }, [project.id]);
  const previewClickAnchor = useRef<{ fileId: string; offset: number } | undefined>(undefined);
  const previewInsertionAnchor = useRef<{ fileId: string; offset: number } | undefined>(undefined);
  const pendingVisualToCodeAnchor = useRef<{ fileId: string; offset: number } | undefined>(undefined);
  useEffect(() => () => resizeCleanup.current?.(), []);

  const activeTab = tabs.find((tab) => tab.path === activePath);
  useEffect(() => { previewClickAnchor.current = undefined; }, [activePath, activeTab?.content]);
  useEffect(() => {
    pendingVisualToCodeAnchor.current = undefined; previewInsertionAnchor.current = undefined;
    setFigureSelection(undefined); setTableSelection(undefined); setInspectorBlock(undefined);
    setPreviewSelection(undefined); setSourceSelection(undefined);
  }, [activePath]);
  const aiReviewFile = useMemo(() => aiDiffFile ? groupChangeReports(aiReviewChanges).find(report => report.id === aiDiffFile.id || report.members.some(member => member.id === aiDiffFile.id))?.files.find(file => file.path === aiDiffFile.path) : undefined, [aiReviewChanges, aiDiffFile]);
  const aiReviewContent = useMemo(() => aiReviewFile ? { original: aiReviewFile.originalContent ?? "", modified: aiReviewFile.proposedContent ?? "" } : undefined, [aiReviewFile]);
  const sourceEditorVisible = layout.mode === "single" ? layout.singlePane === "source" : layout.leftPane === "source";
  const visualEditorVisible = layout.mode === "single" ? layout.singlePane === "preview" : layout.leftPane === "preview";
  const creationSelection = sourceEditorVisible ? sourceSelection : previewSelection;
  const relationModeActive = sidebarMode === "relations";
  const diagnostics = useMemo(() => compileResults.length ? compileResults.flatMap(result => result.diagnostics.map(diagnostic => ({ ...diagnostic, file: diagnostic.file ?? result.mainFile }))) : compileResult?.diagnostics ?? [], [compileResults, compileResult]);
  const compilationFailed = compileResults.length ? compileResults.some(result => result.status !== "succeeded") : compileResult?.status !== "succeeded";
  const diagnosticGroups = useMemo(() => {
    const groups = new Map<string, typeof diagnostics>();
    for (const diagnostic of diagnostics) {
      const category = diagnostic.category ?? diagnostic.source;
      groups.set(category, [...(groups.get(category) ?? []), diagnostic]);
    }
    return [...groups.entries()];
  }, [diagnostics]);
  const errors = diagnostics.filter((item) => item.severity === "error" || item.severity === "fatal").length;
  const warnings = diagnostics.filter((item) => item.severity === "warning").length;
  useEffect(() => {
    if (!bottomVisible || bottomTab !== "compileLog" || !compileResult) return;
    let cancelled = false;
    const fallback = `${compileResult.stdoutTail}\n${compileResult.stderrTail}`.trim();
    if (!compileResult.logPath) {
      setCompileLogView({ compilationId: compileResult.compilationId, text: fallback, loading: false });
      return;
    }
    setCompileLogView({ compilationId: compileResult.compilationId, text: fallback, loading: true });
    void window.latexEditor!.compile.readLog(project.id, compileResult.compilationId).then((text) => {
      if (!cancelled) setCompileLogView({ compilationId: compileResult.compilationId, text, loading: false });
    }).catch((reason: unknown) => {
      if (!cancelled) setCompileLogView({ compilationId: compileResult.compilationId, text: fallback, loading: false, error: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => { cancelled = true; };
  }, [bottomVisible, bottomTab, compileResult, project.id]);
  const configuredEnvironments = store.get("environments") as EnvironmentDefinition[];
  const previewEnvironments = configuredEnvironments.length ? configuredEnvironments : environments;
  const mathContext = useMemo(() => {
    const sources = new Map(projectMathSources.map((source) => [source.path.replaceAll("\\", "/").toLocaleLowerCase(), source]));
    for (const tab of tabs) if (/\.(?:tex|sty)$/i.test(tab.path)) sources.set(tab.path.replaceAll("\\", "/").toLocaleLowerCase(), { path: tab.path, content: tab.content });
    return mathRegistryRef.current.rebuild([...sources.values()], project.mainFile ?? activePath);
  }, [projectMathSources, tabs, project.mainFile, activePath]);
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
  useEffect(() => () => {
    // The debounced save is cancelled on unmount; persist the last pane
    // visibility and collapse choices with the explicit project ID.
    void api?.settings.set("layout", { ...layoutRef.current }, project.id);
  }, [api, project.id]);
  useEffect(() => {
    if (!api) return;
    void api.spellcheck.status().then((status) => { if (status) setSpellStatus(status); });
  }, [api]);
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
    const ai = window.latexEditor?.ai;
    if (!ai) return;
    const conversations = new Map<string, boolean>();
    const updatesDuringLoad = new Map<string, boolean>();
    let active = true;
    let loaded = false;
    const isWorking = (conversation: AIConversation) => Boolean(conversation.activeTaskId || conversation.messages.some((message) => message.status === "streaming"));
    const publish = () => {
      const working = [...conversations.values()].some(Boolean);
      aiWorkingRef.current = working;
      if (!working) aiEditWarningShown.current = false;
    };
    const unsubscribe = ai.onUpdate((update) => {
      if (!active || update.kind !== "conversation") return;
      const conversation = update.payload as AIConversation;
      if (conversation.projectId !== project.id) return;
      const working = isWorking(conversation);
      if (!loaded) updatesDuringLoad.set(conversation.id, working);
      conversations.set(conversation.id, working);
      publish();
    });
    void ai.conversations(project.id).then((snapshot) => {
      if (!active || !snapshot) return;
      for (const conversation of snapshot.conversations) conversations.set(conversation.id, isWorking(conversation));
      for (const [id, working] of updatesDuringLoad) conversations.set(id, working);
      updatesDuringLoad.clear();
      loaded = true;
      publish();
    }).catch(() => { loaded = true; updatesDuringLoad.clear(); });
    return () => { active = false; unsubscribe(); aiWorkingRef.current = false; aiEditWarningShown.current = false; };
  }, [project.id]);
  const warnAboutConcurrentAIEdit = (path: string, content: string) => {
    if (!aiWorkingRef.current || aiEditWarningShown.current || tabsRef.current.find((tab) => tab.path === path)?.content === content) return;
    aiEditWarningShown.current = true;
    setBlockNotice(t("ai.concurrentEditWarning"));
  };
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
  const externalFiles = useExternalFiles({ api, projectId: project.id, tabs, tabsRef, savedContents, setTabs,
    onBaselineChange: path => workingDocuments.resetFile(path),
    hasDraft: () => unsavedChanges.hasDraftChanges(), onError: setBlockNotice,
    onReload: (path, content) => {
      editHistory.current.forgetFile(path); completionController.current?.invalidate();
      updateSavedSearchDocument(path, content);
      setSaveState(tabsRef.current.some(tab => tab.dirty) ? "unsaved" : "saved");
    }
  });
  const resolveExternalFile = async (path: string, keepLocal: boolean) => {
    if (unsavedChanges.hasDraftChanges()) { setBlockNotice(t("externalFiles.finishDraft")); return; }
    if (tabsRef.current.find(tab => tab.path === path)?.dirty && !window.confirm(t(keepLocal ? "externalFiles.confirmKeep" : "externalFiles.confirmReload", { path }))) return;
    try { await externalFiles.resolve(path, keepLocal); setSaveState(tabsRef.current.some(tab => tab.dirty) ? "unsaved" : "saved"); }
    catch (error) { setBlockNotice(error instanceof Error ? error.message : String(error)); }
  };
  const refreshTree = useCallback(async () => {
    if (!api) return undefined;
    const request = ++treeRefreshSequence.current;
    await externalFiles.sync(true);
    const nextTree = await api.files.tree(project.id);
    if (request === treeRefreshSequence.current) setTree(nextTree);
    return nextTree;
  }, [api, project.id, externalFiles.sync]);
  useEffect(() => {
    const handleFileDrop = (event: Event) => {
      const detail = (event as CustomEvent<FileDropDetail>).detail;
      if (!api || !Array.isArray(detail?.paths) || typeof detail.destination !== "string" || detail.paths.length === 0) return;
      const destination = detail.destination;
      void Promise.all(detail.paths.map(async (sourcePath) => {
        const name = sourcePath.split(/[\\/]/).at(-1);
        if (name) await api.files.import(project.id, sourcePath, projectPathJoin(destination, name));
      })).then(() => refreshTree()).catch(async (error: unknown) => {
        await refreshTree().catch(() => undefined);
        window.alert(error instanceof Error ? error.message : String(error));
      });
    };
    window.addEventListener("texweave:file-drop", handleFileDrop);
    return () => window.removeEventListener("texweave:file-drop", handleFileDrop);
  }, [api, project.id, refreshTree]);
  useEffect(() => { void refreshTree().catch(() => undefined); }, [refreshTree]);
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
  useEffect(() => () => {
    completionController.current?.dispose();
    spellCheckController.current?.dispose();
    referenceMouseListener.current?.dispose();
    symbolPairingListener.current?.dispose();
  }, [project.id]);
  useEffect(() => { navigationNonce.current += 1; }, [pdfFile, pdfOrigin]);
  useEffect(() => { setCompileResults([]); setCompileResult(undefined); }, [project.id, project.mainFile]);
  useEffect(() => api?.compile.onUpdate(update => {
    if (update.projectId !== project.id || compileGuard.current.busy) return;
    const metadata = compileResultMetadata(update.result);
    setCompileResult(metadata);
    setCompileResults(values => [...values.filter(value => value.mainFile !== update.result.mainFile), metadata]);
    if (pdfDocumentsRef.current.adopt(update.result, "ai-workspace")) {
      navigationNonce.current += 1;
      setLayout(value => ({ ...value, rightPane: "pdf" }));
    }
    setBottomTab(update.result.diagnostics.length ? "problems" : "compileLog");
    if (update.result.status !== "succeeded") setBottomVisible(true);
  }), [api, project.id]);
  useEffect(() => {
    let live = true;
    const restore = async () => {
      const initial = restoredWorkspace.activePath ?? project.mainFile;
      if (initial) await openFile(initial);
      if (live && !tabsRef.current.length && project.mainFile && initial !== project.mainFile) await openFile(project.mainFile);
      if (live) workspaceReady.current = true;
    };
    void restore();
    return () => { live = false; };
  }, [project.id]);
  useEffect(() => {
    const persist = () => {
      if (!workspaceReady.current) return;
      const path = activePathRef.current, editor = editorRef.current, model = editor?.getModel();
      if (path && model && sourceModelPath.current === path) {
        const position = editor!.getPosition();
        if (position) sourcePositions.current.set(path, { offset: model.getOffsetAt(position), scrollTop: editor!.getScrollTop() });
      }
      writeWorkspacePosition(project.id, project.canonicalPath, { ...(path ? { activePath: path } : {}), source: [...sourcePositions.current], preview: [...previewPositions.current] });
    };
    const timer = window.setInterval(persist, 1000);
    const stopCloseListener = api?.lifecycle.onCloseRequested(() => persist());
    window.addEventListener("pagehide", persist);
    window.addEventListener("beforeunload", persist);
    return () => { persist(); stopCloseListener?.(); window.clearInterval(timer); window.removeEventListener("pagehide", persist); window.removeEventListener("beforeunload", persist); };
  }, [project.id, project.canonicalPath]);

  const rememberPreviewPosition = () => {
    const path = activePathRef.current;
    const root = document.querySelector<HTMLElement>(".structured-preview, .bib-preview-pane");
    if (!path || !root) return;
    const offset = previewPositions.current.get(path)?.offset ?? (previewViewportAnchor.current?.fileId === path ? previewViewportAnchor.current.offset : 0);
    previewPositions.current.set(path, { offset, scrollTop: root.scrollTop });
  };

  const { openFile } = createFileOpeningController({
    api, project, activePathRef, tabsRef, openingFilesRef, sequenceRef: fileOpenSequence, savedContents,
    setAiDiffFile, setActivePath, setTabs, rememberPreviewPosition
  });

  const { createEntry, moveEntry, importFromComputer, fileContextItems } = createWorkbenchFileActions({
    api, project, fileContext, activePath, tabsRef, savedContents, editHistory, navigationHistory,
    setTabs, setActivePath, setLayout, importingProjectEntries, setImportingProjectEntries,
    setNameRequest, setDeleteRequest, refreshTree, openFile, onSwitch
  });

  const { currentNavigationOrigin, requestPreviewAtSourcePosition, navigateTo, navigateBack, navigateForward, forwardSyncToPdf, reverseSyncFromPdf } = createNavigationController({
    project, api, pdfFile, layout, layoutRef, setLayout, activePathRef, tabsRef, editorRef, sourceModelPath, lastTextPane,
    sourcePositions, previewPositions, previewViewportAnchor, navigationHistory, navigationNonce, fileOpenSequence,
    setNavigationRequest, setPdfTarget, openFile,
    onNavigationPosition: (fileId, offset) => { previewClickAnchor.current = { fileId, offset }; },
    reportSyncError: (message) => setBlockNotice(/SYNCTEX_DATA_(MISSING|STALE)/.test(message) ? t("pdf.syncDataHint") : /SYNCTEX_NO_MATCH/.test(message) ? t("pdf.syncNoMatch") : message),
    canSync: () => { if (pdfOriginRef.current === "ai-workspace") { setBlockNotice(t("pdf.aiSyncHint")); return false; } return true; },
    prepareNavigation: () => {
      if (store.get("confirmPreviewEdits") && unsavedChanges.hasDraftChanges() && !window.confirm(t("preview.unsavedMessage"))) return false;
      unsavedChanges.commitDrafts(flushSync);
      return true;
    }
  });
  forwardSyncToPdfRef.current = forwardSyncToPdf;

  const workingDocuments = useWorkingDocuments({ api, projectId: project.id, tabs, tabsRef, savedContents, activePath,
    configuration: previewEnvironments, directives: store.get("previewDirectives"), onSnapshot: setBlockSnapshot,
    onSemanticIds: setPreviewSemanticIds, onError: message => {
      if (message.includes("saved file changed outside this editor")) {
        void externalFiles.sync(true).catch(error => setBlockNotice(error instanceof Error ? error.message : String(error)));
      } else setBlockNotice(message);
    } });
  const { saveTabs, saveActive, saveAll, leaveProject, switchProject } = createProjectSessionController({
    api, project, tabs, activePath, tabsRef, savedContents, editHistory, completionController,
    setTabs, setSaveState, onHome, onSwitch, flushDocuments: workingDocuments.sync, releaseDocuments: workingDocuments.close, onSaveError: setBlockNotice,
    onSaved: (path, content) => updateSavedSearchDocument(path, content),
    beforeSave: async paths => {
      await externalFiles.sync();
      if (externalFiles.conflicts().some(conflict => paths.includes(conflict.path))) throw new Error(t("externalFiles.saveBlocked"));
    }
  });
  const { compile, exportSourceArchive, exportMainSourceArchive, exportPdf } = createDocumentActions({
    api, project, activePath: pdfDocuments.sourceTarget ?? activePath, tree, compileState, saveActive,
    saveAll: async () => { unsavedChanges.commitDrafts(flushSync); await saveAll(); },
    guard: compileGuard.current, isCurrent: mainFile => !projectMainRef.current || mainFile === projectMainRef.current,
    onIdle: () => autoCompiler.current?.idle(),
    onPdfReady: result => { navigationNonce.current += 1; return pdfDocuments.onPdfReady(result); },
    onCompileBatch: results => { setCompileResults(results.map(compileResultMetadata)); pdfDocuments.recordResults(results); },
    setCompileState, setCompileResult, setPdfDataUrl, setLayout, setBottomTab, setBottomVisible
  });
  compileRef.current = compile;
  const refreshAfterHistoryRestore = createHistoryRestoreHandler({
    api, project, tabsRef, savedContents, activePathRef, sourcePositions, previewPositions, sourceRestoredFor,
    completionController, navigationHistory, editHistory, setTabs, setTree, setActivePath, setSaveState,
    setNavigationRequest, setBlockSnapshot
  });
  const snapshotOpenedAt = useRef(performance.now());
  const [historyToolbarTarget, setHistoryToolbarTarget] = useState<HTMLSpanElement | null>(null);
  const [searchToolbarTarget, setSearchToolbarTarget] = useState<HTMLElement | null>(null);
  const [libraryToolbarTarget, setLibraryToolbarTarget] = useState<HTMLSpanElement | null>(null);
  const historyPreferences = store.get("history");
  useEffect(() => {
    if (!api || !historyPreferences.autoSnapshot) return;
    return startSnapshotTimer(snapshotOpenedAt.current, historyPreferences.intervalMinutes * 60_000, async () => {
      const overrides = tabsRef.current.filter((tab) => tab.dirty).map((tab) => ({ path: tab.path, content: tab.content }));
      await api.history.snapshot(project.id, "interval", undefined, overrides);
    });
  }, [api, project.id, historyPreferences.autoSnapshot, historyPreferences.intervalMinutes]);
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
  const trackPreviewViewport = useCallback((anchor: { fileId: string; offset: number; scrollTop: number }) => {
    if (anchor.fileId !== activePathRef.current) return;
    previewViewportAnchor.current = anchor;
    previewPositions.current.set(anchor.fileId, { offset: anchor.offset, scrollTop: anchor.scrollTop });
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

  useEffect(() => {
    if (store.get("autoSave") !== "afterDelay" || !tabs.some((tab) => tab.dirty)) return;
    const timer = setTimeout(() => { void saveTabs(true).catch(() => undefined); }, store.get("autoSaveDelaySeconds") * 1000);
    return () => clearTimeout(timer);
  }, [tabs, store.get("autoSave"), store.get("autoSaveDelaySeconds")]);
  useEffect(() => {
    const registrations = [
      commands.register("edit.undo", { execute: () => replayHistory("undo"), when: documentHistoryFocused }),
      commands.register("edit.redo", { execute: () => replayHistory("redo"), when: documentHistoryFocused }),
      commands.register("file.save", { execute: () => saveActive().catch(() => undefined) }),
      commands.register("file.saveAll", { execute: () => saveTabs(true).catch(() => undefined) }),
      commands.register("navigation.back", { execute: () => navigateBack().catch(() => undefined) }),
      commands.register("navigation.forward", { execute: () => navigateForward().catch(() => undefined) }),
      commands.register("latex.compile", { execute: () => compile().catch(() => undefined) }),
      commands.register("edit.find", { execute: () => { setSidebarMode("search"); setLayout((value) => ({ ...value, sidebarVisible: true })); setSearchFocusRequest((value) => value + 1); } }),
      commands.register("edit.replace", { execute: () => editorRef.current?.trigger("command", "editor.action.startFindReplaceAction", null), when: () => !!document.querySelector(".editor-surface .monaco-editor") }),
      commands.register("settings.open", { execute: () => { setSettingsInitial("general"); setSettingsOpen(true); } }),
      ...Object.entries(sidebarCommands).map(([mode, id]) => commands.register(id, { execute: () => mode === "help" ? void commands.execute("help.toggle") : selectActivity(mode as SidebarMode) })),
      commands.register("block.createFromSelection", { execute: () => createUserBlockFromSelection().catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error))) })
    ];
    return () => registrations.forEach((dispose) => dispose());
  });

  const closeTab = (path: string) => { navigationHistory.current.clear(); fileOpenSequence.current += 1; navigationNonce.current += 1; setNavigationRequest(undefined); rememberPreviewPosition(); const remaining = tabsRef.current.filter((tab) => tab.path !== path); tabsRef.current = remaining; setTabs(remaining); if (activePath === path) setActivePath(remaining.at(-1)?.path); };
  const setEditorContent = (content: string, edits?: BlockTextEdit[], previewChanges?: PreviewTextChange[]) => {
    if (!activePath) return;
    warnAboutConcurrentAIEdit(activePath, content);
    changeDocument(activePath, content, edits !== undefined, edits, true, true, previewChanges);
  };
  const changeDocument = (path: string, content: string, typing = false, edits?: BlockTextEdit[], record = true, captureLargeDelete = true, previewChanges?: PreviewTextChange[]) => {
    const before = tabsRef.current.find(tab => tab.path === path)?.content;
    if (before === undefined || before === content) return;
    if (path === activePathRef.current) previewSourceTransaction.current = previewChanges ? createPreviewTransaction(before, content, previewChanges) : undefined;
    const patch = edits ? patchFromEdits(before, content, edits) : textPatch(before, content);
    if (captureLargeDelete && api && patch.removed.length - patch.inserted.length >= 500 && settings.get("history").beforeLargeDelete) {
      const overrides = tabsRef.current.filter((tab) => tab.dirty || tab.path === path).map((tab) => ({ path: tab.path, content: tab.content }));
      void api.history.snapshot(project.id, "pre-delete", `Before removing content from ${path}`, overrides).catch((error: unknown) => setBlockNotice(String(error)));
    }
    if (record) editHistory.current.recordText(path, before, content, typing, Date.now(), patch);
    const editDelta = edits?.reduce((sum, edit) => sum + edit.newLength - (edit.end - edit.start), 0);
    const mappedEdits = edits && editDelta === content.length - before.length ? edits : [{ start: patch.start, end: patch.start + patch.removed.length, newLength: patch.inserted.length }];
    navigationHistory.current.mapEdit(path, mappedEdits);
    workingDocuments.recordChange(path, before, content, mappedEdits);
    if (path === activePathRef.current) activeContentRef.current = content;
    tabsRef.current = tabsRef.current.map(tab => tab.path === path ? { ...tab, content, dirty: savedContents.current.get(path) !== content } : tab);
    setTabs(tabsRef.current);
    setSaveState(tabsRef.current.some(tab => tab.dirty) ? "unsaved" : "saved");
  };
  const flushRangeMappings = workingDocuments.sync;
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
      navigationHistory.current.clear();
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
        changeDocument(operation.fileId, next, false, [{ start: operation.patch.start, end: operation.patch.start + replaced.length, newLength: restored.length }], false, false);
        setActivePath(operation.fileId);
      });
      const offset = operation.patch.start;
      void navigateTo(operation.fileId, { offset });
    }
    setInspectorBlock(undefined); setFigureSelection(undefined); setTableSelection(undefined);
    setBlockContext(undefined); setBoundaryRepair(undefined);
    window.dispatchEvent(new CustomEvent("texweave:history-replayed"));
  }).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)));
  const { createUserBlockAtRange, createUserBlockFromSelection, updateInspectorBlock } = createUserBlockController({
    api, project, activeTab, inspectorBlock, blockSnapshot, creationSelection, sourceEditorVisible,
    editHistory, flushRangeMappings, highlightCreatedBlock, setInspectorBlock, setBoundaryRepair, setBlockContext,
    setSourceSelection, setPreviewSelection, setBlockSnapshot, setStructuralHistory, setBlockNotice
  });
  const documentHistoryFocused = () => {
    const target = document.activeElement;
    // Local drafts, table cells, labels, search boxes and chat retain their own
    // text undo. The main Code editor shares the committed document history.
    return !target?.closest("input, textarea, select, [contenteditable='true'], .monaco-editor") || !!target.closest(".editor-surface .monaco-editor:not(.monaco-diff-editor)");
  };
  const {
    searchQuery, setSearchQuery, replacement, setReplacement, replaceOpen, setReplaceOpen,
    filterQuery, setFilterQuery, activeSearchResult, projectSearchDocuments,
    searchDocuments, searchResponse, filterOptions, searching, replacing, searchReady, searchNotice, updateSavedSearchDocument,
    selectSearchResult, replaceCurrentSearchResult, replaceAllSearchResults
  } = useSearchController({
    api, project, tree, tabs, activePath, previewEnvironments, previewDirectives: store.get("previewDirectives"), tabsRef, savedContents,
    changeDocument, navigateTo, setProjectMathSources,
    prepareNavigation: () => {
      if (store.get("confirmPreviewEdits") && unsavedChanges.hasDraftChanges() && !window.confirm(t("preview.unsavedMessage"))) return false;
      unsavedChanges.commitDrafts(flushSync); return true;
    }
  });
  const referenceIndex = useMemo(() => new ProjectReferenceIndex(), [project.id]);
  referenceIndex.update(searchDocuments.map(file => ({ path: file.fileId, content: file.content })), project.mainFile);
  const resolveReference = useCallback((label: string) => referenceIndex.resolve(activePathRef.current ?? "", label), [referenceIndex]);
  const jumpToReference = (anchor: { fileId: string; offset: number; linkText: string; targetLabel: string }, view: "source" | "preview") => {
    if (anchor.fileId !== activePathRef.current) return;
    const target = referenceIndex.resolve(anchor.fileId, anchor.targetLabel);
    const from = currentNavigationOrigin(anchor.offset);
    if (!target || !from) return;
    void navigateTo(target.path, { offset: target.offset }, view, true, {
      ...from, link: { start: anchor.offset, text: anchor.linkText, targetLabel: target.label, targetPath: target.path }
    }).catch(error => setBlockNotice(error instanceof Error ? error.message : String(error)));
  };
  const {
    relationFocusId, relationSelectedId, setRelationSelectedId,
    relationDocumentFiltered, setRelationDocumentFiltered, relationFocusHistory,
    relationDirection, setRelationDirection, relationDepth, setRelationDepth, relationFilters, setRelationFilters,
    relationLocateRequest, setRelationLocateRequest, relationChooser, setRelationChooser,
    relationGraphOpen, setRelationGraphOpen, setRelationGraphFocusId,
    relationNeighborhood, currentRelationScope, relationProjection, chooserPrerequisiteState,
    focusRelationBlock, relationBack, locateRelationBlock, mutateRelation, toggleRelation, removeRelation,
    undoStructure, redoStructure
  } = useRelationController({
    api, projectId: project.id, blockSnapshot, setBlockSnapshot, setStructuralHistory,
    editHistory, navigationHistory, flushRangeMappings, tabs, projectSearchDocuments, layout, setLayout,
    lastTextPane, activePath, navigateTo, setBlockNotice, setInspectorBlock, replayHistory
  });

  const { applyAIChanges, undoAIChanges, viewAIChanges } = createAIChangeController({
    api, project, tabsRef, savedContents, editHistory, navigationHistory, activePathRef, aiOperationQueue,
    setActivePath, setTabs, setSaveState, setBlockNotice, setAiDiffFile, setLayout, refreshTree, openFile, changeDocument,
    onSourcesChanged: () => autoCompiler.current?.request()
  });
  const applyAIRef = useRef(applyAIChanges);
  applyAIRef.current = applyAIChanges;
  useEffect(() => {
    if (!api) return;
    let mounted = true;
    const processChanges = (changes: AIChangeSet) => {
      if (!mounted || !changes.permissionMode || changes.permissionMode === "ask" || changes.autoApplyError || aiAutoAttempts.current.has(changes.id)) return;
      const ids = automaticHunkIds(changes);
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
  const insertText = (text: string, cursorOffset?: number, triggerSuggestions = false) => {
    if (!project.writable || sourceModelPath.current !== activePathRef.current) return;
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
    if (!project.writable || sourceModelPath.current !== activePathRef.current) return;
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
  const citeReference = (key: string) => {
    const path = activePathRef.current;
    if (!project.writable || !path || !/\.tex$/i.test(path)) { setBlockNotice(t("ui.Workbench.open_a_writable_tex_file_to_insert")); return; }
    let text: string;
    try { text = citationText(key); } catch { setBlockNotice(t("ui.citationInsertion.invalid_citation_key")); return; }
    const currentLayout = layoutRef.current;
    const inCode = currentLayout.mode === "single" ? currentLayout.singlePane === "source" : currentLayout.leftPane === "source";
    if (!inCode && insertPreviewCitation(project.id, path, text)) return;
    if (inCode) {
      if (sourceModelPath.current !== path || !editorRef.current?.getModel() || aiDiffFile) { setBlockNotice(t("ui.Workbench.wait_for_the_source_editor_to_load")); return; }
      insertText(text, text.length);
      return;
    }
    unsavedChanges.commitDrafts(flushSync);
    const tab = tabsRef.current.find(item => item.path === path);
    if (!tab) return;
    const clicked = previewClickAnchor.current;
    const viewport = previewViewportAnchor.current;
    const offset = citationInsertionOffset(tab.content, clicked?.fileId === path ? clicked.offset : viewport?.fileId === path ? viewport.offset : undefined);
    changeDocument(path, tab.content.slice(0, offset) + text + tab.content.slice(offset), false,
      [{ start: offset, end: offset, newLength: text.length }], true, false,
      [{ from: offset, to: offset, insertedText: text }]);
    previewClickAnchor.current = { fileId: path, offset: offset + text.length };
  };
  const writeLinkedBibliography = async (path: string, content: string) => {
    if (!api || !project.writable) throw new Error(t("ui.Workbench.project_is_read_only"));
    const tab = tabsRef.current.find(item => item.path === path);
    if (tab?.dirty) throw new Error(t("ui.Workbench.save_or_close_before_updating_library_links", { value1: path }));
    await api.files.write(project.id, path, content);
    savedContents.current.set(path, content);
    // Keep an open generated bibliography in sync with the successful disk write.
    tabsRef.current = tabsRef.current.map(item => item.path === path && item.content === tab?.content ? { ...item, content, dirty: false } : item);
    setTabs(tabsRef.current);
    await refreshTree();
  };
  const { applyImageChoice, pasteImage, applyPreviewTableChange, applyTableChoice, dropImages, dropImagesToProject, insertEnvironment } = createDocumentInsertions({
    api, project, store, activeTab, getActiveTab: () => tabsRef.current.find(tab => tab.path === activePathRef.current), sourceEditorVisible, editorRef, previewInsertionAnchor,
    previewViewportAnchor, imageDialog, insertText, setEditorContent, setFigureSelection, setTableSelection,
    setImageDialog, setTableDialogOpen, refreshTree, setBlockNotice
  });
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !project.writable || !activeTab?.path.endsWith(".tex") || settingsOpen || tableDialogOpen) return;
      if (!Array.from(event.clipboardData?.items ?? []).some(item => item.kind === "file" && item.type.startsWith("image/"))) return;
      const target = event.target instanceof Element ? event.target : undefined;
      if (!target || target.closest(".preview-local-editor, .ai-inline-diff")) return;
      if (target !== document.body && !target.closest(".editor-surface, .structured-preview, .figure-inspector, .image-insert-dialog")) return;
      if (target.closest("input, textarea, [contenteditable=true]") && !target.closest(".editor-surface")) return;
      event.preventDefault();
      event.stopPropagation();
      const selection = target.closest(".preview-figure, .figure-inspector") ? figureSelection : undefined;
      void pasteImage(selection).catch((reason: unknown) => setBlockNotice(reason instanceof Error ? reason.message : String(reason)));
    };
    window.addEventListener("paste", paste, true);
    return () => window.removeEventListener("paste", paste, true);
  }, [project.writable, activeTab?.path, settingsOpen, tableDialogOpen, figureSelection, pasteImage]);
  const figureContextDocuments = () => {
    const documents = new Map(searchDocuments.map(file => [file.fileId, { path: file.fileId, content: file.content }]));
    for (const tab of tabsRef.current) documents.set(tab.path, tab);
    return [...documents.values()];
  };
  const figurePreambleContext = useMemo(() => {
    const owner = activeTab?.content.includes("\\documentclass") && !activeTab.content.includes("{subfiles}") ? activeTab.path : project.mainFile ?? activePath;
    return owner ? referenceIndex.documentFiles(owner).map(path => searchDocuments.find(file => file.fileId === path)?.content ?? "").join("\n") : activeTab?.content ?? "";
  }, [referenceIndex, searchDocuments, activePath, activeTab?.content, project.mainFile]);
  const figureGraphicPaths = useMemo(() => parseGraphicPaths(figurePreambleContext), [figurePreambleContext]);
  const commitFigureEdit = (plan: FigureEditPlan) => {
    if (plan.preamble) {
      const owner = plan.preamble;
      if (!tabsRef.current.some(tab => tab.path === owner.document.path)) {
        savedContents.current.set(owner.document.path, owner.before);
        tabsRef.current = [...tabsRef.current, { path: owner.document.path, content: owner.before, dirty: false }];
      }
      changeDocument(owner.document.path, owner.document.content, false, undefined, true, false);
    }
    changeDocument(plan.document.path, plan.document.content, false, undefined, true, false);
    setFigureSelection(plan.selection);
  };
  const applyPreviewFigureChange = (selection: FigureSelection, replacement: string): void | Promise<void> => {
    if (!project.writable || activePathRef.current !== selection.fileId) return;
    const tab = tabsRef.current.find(value => value.path === selection.fileId);
    if (!tab || tab.content.slice(selection.start, selection.end) !== selection.source) throw new Error(t("image.layout.changed"));
    const required = subfigurePackage(replacement);
    if (!required || required === subfigurePackage(selection.source)) {
      commitFigureEdit({ before: tab.content, document: { path: tab.path, content: tab.content.slice(0, selection.start) + replacement + tab.content.slice(selection.end) }, selection: { ...selection, source: replacement, end: selection.start + replacement.length } });
      return;
    }
    if (!api) return;
    return planFigureEdit(selection, replacement, { mainFile: project.mainFile, activePath: () => activePathRef.current, documents: figureContextDocuments, documentFiles: path => referenceIndex.documentFiles(path), read: async path => (await api.files.read(project.id, path)).content })
      .then(commitFigureEdit).catch(error => { throw new Error(error instanceof Error && error.message.startsWith("image.layout.") ? t(error.message as MessageKey) : error instanceof Error ? error.message : String(error)); });
  };
  const changePreviewFigure = (selection: FigureSelection, replacement: string) => {
    try { void Promise.resolve(applyPreviewFigureChange(selection, replacement)).catch(error => setBlockNotice(error instanceof Error ? error.message : String(error))); }
    catch (error) { setBlockNotice(error instanceof Error ? error.message : String(error)); }
  };
  const onEditorMount = createWorkbenchEditorMount({
    api, project, store, editorRef, sourceRestoredFor, setEditorMountVersion, searchDecorationsRef,
    completionController, spellCheckController, referenceMouseListener, symbolPairingListener, activePathRef, sourceModelPath,
    setSourceMathPreview, clearHoverMathPreviewRef, mathPopoverInteracting, mathPopoverInteractionChangeRef,
    setCursor, sourcePositions, activeContentRef, setSourceSelection, forwardSyncToPdf: (path, line, column) => forwardSyncToPdfRef.current(path, line, column), treeRef, environmentsRef,
    getOpenDocuments: () => tabsRef.current.map(tab => ({ path: tab.path, content: tab.content })),
    resolveReference: (path, label) => referenceIndex.resolve(path, label),
    onReferenceJump: jump => { if (activePathRef.current) jumpToReference({ fileId: activePathRef.current, offset: jump.offset, linkText: jump.text, targetLabel: jump.label }, "source"); },
    setDetectedSpellLanguage, setSpellContextMenu
  });

  const outline = useMemo(() => buildOutline(activeTab?.content ?? ""), [activeTab?.content]);

  const navigateToOutline = (line: number) => { if (activePath) void navigateTo(activePath, { line }); };
  const openAIFileReference = async (path: string, line?: number) => {
    await navigateTo(path, line ? { line } : {});
  };
  aiFileNavigationRef.current = openAIFileReference;
  useEditorStateEffects({
    editorRef, sourceRestoredFor, sourceModelPath, sourcePositions, pendingVisualToCodeAnchor,
    searchDecorationsRef, aiFileNavigationRef, sourceEditorVisible, activePath, activeTab, navigationRequest,
    editorMountVersion, searchResponse, activeSearchResult, setNavigationRequest
  });

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
    await navigateTo(path, { line: diagnostic.line, column: diagnostic.column });
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

  const activityTitle = (mode: SidebarMode) => { const shortcut = commandBindings(sidebarCommands[mode]).map(displayBinding).join(" / "); return `${t(`activity.${mode}` as MessageKey)}${shortcut ? ` (${shortcut})` : ""}`; };
  const selectActivity = (mode: SidebarMode) => { if (mode === "relations") setInspectorBlock(undefined); if (sidebarMode === mode && layout.sidebarVisible) setLayout((value) => ({ ...value, sidebarVisible: false })); else { setSidebarMode(mode); setLayout((value) => ({ ...value, sidebarVisible: true })); } };
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
  const spellStatusControl = <div className="spell-status-control"><button onClick={() => setSpellMenuOpen((value) => !value)}>{spellMode === "disabled" ? t("spell.status.off") : spellMode === "manual" ? t("spell.status.manual", { language: spellLanguageLabel(spellDisplayLanguage) }) : t("spell.status.auto", { language: spellLanguageLabel(spellDisplayLanguage) })}</button>{spellMenuOpen && <div className="spell-status-menu"><button onClick={() => void configureSpell("auto", detectedSpellLanguage)}>{spellMode === "auto" && "✓"}{t("spell.menu.auto", { language: spellLanguageLabel(detectedSpellLanguage) })}</button>{spellLanguages.map((language) => <button key={language} onClick={() => void configureSpell("manual", language)}>{spellMode === "manual" && spellManualLanguage === language && "✓"}{spellLanguageLabel(language)}</button>)}<div className="menu-divider"/><button onClick={() => void configureSpell("disabled", spellDisplayLanguage)}>{spellMode === "disabled" && "✓"}{t("spell.menu.disable")}</button></div>}</div>;
  const menuItems = (menu: Exclude<MenuName, "projects">) => {
    if (menu === "file") return [{ label: t("menu.newFile"), action: () => void createEntry(false, "") }, { label: t("menu.openFile"), disabled: importingProjectEntries || !project.writable, action: () => void importFromComputer("file") }, { label: t("menu.openFolder"), disabled: importingProjectEntries || !project.writable, action: () => void importFromComputer("folder") }, { label: t("menu.save"), action: () => { commands.execute("file.save"); } }, { label: t("menu.saveAll"), action: () => { commands.execute("file.saveAll"); } }, { label: "", divider: true }, { label: t("export.pdf"), action: () => void exportPdf() }, { label: t("export.sourceArchive"), action: () => void exportSourceArchive() }, { label: t("export.mainSourceArchive"), action: () => void exportMainSourceArchive() }, { label: "", divider: true }, { label: t("menu.closeProject"), action: leaveProject }];
    if (menu === "edit") return [{ label: t("menu.undo"), action: () => { commands.execute("edit.undo"); } }, { label: t("menu.redo"), action: () => { commands.execute("edit.redo"); } }, { label: t("menu.find"), action: () => { commands.execute("edit.find"); } }, { label: t("menu.replace"), action: () => { commands.execute("edit.replace"); } }, { label: "", divider: true }, { label: t("editor.formatSource"), disabled: !isLatexSource || !project.writable, action: formatSource }];
    if (menu === "view") return [{ label: t("menu.source"), action: () => switchTextView("source", true, true) }, { label: t("menu.preview"), action: () => switchTextView("preview", true, true) }, { label: t("menu.pdf"), action: () => setLayout((value) => ({ ...value, mode: "single", singlePane: "pdf" })) }, { label: "", divider: true }, { label: t("menu.single"), action: () => setLayout((value) => ({ ...value, mode: "single" })) }, { label: t("menu.split"), action: () => setLayout((value) => ({ ...value, mode: "split" })) }];
    return [{ label: t("menu.automaticHistory"), action: () => { setSidebarMode("history"); setLayout((value) => ({ ...value, sidebarVisible: true })); } }, { label: t("menu.namedVersions"), action: () => { setSidebarMode("history"); setLayout((value) => ({ ...value, sidebarVisible: true })); } }];
  };

  const switchTextView = (target: "source" | "preview", single: boolean, forceSingle = false) => {
    const current = layout.mode === "single" ? layout.singlePane : layout.leftPane;
    if (target === "source" && current === "preview") pendingVisualToCodeAnchor.current = previewToCodeAnchor();
    if (target === "preview" && current === "source" && !aiReviewFile) requestPreviewAtSourcePosition();
    setLayout((value) => forceSingle ? { ...value, mode: "single", singlePane: target } : single ? { ...value, singlePane: target } : { ...value, leftPane: target });
  };
  const viewSwitch = (active: "source" | "preview", single = false) => <div className="editor-view-controls">
    <select className="filter-view-mode" aria-label={t("filter.unmatchedDisplay")} title={t("filter.unmatchedDisplay")} value={filterQuery.viewMode} onChange={(event) => setFilterQuery((current) => ({ ...current, viewMode: event.target.value as FilterQuery["viewMode"] }))}>
      {(["original", "dim", "collapse", "remove"] as const).map((mode) => <option key={mode} value={mode} title={t(`filter.${mode}`)}>{t(`filter.short.${mode}`)}</option>)}
    </select>
    <div className="view-switch"><button className={active === "source" ? "active" : ""} onClick={() => switchTextView("source", single)}>{t("menu.code")}</button><button className={active === "preview" ? "active" : ""} onClick={() => switchTextView("preview", single)}>{t("menu.visual")}</button></div>
  </div>;
  const isLatexSource = !!activeTab && /\.(?:tex|sty|cls|ltx|dtx|ins|def|fd)$/i.test(activeTab.path);
  const formatSource = () => {
    if (!activeTab || !isLatexSource || !project.writable) return;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor?.getDomNode()?.isConnected && model?.getLanguageId() === "latex" && model.getValue() === activeTab.content) {
      editor.trigger("texweave", "editor.action.formatDocument", {});
      return;
    }
    const formatted = formatLatexSource(activeTab.content, { insertSpaces: true, tabSize: store.get("tabSize") });
    if (formatted !== activeTab.content) setEditorContent(formatted);
  };
  const blockButtonDisabled = blockCreationAvailability.kind === "none" || blockCreationAvailability.kind === "checking" || blockCreationAvailability.kind === "invalid";
  const blockButton = <button key="custom-block" className={`custom-block-button ${blockCreationAvailability.kind === "repair" ? "warning" : ""} ${blockCreationAvailability.kind === "edit" ? "editing" : ""}`} disabled={blockButtonDisabled} title={blockButtonDisabled ? t("block.selectRange") : t("block.createHint", { shortcut: displayBinding(bindings()["block.createFromSelection"] ?? "") })} onClick={() => {
    if (blockCreationAvailability.kind === "edit") { setInspectorBlock(blockCreationAvailability.block); return; }
    void createUserBlockFromSelection().catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)));
  }}><b>{blockCreationAvailability.kind === "repair" ? "+⚠" : blockCreationAvailability.kind === "edit" ? "✎" : "+"}</b><span>{t(blockCreationAvailability.kind === "edit" ? "block.edit" : "block.add")}{blockCreationAvailability.kind === "edit" ? " ▾" : ""}</span></button>;
  const quickActions = [blockButton, ...toolbarActions.map((action) => { const shortTitleKey = action.shortTitleKey; const icon = "icon" in action ? action.icon : undefined; return action.id === "environment" ? <EnvironmentQuickAction key={action.id} definitions={previewEnvironments} onInsert={insertEnvironment}/> : action.id === "figure" ? <ImageQuickAction key={action.id} onOpen={() => setImageDialog({ kind: "insert" })}/> : action.id === "table" ? <button key={action.id} title={t(action.titleKey as MessageKey)} onClick={() => setTableDialogOpen(true)}><b>{action.glyph}</b><span>{t(shortTitleKey as MessageKey)}</span></button> : <button key={action.id} title={t(action.titleKey as MessageKey)} onClick={() => insertToolbarAction(action.id)}>{icon ? <Icon name={icon}/> : <b>{action.glyph}</b>}<span>{t(shortTitleKey as MessageKey)}</span></button>; })];
  const isBibFile = activeTab?.path.toLocaleLowerCase().endsWith(".bib") ?? false;
  const editorQuickActions = isBibFile ? [] : quickActions;
  const sourceTabs = <div className="editor-tabs">{tabs.map((tab) => <button className={tab.path === activePath ? "active" : ""} key={tab.path} onClick={() => { navigationHistory.current.clear(); rememberPreviewPosition(); fileOpenSequence.current += 1; setAiDiffFile(undefined); setNavigationRequest(undefined); setActivePath(tab.path); }}><span>{tab.path.split("/").at(-1)}</span>{tab.dirty && <i/>}<span className="tab-close" title={t("editor.closeTab")} onClick={(event) => { event.stopPropagation(); closeTab(tab.path); }}><Icon name="close"/></span></button>)}</div>;
  const sourceFontSize = store.get("fontSize"), sourceTabSize = store.get("tabSize"), sourceWordWrap = store.get("wordWrap"), sourceMinimap = store.get("sourceMinimap");
  const sourceEditorOptions = useMemo<Monaco.editor.IStandaloneEditorConstructionOptions>(() => ({ readOnly: !project.writable, minimap: { enabled: sourceMinimap }, fontSize: sourceFontSize, tabSize: sourceTabSize, lineHeight: Math.round(sourceFontSize * 1.5), wordWrap: sourceWordWrap ? "on" : "off", quickSuggestions: { other: true, comments: true, strings: true }, suggestOnTriggerCharacters: true, autoClosingBrackets: "never", autoClosingQuotes: "always", autoSurround: "never", automaticLayout: true, padding: { top: 14 }, renderWhitespace: showSourceWhitespace ? "all" : "none", scrollBeyondLastLine: false  }), [project.writable, sourceFontSize, sourceTabSize, sourceWordWrap, sourceMinimap, showSourceWhitespace]);
  const sourceEditor = <div className="editor-surface" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={dropImages}>{aiReviewFile ? <div className="ai-inline-diff"><div className="ai-inline-diff-heading"><strong>{t("ai.inlineDiffTitle")}</strong><span>{aiReviewFile.path}</span><button className="ai-diff-close" onClick={() => setAiDiffFile(undefined)}>{t("ai.closeDiff")}</button></div><DiffEditor height="calc(100% - 34px)" language={aiReviewFile.path.endsWith(".bib") ? "bibtex" : aiReviewFile.path.endsWith(".json") ? "json" : "latex"} original={aiReviewContent?.original ?? ""} modified={aiReviewContent?.modified ?? ""} theme={editorThemeName(store.get("theme"))} options={{ readOnly: true, originalEditable: false, renderSideBySide: true, automaticLayout: true, minimap: { enabled: store.get("sourceMinimap") }, fontSize: store.get("fontSize"), lineHeight: Math.round(store.get("fontSize") * 1.5), wordWrap: store.get("wordWrap") ? "on" : "off", scrollBeyondLastLine: false }} /></div> : activeTab ? <Editor height="100%" language={activeTab.path.endsWith(".bib") ? "bibtex" : activeTab.path.endsWith(".json") ? "json" : "latex"} value={activeTab.content} onChange={(value, event) => setEditorContent(value ?? "", event.changes.map((change) => ({ start: change.rangeOffset, end: change.rangeOffset + change.rangeLength, newLength: change.text.length })), event.changes.map((change) => ({ from: change.rangeOffset, to: change.rangeOffset + change.rangeLength, insertedText: change.text })))} onMount={onEditorMount} theme={editorThemeName(store.get("theme"))} options={sourceEditorOptions} /> : <div className="editor-empty"><Logo/><p>{t("editor.noFile")}</p></div>}</div>;
  const whitespaceToggle = <button className={showSourceWhitespace ? "active" : ""} title={t("editor.toggleWhitespace")} aria-label={t("editor.toggleWhitespace")} aria-pressed={showSourceWhitespace} onClick={() => setShowSourceWhitespace(value => !value)}><Icon name="whitespace"/></button>;
  const sourceToolbar = <div className="latex-toolbar">{editorQuickActions}<div className="toolbar-spacer"/>{whitespaceToggle}{viewSwitch("source", layout.mode === "single")}</div>;
  const previewToolbar = <div className="latex-toolbar">{editorQuickActions}<div className="toolbar-spacer"/>{whitespaceToggle}{viewSwitch("preview", layout.mode === "single")}</div>;
  const enginePicker = <label className="engine-picker" title={t("settings.engine")}><span>{t("build.engine")}</span><select aria-label={t("settings.engine")} value={store.get("engine")} onChange={(event) => void store.set("engine", event.target.value as "pdflatex" | "xelatex" | "lualatex", "project")}><option value="pdflatex">pdfLaTeX</option><option value="xelatex">XeLaTeX</option><option value="lualatex">LuaLaTeX</option></select></label>;
  const outputToolbar = <div className="output-toolbar"><button className="compile-button" onClick={() => { commands.execute("latex.compile"); }} disabled={compileState === "running"}><Icon name="play"/><span>{t(compileState === "running" ? "build.compiling" : "build.compile")}</span></button>{enginePicker}<button onClick={() => { setBottomTab("compileLog"); setBottomVisible(true); }}>{t("build.log")}</button><div className="toolbar-spacer"/><button className={layout.rightPane === "pdf" ? "active" : ""} onClick={() => setLayout((value) => ({ ...value, rightPane: value.rightPane === "pdf" ? "preview" : "pdf" }))}>{layout.rightPane === "pdf" ? t("menu.preview") : t("menu.pdf")}</button></div>;
  const sourcePaneContent = <section className="work-pane source-pane">{sourceTabs}{sourceEditor}</section>;
  const sourcePane = <section className="work-pane source-pane">{sourceTabs}{sourceToolbar}{sourceEditor}</section>;
  const previewRequest = activeTab && navigationRequest?.path === activeTab.path ? { fileId: activeTab.path, offset: navigationRequest.offset ?? sourceOffsetAtLine(activeTab.content, navigationRequest.line ?? 1, navigationRequest.column), nonce: navigationRequest.nonce } : undefined;
  const applyPreviewSourceChange = (next: string, changes?: PreviewTextChange[]) => {
    if (!activePath) return;
    warnAboutConcurrentAIEdit(activePath, next);
    const edits = changes?.map((change) => ({ start: change.from, end: change.to, newLength: change.insertedText.length }));
    changeDocument(activePath, next, false, edits, true, true, changes);
  };
  const previewProps = { getOpenDocuments: () => tabsRef.current.map(tab => ({ path: tab.path, content: tab.content })), filePath: activeTab?.path, source: activeTab?.content, sourceTransaction: previewSourceTransaction.current, definitions: previewEnvironments, mathContext, filterQuery, searchQuery, searchResults: searchResponse.results, activeSearchResult, highlightRange: createdBlockHighlight, locateRequest: previewRequest, restoreOffset: activeTab ? previewPositions.current.get(activeTab.path)?.offset ?? sourcePositions.current.get(activeTab.path)?.offset : undefined, restoreScrollTop: activeTab ? previewPositions.current.get(activeTab.path)?.scrollTop : undefined, onLocated: (nonce: number) => setNavigationRequest((current) => current?.nonce === nonce ? undefined : current), onHighlightLocated: (nonce: number) => setCreatedBlockHighlight((current) => current?.nonce === nonce ? undefined : current), relation: blockSnapshot ? { active: relationModeActive && relationDocumentFiltered, snapshot: blockSnapshot, transientToBlockId: previewSemanticIds, focusId: relationFocusId, direction: relationDirection, matchIds: relationProjection.matchIds, contextIds: relationProjection.contextIds, locateRequest: relationLocateRequest, onLocated: (nonce: number) => setRelationLocateRequest((current) => current?.nonce === nonce ? undefined : current), onFocus: focusRelationBlock, onToggle: toggleRelation } : undefined, onSourceChange: applyPreviewSourceChange, onSelectionChange: setPreviewSelection, onSelectionContextMenu: (selection: DocumentSelection, x: number, y: number) => { setPreviewSelection(selection); setBlockContext({ selection, x, y }); }, onViewportAnchorChange: trackPreviewViewport, onClickSourcePosition: trackPreviewClick, onLocateDiagnostic: (source: SourceSpan) => { void navigateTo(source.filePath, { offset: source.startOffset }, "source"); }, resolveReference, onJumpFromPosition: (anchor: { fileId: string; offset: number; targetOffset: number; linkText: string; targetLabel: string }) => jumpToReference(anchor, "preview"), onPasteImage: project.writable ? (offset: number) => pasteImage(undefined, true, offset) : undefined, onFigureChange: project.writable ? changePreviewFigure : undefined, onFigureSelect: (selection?: FigureSelection) => { if (selection) { setInspectorBlock(undefined); setTableSelection(undefined); } setFigureSelection(selection); }, onFigureSlotSelect: (selection: FigureSelection) => { if (!project.writable) return; setInspectorBlock(undefined); setTableSelection(undefined); setFigureSelection(selection); setImageDialog({ kind: "replace", selection, imageIndex: selection.imageIndex ?? 0 }); }, onTableSelect: (selection?: TableSelection) => { if (selection) { setInspectorBlock(undefined); setFigureSelection(undefined); } setTableSelection(selection); }, onTableChange: applyPreviewTableChange, api, projectId: project.id, tree, onSpellContextMenu: setSpellContextMenu, onDetectedLanguage: setDetectedSpellLanguage, onForwardSync: forwardSyncToPdf };
  const anchoredPreviewProps = { ...previewProps, onInsertionAnchorChange: trackPreviewInsertion, showWhitespace: showSourceWhitespace };
  const bibPreview = activeTab?.path.toLocaleLowerCase().endsWith(".bib") ? <BibtexPreviewPane source={activeTab.content} filePath={activeTab.path} projectId={project.id} documents={searchDocuments} restoreScrollTop={previewPositions.current.get(activeTab.path)?.scrollTop} onScrollPositionChange={(scrollTop) => { if (activePathRef.current === activeTab.path) previewPositions.current.set(activeTab.path, { offset: 0, scrollTop }); }} onSourceChange={setEditorContent} onLocate={({ filePath, offset }) => {
    void navigateTo(filePath, { offset }, filePath === activePath ? "source" : "preserve");
  }} /> : <PreviewPane {...anchoredPreviewProps}/>;
  const previewContent = <section className="work-pane" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={dropImages}>{sourceTabs}{bibPreview}</section>;
  const previewPane = <section className="work-pane" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={dropImages}>{sourceTabs}{previewToolbar}{bibPreview}</section>;
  const secondaryContent = <section className="work-pane output-pane"><Placeholder type={layout.rightPane} key={`${project.id}:${pdfSourceFile}`} pdfLinkDestination={pdfDocuments.pdfLinkDestination} onPdfLink={href => { if (!pdfDocuments.openPdfLink(href)) setBlockNotice(t("pdf.localLinkUnavailable")); }} pdfDocuments={pdfDocuments.documents} pdfSelectedId={pdfDocuments.selectedId} onPdfSelect={pdfDocuments.selectPdf} pdfViewState={pdfViewState} pdfLabel={pdfOrigin === "ai-workspace" ? t("pdf.aiPreview") : pdfSourceFile} pdfDataUrl={pdfDataUrl} pdfTarget={pdfTarget} onPdfInteract={() => setPdfTarget(undefined)} onPdfDoubleClick={(page, x, y) => void reverseSyncFromPdf(page, x, y)}/></section>;
  const singlePane = layout.singlePane === "source" ? sourcePane : layout.singlePane === "preview" ? previewPane : <section className="work-pane single-output"><div className="output-toolbar"><div className="view-switch"><button onClick={() => setLayout((value) => ({ ...value, singlePane: "source" }))}>{t("menu.code")}</button><button onClick={() => setLayout((value) => ({ ...value, singlePane: "preview" }))}>{t("menu.visual")}</button><button className="active">{t("menu.pdf")}</button></div><div className="toolbar-spacer"/><button className="compile-button" onClick={() => { commands.execute("latex.compile"); }}><Icon name="play"/>{t("build.compile")}</button></div><Placeholder type="pdf" key={`${project.id}:${pdfSourceFile}`} pdfLinkDestination={pdfDocuments.pdfLinkDestination} onPdfLink={href => { if (!pdfDocuments.openPdfLink(href)) setBlockNotice(t("pdf.localLinkUnavailable")); }} pdfDocuments={pdfDocuments.documents} pdfSelectedId={pdfDocuments.selectedId} onPdfSelect={pdfDocuments.selectPdf} pdfViewState={pdfViewState} pdfLabel={pdfOrigin === "ai-workspace" ? t("pdf.aiPreview") : pdfSourceFile} pdfDataUrl={pdfDataUrl} pdfTarget={pdfTarget} onPdfInteract={() => setPdfTarget(undefined)} onPdfDoubleClick={(page, x, y) => void reverseSyncFromPdf(page, x, y)}/></section>;
  const splitLeftContent = layout.leftPane === "preview" ? previewContent : sourcePaneContent;
  const splitToolbar = <div className="split-toolbar"><div className="split-toolbar-left latex-toolbar">{editorQuickActions}<div className="toolbar-spacer"/>{whitespaceToggle}{viewSwitch(layout.leftPane)}</div><div className="split-toolbar-right">{outputToolbar}</div></div>;

  return <div className="workbench" data-theme={store.get("theme")} data-side-panel-display={store.get("sidePanelDisplay")}>
    {deleteRequest && <div className="modal-backdrop"><section className="modal-card" role="dialog" aria-label={t("files.deleteTitle")}>
      <p>{t("files.deleteMessage", { path: deleteRequest.path })}</p>
      <button onClick={() => { deleteRequest.resolve(false); setDeleteRequest(undefined); }}>{t("project.cancel")}</button>
      <button onClick={() => { deleteRequest.resolve(true); setDeleteRequest(undefined); }}>{t("files.delete")}</button>
    </section></div>}
    {nameRequest && createPortal(<EntryNameInput message={nameRequest.message} fallback={nameRequest.fallback} finish={(value) => { nameRequest.resolve(value); setNameRequest(undefined); }}/>, document.querySelector(".file-tree") ?? document.body)}
    {boundaryRepair && <div className="block-repair-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setBoundaryRepair(undefined); }}><section className="block-repair-popover" role="dialog" aria-modal="true" aria-label={t("block.repairTitle")}><strong>{t("block.partialOverlap", { block: boundaryRepair.conflictName })}</strong><p>{t("block.repairHint")}</p><div>{boundaryRepair.candidates.map((candidate) => <button key={`${candidate.kind}:${candidate.range.start}:${candidate.range.end}`} onClick={() => void createUserBlockAtRange(candidate.range).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)))}>{t(`block.${candidate.kind}`)}</button>)}<button onClick={() => setBoundaryRepair(undefined)}>{t("project.cancel")}</button></div></section></div>}
    {blockNotice && <div className="block-notice" role="status">{blockNotice}</div>}
    {externalFiles.pending.length > 0 && <section className="external-file-notice" role="alert"><strong>{t("externalFiles.title")}</strong>{externalFiles.pending.map(conflict => <div key={conflict.path}><p>{t(conflict.missing ? "externalFiles.missing" : "externalFiles.conflict", { path: conflict.path })}</p>{!conflict.missing && <><button onClick={() => void resolveExternalFile(conflict.path, false)}>{t("externalFiles.reload")}</button><button onClick={() => void resolveExternalFile(conflict.path, true)}>{t("externalFiles.keep")}</button></>}</div>)}</section>}
    {store.snapshot().toolchain && !toolchainReadiness(store.snapshot().toolchain, store.get("engine")).ready && <aside className="toolchain-workbench-guidance" role="status"><span>{t("toolchainGuide.required", { tools: toolchainReadiness(store.snapshot().toolchain, store.get("engine")).missing.join(", ") })}</span><button data-toolchain-open onClick={() => { setSettingsInitial("compiler"); setSettingsOpen(true); }}>{t("toolchainGuide.configure")}</button></aside>}
    {relationChooser && createPortal(<><div className="relation-chooser-dismiss" onMouseDown={() => setRelationChooser(undefined)}/><div className="relation-direction-chooser" role="dialog" style={{ left: Math.min(relationChooser.x, window.innerWidth - 230), top: Math.min(relationChooser.y, window.innerHeight - 110) }}><button disabled={!!chooserPrerequisiteState?.disabledReason} title={chooserPrerequisiteState?.disabledReason ? t(`relation.invalid.${chooserPrerequisiteState.disabledReason}`) : undefined} onClick={() => void mutateRelation(relationChooser.candidateId, "prerequisite").catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)))}>+{t("relation.addPrerequisite")}</button><button onClick={() => void mutateRelation(relationChooser.candidateId, "consequence").catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)))}>+{t("relation.addConsequence")}</button></div></>, document.body)}
    {relationGraphOpen && relationNeighborhood && createPortal(<RelationGraphView snapshot={blockSnapshot ?? emptyBlockSnapshot} definitions={previewEnvironments} neighborhood={relationNeighborhood} direction={relationDirection} depth={relationDepth} onDirection={setRelationDirection} onDepth={setRelationDepth} onFocus={(id) => { if (focusRelationBlock(id)) setRelationGraphFocusId(id); }} onLocate={(id) => { setRelationGraphOpen(false); void locateRelationBlock(id); }} onClose={() => setRelationGraphOpen(false)}/>, document.body)}
    <header className="workbench-topbar" ref={workbenchRef}><button className="logo-button" onClick={leaveProject} title={t("project.directory")}><Logo/><span>{t("app.name")}</span></button><nav className="app-menus">{(["file", "edit", "view", "history"] as const).map((menu) => <div className="menu-anchor" key={menu}><button onMouseDown={(event) => { if (menu === "edit") event.preventDefault(); }} onClick={() => setActiveMenu(activeMenu === menu ? undefined : menu)}>{t(`menu.${menu}` as MessageKey)}</button>{activeMenu === menu && <Menu items={menuItems(menu)} onClose={() => setActiveMenu(undefined)}/>}</div>)}</nav><div className="project-switcher menu-anchor"><button onClick={() => setActiveMenu(activeMenu === "projects" ? undefined : "projects")}><strong>{project.name}</strong><Icon name="chevron"/></button>{activeMenu === "projects" && <div className="menu-popover project-menu">{projects.map((item) => <button key={item.id} onClick={() => { setActiveMenu(undefined); switchProject(item); }}><span>{item.name}</span>{item.id === project.id && <b>✓</b>}</button>)}<div className="menu-divider"/><button onClick={() => { setActiveMenu(undefined); leaveProject(); }}>{t("project.directory")}</button></div>}</div><button className={`save-status ${saveState}`} onClick={() => { commands.execute("file.save"); }}><Icon name="save"/>{t(`save.${saveState}` as MessageKey)}</button></header>
    <div className="workbench-body">
      <aside className="activity-bar">
        <div>{(["files", "search", "library", "ai", "history", "relations"] as const).map((mode) => <button key={mode} className={layout.sidebarVisible && sidebarMode === mode ? "active" : ""} title={activityTitle(mode)} onClick={() => commands.execute(sidebarCommands[mode])}><Icon name={mode}/><span>{t(`activity.${mode}` as MessageKey)}</span></button>)}</div>
        <div><button className={settingsOpen ? "active" : ""} title={t("activity.settings")} onClick={() => commands.execute("settings.open")}><Icon name="settings"/><span>{t("activity.settings")}</span></button><button data-help-ui className={layout.sidebarVisible && sidebarMode === "help" ? "active" : ""} title={activityTitle("help")} onClick={() => commands.execute(sidebarCommands.help)}><Icon name="help"/><span>{t("activity.help")}</span></button></div>
      </aside>
      {layout.sidebarVisible && <><aside className="sidebar" style={{ width: layout.sidebarWidth }}>
        <div className="sidebar-heading">
          <strong>{t(sidebarMode === "files" ? "sidebar.files" : sidebarMode === "search" ? "sidebar.search" : `activity.${sidebarMode}` as MessageKey)}</strong>
          <div>
            {sidebarMode === "search" && <span ref={setSearchToolbarTarget} className="library-toolbar-target"/>}
            {sidebarMode === "library" && <span ref={setLibraryToolbarTarget} className="library-toolbar-target"/>}
            {sidebarMode === "history" && <span ref={setHistoryToolbarTarget} className="history-toolbar-target"/>}
            {sidebarMode === "files" && <><button className="sidebar-section-toggle" aria-expanded={!layout.filesCollapsed} title={`${t(layout.filesCollapsed ? "blockOperation.expand" : "blockOperation.collapse")}: ${t("sidebar.files")}`} aria-label={`${t(layout.filesCollapsed ? "blockOperation.expand" : "blockOperation.collapse")}: ${t("sidebar.files")}`} onClick={() => setLayout(value => ({ ...value, filesCollapsed: !value.filesCollapsed }))}><Icon name="chevron"/></button><button onClick={() => void createEntry(false, "")} title={t("files.newFile")}><Icon name="plus"/></button><button onClick={() => { void refreshTree().catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error))); }} data-action="refresh-files" title={t("sidebar.refresh")}><Icon name="refresh"/></button></>}
            {sidebarMode === "relations" && <button className="relation-back" disabled={!relationFocusHistory.length} onClick={relationBack} title={t("relation.back")} aria-label={t("relation.back")}><Icon name="back"/></button>}
            <button className="sidebar-collapse-button" onClick={() => setLayout((value) => ({ ...value, sidebarVisible: false }))} title={t("sidebar.collapse")} aria-label={t("sidebar.collapse")}>‹</button>
          </div>
        </div>
        {sidebarMode === "files" && <><div className="tree-section" data-section-collapsed={Boolean(layout.filesCollapsed)} style={{ height: layout.outlineCollapsed ? undefined : layout.fileTreeHeight, flex: layout.outlineCollapsed ? 1 : undefined }} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={dropImagesToProject}><div className="tree-file-controls"><input className="sidebar-input" value={treeFilter} onChange={(event) => setTreeFilter(event.target.value)} placeholder={t("sidebar.fileSearch")}/><div className="tree-sort-controls"><label><span>{t("sidebar.sortBy")}</span><select aria-label={t("sidebar.sortBy")} value={treeSortBy} onChange={(event) => setTreeSortBy(event.target.value as "type" | "name")}><option value="type">{t("sidebar.sortType")}</option><option value="name">{t("sidebar.sortName")}</option></select></label><button type="button" title={t(treeSortDirection === "asc" ? "sidebar.sortAscending" : "sidebar.sortDescending")} aria-label={t("sidebar.reverseSort")} onClick={() => setTreeSortDirection((value) => value === "asc" ? "desc" : "asc")}>{treeSortDirection === "asc" ? "\u2191" : "\u2193"}</button></div></div><Tree key={project.id} projectId={project.id} nodes={tree} activePath={activePath} mainFile={project.mainFile} filter={treeFilter} hideBuildArtifacts={store.get("hideBuildArtifacts")} sortBy={treeSortBy} sortDirection={treeSortDirection} canMove={project.writable} onOpen={(path) => { navigationHistory.current.clear(); setNavigationRequest(undefined); void openFile(path); }} onMove={(sourcePath, destinationDirectory) => void moveEntry(sourcePath, destinationDirectory)}/></div>{!layout.filesCollapsed && !layout.outlineCollapsed && <div className="horizontal-resizer" onPointerDown={(event) => startResize("tree", event)}/>}<div className="outline-section" data-section-collapsed={Boolean(layout.outlineCollapsed)}><div className="outline-heading"><strong>{t("sidebar.outline")}</strong><button className="sidebar-section-toggle" aria-expanded={!layout.outlineCollapsed} title={t(layout.outlineCollapsed ? "blockOperation.expand" : "blockOperation.collapse")} aria-label={`${t(layout.outlineCollapsed ? "blockOperation.expand" : "blockOperation.collapse")}: ${t("sidebar.outline")}`} onClick={() => setLayout(value => ({ ...value, outlineCollapsed: !value.outlineCollapsed }))}><Icon name="chevron"/></button></div><OutlineList key={`${project.id}:${activePath ?? ""}`} projectId={project.id} filePath={activePath ?? ""} items={outline} onNavigate={navigateToOutline}/></div></>}
        {sidebarMode === "relations" && <RelationBrowser snapshot={blockSnapshot ?? emptyBlockSnapshot} definitions={previewEnvironments} selectedId={relationSelectedId} scope={currentRelationScope} documentFiltered={relationDocumentFiltered} onDocumentFiltered={setRelationDocumentFiltered} onSelect={setRelationSelectedId} focusId={relationFocusId} direction={relationDirection} depth={relationDepth} filters={relationFilters} viewMode={filterQuery.viewMode} onFocus={focusRelationBlock} onLocate={(id) => void locateRelationBlock(id)} onDirection={setRelationDirection} onDepth={setRelationDepth} onFilters={setRelationFilters} onToggleRelation={(id, event) => toggleRelation(id, event.clientX, event.clientY)}/>}
        {sidebarMode === "search" && <AdvancedSearchPanel toolbarTarget={searchToolbarTarget} focusRequest={searchFocusRequest} searching={searching} busy={replacing} ready={searchReady} canReplace={project.writable} notice={searchNotice} query={searchQuery} response={searchResponse} activeResultId={activeSearchResult?.id} replacement={replacement} replaceOpen={replaceOpen} filter={filterQuery} options={filterOptions} visibleGroups={store.get("visibleFilterGroups") as FilterGroupId[]} setQuery={setSearchQuery} setReplacement={setReplacement} setReplaceOpen={setReplaceOpen} setFilter={setFilterQuery} selectResult={(result) => void selectSearchResult(result)} replaceCurrent={() => void replaceCurrentSearchResult()} replaceAll={() => void replaceAllSearchResults()}/>}
        {sidebarMode === "library" && <ReferenceLibraryPanel toolbarTarget={libraryToolbarTarget} key={project.id} project={project} documents={searchDocuments} canCite={project.writable && !!activePath && /\.tex$/i.test(activePath)} onOpenReference={(path, offset) => void navigateTo(path, { offset })} onWriteBibliography={writeLinkedBibliography} onOpenLibrary={onOpenLibrary} onCite={citeReference}/>}
        {sidebarMode === "ai" && <AIView projectId={project.id} projectRoot={project.canonicalPath} mathContext={mathContext} overrides={tabs.filter(tab => tab.dirty).map(({ path, content }) => ({ path, content }))} {...(activeTab ? { currentFile: activeTab.path, currentFileContent: activeTab.content } : {})} {...(creationSelection && activeTab && creationSelection.fileId === activeTab.path ? { selectedText: activeTab.content.slice(creationSelection.start, creationSelection.end) } : {})} onApplyChanges={applyAIChanges} onUndoChanges={undoAIChanges} onViewChanges={viewAIChanges} onOpenFile={(path, line) => { void navigateTo(path, line ? { line, column: 1 } : {}).catch((reason: unknown) => setBlockNotice(String(reason))); }} onReviewChanges={setAiReviewChanges} onOpenSettings={() => { setSettingsInitial("ai"); setSettingsOpen(true); }}/>}
        {sidebarMode === "history" && <ProjectHistoryPanel toolbarTarget={historyToolbarTarget} projectId={project.id} onBeforeCapture={() => saveTabs(true)} onRestored={refreshAfterHistoryRestore} onOpenSettings={() => { setSettingsInitial("history"); setSettingsOpen(true); }}/>}
        {sidebarMode === "help" && <div className="generic-sidebar help-sidebar"><p>{t("helpMode.hint")}</p><button onClick={() => commands.execute("help.toggle")}>{t("helpMode.start")}</button><button onClick={() => { setSettingsInitial("shortcuts"); setSettingsOpen(true); }}>{t("settings.manager.shortcuts")}</button><button onClick={() => commands.execute("settings.open")}>{t("activity.settings")}</button></div>}
      </aside><div className="vertical-resizer" onPointerDown={(event) => startResize("sidebar", event)}/></>}
      <main className="workspace"><div className="workspace-main">{layout.mode === "single" ? singlePane : <><div className="split-toolbar-row">{splitToolbar}</div><div className="split-layout"><div style={{ width: `${layout.splitRatio}%` }}>{splitLeftContent}</div><div className="split-resizer" onPointerDown={(event) => startResize("split", event)}/><div style={{ width: `${100 - layout.splitRatio}%` }}>{secondaryContent}</div></div></>}</div>{bottomVisible && <><div className="bottom-resizer" onPointerDown={(event) => startResize("bottom", event)}/><section className="bottom-panel" style={{ height: layout.bottomPanelHeight }}><div className="bottom-tabs">{(["problems", "output", "compileLog"] as const).map((tab) => <button className={bottomTab === tab ? "active" : ""} key={tab} onClick={() => setBottomTab(tab)}>{t(`panel.${tab}` as MessageKey)}{tab === "problems" && diagnostics.length > 0 && <span>{diagnostics.length}</span>}</button>)}{bottomTab === "compileLog" && <CompileResultPicker results={compileResults} selected={compileResult} onSelect={setCompileResult}/>}<button className="panel-close" onClick={() => setBottomVisible(false)} title={t("common.close")}><Icon name="close"/></button></div><div className="panel-content">{bottomTab === "problems" && (diagnostics.length ? <div className="diagnostic-groups">{diagnosticGroups.map(([category, items]) => <section className="diagnostic-group" key={category}><h3>{category} <span>{items.length}</span></h3>{items.map((diagnostic, index) => <DiagnosticRow diagnostic={diagnostic} onOpen={() => void openDiagnostic(diagnostic)} key={`${diagnostic.message}-${index}`}/>)}</section>)}</div> : <p>{t("panel.noProblems")}</p>)}{bottomTab === "compileLog" && (compileResult ? <><div className="compile-log-status" aria-live="polite">{compileLogView?.compilationId === compileResult.compilationId && compileLogView.loading ? t("panel.loadingLog") : compileLogView?.compilationId === compileResult.compilationId && compileLogView.error ? `${t("panel.logUnavailable")} ${compileLogView.error}` : compileResult.logPath ? compileResult.logPath : ""}</div><pre>{compileLogView?.compilationId === compileResult.compilationId ? compileLogView.text : `${compileResult.stdoutTail}\n${compileResult.stderrTail}`}</pre></> : <p>{t("panel.noOutput")}</p>)}{bottomTab === "output" && <p>{t("panel.noOutput")}</p>}</div></section></>}</main>
      {figureSelection ? <FigureInspector selection={figureSelection} api={api} projectId={project.id} graphicPaths={figureGraphicPaths} preferences={store.get("images")} syntax={preferredSubfigureSyntax(figurePreambleContext)} editable={project.writable && environmentPreview(figureSelection.environmentId ?? "figure", previewEnvironments.find(value => value.id === (figureSelection.environmentId ?? "figure"))).behavior.inlineEditable} onClose={() => setFigureSelection(undefined)} onLocate={(imageIndex) => setImageDialog({ kind: "replace", selection: figureSelection, imageIndex })} onChange={replacement => applyPreviewFigureChange({ ...figureSelection, imageIndex: Math.min(figureSelection.imageIndex ?? 0, Math.max(0, parseImages(figureSelection.source).length - 1)) }, replacement)}/> : tableSelection ? <TableInspector selection={tableSelection} onClose={() => setTableSelection(undefined)} onChange={(replacement) => { if (!activeTab || activeTab.path !== tableSelection.fileId) return; setEditorContent(activeTab.content.slice(0, tableSelection.start) + replacement + activeTab.content.slice(tableSelection.end)); setTableSelection({ ...tableSelection, source: replacement, end: tableSelection.start + replacement.length }); }}/> : inspectorBlock ? <aside className="custom-block-inspector" aria-label={t("block.inspector")}><header><div><small>{t("block.customBlock")}</small><strong>{inspectorBlock.name || inspectorBlock.label || t("block.untitled")}</strong></div><button onClick={() => setInspectorBlock(undefined)} title={t("common.close")}><Icon name="close"/></button></header><div><label><span>{t("block.type")}</span><input value={inspectorBlock.role ?? inspectorBlock.type} onChange={(event) => setInspectorBlock((block) => block ? { ...block, role: event.target.value, type: event.target.value } : block)} onBlur={(event) => void updateInspectorBlock({ role: event.target.value || "custom", type: event.target.value || "custom" })}/></label><label><span>{t("block.name")}</span><input value={inspectorBlock.name ?? ""} placeholder={t("block.optional")} onChange={(event) => setInspectorBlock((block) => block ? { ...block, name: event.target.value, title: event.target.value } : block)} onBlur={(event) => void updateInspectorBlock({ name: event.target.value, title: event.target.value })}/></label><label><span>{t("block.label")}</span><input value={inspectorBlock.label ?? ""} placeholder={t("block.optional")} onChange={(event) => setInspectorBlock((block) => block ? { ...block, label: event.target.value } : block)} onBlur={(event) => void updateInspectorBlock({ label: event.target.value })}/></label><dl><div><dt>{t("block.origin")}</dt><dd>{inspectorBlock.origin}</dd></div><div><dt>{t("block.range")}</dt><dd>{inspectorBlock.range ? `${inspectorBlock.range.start}-${inspectorBlock.range.end}` : "--"}</dd></div></dl></div></aside> : relationModeActive && <RelationInspector snapshot={blockSnapshot ?? emptyBlockSnapshot} definitions={previewEnvironments} selectedId={relationSelectedId} scope={currentRelationScope} documentFiltered={relationDocumentFiltered} onDocumentFiltered={setRelationDocumentFiltered} onSelect={setRelationSelectedId} onLocate={(id) => void locateRelationBlock(id)} focusId={relationFocusId} direction={relationDirection} depth={relationDepth} history={structuralHistory} onDirection={setRelationDirection} onDepth={setRelationDepth} onFocus={focusRelationBlock} onRemove={(from, to) => void removeRelation(from, to).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)))} onUndo={() => void undoStructure()} onRedo={() => void redoStructure()} onClose={() => setSidebarMode("files")}/>}
    </div><footer className="status-bar"><div><span>{activePath ?? project.mainFile ?? "--"}</span><span>{t("status.line", cursor)}</span><span>{t("status.encoding")}</span><span>{t("status.lineEnding")}</span></div><div><span>{t("status.engine")}</span><button onClick={() => { setBottomTab("problems"); setBottomVisible(true); }}>{compileResult && !compilationFailed ? `✓${t("build.succeeded")}` : compileResult ? `! ${t("build.failed")}` : t("build.notRun")}</button><button onClick={() => { setBottomTab("problems"); setBottomVisible(true); }}>{t("status.errors", { count: errors })}</button><button onClick={() => { setBottomTab("problems"); setBottomVisible(true); }}>{t("status.warnings", { count: warnings })}</button>{spellStatusControl}<button onClick={() => setBottomVisible((value) => !value)} title={t("panel.output")}><Icon name="panel"/></button></div></footer>
  {sourceMathPreview && <MathPreviewPopover source={sourceMathPreview.source} displayMode={sourceMathPreview.displayMode} context={mathContext} anchor={sourceMathPreview.anchor} onInteractionChange={(active) => mathPopoverInteractionChangeRef.current(active)}/>} {settingsOpen && <SettingsDialog initial={settingsInitial} onClose={() => setSettingsOpen(false)}/>} {imageDialog && createPortal(<ImageInsertDialog tree={tree} replacement={imageDialog.kind === "replace"} onClose={() => setImageDialog(undefined)} onChoose={(choice) => void applyImageChoice(choice).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)))}/>, document.body)} {tableDialogOpen && activeTab && createPortal(<TableInsertDialog documentSource={activeTab.content} defaults={{ style: store.get("tables").defaultStyle, headerRow: store.get("tables").defaultInsert.headerRow, addCaption: store.get("tables").defaultInsert.addCaption, addLabel: store.get("tables").defaultInsert.addLabel }} onClose={() => setTableDialogOpen(false)} onChoose={applyTableChoice}/>, document.body)} {fileContext && <ContextMenu context={fileContext} items={fileContextItems()} onClose={() => setFileContext(undefined)}/>} {blockContext && <ContextMenu context={blockContext} items={[{ label: t("block.createFromSelection"), action: () => void createUserBlockFromSelection(blockContext.selection).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error))) }]} onClose={() => setBlockContext(undefined)}/>} {spellContextMenu && <SpellContextMenu request={spellContextMenu} onClose={() => setSpellContextMenu(undefined)}/>}</div>;
}
