import { settings } from "./service.js";
export const defaultBindings = {
  "edit.undo": "Mod+Z", "edit.redo": "Mod+Y",
  "file.save": "Mod+S", "file.saveAll": "Mod+Shift+S", "edit.find": "Mod+F", "edit.replace": "Mod+H",
  "latex.compile": "Mod+B", "settings.open": "Mod+,", "ai.open": "Mod+Shift+A", "block.insertBefore": "Alt+ENTER",
  "block.insertAfter": "Shift+ENTER", "block.createFromSelection": "Mod+Alt+B", "preview.applyDraft": "Mod+ENTER", "preview.cancelDraft": "ESCAPE"
};
export type CommandId = keyof typeof defaultBindings;
export const commandLabels: Record<CommandId, string> = {
  "edit.undo": "menu.undo", "edit.redo": "menu.redo",
  "file.save": "menu.save", "file.saveAll": "menu.saveAll", "edit.find": "menu.find", "edit.replace": "menu.replace",
  "latex.compile": "build.compile", "settings.open": "activity.settings", "ai.open": "activity.ai", "block.insertBefore": "command.blockInsertBefore",
  "block.insertAfter": "command.blockInsertAfter", "block.createFromSelection": "block.createFromSelection", "preview.applyDraft": "command.previewApplyDraft", "preview.cancelDraft": "command.previewCancelDraft"
};
export const commandContexts: Record<CommandId, string> = {
  "edit.undo": "command.context.global", "edit.redo": "command.context.global",
  "file.save": "command.context.global", "file.saveAll": "command.context.global", "edit.find": "command.context.source",
  "edit.replace": "command.context.source", "latex.compile": "command.context.global", "settings.open": "command.context.global", "ai.open": "command.context.global",
  "block.insertBefore": "command.context.previewBlock", "block.insertAfter": "command.context.previewBlock",
  "block.createFromSelection": "command.context.documentSelection",
  "preview.applyDraft": "command.context.previewBlock", "preview.cancelDraft": "command.context.previewDraft"
};
type Command = { execute(): void | Promise<void>; when?: () => boolean };
const registry = new Map<string, Command[]>();
function activeCommand(id: string): Command | undefined {
  const entries = registry.get(id);
  if (!entries) return undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const command = entries[index];
    if (command && (!command.when || command.when())) return command;
  }
  return undefined;
}
export const commands = {
  register(id: string, command: Command) {
    const entries = registry.get(id) ?? [];
    entries.push(command);
    registry.set(id, entries);
    return () => {
      const current = registry.get(id);
      if (!current) return;
      const index = current.lastIndexOf(command);
      if (index >= 0) current.splice(index, 1);
      if (!current.length) registry.delete(id);
    };
  },
  canExecute(id: string) { return !!activeCommand(id); },
  execute(id: string) { const command = activeCommand(id); if (command) { void command.execute(); return true; } return false; }
};
export function bindings(): Record<string, string> { return { ...defaultBindings, ...settings.global("keybindings") }; }
export function validBinding(value: string) { return value === "" || /^(?:(?:(?:Mod|Alt|Shift)\+){1,3}(?:[A-Z0-9,.;/]|F(?:[1-9]|1[0-2])|ENTER)|ESCAPE)$/.test(value); }
export function eventBinding(event: KeyboardEvent): string {
  const modifiers = [event.ctrlKey || event.metaKey ? "Mod" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : ""].filter(Boolean);
  return `${modifiers.length ? `${modifiers.join("+")}+` : ""}${event.key.toUpperCase()}`;
}
export function displayBinding(value: string) { return value.replace("Mod", /Mac/.test(navigator.platform) ? "Cmd" : "Ctrl"); }
export function installShortcuts() {
  const handler = (event: KeyboardEvent) => {
    if (event.isComposing || (event.target as Element)?.closest("[data-shortcut-capture], [role=dialog]")) return;
    const key = eventBinding(event);
    const found = Object.entries(bindings()).find(([id, value]) => value && validBinding(value) && (value === key || (id === "edit.redo" && value === "Mod+Y" && key === "Mod+Shift+Z")) && commands.canExecute(id));
    if (event.repeat && found?.[0] !== "edit.undo" && found?.[0] !== "edit.redo") return;
    if (found && commands.execute(found[0])) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}
