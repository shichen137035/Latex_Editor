import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t, type MessageKey } from "../i18n/index.js";
import { ColorTokenInput } from "./ColorTokenInput.js";
import { createCustomEnvironment, parseEnvironmentXml, resetBuiltIn, serializeEnvironments } from "./environmentConfig.js";
import { environmentBlockStyle } from "./environment-block-style.js";
import { environmentAccent } from "./environment-colors.js";
import type { EnvironmentDefinition, EnvironmentMatchRule } from "./types.js";
import "./environment-manager.css";

const families: EnvironmentDefinition["family"][] = ["section", "theorem", "definition", "proof", "equation", "remark", "example", "figure", "table", "list", "quote", "code", "virtual", "generic"];
const matchKinds: EnvironmentMatchRule["kind"][] = ["latex-environment", "command", "display-math", "virtual-block", "custom-pattern"];

export function environmentDisplayName(definition: EnvironmentDefinition): string {
  if (definition.label) return definition.label;
  const translated = t(definition.labelKey as MessageKey);
  return translated || definition.id.replaceAll("-", " ");
}

function matchValue(match: EnvironmentMatchRule): string {
  if (match.kind === "latex-environment") return match.name;
  if (match.kind === "command") return match.command;
  if (match.kind === "virtual-block") return match.type;
  if (match.kind === "custom-pattern") return match.pattern;
  return "";
}

function matchFrom(kind: EnvironmentMatchRule["kind"], value: string): EnvironmentMatchRule {
  if (kind === "latex-environment") return { kind, name: value };
  if (kind === "command") return { kind, command: value };
  if (kind === "virtual-block") return { kind, type: value };
  if (kind === "custom-pattern") return { kind, pattern: value };
  return { kind: "display-math" };
}

function duplicateDefinition(definition: EnvironmentDefinition, existing: EnvironmentDefinition[]): EnvironmentDefinition {
  const base = `${definition.id}-copy`;
  let id = base;
  let suffix = 2;
  while (existing.some((item) => item.id === id)) id = `${base}-${suffix++}`;
  return {
    ...definition,
    id,
    builtIn: false,
    labelKey: `environment.${id}`,
    label: t("environment.copySuffix", { name: environmentDisplayName(definition) }),
    match: { ...definition.match },
    style: { ...definition.style },
    behavior: { ...definition.behavior }
  };
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange(value: boolean): void; label: string }) {
  return <label className="environment-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span aria-hidden="true"/><em>{label}</em></label>;
}

function SamplePreviewBlock({ definition, selected }: { definition: EnvironmentDefinition; selected: boolean }) {
  const family = definition.family;
  const accent = environmentAccent(definition.id, definition);
  return <section className={`preview-block env-${family}${selected ? " selected" : ""}`} data-environment={definition.id} style={environmentBlockStyle(definition.id, family, definition)}>
    {definition.behavior.showHeader && <div className="preview-block-header"><div className="preview-block-header-main"><span className="preview-environment-label">{environmentDisplayName(definition)}</span><strong>{t("environment.sampleHeading")}</strong></div>{definition.behavior.showLabel && <span className="preview-block-label" style={{ "--block-accent": accent } as CSSProperties}>{t("environment.sampleLabel")}</span>}</div>}
    <div className="preview-block-body"><p>{t("environment.sampleBody")}</p></div>
  </section>;
}

function EnvironmentSamplePreview({ definition, onClose }: { definition: EnvironmentDefinition; onClose(): void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);
  return createPortal(<div className="environment-sample-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="environment-sample-dialog" role="dialog" aria-modal="true" aria-label={t("environment.samplePreviewTitle")}>
      <header><div><p>{t("environment.settingsEyebrow")}</p><h2>{t("environment.samplePreviewTitle")}</h2><span>{environmentDisplayName(definition)}</span></div><button type="button" aria-label={t("common.close")} autoFocus onClick={onClose}>×</button></header>
      <div className="environment-sample-variants"><figure><figcaption>{t("environment.sampleDefault")}</figcaption><SamplePreviewBlock definition={definition} selected={false}/></figure><figure><figcaption>{t("environment.sampleSelected")}</figcaption><SamplePreviewBlock definition={definition} selected/></figure></div>
    </section>
  </div>, document.body);
}

