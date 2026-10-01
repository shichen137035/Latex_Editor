import { describe, expect, it, vi } from "vitest";
import { resolveExit, UnsavedChangesRegistry } from "../../apps/desktop/src/renderer/lifecycle/unsavedChanges.js";

function options(choice: "save" | "discard" | "cancel") {
  return { confirm: vi.fn(async () => choice), flush: (commit: () => void) => commit(), reportError: vi.fn(async () => undefined) };
}

describe("application exit with unsaved project changes", () => {
  it("closes without prompting when nothing is modified", async () => {
    const registry = new UnsavedChangesRegistry(), ui = options("cancel");
    registry.register({ hasChanges: () => false });
    expect(await resolveExit(registry, ui)).toBe(true);
    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it.each(["cancel", "discard"] as const)("%s never writes or commits a draft", async choice => {
    const registry = new UnsavedChangesRegistry(), commit = vi.fn(), save = vi.fn(async () => undefined);
    registry.register({ hasChanges: () => true, commit, save });
    expect(await resolveExit(registry, options(choice))).toBe(choice === "discard");
    expect(commit).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("commits Preview drafts before saving all modified files", async () => {
    const registry = new UnsavedChangesRegistry(), order: string[] = [];
    let dirtyFile = false;
    registry.register({ hasChanges: () => dirtyFile, save: async () => { order.push("save"); dirtyFile = false; } });
    const removeDraft = registry.register({ hasChanges: () => true, commit: () => { order.push("commit"); dirtyFile = true; removeDraft(); } });
    expect(await resolveExit(registry, options("save"))).toBe(true);
    expect(order).toEqual(["commit", "save"]);
  });

  it("waits for file writes to complete before approving exit", async () => {
    const registry = new UnsavedChangesRegistry();
    let dirty = true, finish!: () => void, completed = false;
    const pending = new Promise<void>(done => { finish = done; });
    registry.register({ hasChanges: () => dirty, save: async () => { await pending; dirty = false; } });
    const request = resolveExit(registry, options("save")).then(value => { completed = true; return value; });
    await Promise.resolve(); await Promise.resolve();
    expect(completed).toBe(false);
    finish();
    expect(await request).toBe(true);
  });

  it("keeps the app open and reports a failed file write", async () => {
    const registry = new UnsavedChangesRegistry(), ui = options("save");
    const error = new Error("Disk is read-only");
    registry.register({ hasChanges: () => true, save: async () => { throw error; } });
    expect(await resolveExit(registry, ui)).toBe(false);
    expect(ui.reportError).toHaveBeenCalledWith(error);
    expect(registry.hasChanges()).toBe(true);
  });

  it("does not close after an invalid draft or incomplete save", async () => {
    for (const commit of [undefined, () => { throw new Error("Invalid BibTeX"); }]) {
      const registry = new UnsavedChangesRegistry(), ui = options("save");
      registry.register({ hasChanges: () => true, ...(commit ? { commit } : {}) });
      expect(await resolveExit(registry, ui)).toBe(false);
      expect(ui.reportError).toHaveBeenCalledOnce();
    }
  });
});
