import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { PreferenceValues } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { commandBindings, commandCatalog, commandDescriptions, commandLabels, contextTree, displayBinding, eventBinding, findBindingConflicts, isOsReserved, listBindingConflicts, normalizeBinding, parseBinding, resolveBindingSequence, shortcutGroups, validBinding, type CommandId } from "./commands.js";
import type { useSettings } from "./service.js";

type Scope = "global" | "project";
type MapFilter = "all" | "assigned" | "available" | "conflicts";
type Modifier = "Mod" | "Ctrl" | "Alt" | "Shift";
type KeyboardKey = { key: string; label?: string; grow?: number; decorative?: boolean } | { modifier: Modifier; label: string; grow?: number } | { gap: number };
const key = (value: string, label?: string, grow = 1): KeyboardKey => ({ key: value, ...(label ? { label } : {}), grow });
const modifierKey = (value: Modifier, label: string, grow = 1): KeyboardKey => ({ modifier: value, label, grow });
const gap = (grow: number): KeyboardKey => ({ gap: grow });
const isAppleKeyboard = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const isWindowsKeyboard = typeof navigator !== "undefined" && /Win/.test(navigator.platform);
const bottomKeyboardRow = isAppleKeyboard
  ? [modifierKey("Ctrl", "Ctrl", 1.2), modifierKey("Alt", "Alt", 1.2), modifierKey("Mod", "Mod", 1.2), key("Space", "Space", 6.2), modifierKey("Mod", "Mod", 1.2), modifierKey("Alt", "Alt", 1.2), modifierKey("Ctrl", "Ctrl", 1.2)]
  : [modifierKey("Mod", "Mod", 1.2), modifierKey("Ctrl", "Ctrl", 1.2), modifierKey("Alt", "Alt", 1.2), key("Space", "Space", 6.2), modifierKey("Alt", "Alt", 1.2), modifierKey("Ctrl", "Ctrl", 1.2), modifierKey("Mod", "Mod", 1.2)];