function DefinitionEditor({ definition, definitions, onChange, onSelect }: { definition: EnvironmentDefinition; definitions: EnvironmentDefinition[]; onChange(next: EnvironmentDefinition[]): void; onSelect(id: string): void }) {
  const [sampleOpen, setSampleOpen] = useState(false);
  const replace = (next: EnvironmentDefinition) => onChange(definitions.map((item) => item.id === definition.id ? next : item));
  const update = <K extends keyof EnvironmentDefinition>(key: K, value: EnvironmentDefinition[K]) => replace({ ...definition, [key]: value });
  const addDuplicate = () => { const copy = duplicateDefinition(definition, definitions); onChange([...definitions, copy]); onSelect(copy.id); };
  const remove = () => {
    if (definition.builtIn || !window.confirm(t("environment.deleteConfirm", { name: environmentDisplayName(definition) }))) return;
    const next = definitions.filter((item) => item.id !== definition.id);
    onChange(next);
    onSelect(next[0]?.id ?? "");
  };
  const reset = () => replace(resetBuiltIn(definition));

  return <div className="environment-editor">
    <div className="environment-editor-title"><div><p>{definition.builtIn ? t("environment.builtIn") : t("environment.customGroup")}</p><h2>{environmentDisplayName(definition)}</h2></div><div className="environment-editor-title-actions"><button type="button" className="environment-preview-sample-button" onClick={() => setSampleOpen(true)}>{t("environment.previewSample")}</button><Toggle checked={definition.enabled} onChange={(enabled) => update("enabled", enabled)} label={definition.enabled ? t("environment.on") : t("environment.off")}/></div></div>
    <section className="environment-form-section"><h3>{t("environment.identity")}</h3><div className="environment-form-grid">
      <label><span>{t("environment.label")}</span><input value={definition.label ?? environmentDisplayName(definition)} onChange={(event) => update("label", event.target.value)}/></label>
      <label><span>{t("environment.family")}</span><select value={definition.family} onChange={(event) => update("family", event.target.value as EnvironmentDefinition["family"])}>{families.map((family) => <option key={family} value={family}>{t(`environment.family.${family}` as MessageKey)}</option>)}</select></label>
    </div></section>
    <section className="environment-form-section"><h3>{t("environment.blockSource")}</h3><div className="environment-form-grid">
      <label><span>{t("environment.sourceType")}</span><select value={definition.match.kind} onChange={(event) => update("match", matchFrom(event.target.value as EnvironmentMatchRule["kind"], ""))}>{matchKinds.map((kind) => <option value={kind} key={kind}>{t(`environment.match.${kind}` as MessageKey)}</option>)}</select></label>
      {definition.match.kind !== "display-math" && <label className="wide"><span>{definition.match.kind === "custom-pattern" ? t("environment.pattern") : t("environment.matchValue")}</span><input value={matchValue(definition.match)} onChange={(event) => update("match", matchFrom(definition.match.kind, event.target.value))} placeholder={definition.match.kind === "custom-pattern" ? String.raw`\\begin\{note\}[\s\S]*?\\end\{note\}` : t("environment.matchValuePlaceholder")}/></label>}
    </div></section>
    <section className="environment-form-section"><h3>{t("environment.appearance")}</h3><div className="environment-form-grid style-grid">
      {(["accentToken", "fillToken", "borderToken", "selectedBorderToken", "labelBackgroundToken", "labelTextToken"] as const).map((key) => <label key={key}><span>{t(`environment.style.${key}` as MessageKey)}</span><ColorTokenInput label={t(`environment.style.${key}` as MessageKey)} value={definition.style[key]} onChange={(value) => replace({ ...definition, style: { ...definition.style, [key]: value } })}/></label>)}
    </div></section>
    <section className="environment-form-section"><h3>{t("environment.behavior")}</h3><div className="behavior-grid">{(["inlineEditable", "allowChildren", "showHeader", "showLabel"] as const).map((key) => <Toggle key={key} checked={definition.behavior[key]} onChange={(value) => replace({ ...definition, behavior: { ...definition.behavior, [key]: value } })} label={t(`environment.behavior.${key}` as MessageKey)}/>)}</div></section>
    <div className="environment-actions"><button onClick={addDuplicate}>{t("environment.duplicate")}</button>{definition.builtIn ? <button onClick={reset}>{t("environment.reset")}</button> : <button className="danger" onClick={remove}>{t("environment.delete")}</button>}</div>
    {sampleOpen && <EnvironmentSamplePreview definition={definition} onClose={() => setSampleOpen(false)}/>}
  </div>;
}

