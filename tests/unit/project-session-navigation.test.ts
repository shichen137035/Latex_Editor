import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectSessionController } from "../../apps/desktop/src/renderer/workbench/projectSession.js";
import { unsavedChanges } from "../../apps/desktop/src/renderer/lifecycle/unsavedChanges.js";

describe("project navigation with unsaved changes", () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const [choice, shouldNavigate] of [["cancel", false], ["discard", true]] as const) {
    it(`${choice === "cancel" ? "stays in the project" : "returns home"} after the navigation prompt`, async () => {
      const confirmNavigation = vi.fn(async () => choice);
      const confirmClose = vi.fn();
      const onHome = vi.fn();
      const api = { lifecycle: { confirmNavigation, confirmClose, showSaveError: vi.fn() } };
      vi.stubGlobal("window", { latexEditor: api });
      const unregister = unsavedChanges.register({ hasChanges: () => true });
      try {
        const session = createProjectSessionController({
          api, project: { id: "project" }, tabs: [], activePath: undefined,
          tabsRef: { current: [] }, savedContents: { current: new Map() },
          editHistory: { current: { breakGroup: vi.fn() } }, completionController: { current: null },
          setTabs: vi.fn(), setSaveState: vi.fn(), onHome, onSwitch: vi.fn()
        } as unknown as Parameters<typeof createProjectSessionController>[0]);
        await session.leaveProject();
        expect(confirmNavigation).toHaveBeenCalledOnce();
        expect(confirmClose).not.toHaveBeenCalled();
        expect(onHome).toHaveBeenCalledTimes(shouldNavigate ? 1 : 0);
      } finally { unregister(); }
    });
  }
});
