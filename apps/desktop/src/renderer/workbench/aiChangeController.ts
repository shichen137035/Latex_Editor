import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AIChangeSet, BlockTextEdit, Project, ProjectTreeNode } from "@latex-editor/contracts";
import { isAIReviewableProjectPath, isAIStructureMetadataPath } from "@latex-editor/contracts/ai-paths";
import { settings } from "../settings/service.js";
import { t } from "../i18n/index.js";
import { transitionAIFile, type AIApplyResult } from "../ai/changeOperations.js";
import type { EditHistory } from "./EditHistory.js";
import type { NavigationHistory } from "./NavigationHistory.js";
import type { EditorTab } from "./fileActions.js";
import { projectFilePaths, type PersistedLayout } from "./layout.js";

interface AIChangeControllerOptions {
  api: Window["latexEditor"];
  project: Project;
  tabsRef: MutableRefObject<EditorTab[]>;
  savedContents: MutableRefObject<Map<string, string>>;
  editHistory: MutableRefObject<EditHistory>;
  navigationHistory: MutableRefObject<NavigationHistory>;
  activePathRef: MutableRefObject<string | undefined>;
  aiOperationQueue: MutableRefObject<Promise<void>>;
  setActivePath: Dispatch<SetStateAction<string | undefined>>;
  setTabs: Dispatch<SetStateAction<EditorTab[]>>;
  setSaveState: Dispatch<SetStateAction<"saved" | "unsaved" | "saving" | "failed">>;
  setBlockNotice: Dispatch<SetStateAction<string | undefined>>;
  setAiDiffFile: Dispatch<SetStateAction<{ id: string; path: string } | undefined>>;
  setLayout: Dispatch<SetStateAction<PersistedLayout>>;
  refreshTree(): Promise<ProjectTreeNode[] | undefined>;
  openFile(path: string): Promise<void>;
  changeDocument(path: string, content: string, typing?: boolean, edits?: BlockTextEdit[], record?: boolean, captureLargeDelete?: boolean): void;
  onSourcesChanged?(): void;
}

