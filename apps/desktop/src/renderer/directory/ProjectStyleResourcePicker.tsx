import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { StyleResource } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { styleResourceName, styleResourceDescription } from "../i18n/displayNames.js";
import { DirectoryIcon } from "./DirectoryIcon.js";

export function ProjectStyleResourcePicker({ styleResources, baseResource, setBaseResource, extraResources, setExtraResources }: {
  styleResources: StyleResource[]; baseResource: string; setBaseResource(value: string): void;
  extraResources: string[]; setExtraResources: Dispatch<SetStateAction<string[]>>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedOnly, setSelectedOnly] = useState(false);
  const hintId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const resources = styleResources.filter(resource => !(resource.source === "built-in" && resource.id === "empty"));
  const selected = resources.filter(resource => resource.id === baseResource || extraResources.includes(resource.id));
  const emptyName = t("resource.preset.empty.name");
  const clearSelection = () => { setBaseResource(""); setExtraResources([]); };
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    return () => trigger.current?.focus();
  }, [open]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = resources.filter(resource => (!selectedOnly || selected.includes(resource)) && `${styleResourceName(resource)} ${styleResourceDescription(resource)} ${resource.files.map(file => file.targetPath).join(" ")}`.toLocaleLowerCase().includes(needle));
  return <fieldset className="resource-picker">
    <legend>{t("resource.choose")}</legend>
    <button ref={trigger} type="button" className="style-picker-entry" onClick={() => { setQuery(""); setSelectedOnly(false); setOpen(true); }} aria-haspopup="dialog" aria-expanded={open} title={selected.map(styleResourceName).join(" · ") || emptyName}>
      <span className="style-picker-summary"><strong>{selected[0] ? styleResourceName(selected[0]) : emptyName}</strong><small>{selected.length ? t("directory.selected", { count: selected.length }) : t("resource.preset.empty.description")}</small></span>
      {selected.length > 1 && <span className="style-picker-count">+{selected.length - 1}</span>}<DirectoryIcon name="next"/>
    </button>
    {open && createPortal(<div className="style-selector-backdrop" onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="style-selector" role="dialog" aria-modal="true" aria-label={t("resource.choose")} aria-describedby={hintId} onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
        if (event.key === "Tab") {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)"));
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <header><h2>{t("resource.choose")}</h2><button type="button" aria-label={t("common.close")} onClick={() => setOpen(false)}><DirectoryIcon name="close"/></button></header>
        <p id={hintId} className="style-selector-hint">{t("resource.chooseHint")}</p>
        <div className="style-selector-searchbox"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input ref={search} className="style-selector-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("resource.searchPresets")} aria-label={t("resource.searchPresets")}/></div>
        <div className="style-selector-tools">
          <div role="group" aria-label={t("resource.choose")}><button type="button" aria-pressed={!selectedOnly} onClick={() => setSelectedOnly(false)}>{t("history.all")} <span>{resources.length}</span></button><button type="button" aria-pressed={selectedOnly} onClick={() => setSelectedOnly(true)}>{t("directory.selected", { count: selected.length })}</button></div>
          <button type="button" className="style-selector-clear" disabled={!selected.length} onClick={clearSelection}>{t("resource.clearSelection")}</button>
        </div>
        <button type="button" className="style-selector-item style-selector-empty" aria-pressed={!selected.length} onClick={clearSelection}>
          <DirectoryIcon name={selected.length ? "unchecked" : "selected"}/><span><strong>{emptyName}</strong><small>{t("resource.preset.empty.description")}</small></span>
        </button>
        <div className="style-selector-list">
          {(["built-in", "user"] as const).map(source => {
            const group = visible.filter(resource => resource.source === source);
            return group.length > 0 && <div key={source}>
            <h3>{t(source === "built-in" ? "resource.builtIn" : "resource.myResources")} <span>{group.length}</span></h3>
            {group.map(resource => <label className="style-selector-item" key={resource.id} data-resource-id={resource.id}>
              <input type="checkbox" checked={source === "built-in" ? baseResource === resource.id : extraResources.includes(resource.id)} onChange={() => {
                if (source === "built-in") setBaseResource(baseResource === resource.id ? "" : resource.id);
                else setExtraResources(current => current.includes(resource.id) ? current.filter(id => id !== resource.id) : [...current, resource.id]);
              }}/><span><strong title={styleResourceName(resource)}>{styleResourceName(resource)}</strong><small title={styleResourceDescription(resource)}>{styleResourceDescription(resource)}</small>{resource.files.length > 0 && <code title={resource.files.map(file => file.targetPath).join(", ")}>{resource.files.map(file => file.targetPath).join(", ")}</code>}</span>
            </label>)}
          </div>; })}
          {!visible.length && <p>{t("resource.noMatches")}</p>}
        </div>
        <footer><span role="status">{selected.length ? t("directory.selected", { count: selected.length }) : emptyName}</span><button type="button" className="primary-button" onClick={() => setOpen(false)}>{t("common.close")}</button></footer>
      </section>
    </div>, document.body)}
  </fieldset>;
}
