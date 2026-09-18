import { useEffect, useMemo, useRef, useState } from "react";
import { t, type MessageKey } from "../i18n/index.js";
import type { EnvironmentDefinition } from "./types.js";
import "./environment-picker.css";

function displayName(definition: EnvironmentDefinition): string {
  if (definition.label) return definition.label;
  const key = definition.labelKey as Parameters<typeof t>[0];
  return t(key) || definition.id.replaceAll("-", " ");
}

function indentBody(value: string): string {
  if (!value.trim()) return "  ";
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}

/** Convert an enabled semantic definition into source that can be inserted. */
export function environmentInsertion(definition: EnvironmentDefinition, selectedText = ""): string | undefined {
  const match = definition.match;
  if (match.kind === "latex-environment") return `\\begin{${match.name}}\n${indentBody(selectedText)}\n\\end{${match.name}}`;
  if (match.kind === "display-math") return `\\[\n${indentBody(selectedText)}\n\\]`;
  if (match.kind === "virtual-block") return `% tw:block-begin type=${match.type} title="${displayName(definition)}"\n${selectedText || "Content"}\n% tw:block-end`;
  return undefined;
}

/** Returns the offset where the cursor should land after an environment insert. */
export function environmentCursorOffset(snippet: string, selectedText: string): number {
  const closingMarker = snippet.includes("\\end{") ? "\n\\end{" : snippet.includes("\\]") ? "\n\\]" : "\n% tw:block-end";
  const closingOffset = snippet.lastIndexOf(closingMarker);
  if (selectedText && closingOffset >= 0) return closingOffset;
  const firstLineEnd = snippet.indexOf("\n");
  return firstLineEnd >= 0 ? firstLineEnd + 3 : snippet.length;
}

function sourceHint(definition: EnvironmentDefinition): string {
  const match = definition.match;
  if (match.kind === "latex-environment") return `\\begin{${match.name}}`;
  if (match.kind === "display-math") return "\\[ … \\]";
  if (match.kind === "virtual-block") return `% tw:block-begin type=${match.type}`;
  return t(`environment.match.${match.kind}` as MessageKey);
}

function familyLabel(definition: EnvironmentDefinition): string {
  return t(`environment.family.${definition.family}` as MessageKey);
}

export function EnvironmentQuickAction({ definitions, onInsert }: { definitions: EnvironmentDefinition[]; onInsert(definition: EnvironmentDefinition): void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const available = useMemo(() => definitions.filter((definition) => definition.enabled && environmentInsertion(definition) !== undefined && `${displayName(definition)} ${definition.id} ${definition.family}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [definitions, query]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("mousedown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [open]);

  return <div className="environment-quick-action" ref={rootRef}>
    <button className={open ? "active" : ""} title={t("editor.quick.environment")} onClick={() => { setOpen((value) => !value); setQuery(""); }}><b>{"{}"}</b><span>{t("editor.quick.environmentShort")}</span></button>
    {open && <section className="environment-picker" role="dialog" aria-label={t("editor.environmentPicker.title")}>
      <header><div><strong>{t("editor.environmentPicker.title")}</strong><small>{t("editor.environmentPicker.hint")}</small></div><button onClick={() => setOpen(false)} aria-label={t("common.close")}>×</button></header>
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("editor.environmentPicker.search")}/>
      <div className="environment-picker-list">{available.length ? available.map((definition) => <button data-environment-id={definition.id} key={definition.id} onClick={() => { onInsert(definition); setOpen(false); }}><i style={{ background: definition.style.accentToken.startsWith("--") ? `var(${definition.style.accentToken})` : definition.style.accentToken }}/><span><strong>{displayName(definition)}</strong><small>{sourceHint(definition)}</small></span><em>{familyLabel(definition)}</em></button>) : <p>{t("editor.environmentPicker.empty")}</p>}</div>
      <footer>{available.length} {t("editor.environmentPicker.available")}</footer>
    </section>}
  </div>;
}
