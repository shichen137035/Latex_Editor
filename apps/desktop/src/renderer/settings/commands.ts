import { settings } from "./service.js";
export const defaultBindings = { "file.save": "Mod+S", "file.saveAll": "Mod+Shift+S", "edit.find": "Mod+F", "edit.replace": "Mod+H", "latex.compile": "Mod+B", "settings.open": "Mod+," };
export type CommandId = keyof typeof defaultBindings;
export const commandLabels: Record<CommandId, string> = { "file.save": "menu.save", "file.saveAll": "menu.saveAll", "edit.find": "menu.find", "edit.replace": "menu.replace", "latex.compile": "build.compile", "settings.open": "activity.settings" };
type Command = { execute(): void | Promise<void>; when?: () => boolean };
const registry = new Map<string, Command>();
export const commands = {
  register(id: string, command: Command) { registry.set(id, command); return () => { if (registry.get(id) === command) registry.delete(id); }; },
  execute(id: string) { const command = registry.get(id); if (command && (!command.when || command.when())) { void command.execute(); return true; } return false; }
};
export function bindings(): Record<string, string> { return { ...defaultBindings, ...settings.global("keybindings") }; }
export function validBinding(value: string) { return value === "" || /^(?:Mod\+|Alt\+)(?:Shift\+)?(?:[A-Z0-9,.;/]|F(?:[1-9]|1[0-2]))$/.test(value); }
export function eventBinding(event: KeyboardEvent): string {
  const modifier = event.ctrlKey || event.metaKey ? "Mod+" : event.altKey ? "Alt+" : "";
  return `${modifier}${event.shiftKey ? "Shift+" : ""}${event.key.toUpperCase()}`;
}
export function displayBinding(value: string) { return value.replace("Mod", /Mac/.test(navigator.platform) ? "Cmd" : "Ctrl"); }
export function installShortcuts() {
  const handler = (event: KeyboardEvent) => {
    if (event.isComposing || event.repeat || (event.target as Element)?.closest("[data-shortcut-capture], [role=dialog]")) return;
    const key = eventBinding(event);
    const found = Object.entries(bindings()).find(([, value]) => value && validBinding(value) && value === key);
    if (found && commands.execute(found[0])) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}
