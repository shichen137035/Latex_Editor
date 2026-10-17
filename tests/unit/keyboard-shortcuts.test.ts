import { describe, expect, it } from "vitest";
import { analyzeBindingConflicts, commandBindings, commandCatalog, defaultBindings, eventBinding, parseBinding, resolveBindingSequence, validBinding, type CommandId } from "../../apps/desktop/src/renderer/settings/commands.js";

function withBindings(overrides: Partial<Record<CommandId, string>> = {}): Record<CommandId, string> {
  return { ...defaultBindings, ...overrides };
}

describe("v0.6.2.3 shortcut conflict model", () => {
  it("offers configurable F1 interface help on home, editors and dialogs", () => {
    expect(commandCatalog["help.toggle"]).toMatchObject({ context: "global", defaultBinding: "F1" });
    expect(analyzeBindingConflicts("help.toggle", "F1", withBindings())).toEqual([]);
    for (const context of ["directory", "workspace.editor.source.text", "workspace.editor.preview", "dialog"]) {
      expect(resolveBindingSequence("F1", "global", context).commandId).toBe("help.toggle");
    }
  });

  it("allows reuse between sibling contexts", () => {
    const conflicts = analyzeBindingConflicts("edit.replace", "Mod+K", withBindings({ "block.insertBefore": "Mod+K" }));
    expect(conflicts).toEqual([]);
  });

  it("warns when a child context shadows a parent context", () => {
    const conflicts = analyzeBindingConflicts("file.save", "Mod+K", withBindings({ "block.insertBefore": "Mod+K" }));
    expect(conflicts).toMatchObject([{ kind: "overlap", commandId: "block.insertBefore" }]);
  });

  it("exposes configurable Ctrl+F search throughout the workspace", () => {
    expect(commandCatalog["edit.find"]).toMatchObject({ group: "search", context: "workspace", defaultBinding: "Mod+F" });
    for (const context of ["workspace.editor.source.text", "workspace.editor.preview", "workspace.editor.preview.block-edit", "workspace.file-tree", "workspace.search"]) {
      expect(resolveBindingSequence("Mod+F", "global", context).commandId).toBe("edit.find");
    }
    expect(resolveBindingSequence("Mod+F", "global", "manager.shortcut-manager").commandId).toBeUndefined();
    expect(analyzeBindingConflicts("edit.find", "Mod+K", withBindings({ "block.insertBefore": "Mod+K" }))).toMatchObject([{ kind: "overlap", commandId: "block.insertBefore" }]);
  });

  it("reports same-context duplicate bindings as direct conflicts", () => {
    const conflicts = analyzeBindingConflicts("block.insertBefore", "Mod+K", withBindings({ "block.insertAfter": "Mod+K" }));
    expect(conflicts).toMatchObject([{ kind: "direct", commandId: "block.insertAfter" }]);
  });

  it("exposes configurable sidebar shortcuts and resolves shifted physical digits", () => {
    const ids: CommandId[] = ["sidebar.files", "sidebar.search", "sidebar.library", "ai.open", "sidebar.history", "sidebar.relations", "sidebar.help"];
    ids.forEach((id, index) => {
      const digit = index + 1, stroke = `Mod+Shift+${digit}`;
      expect(commandBindings(id, "global")).toContain(stroke);
      expect(analyzeBindingConflicts(id, stroke, withBindings())).toEqual([]);
      expect(resolveBindingSequence(stroke, "global", "workspace.editor.source.text").commandId).toBe(id);
      expect(resolveBindingSequence(stroke, "global", "dialog").commandId).toBeUndefined();
      expect(eventBinding({ key: "!@#$%^&"[index], code: `Digit${digit}`, ctrlKey: true, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent)).toBe(stroke);
    });
    expect(commandBindings("ai.open", "global")).toContain("Mod+Shift+A");
  });

  it("rejects a complete shortcut that is also a chord prefix", () => {
    const conflicts = analyzeBindingConflicts("block.insertBefore", "Mod+K", withBindings({ "block.insertAfter": "Mod+K, Mod+C" }));
    expect(conflicts).toMatchObject([{ kind: "prefix", commandId: "block.insertAfter" }]);
  });

  it("keeps legacy comma-key shortcuts intact while accepting two-stroke chords", () => {
    expect(parseBinding("Mod+,")).toEqual(["Mod+,"]);
    expect(validBinding("Mod+,")).toBe(true);
    expect(parseBinding("Alt+ENTER")).toEqual(["Alt+Enter"]);
    expect(validBinding("Mod+K, Mod+C")).toBe(true);
    expect(validBinding("Mod+K, Mod+C, Mod+T")).toBe(false);
  });

  it("keeps both built-in redo bindings in the registry", () => {
    expect(commandBindings("edit.redo", "global")).toEqual(["Mod+Y", "Mod+Shift+Z"]);
  });

  it("exposes block operations as configurable, conflict-free defaults", () => {
    const expected: Partial<Record<CommandId, string>> = {
      "block.selectPrevious": "Up", "block.selectNext": "Down",
      "block.copy": "Mod+C", "block.cut": "Mod+X", "block.paste": "Mod+V", "block.duplicate": "Mod+Shift+D",
      "block.collapse": "Mod+Shift+Up", "block.expand": "Mod+Shift+Down",
      "block.disable": "Mod+Alt+P", "block.enable": "Mod+Alt+Shift+P", "block.delete": "Delete"
    };
    for (const [id, binding] of Object.entries(expected) as Array<[CommandId, string]>) {
      expect(defaultBindings[id]).toBe(binding);
      expect(validBinding(binding)).toBe(true);
      expect(analyzeBindingConflicts(id, binding, withBindings())).toEqual([]);
    }
  });

  it("recognizes letter shortcuts even when Alt produces a symbol", () => {
    const event = { key: "π", code: "KeyP", ctrlKey: true, metaKey: false, altKey: true, shiftKey: false } as KeyboardEvent;
    expect(eventBinding(event)).toBe("Mod+Alt+P");
  });
});
