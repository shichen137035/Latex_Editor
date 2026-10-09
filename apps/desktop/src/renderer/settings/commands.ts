import { settings } from "./service.js";

export const commandCatalog = {
  "directory.search": { label: "command.directorySearch", group: "search", context: "directory", contextLabel: "shortcut.context.directory", defaultBinding: "Mod+K" },
  "edit.undo": { label: "menu.undo", group: "editing", context: "workspace.editor", contextLabel: "command.context.source", defaultBinding: "Mod+Z" },
  "edit.redo": { label: "menu.redo", group: "editing", context: "workspace.editor", contextLabel: "command.context.source", defaultBinding: "Mod+Y", alternateDefaultBindings: ["Mod+Shift+Z"] },
  "file.save": { label: "menu.save", group: "files", context: "workspace", contextLabel: "command.context.global", defaultBinding: "Mod+S" },
  "file.saveAll": { label: "menu.saveAll", group: "files", context: "workspace", contextLabel: "command.context.global", defaultBinding: "Mod+Shift+S" },
  "edit.find": { label: "activity.search", group: "search", context: "workspace", contextLabel: "shortcut.context.workspace", defaultBinding: "Mod+F" },
  "edit.replace": { label: "menu.replace", group: "search", context: "workspace.editor.source", contextLabel: "command.context.source", defaultBinding: "Mod+H" },
  "navigation.back": { label: "command.navigationBack", group: "navigation", context: "workspace", contextLabel: "command.context.global", defaultBinding: "Mod+B" },
  "navigation.forward": { label: "command.navigationForward", group: "navigation", context: "workspace", contextLabel: "command.context.global", defaultBinding: "Mod+R" },
  "latex.compile": { label: "build.compile", group: "build", context: "workspace", contextLabel: "command.context.global", defaultBinding: "Mod+Shift+B" },
  "settings.open": { label: "activity.settings", group: "general", context: "global", contextLabel: "command.context.global", defaultBinding: "Mod+," },
  "ai.open": { label: "activity.ai", group: "ai", context: "workspace", contextLabel: "command.context.global", defaultBinding: "Mod+Shift+A" },
  "block.insertBefore": { label: "command.blockInsertBefore", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Alt+Enter" },
  "block.insertAfter": { label: "command.blockInsertAfter", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Shift+Enter" },
  "block.selectPrevious": { label: "blockOperation.selectPrevious", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Up" },
  "block.selectNext": { label: "blockOperation.selectNext", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Down" },
  "block.moveUp": { label: "blockOperation.moveUp", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Alt+Up" },
  "block.moveDown": { label: "blockOperation.moveDown", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Alt+Down" },
  "block.outdent": { label: "blockOperation.outdent", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Alt+Left" },
  "block.indent": { label: "blockOperation.indent", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Alt+Right" },
  "block.copy": { label: "editor.context.copy", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Mod+C" },
  "block.cut": { label: "editor.context.cut", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Mod+X" },
  "block.paste": { label: "blockOperation.paste", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Mod+V" },
  "block.duplicate": { label: "blockOperation.duplicate", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Mod+Shift+D" },
  "block.collapse": { label: "blockOperation.collapse", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Mod+Shift+Up" },
  "block.expand": { label: "blockOperation.expand", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Mod+Shift+Down" },
  "block.disable": { label: "blockOperation.disable", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Mod+Alt+P" },
  "block.enable": { label: "blockOperation.enable", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Mod+Alt+Shift+P" },
  "block.delete": { label: "files.delete", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "Delete" },
  "block.removeEnvironment": { label: "preview.removeEnvironment", group: "blocks", context: "workspace.editor.preview.block-selected", contextLabel: "command.context.previewBlock", defaultBinding: "" },
  "block.createFromSelection": { label: "block.createFromSelection", group: "blocks", context: "workspace.editor.source.text", contextLabel: "command.context.documentSelection", defaultBinding: "Mod+Alt+B" },
  "preview.applyDraft": { label: "command.previewApplyDraft", group: "editing", context: "workspace.editor.preview.block-edit", contextLabel: "command.context.previewDraft", defaultBinding: "Mod+Enter" },
  "preview.cancelDraft": { label: "command.previewCancelDraft", group: "editing", context: "workspace.editor.preview.block-edit", contextLabel: "command.context.previewDraft", defaultBinding: "Escape" }
} as const;

export type CommandId = keyof typeof commandCatalog;
export type ShortcutContextId = (typeof commandCatalog)[CommandId]["context"] | "workspace.editor.preview" | "workspace.editor.relation" | "workspace.file-tree" | "workspace.search" | "dialog" | "manager.shortcut-manager";
export type ShortcutGroupId = (typeof commandCatalog)[CommandId]["group"];
export const defaultBindings: Record<CommandId, string> = Object.fromEntries(Object.entries(commandCatalog).map(([id, command]) => [id, command.defaultBinding])) as Record<CommandId, string>;
export const commandLabels: Record<CommandId, string> = Object.fromEntries(Object.entries(commandCatalog).map(([id, command]) => [id, command.label])) as Record<CommandId, string>;
export const commandContexts: Record<CommandId, string> = Object.fromEntries(Object.entries(commandCatalog).map(([id, command]) => [id, command.contextLabel])) as Record<CommandId, string>;
export const commandDescriptions: Record<CommandId, string> = Object.fromEntries((Object.keys(commandCatalog) as CommandId[]).map((id) => [id, `shortcut.description.${id}`])) as Record<CommandId, string>;

export const shortcutGroups: ShortcutGroupId[] = ["general", "navigation", "editing", "blocks", "search", "build", "files", "ai"];
export const contextTree: ReadonlyArray<{ id: string; parent?: string }> = [
  { id: "global" }, { id: "directory", parent: "global" }, { id: "workspace", parent: "global" }, { id: "workspace.editor", parent: "workspace" },
  { id: "workspace.editor.source", parent: "workspace.editor" }, { id: "workspace.editor.source.text", parent: "workspace.editor.source" },
  { id: "workspace.editor.preview", parent: "workspace.editor" }, { id: "workspace.editor.preview.block-selected", parent: "workspace.editor.preview" },
  { id: "workspace.editor.preview.block-edit", parent: "workspace.editor.preview" }, { id: "workspace.editor.relation", parent: "workspace.editor" },
  { id: "workspace.file-tree", parent: "workspace" }, { id: "workspace.search", parent: "workspace" },
  { id: "dialog", parent: "global" }, { id: "manager.shortcut-manager", parent: "global" }
];

type Command = { execute(): void | Promise<void>; when?: () => boolean };
const registry = new Map<CommandId, Command[]>();
function activeCommand(id: CommandId): Command | undefined {
  const entries = registry.get(id);
  if (!entries) return undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const command = entries[index];
    if (command && (!command.when || command.when())) return command;
  }
  return undefined;
}
export const commands = {
  register(id: CommandId, command: Command) {
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
  canExecute(id: CommandId) { return !!activeCommand(id); },
  isRegistered(id: CommandId) { return registry.has(id); },
  execute(id: CommandId) { const command = activeCommand(id); if (command) { void command.execute(); return true; } return false; }
};

/** Resolve default -> user -> project bindings, preserving empty strings as explicit unassignments. */
export function bindings(scope?: "global" | "project"): Record<CommandId, string> {
  const overrides = scope === "global" ? settings.global("keybindings") : { ...settings.global("keybindings"), ...settings.get("keybindings") };
  const safeOverrides = Object.fromEntries(Object.entries(overrides).filter((entry): entry is [string, string] => typeof entry[1] === "string" && validBinding(entry[1])).map(([id, value]) => [id, normalizeBinding(value)]));
  return { ...defaultBindings, ...safeOverrides } as Record<CommandId, string>;
}
function sequencesFrom(id: CommandId, current: Record<CommandId, string>): string[] {
  const primary = current[id] ?? "";
  const definition = commandCatalog[id];
  const aliases = "alternateDefaultBindings" in definition && primary === defaultBindings[id] ? definition.alternateDefaultBindings : [];
  return [primary, ...(aliases ?? [])].filter(Boolean).map(normalizeBinding);
}
export function commandBindings(commandId: CommandId, scope?: "global" | "project"): string[] { return sequencesFrom(commandId, bindings(scope)); }

const modifierOrder = ["Mod", "Ctrl", "Alt", "Shift"] as const;
const keyAliases: Record<string, string> = { " ": "Space", Esc: "Escape", Return: "Enter", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", ",": ",", ".": ".", ";": ";", "/": "/", "[": "[", "]": "]", "-": "-", "=": "=" };
export function eventBinding(event: KeyboardEvent): string {
  // Option/Alt can turn letters into symbols on some keyboard layouts. Keep
  // letter-based shortcuts recordable and executable by using their key code.
  const altLetter = event.altKey && /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : undefined;
  const key = altLetter ?? keyAliases[event.key] ?? event.key;
  const normalizedKey = /^[a-z]$/i.test(key) ? key.toUpperCase() : key;
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const modifiers = [isMac ? event.metaKey ? "Mod" : "" : event.ctrlKey ? "Mod" : "", isMac ? event.ctrlKey ? "Ctrl" : "" : event.metaKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : ""].filter(Boolean);
  return [...modifiers, normalizedKey].join("+");
}
export function normalizeStroke(value: string): string {
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "";
  const rawKey = keyAliases[parts.at(-1)!] ?? parts.at(-1)!;
  const key = ({ ENTER: "Enter", ESCAPE: "Escape", SPACE: "Space", TAB: "Tab", BACKSPACE: "Backspace", DELETE: "Delete", INSERT: "Insert", HOME: "Home", END: "End", PAGEUP: "PageUp", PAGEDOWN: "PageDown", UP: "Up", DOWN: "Down", LEFT: "Left", RIGHT: "Right" } as Record<string, string>)[rawKey.toUpperCase()] ?? rawKey;
  const mods = new Set(parts.slice(0, -1).map((item) => item === "Cmd" || item === "Command" ? "Mod" : item === "Control" ? "Ctrl" : item));
  const ordered = modifierOrder.filter((modifier) => mods.has(modifier));
  return [...ordered, /^[a-z]$/i.test(key) ? key.toUpperCase() : key].join("+");
}
export function parseBinding(value: string): string[] { return value.split(/,\s+/).filter(Boolean).map(normalizeStroke); }
export function normalizeBinding(value: string): string { return parseBinding(value).join(", "); }
export function validBinding(value: string) {
  if (value === "") return true;
  const strokes = parseBinding(value);
  const validKey = /^(?:[A-Z]|[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Enter|Escape|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|,|\.|;|\/|\[|\]|-|=)$/;
  return strokes.length >= 1 && strokes.length <= 2 && strokes.every((stroke) => {
    const parts = stroke.split("+");
    const key = parts.pop() ?? "";
    return validKey.test(key) && new Set(parts).size === parts.length && parts.every((item) => ["Mod", "Ctrl", "Alt", "Shift"].includes(item));
  });
}
export function displayBinding(value: string) {
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  return normalizeBinding(value).split(", ").map((stroke) => stroke.split("+").map((part) => part === "Mod" ? isMac ? "⌘" : "Ctrl" : part === "Alt" && isMac ? "⌥" : part === "Shift" ? isMac ? "⇧" : "Shift" : part).join(isMac ? "" : "+")).join(", ");
}

export type ShortcutConflictKind = "direct" | "overlap" | "prefix";
export interface ShortcutConflict { kind: ShortcutConflictKind; commandId: CommandId; binding: string; ownerBinding: string; context: string }
function contextsOverlap(a: string, b: string): boolean { return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`); }
export function analyzeBindingConflicts(commandId: CommandId, binding: string, current: Record<CommandId, string>): ShortcutConflict[] {
  if (!binding) return [];
  const sequence = parseBinding(binding);
  const conflicts: ShortcutConflict[] = [];
  for (const otherId of Object.keys(commandCatalog) as CommandId[]) {
    if (otherId === commandId) continue;
    const context = commandCatalog[commandId].context;
    const otherContext = commandCatalog[otherId].context;
    if (!contextsOverlap(context, otherContext)) continue;
    for (const otherBinding of sequencesFrom(otherId, current)) {
      const otherSequence = parseBinding(otherBinding);
      const same = sequence.length === otherSequence.length && sequence.every((stroke, index) => stroke === otherSequence[index]);
      const prefix = sequence.length !== otherSequence.length && (sequence.every((stroke, index) => stroke === otherSequence[index]) || otherSequence.every((stroke, index) => stroke === sequence[index]));
      if (same || prefix) conflicts.push({ kind: prefix ? "prefix" : context === otherContext ? "direct" : "overlap", commandId: otherId, binding: otherBinding, ownerBinding: normalizeBinding(binding), context: otherContext });
    }
  }
  return conflicts;
}
export function findBindingConflicts(commandId: CommandId, binding: string, scope: "global" | "project"): ShortcutConflict[] {
  return analyzeBindingConflicts(commandId, binding, bindings(scope));
}
export function listBindingConflicts(scope: "global" | "project") {
  const current = bindings(scope);
  const conflicts: Array<ShortcutConflict & { owner: CommandId }> = [];
  const ids = Object.keys(commandCatalog) as CommandId[];
  const seen = new Set<string>();
  for (const [index, owner] of ids.entries()) {
    for (const value of sequencesFrom(owner, current)) {
      for (const match of analyzeBindingConflicts(owner, value, current)) {
        if (ids.indexOf(match.commandId) <= index) continue;
        const id = `${owner}:${match.commandId}:${match.kind}:${match.ownerBinding}:${match.binding}`;
        if (seen.has(id)) continue;
        seen.add(id); conflicts.push({ ...match, owner });
      }
    }
  }
  return conflicts;
}

export type BindingSource = "default" | "user" | "project";
export function bindingSource(commandId: CommandId, scope: "global" | "project"): BindingSource {
  const snapshot = settings.snapshot();
  if (scope === "project" && Object.prototype.hasOwnProperty.call(snapshot.project.keybindings ?? {}, commandId)) return "project";
  if (Object.prototype.hasOwnProperty.call(snapshot.global.keybindings ?? {}, commandId)) return "user";
  return "default";
}
export function resolveBindingSequence(sequenceValue: string, scope: "global" | "project", activeContext?: string) {
  const sequence = parseBinding(sequenceValue);
  const current = bindings(scope);
  const matching = (Object.keys(commandCatalog) as CommandId[]).filter((id) => {
    const candidates = sequencesFrom(id, current).map(parseBinding);
    return candidates.some((candidate) => candidate.length === sequence.length && candidate.every((stroke, index) => stroke === sequence[index]))
      && (!activeContext || contextIsActive(commandCatalog[id].context, activeContext));
  }).sort((a, b) => commandCatalog[b].context.length - commandCatalog[a].context.length);
  const prefixes = sequence.length === 1 ? (Object.keys(commandCatalog) as CommandId[]).filter((id) => {
    const candidates = sequencesFrom(id, current).map(parseBinding);
    return candidates.some((candidate) => candidate.length === 2 && candidate[0] === sequence[0]) && (!activeContext || contextIsActive(commandCatalog[id].context, activeContext));
  }) : [];
  const commandId = matching[0];
  return {
    ...(commandId ? { commandId, source: bindingSource(commandId, scope), context: commandCatalog[commandId].context } : {}),
    shadowed: commandId ? matching.slice(1) : [],
    chordCommands: prefixes,
    unassigned: !commandId && prefixes.length === 0
  };
}

const isApplePlatform = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const isWindowsPlatform = typeof navigator !== "undefined" && /Win/.test(navigator.platform);
const osReserved = new Set(isApplePlatform
  ? ["Mod+Q", "Mod+Space", "Mod+Tab", "Mod+Ctrl+Q"]
  : isWindowsPlatform
    ? ["Alt+F4", "Alt+Tab", "Mod+Escape", "Mod+Shift+Escape", "Mod+Alt+Delete", "Ctrl+Space", "Ctrl+Tab"]
    : ["Alt+F4"]);
export function isOsReserved(binding: string): boolean { return parseBinding(binding).some((stroke) => osReserved.has(stroke)); }

function activeContextPath(event: KeyboardEvent): string {
  const target = event.target instanceof Element ? event.target : document.activeElement;
  if (target === document.body && document.querySelector('[role="dialog"][aria-modal="true"]')) return "dialog";
  if (target?.closest(".settings-shortcut-manager")) return "manager.shortcut-manager";
  if (target?.closest("[role=dialog]")) return "dialog";
  if (target?.closest(".project-directory-v044") || (target === document.body && document.querySelector(".project-directory-v044"))) return "directory";
  if (target?.closest(".preview-local-editor, .monaco-editor")) {
    if (target.closest(".preview-local-editor")) return "workspace.editor.preview.block-edit";
    return "workspace.editor.source.text";
  }
  if (target?.closest(".structured-preview")) {
    return commands.canExecute("block.copy") ? "workspace.editor.preview.block-selected" : "workspace.editor.preview";
  }
  if (target?.closest(".tree-section")) return "workspace.file-tree";
  if (target?.closest(".relation-browser")) return "workspace.editor.relation";
  if (target?.closest(".advanced-search-panel")) return "workspace.search";
  if (target?.closest(".editor-surface")) return "workspace.editor.source.text";
  if (target?.closest(".workbench") || target === document.body) {
    if (document.activeElement === document.body && document.querySelector<HTMLElement>(".structured-preview")?.getClientRects().length && commands.canExecute("block.copy")) return "workspace.editor.preview.block-selected";
    return "workspace";
  }
  return "global";
}
function contextIsActive(commandContext: string, active: string): boolean {
  return commandContext === "global" || active === commandContext || active.startsWith(`${commandContext}.`);
}

let pendingChord: { first: string; timer: number } | undefined;
function clearPendingChord() { if (pendingChord) window.clearTimeout(pendingChord.timer); pendingChord = undefined; }
export function installShortcuts() {
  const handler = (event: KeyboardEvent) => {
    if (event.isComposing || ["Control", "Meta", "Shift", "Alt"].includes(event.key) || (event.target as Element)?.closest("[data-shortcut-capture]")) return;
    const stroke = eventBinding(event);
    const activeContext = activeContextPath(event);
    if (pendingChord) {
      const first = pendingChord.first;
      clearPendingChord();
      const found = (Object.keys(commandCatalog) as CommandId[])
        .filter((id) => {
          return commandBindings(id).some((value) => { const sequence = parseBinding(value); return sequence.length === 2 && sequence[0] === first && sequence[1] === stroke; }) && contextIsActive(commandCatalog[id].context, activeContext) && commands.canExecute(id);
        })
        .sort((a, b) => commandCatalog[b].context.length - commandCatalog[a].context.length)[0];
      if (found && commands.execute(found)) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    const ids = (Object.keys(commandCatalog) as CommandId[]).filter((id) => {
      return commandBindings(id).some((value) => { const sequence = parseBinding(value); return sequence.length === 2 && sequence[0] === stroke; }) && contextIsActive(commandCatalog[id].context, activeContext) && commands.canExecute(id);
    });
    if (ids.length) {
      event.preventDefault(); event.stopImmediatePropagation();
      const timer = window.setTimeout(() => { pendingChord = undefined; }, 1100);
      pendingChord = { first: stroke, timer };
      return;
    }
    const found = (Object.keys(commandCatalog) as CommandId[])
      .filter((id) => {
        return commandBindings(id).some((value) => normalizeBinding(value) === stroke) && contextIsActive(commandCatalog[id].context, activeContext) && commands.canExecute(id);
      })
      .sort((a, b) => commandCatalog[b].context.length - commandCatalog[a].context.length)[0];
    if ((found === "block.selectPrevious" || found === "block.selectNext")
      && event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], [role='combobox']")) return;
    if (event.repeat && found !== "edit.undo" && found !== "edit.redo" && found !== "block.selectPrevious" && found !== "block.selectNext") return;
    if (found && commands.execute(found)) { event.preventDefault(); event.stopImmediatePropagation(); }
  };
  window.addEventListener("keydown", handler, true);
  return () => { clearPendingChord(); window.removeEventListener("keydown", handler, true); };
}