export function EnvironmentManager({ definitions, onChange, toolbarTarget }: { definitions: EnvironmentDefinition[]; onChange(next: EnvironmentDefinition[]): void; toolbarTarget?: HTMLElement | null }) {
  const [selectedId, setSelectedId] = useState(definitions[0]?.id ?? "");
  const [mode, setMode] = useState<"gui" | "xml">("gui");
  const [xml, setXml] = useState(() => serializeEnvironments(definitions));
  const [xmlError, setXmlError] = useState<string>();
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<EnvironmentMatchRule["kind"] | "all">("all");
  const [familyFilter, setFamilyFilter] = useState<EnvironmentDefinition["family"] | "all">("all");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredDefinitions = definitions.filter((definition) => {
    const sourceName = matchValue(definition.match);
    const matchesQuery = !normalizedQuery || `${definition.id} ${definition.label ?? ""} ${environmentDisplayName(definition)} ${sourceName}`.toLocaleLowerCase().includes(normalizedQuery);
    return matchesQuery && (sourceFilter === "all" || definition.match.kind === sourceFilter) && (familyFilter === "all" || definition.family === familyFilter);
  });
  const selected = filteredDefinitions.find((item) => item.id === selectedId) ?? filteredDefinitions[0];
  const groups = [
    { title: t("environment.builtIn"), items: filteredDefinitions.filter((item) => item.builtIn) },
    { title: t("environment.customGroup"), items: filteredDefinitions.filter((item) => !item.builtIn) }
  ];
  useEffect(() => { if (mode === "xml") setXml(serializeEnvironments(definitions)); }, [definitions, mode]);
  const add = () => { const definition = createCustomEnvironment(definitions); onChange([...definitions, definition]); setSelectedId(definition.id); setQuery(""); setSourceFilter("all"); setFamilyFilter("all"); setMode("gui"); };
  const applyXml = () => {
    try { const parsed = parseEnvironmentXml(xml); onChange(parsed); setSelectedId(parsed[0]?.id ?? ""); setXmlError(undefined); }
    catch (reason) { setXmlError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const toolbarControls: ReactNode = <div className="environment-manager-toolbar-controls"><div className="environment-manager-mode" role="group" aria-label={t("environment.manager")}><button className={mode === "gui" ? "active" : ""} onClick={() => setMode("gui")}>{t("environment.gui")}</button><button className={mode === "xml" ? "active" : ""} onClick={() => { setXml(serializeEnvironments(definitions)); setMode("xml"); }}>{t("environment.advanced")}</button></div><button className="primary" onClick={add}>＋ {t("environment.add")}</button></div>;
  const toolbar: ReactNode = <div className="environment-manager-toolbar"><div className="environment-manager-toolbar-heading"><p>{t("environment.settingsEyebrow")}</p><h1>{t("environment.manager")}</h1></div>{toolbarControls}</div>;

  return <div className="environment-manager-page">
    {toolbarTarget !== undefined ? toolbarTarget && createPortal(toolbarControls, toolbarTarget) : <header className="environment-manager-header">{toolbar}</header>}
    {mode === "gui" ? <div className="environment-manager-body"><aside className="environment-catalog"><div className="environment-catalog-toolbar"><label className="environment-catalog-search"><input aria-label={t("environment.search")} value={query} onChange={(event) => setQuery(event.target.value)}/><span className="environment-search-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.5 15.5 4.2 4.2"/></svg></span></label><div className="environment-catalog-filters"><label><span>{t("environment.filterSource")}</span><select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as EnvironmentMatchRule["kind"] | "all")}><option value="all">{t("environment.filterAll")}</option>{matchKinds.map((kind) => <option key={kind} value={kind}>{t(`environment.match.${kind}` as MessageKey)}</option>)}</select></label><label><span>{t("environment.filterFamily")}</span><select value={familyFilter} onChange={(event) => setFamilyFilter(event.target.value as EnvironmentDefinition["family"] | "all")}><option value="all">{t("environment.filterAll")}</option>{families.map((family) => <option key={family} value={family}>{t(`environment.family.${family}` as MessageKey)}</option>)}</select></label></div></div><div className="environment-catalog-list">{groups.map((group) => group.items.length > 0 && <section key={group.title}><h3>{group.title}<span>{group.items.length}</span></h3>{group.items.map((definition) => <button className={definition.id === selected?.id ? "active" : ""} data-environment-id={definition.id} key={definition.id} onClick={() => setSelectedId(definition.id)}><i style={{ background: definition.style.accentToken.startsWith("--") ? `var(${definition.style.accentToken})` : definition.style.accentToken }}/><span><strong>{environmentDisplayName(definition)}</strong><small>{t(`environment.match.${definition.match.kind}` as MessageKey)} · {t(`environment.family.${definition.family}` as MessageKey)}</small></span><b className={definition.enabled ? "on" : "off"}>{definition.enabled ? t("environment.on") : t("environment.off")}</b></button>)}</section>)}{filteredDefinitions.length === 0 && <p className="environment-catalog-empty">{t("environment.noMatches")}</p>}</div></aside>{selected ? <DefinitionEditor definition={selected} definitions={definitions} onChange={onChange} onSelect={setSelectedId}/> : <div className="environment-empty">{definitions.length ? t("environment.noMatches") : t("environment.empty")}</div>}</div> : <div className="environment-xml"><div><h2>{t("environment.xmlTitle")}</h2><p>{t("environment.xmlHint")}</p></div><textarea spellCheck={false} value={xml} onChange={(event) => setXml(event.target.value)}/>{xmlError && <p className="environment-xml-error">{xmlError}</p>}<div><button onClick={() => setXml(serializeEnvironments(definitions))}>{t("environment.discardXml")}</button><button className="primary" onClick={applyXml}>{t("environment.applyXml")}</button></div></div>}
  </div>;
}

export function EnvironmentManagerDialog({ definitions, onChange, onClose, scope }: { definitions: EnvironmentDefinition[]; onChange(next: EnvironmentDefinition[]): void; onClose(): void; scope: string }) {
  return <div className="environment-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="environment-dialog" role="dialog" aria-modal="true" aria-label={t("environment.manager")}><div className="environment-dialog-bar"><span>{scope}</span><button onClick={onClose} aria-label={t("common.close")}>×</button></div><EnvironmentManager definitions={definitions} onChange={onChange}/></section></div>;
}
