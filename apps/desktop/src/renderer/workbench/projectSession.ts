import type { Project } from "@latex-editor/contracts";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { flushSync } from "react-dom";
import type { CompletionController } from "../completion/CompletionController.js";
import { resolveExit, unsavedChanges } from "../lifecycle/unsavedChanges.js";
import { settings } from "../settings/service.js";
import { t } from "../i18n/index.js";
import type { EditHistory } from "./EditHistory.js";
import type { EditorTab } from "./fileActions.js";

interface ProjectSessionOptions {
  api: Window["latexEditor"];
  project: Project;
  tabs: EditorTab[];
  activePath: string | undefined;
  tabsRef: MutableRefObject<EditorTab[]>;
  savedContents: MutableRefObject<Map<string, string>>;
  editHistory: MutableRefObject<EditHistory>;
  completionController: MutableRefObject<CompletionController | null>;
  setTabs: Dispatch<SetStateAction<EditorTab[]>>;
  setSaveState: Dispatch<SetStateAction<"saved" | "unsaved" | "saving" | "failed">>;
  onHome(): void;
  onSwitch(project: Project): void;
  flushDocuments?(): Promise<void>;
  releaseDocuments?(): Promise<void>;
  onSaveError?(message: string): void;
  onSaved?(path: string, content: string): void;
}

export function createProjectSessionController(options: ProjectSessionOptions) {
  const saveTabs = async (all: boolean, flush: (update: () => void) => void = (update) => update()) => {
    if (!options.api) return;
    const pending = options.tabsRef.current.filter((tab) => tab.dirty && (all || tab.path === options.activePath));
    if (!pending.length) return;
    options.editHistory.current.breakGroup();
    options.setSaveState("saving");
    try {
      await options.flushDocuments?.();
      for (const tab of pending) {
        await options.api.files.write(options.project.id, tab.path, tab.content);
        options.savedContents.current.set(tab.path, tab.content);
        options.onSaved?.(tab.path, tab.content);
        options.tabsRef.current = options.tabsRef.current.map((value) => value.path === tab.path && value.content === tab.content ? { ...value, dirty: false } : value);
        flush(() => options.setTabs(options.tabsRef.current));
      }
      options.completionController.current?.invalidate();
      options.setSaveState(options.tabsRef.current.some(tab => tab.dirty) ? "unsaved" : "saved");
    } catch (error) {
      options.setSaveState("failed");
      const failure = new Error(`${t("save.failed")}${error instanceof Error ? `\n${error.message}` : ""}`, { cause: error });
      options.onSaveError?.(failure.message);
      throw failure;
    }
  };

  const saveActive = () => saveTabs(false);
  const saveAll = () => saveTabs(true);
  const snapshotOnLeave = async () => {
    if (!options.api || !settings.get("history").autoSnapshot) return;
    const overrides = options.tabsRef.current.filter((tab) => tab.dirty).map((tab) => ({ path: tab.path, content: tab.content }));
    await options.api.history.snapshot(options.project.id, "project-close", undefined, overrides);
  };

  const confirmProjectNavigation = async (navigate: () => void) => {
    const lifecycle = window.latexEditor?.lifecycle;
    const canLeave = await resolveExit(unsavedChanges, {
      confirm: () => lifecycle?.confirmNavigation({
        title: t("navigation.unsavedTitle"),
        message: t("navigation.unsavedMessage"),
        detail: t("navigation.unsavedDetail"),
        buttons: [t("navigation.save"), t("navigation.discard"), t("navigation.stay")]
      }) ?? Promise.resolve("cancel"),
      flush: flushSync,
      reportError: async (error) => {
        const message = `${t("navigation.failedMessage")}\n\n${error instanceof Error ? error.message : String(error)}`;
        if (lifecycle) await lifecycle.showSaveError(t("navigation.failedTitle"), message);
        else window.alert(message);
      }
    });
    if (!canLeave) return;
    if (!unsavedChanges.hasChanges()) await snapshotOnLeave().catch(() => undefined);
    await options.releaseDocuments?.();
    navigate();
  };

  const leaveProject = () => confirmProjectNavigation(options.onHome);
  const switchProject = (project: Project) => confirmProjectNavigation(() => options.onSwitch(project));

  return { saveTabs, saveActive, saveAll, leaveProject, switchProject };
}
