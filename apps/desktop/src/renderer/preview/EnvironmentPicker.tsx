import { useEffect, useMemo, useRef, useState } from "react";
import { t, type MessageKey } from "../i18n/index.js";
import type { EnvironmentDefinition } from "./types.js";
import "./environment-picker.css";

export function environmentDisplayName(definition: EnvironmentDefinition): string {
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
  if (match.kind === "virtual-block") return `% tw:block-begin type=${match.type} title="${environmentDisplayName(definition)}"\n${selectedText || "Content"}\n% tw:block-end`;
  return undefined;
}

/** Returns the offset where the cursor should land after an environment insert. */
export function environmentCursorOffset(snippet: string, selectedText: string): number {
  const closingMarker = snippet.includes("\\end{") ? "\n\\end{" : snippet.includes("\\]") ? "\n\\]" : "\n% tw:block-end";
  const closingOffset = snippet.lastIndexOf(closingMarker);
  if (selectedText && closingOffset >= 0) return closingOffset;
  const labelStart = snippet.indexOf("\\label{");
  if (labelStart >= 0) {
    const labelLineEnd = snippet.indexOf("\n", labelStart);
    if (labelLineEnd >= 0) return labelLineEnd + 1 + (snippet.slice(labelLineEnd + 1, labelLineEnd + 3) === "  " ? 2 : 0);
  }
  const firstLineEnd = snippet.indexOf("\n");
  return firstLineEnd >= 0 ? firstLineEnd + 3 : snippet.length;
}

function sourceHint(definition: EnvironmentDefinition): string {
  const match = definition.match;
  if (match.kind === "latex-environment") return `\\begin{${match.name}}`;
  if (match.kind === "command") return `\\${match.command}{…}`;
  if (match.kind === "display-math") return "\\[ … \\]";
  if (match.kind === "virtual-block") return `% tw:block-begin type=${match.type}`;
  return t(`environment.match.${match.kind}` as MessageKey);
}

function familyLabel(definition: EnvironmentDefinition): string {
  return t(`environment.family.${definition.family}` as MessageKey);
}

type EnvironmentPickerPanelProps = {
  definitions: EnvironmentDefinition[];
  title?: string;
  hint?: string;
  include?(definition: EnvironmentDefinition): boolean;
  onSelect(definition: EnvironmentDefinition): void;
  onClose(): void;
};

