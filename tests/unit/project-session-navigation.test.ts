import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectSessionController } from "../../apps/desktop/src/renderer/workbench/projectSession.js";
import { unsavedChanges } from "../../apps/desktop/src/renderer/lifecycle/unsavedChanges.js";

describe("project navigation with unsaved changes", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("checks disk synchronization before saving and blocks unresolved external conflicts", async () => {
    const write = vi.fn(), flushDocuments = vi.fn();
    const tabsRef = { current: [{ path: "refs.bib", content: "local", dirty: true }] };
    const beforeSave = vi.fn(async () => { throw new Error("External conflict"); });
    const session = createProjectSessionController({
      api: { files: { write } }, project: { id: "p" }, tabs: tabsRef.current, activePath: "refs.bib", tabsRef,
      savedContents: { current: new Map([["refs.bib", "old"]]) }, editHistory: { current: { breakGroup: vi.fn() } }, completionController: { current: null },
      setTabs: vi.fn(), setSaveState: vi.fn(), onHome: vi.fn(), onSwitch: vi.fn(), beforeSave, flushDocuments
    } as unknown as Parameters<typeof createProjectSessionController>[0]);
    await expect(session.saveActive()).rejects.toThrow("External conflict");
    expect(beforeSave).toHaveBeenCalledExactlyOnceWith(["refs.bib"]);
    expect(write).not.toHaveBeenCalled(); expect(flushDocuments).not.toHaveBeenCalled(); expect(tabsRef.current[0]!.dirty).toBe(true);
  });

  it("commits a Preview draft before deciding which file contents to save", async () => {
    let dirtyDraft = true;
    const tabsRef = { current: [{ path: "main.tex", content: "original", dirty: false }] };
    const write = vi.fn(async () => ({}));
    const unregister = unsavedChanges.register({ hasChanges: () => dirtyDraft, commit: () => {
      tabsRef.current = [{ path: "main.tex", content: "title draft", dirty: true }];
      dirtyDraft = false;
    } });
    try {
      const session = createProjectSessionController({
        api: { files: { write } }, project: { id: "project" }, tabs: tabsRef.current, activePath: "main.tex", tabsRef,
        savedContents: { current: new Map([["main.tex", "original"]]) }, editHistory: { current: { breakGroup: vi.fn() } }, completionController: { current: null },
        setTabs: vi.fn(), setSaveState: vi.fn(), onHome: vi.fn(), onSwitch: vi.fn()
      } as unknown as Parameters<typeof createProjectSessionController>[0]);
      await session.saveActive();
      expect(write).toHaveBeenCalledExactlyOnceWith("project", "main.tex", "title draft");
      expect(tabsRef.current[0]?.dirty).toBe(false);
    } finally { unregister(); }
  });

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
