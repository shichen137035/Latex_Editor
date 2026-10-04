import type { BlockGraphSnapshot, BlockTextRange, Project, SemanticBlock, StructuralHistoryState } from "@latex-editor/contracts";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { t } from "../i18n/index.js";
import { boundaryRepairCandidates, normalizeDocumentSelection, type BoundaryRepairCandidate, type DocumentSelection } from "../custom-blocks/selection.js";
import type { EditHistory } from "./EditHistory.js";
import type { EditorTab } from "./fileActions.js";

export interface BoundaryRepairPrompt {
  conflictName: string;
  candidates: BoundaryRepairCandidate[];
}

interface UserBlockControllerOptions {
  api: Window["latexEditor"];
  project: Project;
  activeTab: EditorTab | undefined;
  inspectorBlock: SemanticBlock | undefined;
  blockSnapshot: BlockGraphSnapshot | undefined;
  creationSelection: DocumentSelection | undefined;
  sourceEditorVisible: boolean;
  editHistory: MutableRefObject<EditHistory>;
  flushRangeMappings(): Promise<void>;
  highlightCreatedBlock(block: SemanticBlock): void;
  setInspectorBlock: Dispatch<SetStateAction<SemanticBlock | undefined>>;
  setBoundaryRepair: Dispatch<SetStateAction<BoundaryRepairPrompt | undefined>>;
  setBlockContext: Dispatch<SetStateAction<{ x: number; y: number; selection: DocumentSelection } | undefined>>;
  setSourceSelection: Dispatch<SetStateAction<DocumentSelection | undefined>>;
  setPreviewSelection: Dispatch<SetStateAction<DocumentSelection | undefined>>;
  setBlockSnapshot: Dispatch<SetStateAction<BlockGraphSnapshot | undefined>>;
  setStructuralHistory: Dispatch<SetStateAction<StructuralHistoryState>>;
  setBlockNotice: Dispatch<SetStateAction<string | undefined>>;
}

export function createUserBlockController(options: UserBlockControllerOptions) {
  const createUserBlockAtRange = async (range: BlockTextRange) => {
    const { api, activeTab } = options;
    if (!api || !activeTab) return;
    await options.flushRangeMappings();
    const block = await api.blockGraph.createUserBlock(options.project.id, { fileId: activeTab.path, range, role: "custom" });
    options.editHistory.current.recordStructure();
    options.setInspectorBlock(block);
    options.setBoundaryRepair(undefined);
    options.setBlockContext(undefined);
    const normalizedSelection: DocumentSelection = { fileId: activeTab.path, ...range, origin: options.sourceEditorVisible ? "source" : "preview" };
    if (options.sourceEditorVisible) options.setSourceSelection(normalizedSelection);
    else options.setPreviewSelection(normalizedSelection);
    options.highlightCreatedBlock(block);
    const [snapshot, history] = await Promise.all([api.blockGraph.snapshot(options.project.id), api.blockGraph.historyState(options.project.id)]);
    options.setBlockSnapshot(snapshot);
    options.setStructuralHistory(history);
  };

  const createUserBlockFromSelection = async (override?: DocumentSelection) => {
    const { api, activeTab, blockSnapshot } = options;
    if (!api || !activeTab) return;
    const selection = normalizeDocumentSelection(activeTab.content, override ?? options.creationSelection ?? { fileId: activeTab.path, start: 0, end: 0, origin: "source" });
    if (!selection || selection.fileId !== activeTab.path) { options.setBlockNotice(t("block.selectRange")); return; }
    const existing = blockSnapshot?.blocks.find((block) => block.origin === "user" && block.fileId === selection.fileId
      && block.range?.start === selection.start && block.range?.end === selection.end);
    if (existing) { options.setInspectorBlock(existing); return; }
    const input = { fileId: selection.fileId, range: { start: selection.start, end: selection.end }, role: "custom" };
    const validation = await api.blockGraph.validateUserBlock(options.project.id, input);
    if (validation.status === "valid") { await createUserBlockAtRange(input.range); return; }
    if (validation.reason !== "partial-overlap") {
      options.setBlockNotice(t(validation.reason === "duplicate-range" ? "block.duplicateRange" : "block.invalidRange"));
      return;
    }
    const snapshot = blockSnapshot ?? await api.blockGraph.snapshot(options.project.id);
    options.setBlockSnapshot(snapshot);
    const candidates = boundaryRepairCandidates(input.range, snapshot.blocks, selection.fileId);
    const checked = await Promise.all(candidates.map(async (candidate) => ({
      candidate,
      validation: await api.blockGraph.validateUserBlock(options.project.id, { ...input, range: candidate.range })
    })));
    const validCandidates = checked.filter((item) => item.validation.status === "valid").map((item) => item.candidate);
    if (!validCandidates.length) { options.setBlockNotice(t("block.noRepair")); return; }
    const conflict = snapshot.blocks.find((block) => block.id === validation.conflictingBlockId);
    options.setBoundaryRepair({ conflictName: conflict?.name ?? conflict?.title ?? conflict?.label ?? conflict?.role ?? conflict?.type ?? t("block.existingBlock"), candidates: validCandidates });
  };

  const updateInspectorBlock = async (patch: Partial<Omit<SemanticBlock, "id">>) => {
    const { api, blockSnapshot } = options;
    const inspectorBlock = options.inspectorBlock;
    if (!api || !inspectorBlock) return;
    await options.flushRangeMappings();
    const original = blockSnapshot?.blocks.find((block) => block.id === inspectorBlock.id);
    const changed = !original || Object.entries(patch).some(([key, value]) => JSON.stringify(original[key as keyof SemanticBlock]) !== JSON.stringify(value));
    const updated = await api.blockGraph.updateBlock(options.project.id, inspectorBlock.id, patch);
    if (changed) options.editHistory.current.recordStructure();
    options.setInspectorBlock(updated);
    options.setBlockSnapshot((snapshot) => snapshot ? { ...snapshot, blocks: snapshot.blocks.map((block) => block.id === updated.id ? updated : block) } : snapshot);
  };

  return { createUserBlockAtRange, createUserBlockFromSelection, updateInspectorBlock };
}
