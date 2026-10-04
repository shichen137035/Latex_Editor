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
}

export function createProjectSessionController(options: ProjectSessionOptions) {
  const saveTabs = async (all: boolean, flush: (update: () => void) => void = (update) => update()) => {
    if (!options.api) return;
    const pending = options.tabs.filter((tab) => tab.dirty && (all || tab.path === options.activePath));
    if (!pending.length) return;
    options.editHistory.current.breakGroup();
    options.setSaveState("saving");
    try {
      for (const tab of pending) {
        await options.api.files.write(options.project.id, tab.path, tab.content);
        options.savedContents.current.set(tab.path, tab.content);
        flush(() => options.setTabs((current) => current.map((value) => value.path === tab.path && value.content === tab.content ? { ...value, dirty: false } : value)));
      }
      options.completionController.current?.invalidate();
      options.setSaveState("saved");
    } catch {
      options.setSaveState("failed");
      throw new Error(t("save.failed"));
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
      confirm: () => lifecycle?.confirmClose({
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
    navigate();
  };

  const leaveProject = () => { void confirmProjectNavigation(options.onHome); };
  const switchProject = (project: Project) => { void confirmProjectNavigation(() => options.onSwitch(project)); };

  return { saveTabs, saveActive, saveAll, leaveProject, switchProject };
}
