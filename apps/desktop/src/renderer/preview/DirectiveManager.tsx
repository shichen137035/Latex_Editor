import { directiveColorStyle } from "./directive-colors.js";
import { directiveName, directiveNames } from "../i18n/displayNames.js";
import { LocalizedNameInput } from "../i18n/LocalizedNameInput.js";
import { mergeDirectiveEdit } from "./environmentEdits.js";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { defaultPreviewDirectives, type PreviewDirectiveDefinition } from "@latex-editor/contracts";
import { getLocale, t } from "../i18n/index.js";
import "./directive-manager.css";

function sampleSource(item: PreviewDirectiveDefinition): string {
  if (item.match.kind === "blank-line") return "";
  return `\\${item.match.name}${["bibliography", "bibliographystyle", "addbibresource", "nocite"].includes(item.match.name) ? "{references}" : ""}`;
}

function customCommandName(number: number): string {
  let suffix = "";
  while (number > 0) {
    number -= 1;
    suffix = String.fromCharCode(97 + number % 26) + suffix;
    number = Math.floor(number / 26);
  }
  return `customcommand${suffix}`;
}

export function DirectiveManager({ definitions, onChange, toolbarTarget }: {
  definitions: PreviewDirectiveDefinition[];
  onChange(next: PreviewDirectiveDefinition[]): void;
  toolbarTarget?: HTMLElement | null;
}) {
  const [selectedId, setSelectedId] = useState(definitions[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<"all" | "built-in" | "custom">("all");
  const [draftName, setDraftName] = useState("");
  const [nameError, setNameError] = useState("");
  const selected = definitions.find((item) => item.id === selectedId) ?? definitions[0];
  const pending = useRef<{ received: PreviewDirectiveDefinition; latest: PreviewDirectiveDefinition } | undefined>(undefined);

  useEffect(() => {
    setDraftName(selected?.match.kind === "command" ? selected.match.name : "");
    setNameError("");
  }, [selected?.id, selected?.match.kind === "command" ? selected.match.name : ""]);

  const filtered = definitions.filter((item) => {
    const text = `${directiveName(item)} ${Object.values(directiveNames(item)).join(" ")} ${item.id} ${item.match.kind === "command" ? item.match.name : "blank line"}`.toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (group === "all" || (group === "built-in") === item.builtIn);
  });
  const update = (next: PreviewDirectiveDefinition, reset = false) => {
    if (!selected) return;
    const previous = pending.current;
    const latest = previous?.received.id === selected.id ? mergeDirectiveEdit(previous.received, selected, previous.latest) : selected;
    const merged = reset ? next : mergeDirectiveEdit(selected, next, latest);
    pending.current = { received: selected, latest: merged };
    onChange(definitions.map(item => item.id === next.id ? merged : item));
  };
  const add = () => {
    let number = 1;
    let name = customCommandName(number);
    while (definitions.some((item) => item.id === `custom-command-${number}` || item.match.kind === "command" && item.match.name === name)) name = customCommandName(++number);
    const item: PreviewDirectiveDefinition = { id: `custom-command-${number}`, builtIn: false, enabled: true,
      match: { kind: "command", name }, label: "", labels: { [getLocale()]: t("ui.DirectiveManager.custom_command") }, display: "divider", color: "#637da4", placement: "nested" };
    onChange([...definitions, item]);
    setSelectedId(item.id);
    setQuery("");
    setGroup("all");
  };
  const commitName = () => {
    if (!selected || selected.match.kind !== "command" || selected.builtIn) return;
    const name = draftName.replace(/^\\/, "").trim();
    if (!/^[A-Za-z@]+$/.test(name) || definitions.some((item) => item.id !== selected.id && item.enabled && item.match.kind === "command" && item.match.name === name)) {
      setNameError(t("directive.invalidName"));
      return;
    }
    setNameError("");
    if (name !== selected.match.name) update({ ...selected, match: { kind: "command", name } });
  };
  const toolbar = <button type="button" className="directive-add" onClick={add}>{t("directive.add")}</button>;

  return <div className="directive-manager">
    {toolbarTarget ? createPortal(toolbar, toolbarTarget) : <div className="directive-toolbar">{toolbar}</div>}
    <aside className="directive-list-pane">
      <div className="directive-list-filters">
        <input aria-label={t("directive.search")} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("directive.search")}/>
        <select aria-label={t("directive.filter")} value={group} onChange={(event) => setGroup(event.target.value as typeof group)}>
          <option value="all">{t("directive.all")}</option><option value="built-in">{t("directive.builtIn")}</option><option value="custom">{t("directive.custom")}</option>
        </select>
      </div>
      <div className="directive-list">{filtered.map((item) => <button type="button" key={item.id} className={item.id === selected?.id ? "active" : ""} onClick={() => setSelectedId(item.id)}>
        <span><strong>{directiveName(item)}</strong><small>{item.match.kind === "command" ? `\\${item.match.name}` : t("directive.blankLine")}</small></span>
        <em className={item.enabled ? "enabled" : ""}>{item.enabled ? t("directive.on") : t("directive.off")}</em>
      </button>)}{filtered.length === 0 && <p>{t("directive.noResults")}</p>}</div>
    </aside>
    <main className="directive-editor-pane">{selected && <>
      <div className="directive-editor-heading"><div><small>{selected.builtIn ? t("directive.builtIn") : t("directive.custom")}</small><h2>{directiveName(selected)}</h2></div><label className="directive-switch"><input type="checkbox" checked={selected.enabled} onChange={(event) => update({ ...selected, enabled: event.target.checked })}/><span>{selected.enabled ? t("directive.on") : t("directive.off")}</span></label></div>
      <p className="directive-editor-hint">{t("directive.standaloneHint")}</p>
      <div className="directive-editor-fields">
        <LocalizedNameInput id={selected.id} label={t("directive.label")} names={directiveNames(selected)} overrides={selected.labels} fallback={locale => directiveName(selected, locale)} onChange={labels => update({ ...selected, labels })}/>
        <label><span>{t("directive.source")}</span><input value={selected.match.kind === "command" ? draftName : t("directive.blankLine")} disabled={selected.builtIn || selected.match.kind === "blank-line"} onChange={(event) => setDraftName(event.target.value)} onBlur={commitName} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}/>{nameError && <small className="directive-error">{nameError}</small>}</label>
        <label><span>{t("directive.display")}</span><select value={selected.display} onChange={(event) => update({ ...selected, display: event.target.value as PreviewDirectiveDefinition["display"] })}><option value="divider">{t("directive.divider")}</option><option value="placeholder">{t("directive.placeholder")}</option><option value="spacer">{t("directive.spacer")}</option></select></label>
        <label><span>{t("directive.placement")}</span><select value={selected.placement ?? "nested"} onChange={(event) => update({ ...selected, placement: event.target.value as NonNullable<PreviewDirectiveDefinition["placement"]> })}><option value="nested">{t("directive.nested")}</option><option value="trailing">{t("directive.trailing")}</option><option value="independent">{t("directive.independent")}</option></select><small>{t("directive.scopeHint")}</small></label>
        <label><span>{t("colors.mode")}</span><select value={selected.colorMode ?? "adaptive"} onChange={event => update({ ...selected, colorMode: event.target.value as "adaptive" | "fixed" })}><option value="adaptive">{t("colors.adaptive")}</option><option value="fixed">{t("colors.fixed")}</option></select></label><label><span>{t("directive.color")}</span><input type="color" value={selected.color} onChange={(event) => update({ ...selected, color: event.target.value })}/></label>
      </div>
      <div className="directive-sample"><small>{t("directive.sample")}</small><div className={`preview-content-region preview-directive preview-directive-${selected.display}`} style={directiveColorStyle(selected)}><span className="preview-directive-line"/><span className="preview-directive-label">{selected.match.kind === "blank-line" ? "" : directiveName(selected)}</span><span className="preview-directive-line"/>{selected.display === "placeholder" && <code>{sampleSource(selected)}</code>}</div></div>
      <div className="directive-editor-actions">{selected.builtIn
        ? <button type="button" onClick={() => { const original = defaultPreviewDirectives.find((item) => item.id === selected.id); if (original) update(original, true); }}>{t("directive.reset")}</button>
        : <button type="button" className="danger" onClick={() => { onChange(definitions.filter((item) => item.id !== selected.id)); setSelectedId(definitions.find((item) => item.id !== selected.id)?.id ?? ""); }}>{t("directive.delete")}</button>}
      </div>
    </>}</main>
  </div>;
}