export function createAIChangeController(options: AIChangeControllerOptions) {
  const {
    api, project, tabsRef, savedContents, editHistory, navigationHistory, activePathRef, aiOperationQueue,
    setActivePath, setTabs, setSaveState, setBlockNotice, setAiDiffFile, setLayout, refreshTree, openFile, changeDocument
  } = options;

  const mutateAIChanges = (requested: AIChangeSet, hunkIds: string[], apply: boolean): Promise<AIApplyResult> => {
    const run = async () => {
      if (!api) throw new Error(t("save.failed"));
      // Refetch decisions inside the queue: auto-apply and a quick Keep click
      // can arrive together, and must never apply the same edit twice.
      const changes = (await api.ai.conversations(project.id))?.changeSets.find(item => item.id === requested.id);
      if (!changes) throw new Error(t("ai.changeUnavailable"));
      const ids = new Set(hunkIds.filter(id => changes.files.some(file => file.hunks.some(hunk => hunk.id === id && hunk.decision === "pending"))));
      if (!ids.size && hunkIds.length) throw new Error(t("ai.changeUnavailable"));
      const diskPaths = new Set(projectFilePaths(await api.files.tree(project.id)));
      const updates: Array<{ path: string; before: string | undefined; after: string | undefined; buffer: string | undefined }> = [];
      const staleStructureIds: string[] = [];
      for (const file of changes.files) {
        if (!file.hunks.some(hunk => ids.has(hunk.id))) continue;
        if (!isAIReviewableProjectPath(file.path)) throw new Error(t("ai.protectedFile", { path: file.path }));
        const buffer = tabsRef.current.find(tab => tab.path === file.path)?.content;
        const current = buffer ?? (diskPaths.has(file.path) ? (await api.files.read(project.id, file.path)).content : undefined);
        let after: string | undefined;
        try { after = transitionAIFile(file, current, ids, apply); }
        catch (reason) {
          // Structure indexes can be refreshed as a side effect of applying
          // ordinary source edits. Never overwrite a newer index from an AI
          // snapshot, but let the independent source proposals proceed.
          if (apply && isAIStructureMetadataPath(file.path) && reason instanceof Error && reason.message === `AI_CHANGE_CONFLICT:${file.path}`) {
            staleStructureIds.push(...file.hunks.filter(hunk => ids.has(hunk.id)).map(hunk => hunk.id));
            continue;
          }
          throw new Error(t(apply ? "ai.bufferConflict" : "ai.undoConflict", { path: file.path }));
        }
        if (after !== current) updates.push({ path: file.path, before: current, after, buffer });
      }
      // Preflight every file before mutating any of them; protect edits made
      // while the IPC reads were in flight as well.
      for (const update of updates) {
        if (tabsRef.current.find(tab => tab.path === update.path)?.content !== update.buffer) throw new Error(t("ai.bufferConflict", { path: update.path }));
      }
      const snapshotBeforeAiFileRemoval = apply && updates.some(update => update.after === undefined) && settings.get("history").beforeLargeDelete;
      if (snapshotBeforeAiFileRemoval) {
        await api.history.snapshot(project.id, "pre-delete", "Before AI removes files", tabsRef.current.filter((tab) => tab.dirty).map((tab) => ({ path: tab.path, content: tab.content })));
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
      if (updates.some((update) => update.before === undefined || update.after === undefined)) navigationHistory.current.clear();
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
          changeDocument(update.path, update.after, false, undefined, true, !snapshotBeforeAiFileRemoval);
          if (tabsRef.current.find(tab => tab.path === update.path)?.content !== update.after) throw new Error(t("ai.bufferConflict", { path: update.path }));
        }
      }
      setTabs(tabsRef.current);
      setSaveState(tabsRef.current.some(tab => tab.dirty) ? "unsaved" : "saved");
      if (apply) {
        const marked = await api.ai.markChangeSetApplied(changes.id, [...ids].filter(id => !staleStructureIds.includes(id)));
        if (!marked) throw new Error(t("ai.changeUnavailable"));
      }
      else await api.ai.resolveChangeSet(changes.id, Object.fromEntries([...ids].map(id => [id, "rejected" as const])), false);
      if (changedOnDisk.length) await refreshTree();
      if (changes.files.some(file => /\.(?:tex|bib|sty|cls|ltx|dtx|ins|def|fd)$/i.test(file.path) && file.hunks.some(hunk => ids.has(hunk.id)))) options.onSourcesChanged?.();
      return { appliedIds: apply ? [...ids].filter(id => !staleStructureIds.includes(id)) : [], staleStructureIds };
    };
    const next = aiOperationQueue.current.then(run).catch(async (reason: unknown) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      setBlockNotice(message);
      // Persist manual failures alongside automatic failures so the message
      // stays on the relevant changes card, including after reopening AI chat.
      try { await api?.ai.markChangeSetApplied(requested.id, [], message); }
      catch { /* The visible local error remains available when IPC/storage fails. */ }
      throw reason;
    });
    aiOperationQueue.current = next.then(() => undefined, () => undefined);
    return next;
  };

  const viewAIChanges = (changes: AIChangeSet, path: string) => {
    void (async () => {
      navigationHistory.current.clear();
      // Deleted files and not-yet-approved new files have no live editor tab.
      // Their diff is still available without creating a phantom project file.
      if (api && projectFilePaths(await api.files.tree(project.id)).includes(path)) await openFile(path);
      setAiDiffFile({ id: changes.id, path });
      setLayout(value => value.mode === "single" ? { ...value, singlePane: "source" } : { ...value, leftPane: "source" });
    })().catch((reason: unknown) => setBlockNotice(reason instanceof Error ? reason.message : String(reason)));
  };

  const applyAIChanges = (changes: AIChangeSet, ids: string[]) => mutateAIChanges(changes, ids, true);
  const undoAIChanges = async (changes: AIChangeSet, ids: string[]) => { await mutateAIChanges(changes, ids, false); };
  return { mutateAIChanges, applyAIChanges, undoAIChanges, viewAIChanges };
}
