import { describe, expect, it, vi } from "vitest";
import { preferenceDefaults, type PreferenceKey, type PreferenceValues, type SettingsSnapshot } from "@latex-editor/contracts";
import { createCompanionApi } from "../../apps/desktop/src/renderer/companion/api.js";

function fixture() {
  let projectId: string | undefined = "project-a";
  const snapshot: SettingsSnapshot = { global: {}, project: {} };
  const write = vi.fn(async (key: PreferenceKey, value: PreferenceValues[PreferenceKey] | undefined, scope: "global" | "project") => {
    if (value === undefined) delete snapshot[scope][key];
    else Object.assign(snapshot[scope], { [key]: value });
  });
  const run = vi.fn(async () => true);
  const api = createCompanionApi({ settings: { snapshot: () => snapshot, projectId: () => projectId, set: write, subscribe: () => () => undefined }, actions: { list: () => [{ id: "latex.compile", label: "Compile", available: !!projectId }], run }, message: key => key });
  return { api, snapshot, write, run, switchProject: (id: string | undefined) => { projectId = id; snapshot.project = {}; } };
}

describe("companion interfaces reserved for future AI adapters", () => {
  it("stores the pet provider independently of the project chat default", async () => {
    const f = fixture();
    await f.api.settings.set("companionProvider", "codex");
    expect(f.api.settings.read("companionProvider").value).toBe("codex");
    expect(f.api.settings.read("aiDefaultMode").value).toBe("chat");
    expect(await f.api.settings.choices("companionProvider")).toEqual([{ value: "chat", label: "chat" }, { value: "codex", label: "codex" }]);
    expect(() => f.api.settings.set("companionProvider", "unknown")).toThrow("companion.invalidValue");
  });
  it("discovers settings and returns detached values without exposing runtime-owned writes", async () => {
    const f = fixture();
    expect(f.api.settings.list()).toHaveLength(Object.keys(preferenceDefaults).length);
    expect(f.api.settings.read("fontSize", "project")).toMatchObject({ value: 15, inherited: true, writable: true, projectSupported: true });
    expect(f.api.settings.read("fontSize").constraints).toMatchObject({ minimum: 10, maximum: 32 });
    expect(await f.api.settings.choices("engine")).toContainEqual({ value: "xelatex", label: "xelatex" });
    const defaults = f.api.settings.read("history").defaultValue as typeof preferenceDefaults.history;
    defaults.maxSnapshots = 1;
    expect(preferenceDefaults.history.maxSnapshots).not.toBe(1);
    await expect(f.api.invoke({ method: "settings.set", key: "lastProject", value: "elsewhere" })).rejects.toThrow("companion.readOnly");
    await expect(f.api.invoke({ method: "settings.read", key: "__proto__" })).rejects.toThrow("companion.invalidSetting");
    await expect(f.api.invoke({ method: "settings.set", key: "fontSize", value: 1000 })).rejects.toThrow("companion.invalidValue");
    await expect(f.api.invoke({ method: "settings.set", key: "locale", value: "ja", scope: "project" })).rejects.toThrow("companion.globalOnly");
    expect(f.write).not.toHaveBeenCalled();
  });

  it("keeps an in-flight original-project settings write from replacing a newly loaded project", async () => {
    const { settings } = await import("../../apps/desktop/src/renderer/settings/service.js");
    let finish!: (value: SettingsSnapshot) => void;
    const persist = vi.fn(() => new Promise<SettingsSnapshot>(resolve => { finish = resolve; }));
    vi.stubGlobal("document", { documentElement: { dataset: {}, lang: "en" } });
    vi.stubGlobal("window", { latexEditor: { settings: { get: async (id?: string) => ({ global: {}, project: id === "a" ? { fontSize: 16 } : id === "b" ? { fontSize: 19 } : {} }), set: persist } } });
    try {
      await settings.load("a");
      const writing = settings.setStrict("fontSize", 20, "project");
      await settings.load("b");
      finish({ global: {}, project: { fontSize: 20 } });
      await writing;
      expect(persist).toHaveBeenCalledWith("fontSize", 20, "a");
      expect(settings.projectId()).toBe("b");
      expect(settings.get("fontSize")).toBe(19);
      persist.mockRejectedValueOnce(new Error("disk full"));
      await expect(settings.setStrict("fontSize", 21)).rejects.toThrow("disk full");
      expect(settings.error()).toBe("disk full");
    } finally { await settings.load(); vi.unstubAllGlobals(); }
  });

  it("sets, resets and restores inheritance while refusing to undo a subsequent manual edit", async () => {
    const f = fixture();
    await f.api.settings.set("fontSize", 18, "project");
    expect(f.api.settings.read("fontSize", "project")).toMatchObject({ value: 18, inherited: false });
    await f.api.settings.reset("fontSize", "project");
    expect(f.api.settings.read("fontSize", "project").inherited).toBe(true);
    await f.api.settings.undo();
    expect(f.snapshot.project.fontSize).toBe(18);
    f.snapshot.project.fontSize = 20;
    await expect(f.api.settings.undo()).rejects.toThrow("companion.undoConflict");
    expect(f.snapshot.project.fontSize).toBe(20);
  });

  it("serializes writes and rejects a queued project edit after a project switch", async () => {
    const f = fixture();
    let release!: () => void;
    f.write.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const first = f.api.settings.set("theme", "dark");
    const second = f.api.settings.set("fontSize", 18, "project");
    await Promise.resolve();
    expect(f.write).toHaveBeenCalledTimes(1);
    f.switchProject("project-b"); release();
    await first;
    await expect(second).rejects.toThrow("companion.projectChanged");
    expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.snapshot.project).toEqual({});
  });

  it("propagates failed persistence and allows later requests without claiming an undo entry", async () => {
    const f = fixture();
    f.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(f.api.settings.set("fontSize", 18)).rejects.toThrow("disk full");
    expect(f.api.context().canUndoSetting).toBe(false);
    await f.api.settings.set("fontSize", 19);
    expect(f.snapshot.global.fontSize).toBe(19);
    await f.api.settings.undo();
    expect(f.snapshot.global.fontSize).toBeUndefined();
  });

  it("checks command availability and awaits dispatch failures", async () => {
    const f = fixture();
    await expect(f.api.invoke({ method: "actions.run", id: "latex.compile" })).resolves.toEqual({ id: "latex.compile", dispatched: true });
    f.run.mockRejectedValueOnce(new Error("compile failed"));
    await expect(f.api.actions.run("latex.compile")).rejects.toThrow("compile failed");
    f.switchProject(undefined);
    await expect(f.api.actions.run("latex.compile")).rejects.toThrow("companion.unavailable");
    await expect(f.api.actions.run("shell.execute")).rejects.toThrow("companion.unavailable");
    expect(f.run).toHaveBeenCalledTimes(2);
  });

  it("rejects missing project scopes and prevents undo from modifying another project", async () => {
    const f = fixture();
    await f.api.settings.set("wordWrap", false, "project");
    f.switchProject("project-b");
    await expect(f.api.settings.undo()).rejects.toThrow("companion.projectChanged");
    expect(f.snapshot.project).toEqual({});
    f.switchProject(undefined);
    await expect(f.api.invoke({ method: "settings.reset", key: "wordWrap", scope: "project" })).rejects.toThrow("companion.projectRequired");
  });
});
