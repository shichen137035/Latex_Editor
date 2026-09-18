import { useEffect, useState } from "react";
import { t, type MessageKey } from "../i18n/index.js";
import { createCustomEnvironment, parseEnvironmentXml, resetBuiltIn, serializeEnvironments } from "./environmentConfig.js";
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

function DefinitionEditor({ definition, definitions, onChange, onSelect }: { definition: EnvironmentDefinition; definitions: EnvironmentDefinition[]; onChange(next: EnvironmentDefinition[]): void; onSelect(id: string): void }) {
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
    <div className="environment-editor-title"><div><p>{definition.builtIn ? t("environment.builtIn") : t("environment.customGroup")}</p><h2>{environmentDisplayName(definition)}</h2><code>{definition.id}</code></div><Toggle checked={definition.enabled} onChange={(enabled) => update("enabled", enabled)} label={definition.enabled ? t("environment.on") : t("environment.off")}/></div>
    <section className="environment-form-section"><h3>{t("environment.identity")}</h3><div className="environment-form-grid">
      <label><span>{t("environment.id")}</span><input value={definition.id} disabled title={t("environment.idFixed")}/></label>
      <label><span>{t("environment.label")}</span><input value={definition.label ?? environmentDisplayName(definition)} onChange={(event) => update("label", event.target.value)}/></label>
      <label><span>{t("environment.family")}</span><select value={definition.family} onChange={(event) => update("family", event.target.value as EnvironmentDefinition["family"])}>{families.map((family) => <option key={family} value={family}>{t(`environment.family.${family}` as MessageKey)}</option>)}</select></label>
    </div></section>
    <section className="environment-form-section"><h3>{t("environment.blockSource")}</h3><div className="environment-form-grid">
      <label><span>{t("environment.sourceType")}</span><select value={definition.match.kind} onChange={(event) => update("match", matchFrom(event.target.value as EnvironmentMatchRule["kind"], ""))}>{matchKinds.map((kind) => <option value={kind} key={kind}>{t(`environment.match.${kind}` as MessageKey)}</option>)}</select></label>
      {definition.match.kind !== "display-math" && <label className="wide"><span>{definition.match.kind === "custom-pattern" ? t("environment.pattern") : t("environment.matchValue")}</span><input value={matchValue(definition.match)} onChange={(event) => update("match", matchFrom(definition.match.kind, event.target.value))} placeholder={definition.match.kind === "custom-pattern" ? String.raw`\\begin\{note\}[\s\S]*?\\end\{note\}` : t("environment.matchValuePlaceholder")}/></label>}
    </div></section>
    <section className="environment-form-section"><h3>{t("environment.appearance")}</h3><div className="environment-form-grid style-grid">
      {(["accentToken", "fillToken", "borderToken", "selectedBorderToken", "labelBackgroundToken", "labelTextToken"] as const).map((key) => <label key={key}><span>{t(`environment.style.${key}` as MessageKey)}</span><div className="token-input"><i style={{ background: definition.style[key].startsWith("--") ? `var(${definition.style[key]})` : definition.style[key] }}/><input value={definition.style[key]} onChange={(event) => replace({ ...definition, style: { ...definition.style, [key]: event.target.value } })}/></div></label>)}
    </div></section>
    <section className="environment-form-section"><h3>{t("environment.behavior")}</h3><div className="behavior-grid">{(["selectable", "inlineEditable", "allowChildren", "showHeader", "showLabel", "addToOutline"] as const).map((key) => <Toggle key={key} checked={definition.behavior[key]} onChange={(value) => replace({ ...definition, behavior: { ...definition.behavior, [key]: value } })} label={t(`environment.behavior.${key}` as MessageKey)}/>)}</div></section>
    <div className="environment-actions"><button onClick={addDuplicate}>{t("environment.duplicate")}</button>{definition.builtIn ? <button onClick={reset}>{t("environment.reset")}</button> : <button className="danger" onClick={remove}>{t("environment.delete")}</button>}</div>
  </div>;
}