const mainKeyboardRows: KeyboardKey[][] = [
  [key("Escape", "Esc"), gap(0.5), ...Array.from({ length: 4 }, (_, index) => key(`F${index + 1}`)), gap(0.35), ...Array.from({ length: 4 }, (_, index) => key(`F${index + 5}`)), gap(0.35), ...Array.from({ length: 4 }, (_, index) => key(`F${index + 9}`))],
  [key("Backquote", "~", 0.8), ..."1234567890".split("").map((value) => key(value)), key("-"), key("="), key("Backspace", "Backspace", 1.8)],
  [key("Tab", "Tab", 1.35), ..."QWERTYUIOP".split("").map((value) => key(value)), key("["), key("]"), key("Backslash", "\\", 1.3)],
  [key("CapsLock", "Caps", 1.6), ..."ASDFGHJKL".split("").map((value) => key(value)), key(";"), key("Quote", "'"), key("Enter", "Enter", 1.8)],
  [modifierKey("Shift", "Shift", 2.1), ..."ZXCVBNM".split("").map((value) => key(value)), key(","), key("."), key("/"), modifierKey("Shift", "Shift", 2.1)],
  bottomKeyboardRow,
];
const navigationRows: KeyboardKey[][] = [
  [key("Insert", "Ins"), key("Home"), key("PageUp", "PgUp")],
  [key("Delete", "Del"), key("End"), key("PageDown", "PgDn")],
];
const mapKeys = [...new Set([...mainKeyboardRows.flat(), ...navigationRows.flat()].flatMap((item) => "key" in item && !item.decorative && !["Backquote", "Backslash", "CapsLock", "Quote"].includes(item.key) ? [item.key] : [] ).concat(["Up", "Down", "Left", "Right"]))];
const modifierOrder: Modifier[] = ["Mod", "Ctrl", "Alt", "Shift"];
const modifierOptions = ["", ...Array.from({ length: 15 }, (_, index) => modifierOrder.filter((_, bit) => (index + 1) & (1 << bit)).join("+"))];
type NativeShortcut = { binding: string; label: string; platform: "all" | "apple" | "windows" | "other" };
const nativeShortcuts: NativeShortcut[] = [
  { binding: "Mod+A", label: "shortcut.native.selectAll", platform: "all" },
  { binding: "Mod+C", label: "shortcut.native.copy", platform: "all" },
  { binding: "Mod+X", label: "shortcut.native.cut", platform: "all" },
  { binding: "Mod+V", label: "shortcut.native.paste", platform: "all" },
  { binding: "Mod+Q", label: "shortcut.native.quit", platform: "apple" },
  { binding: "Mod+Tab", label: "shortcut.native.switchApps", platform: "apple" },
  { binding: "Mod+Space", label: "shortcut.native.systemSearch", platform: "apple" },
  { binding: "Ctrl+Mod+Q", label: "shortcut.native.lockScreen", platform: "apple" },
  { binding: "Alt+Tab", label: "shortcut.native.switchApps", platform: "windows" },
  { binding: "Alt+F4", label: "shortcut.native.closeWindow", platform: "windows" },
  { binding: "Mod+Escape", label: "shortcut.native.openStart", platform: "windows" },
  { binding: "Mod+Shift+Escape", label: "shortcut.native.taskManager", platform: "windows" },
  { binding: "Ctrl+Tab", label: "shortcut.native.taskView", platform: "windows" },
  { binding: "Ctrl+Space", label: "shortcut.native.inputLanguage", platform: "windows" },
  { binding: "Mod+Alt+Delete", label: "shortcut.native.securityOptions", platform: "windows" },
  { binding: "Mod+Insert", label: "shortcut.native.copyAlternate", platform: "windows" },
  { binding: "Shift+Insert", label: "shortcut.native.pasteAlternate", platform: "windows" },
  { binding: "Shift+Delete", label: "shortcut.native.cutAlternate", platform: "windows" },
  { binding: "Alt+F4", label: "shortcut.native.closeWindow", platform: "other" },
];
function nativeActionsForBinding(binding: string) {
  const platform = isAppleKeyboard ? "apple" : isWindowsKeyboard ? "windows" : "other";
  return nativeShortcuts.filter((item) => (item.platform === "all" || item.platform === platform) && normalizeBinding(item.binding) === binding);
}
function modifierLabel(value: string) {
  if (!value) return t("shortcut.modifier.none");
  const key = `shortcut.modifier.${value.replaceAll("+", ".")}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return value.split("+").map((part) => t(`shortcut.modifier.${part}`)).join(" + ");
}
function modifiersFromEvent(event: KeyboardEvent): string {
  const active: Modifier[] = [];
  if (isAppleKeyboard ? event.metaKey : event.ctrlKey) active.push("Mod");
  if (isAppleKeyboard ? event.ctrlKey : event.metaKey) active.push("Ctrl");
  if (event.altKey) active.push("Alt");
  if (event.shiftKey) active.push("Shift");
  return modifierOrder.filter((item) => active.includes(item)).join("+");
}
function modifierKeyLabel(modifier: Modifier) {
  if (modifier === "Mod") return isAppleKeyboard ? "⌘" : "Ctrl";
  if (modifier === "Ctrl") return isAppleKeyboard ? "Ctrl" : isWindowsKeyboard ? "Win" : "Super";
  if (modifier === "Alt") return isAppleKeyboard ? "Option" : "Alt";
  return "Shift";
}
const contextLabelKeys: Record<string, string> = { "global": "command.context.global", "workspace": "shortcut.context.workspace", "workspace.editor": "shortcut.context.editor", "workspace.editor.source": "command.context.source", "workspace.editor.source.text": "command.context.source", "workspace.editor.preview": "shortcut.context.preview", "workspace.editor.preview.block-selected": "command.context.previewBlock", "workspace.editor.preview.block-edit": "command.context.previewDraft", "workspace.editor.relation": "shortcut.context.relation", "workspace.file-tree": "shortcut.context.fileTree", "workspace.search": "shortcut.context.search", "dialog": "shortcut.context.dialog", "manager.shortcut-manager": "shortcut.context.shortcutManager" };
function contextLabel(context: string) { return t(context === "directory" ? "shortcut.context.directory" : contextLabelKeys[context] ?? context); }

export function ShortcutManager({ store, scope }: { store: ReturnType<typeof useSettings>; scope: Scope }) {
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [nameFilter, setNameFilter] = useState("");
  const [bindingFilter, setBindingFilter] = useState("");
  const [conflictFilter, setConflictFilter] = useState("all");
  const [capture, setCapture] = useState<CommandId>();
  const [captureStage, setCaptureStage] = useState<"first" | "choose" | "second">("first");
  const [draftSequence, setDraftSequence] = useState<string[]>([]);
  const [captureConflict, setCaptureConflict] = useState<ReturnType<typeof findBindingConflicts>>([]);
  const [osWarning, setOsWarning] = useState(false);
  const [modifier, setModifier] = useState("Mod");
  const [pressedModifier, setPressedModifier] = useState("");
  const [mapContext, setMapContext] = useState("all");
  const [mapFilter, setMapFilter] = useState<MapFilter>("all");
  const [testMode, setTestMode] = useState(false);
  const [testedKey, setTestedKey] = useState("");
  const [testedSequence, setTestedSequence] = useState("");
  const [testChordFirst, setTestChordFirst] = useState("");
  const [testResolution, setTestResolution] = useState<ReturnType<typeof resolveBindingSequence>>();
  const captureInputRef = useRef<HTMLInputElement>(null);

  const rawOverrides = (scope === "global" ? store.global("keybindings") : (store.snapshot().project.keybindings ?? {})) as PreferenceValues["keybindings"];
  const conflicts = useMemo(() => listBindingConflicts(scope), [scope, store.snapshot()]);
  const conflictedIds = useMemo(() => new Set(conflicts.flatMap((item) => [item.owner, item.commandId])), [conflicts]);
  const reservedIds = useMemo(() => new Set((Object.keys(commandCatalog) as CommandId[]).filter((id) => commandBindings(id, scope).some(isOsReserved))), [scope, store.snapshot()]);

  const persist = (patches: Partial<Record<CommandId, string>>) => {
    const next = { ...rawOverrides, ...patches };
    void store.set("keybindings", next, scope);
    setCapture(undefined); setCaptureConflict([]); setOsWarning(false); setDraftSequence([]);
  };
  const resetBinding = (id: CommandId) => {
    const next = { ...rawOverrides };
    delete next[id];
    void store.set("keybindings", next, scope);
  };
  const openCapture = (id: CommandId) => {
    setCapture(id); setCaptureStage("first"); setDraftSequence([]); setCaptureConflict([]); setOsWarning(false); setTestMode(false); setTestedKey(""); setTestedSequence(""); setTestResolution(undefined); setPressedModifier("");
  };
  const candidateBinding = normalizeBinding(draftSequence.join(", "));
  const candidateNativeActions = nativeActionsForBinding(candidateBinding);
  const validateAndAssign = (replaceConflicts = false) => {
    if (!capture || !validBinding(candidateBinding) || !candidateBinding) return;
    const nextConflicts = findBindingConflicts(capture, candidateBinding, scope);
    const direct = nextConflicts.filter((item) => item.kind === "direct");
    const prefix = nextConflicts.filter((item) => item.kind === "prefix");
    if (prefix.length) { setCaptureConflict(prefix); return; }
    if (direct.length && !replaceConflicts) { setCaptureConflict(nextConflicts); return; }
    if (nextConflicts.some((item) => item.kind === "overlap") && !replaceConflicts) { setCaptureConflict(nextConflicts); return; }
    persist({ [capture]: candidateBinding, ...(replaceConflicts ? Object.fromEntries(direct.map((item) => [item.commandId, ""])) : {}) });
  };

  const handleCaptureKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    event.preventDefault(); event.stopPropagation();
    setPressedModifier(modifiersFromEvent(event.nativeEvent));
    if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return;
    const stroke = eventBinding(event.nativeEvent);
    const sequence = captureStage === "second" ? [...draftSequence, stroke] : [stroke];
    const binding = normalizeBinding(sequence.join(", "));
    setDraftSequence(sequence); setCaptureConflict(findBindingConflicts(capture!, binding, scope)); setOsWarning(isOsReserved(binding)); setTestedKey(stroke);
    if (captureStage === "first") setCaptureStage("choose");
    else if (captureStage === "second") setCaptureStage("choose");
  };
  const handleCaptureKeyUp = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    setPressedModifier(modifiersFromEvent(event.nativeEvent));
    event.preventDefault(); event.stopPropagation();
  };

  useEffect(() => {
    if (capture) captureInputRef.current?.focus();
  }, [capture, captureStage]);

  useEffect(() => {
    if (!testMode) return;
    const test = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest(".shortcut-modifier-preview, [data-shortcut-capture]")) return;
      if (event.isComposing || ["Control", "Meta", "Shift", "Alt"].includes(event.key)) return;
      const key = eventBinding(event);
      setTestedKey(key);
      const sequence = testChordFirst ? `${testChordFirst}, ${key}` : key;
      const resolution = resolveBindingSequence(sequence, scope, mapContext === "all" ? undefined : mapContext);
      setTestedSequence(sequence);
      setTestResolution(resolution);
      if (resolution.chordCommands.length && !testChordFirst) setTestChordFirst(key);
      else setTestChordFirst("");
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === "Escape") { setTestMode(false); setTestChordFirst(""); }
    };
    window.addEventListener("keydown", test, true);
    return () => window.removeEventListener("keydown", test, true);
  }, [testMode, testChordFirst, scope, mapContext]);

  const handleModifierPreviewKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const modifiers = modifiersFromEvent(event.nativeEvent);
    setPressedModifier(modifiers);
    if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const effectiveContextPaths = mapContext === "all" ? undefined : ["global", mapContext, ...contextTree.filter((item) => mapContext.startsWith(`${item.id}.`)).map((item) => item.id)];
  const matchingCommands = (Object.keys(commandCatalog) as CommandId[]).filter((id) => {
    const definition = commandCatalog[id];
    const commandShortcuts = commandBindings(id, scope);
    const terms = `${t(commandLabels[id])} ${t(commandDescriptions[id])}`.toLocaleLowerCase();
    const shortcutTerms = commandShortcuts.map(displayBinding).join(" ").toLocaleLowerCase();
    const belongsToContext = !effectiveContextPaths || effectiveContextPaths.some((path) => definition.context === path || definition.context.startsWith(`${path}.`));
    if (!belongsToContext) return false;
    if (groupFilter !== "all" && definition.group !== groupFilter) return false;
    if (nameFilter.trim() && !terms.includes(nameFilter.trim().toLocaleLowerCase())) return false;
    if (bindingFilter.trim() && !shortcutTerms.replaceAll(/\s+/g, "").includes(bindingFilter.trim().toLocaleLowerCase().replaceAll(/\s+/g, ""))) return false;
    if (conflictFilter === "conflicts" && !conflictedIds.has(id)) return false;
    if (conflictFilter === "reserved" && !reservedIds.has(id)) return false;
    if (conflictFilter === "clear" && (conflictedIds.has(id) || reservedIds.has(id))) return false;
    if (conflictFilter === "assigned" && !commandShortcuts.length) return false;
    if (conflictFilter === "unassigned" && commandShortcuts.length) return false;
    return true;
  });

  const activeModifier = capture ? pressedModifier : pressedModifier || modifier;
  const keysForMap = mapKeys.map((key) => {
    const binding = normalizeBinding(`${activeModifier ? `${activeModifier}+` : ""}${key}`);
    const nativeActions = nativeActionsForBinding(binding);
    const owners = (Object.keys(commandCatalog) as CommandId[]).filter((id) => {
      const belongsToContext = !effectiveContextPaths || effectiveContextPaths.some((path) => commandCatalog[id].context === path || commandCatalog[id].context.startsWith(`${path}.`));
      return commandBindings(id, scope).some((shortcut) => parseBinding(shortcut)[0] === binding) && belongsToContext;
    });
    const chordPrefix = (Object.keys(commandCatalog) as CommandId[]).some((id) => {
      const belongsToContext = !effectiveContextPaths || effectiveContextPaths.some((path) => commandCatalog[id].context === path || commandCatalog[id].context.startsWith(`${path}.`));
      return belongsToContext && commandBindings(id, scope).some((shortcut) => { const sequence = parseBinding(shortcut); return sequence.length === 2 && sequence[0] === binding; });
    });
    const isConflict = owners.some((owner) => conflictedIds.has(owner));
    const reserved = isOsReserved(binding);
    const status = isConflict ? "conflict" : chordPrefix ? "prefix" : reserved ? "reserved" : owners.length > 1 ? "multiple" : owners.length ? "assigned" : nativeActions.length ? "native" : "unused";
    return { key, binding, owners, nativeActions, status };
  });
  const keyMap = new Map(keysForMap.map((item) => [item.key, item]));
  const isKeyVisible = (item: (typeof keysForMap)[number]) => mapFilter === "all" || (mapFilter === "assigned" ? item.status === "assigned" || item.status === "multiple" || item.status === "native" : mapFilter === "available" ? item.status === "unused" : item.status === "conflict" || item.status === "prefix" || item.status === "reserved");
  const visibleMapKeyCount = keysForMap.filter(isKeyVisible).length;
  const testedBaseKey = parseBinding(testedKey).at(-1)?.split("+").at(-1);
  const toggleModifier = (item: Modifier) => {
    const current = new Set(modifier.split("+").filter(Boolean));
    if (current.has(item)) current.delete(item); else current.add(item);
    setModifier(modifierOrder.filter((part) => current.has(part)).join("+"));
  };
  const renderKeyboardItem = (item: KeyboardKey, index: number) => {
    if ("gap" in item) return <span className="shortcut-keyboard-gap" style={{ flexGrow: item.gap }} key={`gap-${index}`} aria-hidden="true"/>;
    if ("modifier" in item) {
      const selected = activeModifier.split("+").includes(item.modifier);
      const held = pressedModifier.split("+").includes(item.modifier);
      return <button type="button" disabled={Boolean(capture)} className={`shortcut-map-key shortcut-modifier-key${selected ? " selected" : ""}${held ? " held" : ""}`} key={`modifier-${item.modifier}-${index}`} style={{ flexGrow: item.grow ?? 1 }} aria-label={`${t("shortcut.modifier")}: ${modifierLabel(item.modifier)}`} aria-pressed={selected} onClick={() => toggleModifier(item.modifier)} title={modifierLabel(item.modifier)}><strong>{modifierKeyLabel(item.modifier)}</strong></button>;
    }
    if (item.decorative) return <div className="shortcut-map-key shortcut-key-decorative" key={`${item.key}-${index}`} style={{ flexGrow: item.grow ?? 1 }} aria-hidden="true"><strong>{item.label ?? item.key}</strong></div>;
    const keyInfo = keyMap.get(item.key);
    if (!keyInfo) return <div className="shortcut-map-key shortcut-key-decorative" key={`${item.key}-${index}`} style={{ flexGrow: item.grow ?? 1 }} aria-hidden="true"><strong>{item.label ?? item.key}</strong></div>;
    const filtered = !isKeyVisible(keyInfo);
    const details = [...keyInfo.nativeActions.map((action) => `${t("shortcut.nativeCategory")}: ${t(action.label)}`), ...keyInfo.owners.map((id) => `${t("shortcut.appCategory")}: ${t(commandLabels[id])} · ${contextLabel(commandCatalog[id].context)}`)];
    const indicatorCount = keyInfo.owners.length + keyInfo.nativeActions.length;
    return <div className={`shortcut-map-key ${keyInfo.status}${filtered ? " filtered-out" : ""}${testedBaseKey === item.key ? " tested" : ""}`} key={`${item.key}-${index}`} style={{ flexGrow: item.grow ?? 1 }} title={details.join("\n") || item.key} aria-label={`${item.label ?? item.key}: ${[...keyInfo.nativeActions.map((action) => t(action.label)), ...keyInfo.owners.map((id) => t(commandLabels[id]))].join(", ") || t(`shortcut.keyStatus.${keyInfo.status}`)}`}><strong>{item.label ?? item.key}</strong>{indicatorCount > 0 && <small>{indicatorCount}</small>}</div>;
  };

  return <div className="settings-shortcut-manager">
    <section className="shortcut-map-view">
      <div className="shortcut-map-filter-panel">
        {scope === "project" && <p className="shortcut-scope-hint">{t("shortcut.projectHint")}</p>}
        <div className="shortcut-map-controls">
          <label>{t("shortcut.modifier")}<select value={modifier} onChange={(event) => setModifier(event.target.value)}>{modifierOptions.map((item) => <option key={item || "none"} value={item}>{modifierLabel(item)}</option>)}</select></label>
          <label>{t("shortcut.context")}<select value={mapContext} onChange={(event) => setMapContext(event.target.value)}><option value="all">{t("shortcut.context.all")}</option>{contextTree.map((item) => <option key={item.id} value={item.id}>{contextLabel(item.id)}</option>)}</select></label>
          <label>{t("shortcut.showKeys")}<select value={mapFilter} onChange={(event) => setMapFilter(event.target.value as MapFilter)}>{(["all", "assigned", "available", "conflicts"] as const).map((item) => <option key={item} value={item}>{t("shortcut.mapFilter." + item)}</option>)}</select></label>
          <label className="shortcut-manager-reference-modifier"><span>{t("settings.referenceLinkModifier")}</span><select disabled={scope === "project"} value={store.global("referenceLinkModifier")} onChange={(event) => void store.set("referenceLinkModifier", event.target.value as "ctrl" | "alt" | "shift" | "meta", "global")}>{(["ctrl", "alt", "shift", "meta"] as const).map((item) => <option key={item} value={item}>{t("settings.modifier" + item[0]!.toUpperCase() + item.slice(1))}</option>)}</select></label>
          <button type="button" className={testMode ? "active" : ""} disabled={mapContext === "all" && !testMode} title={mapContext === "all" ? t("shortcut.selectContext") : undefined} onClick={() => { setTestMode((value) => !value); setTestedKey(""); setTestedSequence(""); setTestChordFirst(""); setTestResolution(undefined); }}>{testMode ? t("shortcut.stopTest") : t("shortcut.testKeys")}</button>
          {testMode && <output className="shortcut-test-output">{testedKey ? displayBinding(testedSequence) : t("shortcut.pressToTest")}</output>}
        </div>
        <div className="shortcut-map-filters">
          <label>{t("shortcut.mapFilter.group")}<select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}><option value="all">{t("shortcut.mapFilter.allGroups")}</option>{shortcutGroups.map((group) => <option key={group} value={group}>{t("shortcut.group." + group)}</option>)}</select></label>
          <label className="shortcut-map-text-filter"><span>{t("shortcut.mapFilter.name")}</span><input value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} placeholder={t("shortcut.mapFilter.namePlaceholder")}/></label>
          <label className="shortcut-map-text-filter"><span>{t("shortcut.mapFilter.key")}</span><input value={bindingFilter} onChange={(event) => setBindingFilter(event.target.value)} placeholder={t("shortcut.mapFilter.keyPlaceholder")}/></label>
          <label>{t("shortcut.mapFilter.bindingStatus")}<select value={conflictFilter} onChange={(event) => setConflictFilter(event.target.value)}>{(["all", "conflicts", "reserved", "clear", "assigned", "unassigned"] as const).map((item) => <option key={item} value={item}>{t("shortcut.mapFilter.state." + item)}</option>)}</select></label>
        </div>
        <div className="shortcut-map-preview-row">
          <div className="shortcut-modifier-preview" tabIndex={0} role="group" aria-label={t("shortcut.holdModifiers")} onKeyDown={handleModifierPreviewKey} onKeyUp={handleModifierPreviewKey} onBlur={() => setPressedModifier("")}>
            <span className="shortcut-modifier-preview-hint">{t(capture ? "shortcut.mapFilter.pressReplacement" : "shortcut.holdModifiers")}</span><strong>{modifierLabel(activeModifier)}</strong>{pressedModifier && <small>{t("shortcut.modifierHeld")}</small>}
          </div>
        </div>
        {testMode && testResolution && <div className="shortcut-test-result">{testResolution.commandId ? <><strong>{t("shortcut.testCommand")}: {t(commandLabels[testResolution.commandId])}</strong><span>{t("shortcut.context")}: {contextLabel(testResolution.context!)}</span><span>{t("shortcut.source")}: {t("shortcut.source." + testResolution.source)}</span>{testResolution.shadowed.map((id) => <small key={id}>{t("shortcut.shadowed")}: {t(commandLabels[id])}</small>)}</> : testResolution.chordCommands.length ? <strong>{t("shortcut.chordPending")}: {testResolution.chordCommands.map((id) => t(commandLabels[id])).join(" · ")}</strong> : <strong>{t("shortcut.testUnassigned")}</strong>}</div>}
      </div>
      <div className="shortcut-map-function-scroll">
      <div className="shortcut-map-functions">
        <header><div><h2>{t("shortcut.mapFilter.functions")}</h2><span>{t("shortcut.mapFilter.functionCount", { count: matchingCommands.length })}</span></div><p>{t("shortcut.mapFilter.pickFunction")}</p></header>
        {shortcutGroups.map((group) => {
          const rows = matchingCommands.filter((id) => commandCatalog[id].group === group);
          if (!rows.length) return null;
          return <section className="shortcut-map-function-group" key={group}><h3>{t("shortcut.group." + group)}</h3>{rows.map((id) => {
            const shortcuts = commandBindings(id, scope);
            const isConflict = conflictedIds.has(id);
            const isModified = Object.prototype.hasOwnProperty.call(rawOverrides, id);
            return <article className={"shortcut-map-function" + (capture === id ? " active" : "") + (isConflict ? " has-conflict" : "")} key={id}>
              <div className="shortcut-map-function-heading">
                <button type="button" className="shortcut-map-function-select" aria-expanded={capture === id} onClick={() => capture === id ? setCapture(undefined) : openCapture(id)}>
                  <span className="shortcut-map-function-name"><strong>{t(commandLabels[id])}</strong><small>{t(commandDescriptions[id])}</small></span>
                  <span className="shortcut-map-function-meta"><small>{contextLabel(commandCatalog[id].context)}</small>{shortcuts.length ? shortcuts.map((binding, index) => <kbd key={id + ":" + index}>{displayBinding(binding)}</kbd>) : <em>{t("shortcut.unassigned")}</em>}{isConflict && <b>{t("shortcut.keyStatus.conflict")}</b>}</span>
                </button>
                {isModified && <button type="button" className="shortcut-map-reset" title={t("shortcut.resetBinding")} aria-label={t("shortcut.resetBinding") + ": " + t(commandLabels[id])} onClick={() => resetBinding(id)}>↺</button>}
              </div>
              {capture === id && <div className="shortcut-inline-recorder">
                <div className="shortcut-inline-recorder-prompt"><strong>{t("shortcut.mapFilter.pressReplacement")}</strong><input ref={captureInputRef} data-shortcut-capture readOnly value={candidateBinding ? displayBinding(candidateBinding) : ""} placeholder={t(captureStage === "second" ? "shortcut.recordSecond" : "shortcut.capture")} onKeyDown={handleCaptureKey} onKeyUp={handleCaptureKeyUp} onBlur={() => setPressedModifier("")}/></div>
                {captureStage === "choose" && <div className="shortcut-recorder-sequence">{draftSequence.map((stroke, index) => <kbd key={stroke + ":" + index}>{displayBinding(stroke)}</kbd>)}</div>}
                {captureStage === "choose" && candidateBinding && !validBinding(candidateBinding) && <p className="shortcut-recorder-warning" role="alert">{t("shortcut.invalid")}</p>}
                {captureConflict.length > 0 && <div className="shortcut-recorder-warning" role="alert"><strong>{t(captureConflict.some((item) => item.kind === "prefix") ? "shortcut.prefixConflict" : captureConflict.some((item) => item.kind === "direct") ? "shortcut.directConflict" : "shortcut.overlapConflict")}</strong>{captureConflict.map((item) => <p key={item.kind + ":" + item.commandId}>{t(commandLabels[item.commandId])} · {contextLabel(item.context)}</p>)}{captureConflict.some((item) => item.kind === "overlap") && !captureConflict.some((item) => item.kind === "direct" || item.kind === "prefix") && <button type="button" onClick={() => validateAndAssign(true)}>{t("shortcut.assignAnyway")}</button>}{captureConflict.some((item) => item.kind === "direct") && !captureConflict.some((item) => item.kind === "prefix") && <button type="button" onClick={() => validateAndAssign(true)}>{t("shortcut.replaceExisting")}</button>}</div>}
                {osWarning && <p className="shortcut-recorder-warning" role="status">{t("shortcut.osReservedHint")}</p>}
                {candidateNativeActions.length > 0 && <p className="shortcut-recorder-warning" role="status">{candidateNativeActions.map((action) => t(action.label)).join(" · ")}. {t("shortcut.nativeOverrideWarning")}</p>}
                <div className="shortcut-inline-recorder-actions">{captureStage === "choose" && <><button type="button" disabled={!candidateBinding || !validBinding(candidateBinding)} onClick={() => validateAndAssign()}>{t("shortcut.useBinding")}</button><button type="button" disabled={draftSequence.length !== 1} onClick={() => { setCaptureStage("second"); setCaptureConflict([]); }}>{t("shortcut.addSecondKey")}</button></>}{captureStage === "choose" && <button type="button" className="quiet" onClick={() => persist({ [id]: "" })}>{t("shortcut.clearBinding")}</button>}<button type="button" className="quiet" onClick={() => { setCapture(undefined); setCaptureConflict([]); setDraftSequence([]); setPressedModifier(""); }}>{t("project.cancel")}</button></div>
              </div>}
            </article>;
          })}</section>;
        })}
        {!matchingCommands.length && <p className="shortcut-empty">{t("shortcut.noCommands")}</p>}
      </div>
      </div>
      <div className="shortcut-map-head">
        <div className="shortcut-keyboard-viewport">
          <div className="shortcut-keyboard" aria-label={t("shortcut.availableKeys")}>
            <div className="shortcut-keyboard-main">{mainKeyboardRows.map((row, rowIndex) => <div className={"shortcut-keyboard-row row-" + (rowIndex + 1)} key={"row-" + rowIndex}>{row.map(renderKeyboardItem)}</div>)}</div>
            <div className="shortcut-keyboard-side">
              <div className="shortcut-keyboard-navigation">{navigationRows.flatMap((row, rowIndex) => row.map((item, index) => renderKeyboardItem(item, rowIndex * 3 + index)))}</div>
              <div className="shortcut-keyboard-arrows">{renderKeyboardItem(gap(1), 0)}{renderKeyboardItem(key("Up"), 1)}{renderKeyboardItem(gap(1), 2)}{renderKeyboardItem(key("Left"), 3)}{renderKeyboardItem(key("Down"), 4)}{renderKeyboardItem(key("Right"), 5)}</div>
            </div>
          </div>
        </div>
        {!visibleMapKeyCount && <p className="shortcut-empty">{t("shortcut.noKeys")}</p>}
        <div className="shortcut-map-legend">{(["unused", "assigned", "native", "multiple", "conflict", "prefix", "reserved"] as const).map((status) => <span key={status}><i className={status}/>{t("shortcut.keyStatus." + status)}</span>)}</div>
      </div>
    </section>
  </div>;
}
