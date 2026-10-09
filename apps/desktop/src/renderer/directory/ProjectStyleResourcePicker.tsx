import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = styleResources.filter(resource => resource.id === baseResource || extraResources.includes(resource.id));
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    return () => trigger.current?.focus();
  }, [open]);
  const needle = query.trim().toLocaleLowerCase();
  const visible = styleResources.filter(resource => `${styleResourceName(resource)} ${styleResourceDescription(resource)} ${resource.files.map(file => file.targetPath).join(" ")}`.toLocaleLowerCase().includes(needle));
  return <fieldset className="resource-picker">
    <legend>{t("resource.choose")}</legend>
    <button ref={trigger} type="button" className="style-picker-entry" onClick={() => { setQuery(""); setOpen(true); }} aria-haspopup="dialog">
      <span>{selected.map(styleResourceName).join(" · ") || t("resource.choose")}</span><DirectoryIcon name="next"/>
    </button>
    {open && createPortal(<div className="style-selector-backdrop" onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="style-selector" role="dialog" aria-modal="true" aria-label={t("resource.choose")} onKeyDown={event => {
        if (event.key === "Escape") { event.stopPropagation(); setOpen(false); }
        if (event.key === "Tab") {
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button, input"));
          const first = items[0], last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <header><h2>{t("resource.choose")}</h2><button type="button" aria-label={t("common.close")} onClick={() => setOpen(false)}><DirectoryIcon name="close"/></button></header>
        <input ref={search} className="style-selector-search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t("resource.searchPresets")} aria-label={t("resource.searchPresets")}/>
        <div className="style-selector-list">
          {(["built-in", "user"] as const).map(source => <div key={source}>
            <h3>{t(source === "built-in" ? "resource.builtIn" : "resource.myResources")}</h3>
            {visible.filter(resource => resource.source === source).map(resource => <label className="style-selector-item" key={resource.id}>
              <input type={source === "built-in" ? "radio" : "checkbox"} name={source === "built-in" ? "project-style-preset" : undefined} checked={source === "built-in" ? baseResource === resource.id : extraResources.includes(resource.id)} onChange={() => {
                if (source === "built-in") setBaseResource(resource.id);
                else setExtraResources(current => current.includes(resource.id) ? current.filter(id => id !== resource.id) : [...current, resource.id]);
              }}/><span><strong>{styleResourceName(resource)}</strong><small>{styleResourceDescription(resource)}</small></span>
            </label>)}
          </div>)}
          {!visible.length && <p>{t("resource.noMatches")}</p>}
        </div>
        <footer><button type="button" className="primary-button" onClick={() => setOpen(false)}>{t("common.close")}</button></footer>
      </section>
    </div>, document.body)}
  </fieldset>;
}
