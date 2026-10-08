import { describe, expect, it } from "vitest";
import { analyzeBindingConflicts, commandBindings, defaultBindings, eventBinding, parseBinding, validBinding, type CommandId } from "../../apps/desktop/src/renderer/settings/commands.js";

function withBindings(overrides: Partial<Record<CommandId, string>> = {}): Record<CommandId, string> {
  return { ...defaultBindings, ...overrides };
}

describe("v0.6.2.3 shortcut conflict model", () => {
  it("allows reuse between sibling contexts", () => {
    const conflicts = analyzeBindingConflicts("edit.find", "Mod+K", withBindings({ "block.insertBefore": "Mod+K" }));
    expect(conflicts).toEqual([]);
  });

  it("warns when a child context shadows a parent context", () => {
    const conflicts = analyzeBindingConflicts("file.save", "Mod+K", withBindings({ "block.insertBefore": "Mod+K" }));
    expect(conflicts).toMatchObject([{ kind: "overlap", commandId: "block.insertBefore" }]);
  });

  it("reports same-context duplicate bindings as direct conflicts", () => {
    const conflicts = analyzeBindingConflicts("block.insertBefore", "Mod+K", withBindings({ "block.insertAfter": "Mod+K" }));
    expect(conflicts).toMatchObject([{ kind: "direct", commandId: "block.insertAfter" }]);
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