/** Shared project-aware picker used by both insertion and block conversion. */
export function EnvironmentPickerPanel({ definitions, title = t("editor.environmentPicker.title"), hint = t("editor.environmentPicker.hint"), include = () => true, onSelect, onClose }: EnvironmentPickerPanelProps) {
  const [query, setQuery] = useState("");
  const available = useMemo(() => definitions.filter((definition) => definition.enabled && include(definition) && `${environmentDisplayName(definition)} ${definition.id} ${definition.family}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [definitions, include, query]);
  return <section className="environment-picker" role="dialog" aria-label={title}>
    <header><div><strong>{title}</strong><small>{hint}</small></div><button onClick={onClose} aria-label={t("common.close")}>×</button></header>
    <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("editor.environmentPicker.search")}/>
    <div className="environment-picker-list">{available.length ? available.map((definition) => <button data-environment-id={definition.id} key={definition.id} onClick={() => onSelect(definition)}><i style={{ background: definition.style.accentToken.startsWith("--") ? `var(${definition.style.accentToken})` : definition.style.accentToken }}/><span><strong>{environmentDisplayName(definition)}</strong><small>{sourceHint(definition)}</small></span><em>{familyLabel(definition)}</em></button>) : <p>{t("editor.environmentPicker.empty")}</p>}</div>
    <footer>{available.length} {t("editor.environmentPicker.available")}</footer>
  </section>;
}

export function EnvironmentQuickAction({ definitions, onInsert }: { definitions: EnvironmentDefinition[]; onInsert(definition: EnvironmentDefinition): void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("mousedown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [open]);

  return <div className="environment-quick-action" ref={rootRef}>
    <button className={open ? "active" : ""} title={t("editor.quick.environment")} onClick={() => setOpen((value) => !value)}><b>{"{}"}</b><span>{t("editor.quick.environmentShort")}</span></button>
    {open && <EnvironmentPickerPanel definitions={definitions} include={(definition) => environmentInsertion(definition) !== undefined} onSelect={(definition) => { onInsert(definition); setOpen(false); }} onClose={() => setOpen(false)}/>}
  </div>;
}

export type EnvironmentConversionGroup = "command" | "wrapper" | "virtual";

const compatibilityClass: Record<EnvironmentDefinition["family"], string> = {
  section: "section",
  theorem: "statement", definition: "statement", proof: "statement", remark: "statement", example: "statement",
  equation: "equation", figure: "figure", table: "table", list: "list", quote: "quote", code: "code",
  virtual: "virtual", generic: "generic"
};

/** Semantic compatibility is narrower than sharing the same LaTeX wrapper form. */
export function environmentDefinitionsCompatible(source: EnvironmentDefinition | undefined, target: EnvironmentDefinition): boolean {
  if (!source) return false;
  return definitionConversionGroup(source) === definitionConversionGroup(target)
    && compatibilityClass[source.family] === compatibilityClass[target.family];
}

/** Detect the wrapper form from source so configured and unknown environments behave alike. */
export function environmentConversionGroup(source: string): EnvironmentConversionGroup | undefined {
  const value = source.trimStart();
  if (/^%\s*tw:block-begin\b/.test(value)) return "virtual";
  if (/^\\begin\{[^}]+\}/.test(value) || /^\\\[/.test(value)) return "wrapper";
  if (/^\\[A-Za-z@]+\*?\{/.test(value)) return "command";
  return undefined;
}

export function definitionConversionGroup(definition: EnvironmentDefinition): EnvironmentConversionGroup | undefined {
  if (definition.match.kind === "command") return "command";
  if (definition.match.kind === "latex-environment" || definition.match.kind === "display-math") return "wrapper";
  if (definition.match.kind === "virtual-block") return "virtual";
  return undefined;
}

function escapeExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrites only the outer marker and preserves title, options, body and labels. */
export function convertBlockEnvironmentSource(source: string, target: EnvironmentDefinition): string | undefined {
  const sourceGroup = environmentConversionGroup(source);
  if (!sourceGroup || sourceGroup !== definitionConversionGroup(target)) return undefined;
  const match = target.match;
  if (match.kind === "command") {
    return source.replace(/^(\s*)\\[A-Za-z@]+(\*)?(?=\{)/, (_value, whitespace: string, star: string | undefined) => `${whitespace}\\${match.command}${star ?? ""}`);
  }
  if (match.kind === "latex-environment") {
    const environment = /^\s*\\begin\{([^}]+)\}/.exec(source)?.[1];
    if (environment) {
      const closing = new RegExp(`\\\\end\\{${escapeExpression(environment)}\\}(\\s*)$`);
      return source.replace(/^(\s*)\\begin\{[^}]+\}/, `$1\\begin{${match.name}}`).replace(closing, `\\end{${match.name}}$1`);
    }
    return source.replace(/^(\s*)\\\[/, `$1\\begin{${match.name}}`).replace(/\\\](\s*)$/, `\\end{${match.name}}$1`);
  }
  if (match.kind === "display-math") {
    const environment = /^\s*\\begin\{([^}]+)\}/.exec(source)?.[1];
    if (!environment) return source;
    const closing = new RegExp(`\\\\end\\{${escapeExpression(environment)}\\}(\\s*)$`);
    return source.replace(/^(\s*)\\begin\{[^}]+\}/, "$1\\[").replace(closing, "\\]$1");
  }
  if (match.kind === "virtual-block") {
    return source.replace(/^(\s*%\s*tw:block-begin\b[^\r\n]*?)(?:\btype=[^\s]+)?(?=\s*(?:title=|$))/m, (line) => {
      if (/\btype=/.test(line)) return line.replace(/\btype=[^\s]+/, `type=${match.type}`);
      return `${line.trimEnd()} type=${match.type}`;
    });
  }
  return undefined;
}
