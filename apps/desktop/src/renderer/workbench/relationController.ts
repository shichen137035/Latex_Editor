import { useEffect, useMemo, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { BlockGraphSnapshot, BlockId, RelationDirection, RelationNeighborhood, SemanticBlock, StructuralHistoryState } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import type { SearchDocument } from "../search/types.js";
import type { EditHistory, HistoryDirection } from "./EditHistory.js";
import type { EditorTab } from "./fileActions.js";
import type { NavigationHistory } from "./NavigationHistory.js";
import type { PaneType, PersistedLayout } from "./layout.js";
import { candidateRelationState, focusableRelationBlock, projectRelationCandidates, relationDocumentIds, relationEndpoints, relationScope, type RelationFilters } from "../relations/model.js";

export const emptyBlockSnapshot: BlockGraphSnapshot = { version: 2, blocks: [], dependencies: [], structuralParents: [] };
const defaultRelationFilters: RelationFilters = { hierarchyScope: "all", role: "all", origin: "all", label: "all", textQuery: "" };

interface RelationControllerOptions {
  api: Window["latexEditor"];
  projectId: string;
  blockSnapshot: BlockGraphSnapshot | undefined;
  setBlockSnapshot: Dispatch<SetStateAction<BlockGraphSnapshot | undefined>>;
  setStructuralHistory: Dispatch<SetStateAction<StructuralHistoryState>>;
  editHistory: MutableRefObject<EditHistory>;
  navigationHistory: MutableRefObject<NavigationHistory>;
  flushRangeMappings(): Promise<void>;
  tabs: EditorTab[];
  projectSearchDocuments: SearchDocument[];
  layout: PersistedLayout;
  setLayout: Dispatch<SetStateAction<PersistedLayout>>;
  lastTextPane: MutableRefObject<"source" | "preview">;
  activePath: string | undefined;
  navigateTo(path: string, position?: { offset?: number | undefined; line?: number | undefined; column?: number | undefined }): Promise<void>;
  setBlockNotice: Dispatch<SetStateAction<string | undefined>>;
  setInspectorBlock: Dispatch<SetStateAction<SemanticBlock | undefined>>;
  replayHistory(direction: HistoryDirection): void | Promise<void>;
}

export function useRelationController(options: RelationControllerOptions) {
  const [relationFocusId, setRelationFocusId] = useState<BlockId | null>(null);
  const [relationSelectedId, setRelationSelectedId] = useState<BlockId | null>(null);
  const [relationDocumentFiltered, setRelationDocumentFiltered] = useState(true);
  const [relationFocusHistory, setRelationFocusHistory] = useState<BlockId[]>([]);
  const [relationDirection, setRelationDirection] = useState<RelationDirection>("both");
  const [relationDepth, setRelationDepth] = useState<number | "all">(2);
  const [relationFilters, setRelationFilters] = useState<RelationFilters>(defaultRelationFilters);
  const [relationLocateRequest, setRelationLocateRequest] = useState<{ fileId: string; blockId: BlockId; nonce: number }>();
  const [relationChooser, setRelationChooser] = useState<{ candidateId: BlockId; x: number; y: number }>();
  const [relationGraphOpen, setRelationGraphOpen] = useState(false);
  const [relationGraphFocusId, setRelationGraphFocusId] = useState<BlockId | null>(null);
  const [relationNeighborhood, setRelationNeighborhood] = useState<RelationNeighborhood>();

  const currentRelationScope = useMemo(
    () => relationScope(options.blockSnapshot ?? emptyBlockSnapshot, relationFocusId, relationDirection, relationDepth),
    [options.blockSnapshot, relationFocusId, relationDirection, relationDepth]
  );
  const relationProjection = useMemo(() => {
    const snapshot = options.blockSnapshot ?? emptyBlockSnapshot;
    return projectRelationCandidates(snapshot, relationFocusId, relationFilters,
      currentRelationScope.focusIds.length ? relationDocumentIds(snapshot, currentRelationScope) : undefined);
  }, [options.blockSnapshot, relationFocusId, relationFilters, currentRelationScope]);
  const chooserPrerequisiteState = relationChooser && options.blockSnapshot
    ? candidateRelationState(options.blockSnapshot, relationFocusId, relationChooser.candidateId, "prerequisite")
    : undefined;

  const refreshRelationState = async () => {
    if (!options.api) return;
    const [snapshot, history] = await Promise.all([
      options.api.blockGraph.snapshot(options.projectId),
      options.api.blockGraph.historyState(options.projectId)
    ]);
    options.setBlockSnapshot(snapshot);
    options.setStructuralHistory(history);
  };

  const removeRelation = async (from: BlockId, to: BlockId) => {
    if (!options.api) return;
    await options.flushRangeMappings();
    await options.api.blockGraph.removeDependency(options.projectId, from, to);
    options.editHistory.current.recordStructure();
    await refreshRelationState();
  };

  const focusRelationBlock = (blockId: BlockId) => {
    const snapshot = options.blockSnapshot;
    const block = snapshot && focusableRelationBlock(snapshot, blockId);
    if (!block) return false;
    setRelationSelectedId(blockId);
    if (blockId === relationFocusId) return true;
    if (relationFocusId && focusableRelationBlock(snapshot, relationFocusId)) {
      setRelationFocusHistory((history) => [...history, relationFocusId]);
    }
    setRelationFocusId(blockId);
    options.setInspectorBlock(undefined);
    return true;
  };

  const relationBack = () => setRelationFocusHistory((history) => {
    if (!options.blockSnapshot) return history;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const previous = history[index];
      if (previous && focusableRelationBlock(options.blockSnapshot, previous)) {
        setRelationFocusId(previous);
        setRelationSelectedId(previous);
        return history.slice(0, index);
      }
    }
    return [];
  });

  useEffect(() => {
    if (!options.api) return;
    let mounted = true;
    let requestSequence = 0;
    const refreshSnapshot = () => {
      const request = ++requestSequence;
      void Promise.all([
        options.api!.blockGraph.snapshot(options.projectId),
        options.api!.blockGraph.historyState(options.projectId)
      ]).then(([snapshot, history]) => {
        if (!mounted || request !== requestSequence) return;
        options.setBlockSnapshot(snapshot);
        options.setStructuralHistory(history);
      }).catch(() => undefined);
    };
    refreshSnapshot();
    const unsubscribe = options.api.relations.onUpdate((update) => {
      if (update.projectId !== options.projectId) return;
      if (update.event.type !== "graph-invalidated") options.editHistory.current.recordStructure();
      refreshSnapshot();
    });
    return () => { mounted = false; requestSequence += 1; unsubscribe(); };
  }, [options.api, options.projectId]);

  useEffect(() => {
    if (!options.api || !relationGraphOpen) return;
    let cancelled = false;
    void options.api.blockGraph.getRelationNeighborhood(options.projectId, relationGraphFocusId,
      relationGraphFocusId ? relationDirection : "both", relationGraphFocusId ? relationDepth : "all")
      .then((neighborhood) => { if (!cancelled) setRelationNeighborhood(neighborhood); })
      .catch((error: unknown) => { if (!cancelled) options.setBlockNotice(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, [options.api, options.projectId, relationGraphOpen, relationGraphFocusId, relationDirection, relationDepth, options.blockSnapshot]);

  useEffect(() => {
    const snapshot = options.blockSnapshot;
    if (!snapshot) return;
    if (relationFocusId && !focusableRelationBlock(snapshot, relationFocusId)) {
      setRelationFocusId(null);
      setRelationFocusHistory((history) => history.filter((id) => focusableRelationBlock(snapshot, id)));
    }
    if (relationGraphFocusId && !focusableRelationBlock(snapshot, relationGraphFocusId)) setRelationGraphFocusId(null);
  }, [options.blockSnapshot, relationFocusId, relationGraphFocusId]);

  const locateRelationBlock = async (blockId: BlockId) => {
    const block = options.blockSnapshot?.blocks.find((item) => item.id === blockId);
    const path = block?.fileId ?? block?.source?.relativePath;
    if (!block || !path) return;
    const text = options.tabs.find((tab) => tab.path === path)?.content
      ?? options.projectSearchDocuments.find((document) => document.fileId === path)?.content;
    const offset = block.range?.start;
    const prefix = text !== undefined && offset !== undefined ? text.slice(0, offset) : undefined;
    const line = block.source?.startLine ?? (prefix === undefined ? undefined : prefix.split("\n").length);
    const column = block.source?.startColumn ?? (prefix === undefined ? undefined : prefix.length - (prefix.lastIndexOf("\n") + 1) + 1);
    const pane: PaneType = options.layout.mode === "single"
      ? options.layout.singlePane === "pdf" ? options.lastTextPane.current : options.layout.singlePane
      : options.layout.leftPane;
    if (options.layout.mode === "single" && options.layout.singlePane === "pdf") {
      options.setLayout((value) => ({ ...value, singlePane: pane }));
    }
    if (pane === "preview" && offset === undefined && line === undefined) setRelationLocateRequest({ fileId: path, blockId, nonce: Date.now() });
    if (offset !== undefined) await options.navigateTo(path, { offset });
    else if (line !== undefined) await options.navigateTo(path, { line, column });
    else if (path !== options.activePath) await options.navigateTo(path);
  };

  const mutateRelation = async (candidateId: BlockId, requestedDirection?: Exclude<RelationDirection, "both">) => {
    if (!options.api || !options.blockSnapshot || !relationFocusId) return;
    await options.flushRangeMappings();
    const state = candidateRelationState(options.blockSnapshot, relationFocusId, candidateId, relationDirection);
    if (state.existing) {
      await options.api.blockGraph.removeDependency(options.projectId, state.existing.from, state.existing.to);
      options.editHistory.current.recordStructure();
      await refreshRelationState();
      return;
    }
    const direction = requestedDirection ?? (relationDirection === "both" ? undefined : relationDirection);
    if (!direction) return;
    const edge = relationEndpoints(relationFocusId, candidateId, direction);
    const validation = await options.api.blockGraph.validateDependency(options.projectId, edge.from, edge.to);
    if (validation.status === "invalid") { options.setBlockNotice(validation.message); return; }
    const result = await options.api.blockGraph.addDependency(options.projectId, edge.from, edge.to);
    if (result.outcome === "created") options.editHistory.current.recordStructure();
    setRelationChooser(undefined);
    await refreshRelationState();
  };

  const toggleRelation = (candidateId: BlockId, x: number, y: number) => {
    if (!options.blockSnapshot || !relationFocusId) return;
    const state = candidateRelationState(options.blockSnapshot, relationFocusId, candidateId, relationDirection);
    if (state.disabledReason) { options.setBlockNotice(t(`relation.invalid.${state.disabledReason}`)); return; }
    if (relationDirection === "both" && !state.existing) { setRelationChooser({ candidateId, x, y }); return; }
    void mutateRelation(candidateId).catch((error: unknown) => options.setBlockNotice(error instanceof Error ? error.message : String(error)));
  };

  const undoStructure = () => options.replayHistory("undo");
  const redoStructure = () => options.replayHistory("redo");

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

  return {
    relationFocusId, setRelationFocusId, relationSelectedId, setRelationSelectedId,
    relationDocumentFiltered, setRelationDocumentFiltered, relationFocusHistory,
    relationDirection, setRelationDirection, relationDepth, setRelationDepth, relationFilters, setRelationFilters,
    relationLocateRequest, setRelationLocateRequest, relationChooser, setRelationChooser,
    relationGraphOpen, setRelationGraphOpen, relationGraphFocusId, setRelationGraphFocusId,
    relationNeighborhood, currentRelationScope, relationProjection, chooserPrerequisiteState,
    focusRelationBlock, relationBack, locateRelationBlock, mutateRelation, toggleRelation, removeRelation,
    undoStructure, redoStructure
  };
}