export function EnvironmentManager({ definitions, onChange }: { definitions: EnvironmentDefinition[]; onChange(next: EnvironmentDefinition[]): void }) {
  const [selectedId, setSelectedId] = useState(definitions[0]?.id ?? "");
  const [mode, setMode] = useState<"gui" | "xml">("gui");
  const [xml, setXml] = useState(() => serializeEnvironments(definitions));
  const [xmlError, setXmlError] = useState<string>();
  const selected = definitions.find((item) => item.id === selectedId) ?? definitions[0];
  const groups = [
    { title: t("environment.builtIn"), items: definitions.filter((item) => item.builtIn) },
    { title: t("environment.customGroup"), items: definitions.filter((item) => !item.builtIn) }
  ];
  useEffect(() => { if (mode === "xml") setXml(serializeEnvironments(definitions)); }, [definitions, mode]);
  const add = () => { const definition = createCustomEnvironment(definitions); onChange([...definitions, definition]); setSelectedId(definition.id); setMode("gui"); };
  const applyXml = () => {
    try { const parsed = parseEnvironmentXml(xml); onChange(parsed); setSelectedId(parsed[0]?.id ?? ""); setXmlError(undefined); }
    catch (reason) { setXmlError(reason instanceof Error ? reason.message : String(reason)); }
  };

  return <div className="environment-manager-page">
    <header className="environment-manager-header"><div><p>{t("environment.settingsEyebrow")}</p><h1>{t("environment.manager")}</h1><span>{t("environment.managerHint")}</span></div><div><button className={mode === "gui" ? "active" : ""} onClick={() => setMode("gui")}>{t("environment.gui")}</button><button className={mode === "xml" ? "active" : ""} onClick={() => { setXml(serializeEnvironments(definitions)); setMode("xml"); }}>{t("environment.advanced")}</button><button className="primary" onClick={add}>＋ {t("environment.add")}</button></div></header>
    {mode === "gui" ? <div className="environment-manager-body"><aside className="environment-catalog">{groups.map((group) => <section key={group.title}><h3>{group.title}<span>{group.items.length}</span></h3>{group.items.map((definition) => <button className={definition.id === selected?.id ? "active" : ""} data-environment-id={definition.id} key={definition.id} onClick={() => setSelectedId(definition.id)}><i style={{ background: definition.style.accentToken.startsWith("--") ? `var(${definition.style.accentToken})` : definition.style.accentToken }}/><span><strong>{environmentDisplayName(definition)}</strong><small>{t(`environment.match.${definition.match.kind}` as MessageKey)}</small></span><b className={definition.enabled ? "on" : "off"}>{definition.enabled ? t("environment.on") : t("environment.off")}</b></button>)}</section>)}</aside>{selected ? <DefinitionEditor definition={selected} definitions={definitions} onChange={onChange} onSelect={setSelectedId}/> : <div className="environment-empty">{t("environment.empty")}</div>}</div> : <div className="environment-xml"><div><h2>{t("environment.xmlTitle")}</h2><p>{t("environment.xmlHint")}</p></div><textarea spellCheck={false} value={xml} onChange={(event) => setXml(event.target.value)}/>{xmlError && <p className="environment-xml-error">{xmlError}</p>}<div><button onClick={() => setXml(serializeEnvironments(definitions))}>{t("environment.discardXml")}</button><button className="primary" onClick={applyXml}>{t("environment.applyXml")}</button></div></div>}
  </div>;
}

export function EnvironmentManagerDialog({ definitions, onChange, onClose, scope }: { definitions: EnvironmentDefinition[]; onChange(next: EnvironmentDefinition[]): void; onClose(): void; scope: string }) {
  return <div className="environment-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="environment-dialog" role="dialog" aria-modal="true" aria-label={t("environment.manager")}><div className="environment-dialog-bar"><span>{scope}</span><button onClick={onClose} aria-label={t("common.close")}>×</button></div><EnvironmentManager definitions={definitions} onChange={onChange}/></section></div>;
}
