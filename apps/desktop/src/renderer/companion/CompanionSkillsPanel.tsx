import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { CompanionSkillDocument, CompanionSkillSummary } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";

export function CompanionSkillsPanel({ onEditingChange, toolbarTarget }: { onEditingChange(editing: boolean): void; toolbarTarget?: HTMLElement | null | undefined }) {
  const [skills, setSkills] = useState<CompanionSkillSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [document, setDocument] = useState<CompanionSkillDocument>();
  const [name, setName] = useState("my-skill"), [content, setContent] = useState("");
  const [editing, setEditing] = useState(false), [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { onEditingChange(editing); return () => onEditingChange(false); }, [editing, onEditingChange]);
  useEffect(() => {
    let active = true;
    void window.latexEditor!.companionSkills.list().then(items => { if (active) { setSkills(items); setSelected(items[0]?.name ?? ""); } }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setDocument(undefined);
    if (selected) void window.latexEditor!.companionSkills.read(selected).then(item => { if (active) setDocument(item); }).catch(reason => { if (active) setError(String(reason)); });
    return () => { active = false; };
  }, [selected, skills]);
  const save = async () => {
    setBusy(true); setError("");
    try {
      const next = await window.latexEditor!.companionSkills.save({ name, content: content.replace(/^---\r?\n([\s\S]*?)\r?\n---/, header => header.replace(/^name:.*$/m, `name: ${name}`)), create: creating });
      setSkills(next); setSelected(name); setEditing(false);
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const toggle = async (item: CompanionSkillSummary, enabled: boolean) => {
    setBusy(true); setError("");
    try { setSkills(await window.latexEditor!.companionSkills.setEnabled({ name: item.name, enabled })); }
    catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const choose = (id: string) => {
    if (editing && !window.confirm(t("settings.managerUnsavedConfirm"))) return;
    setSelected(id); setEditing(false); setError("");
  };
  const toolbar = <button type="button" disabled={busy} onClick={() => {
    if (editing && !window.confirm(t("settings.managerUnsavedConfirm"))) return;
    setCreating(true); setEditing(true); setName("my-skill"); setError("");
    setContent("---\nname: my-skill\ndescription: Describe when the companion should use this skill.\n---\n\n# My skill\n");
  }}>＋ {t("settings.aiSkillsNew")}</button>;
  return <div className="ai-skills-settings companion-skills-settings">
    {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
    <p>{t("companionSkills.hint")}</p>
    <div className="ai-skills-layout"><nav className="ai-skills-list" aria-label={t("companionSkills.title")}>
      {skills.map(item => <div className={`ai-skill-row${item.name === selected ? " active" : ""}`} key={item.name}>
        <button type="button" className="ai-skill-select" onClick={() => choose(item.name)}><strong>{item.name}</strong><small>{item.description}</small></button>
        <label className="ai-skill-toggle" title={item.readOnly ? t("companionSkills.locked") : item.name}><input type="checkbox" aria-label={item.name} checked={item.enabled} disabled={busy || item.readOnly} onChange={event => void toggle(item, event.target.checked)}/><span aria-hidden="true"/></label>
      </div>)}
    </nav><section className="ai-skills-editor">
      {editing ? <>
        <label>{t("settings.aiSkillsName")}<input value={name} disabled={!creating} onChange={event => setName(event.target.value)}/></label>
        <p>{t("settings.aiSkillsFormatHint")}</p>
        <textarea aria-label={t("settings.aiSkillsContent")} value={content} onChange={event => setContent(event.target.value)} spellCheck={false}/>
        <div className="ai-skills-actions"><button type="button" disabled={busy} onClick={() => setEditing(false)}>{t("settings.aiSkillsCancel")}</button><button className="primary" type="button" disabled={busy} onClick={() => void save()}>{t("settings.aiSkillsSave")}</button></div>
      </> : document ? <>
        <div className="ai-skills-detail-head"><h3>{document.name}</h3>{!document.readOnly && <button type="button" onClick={() => { setCreating(false); setEditing(true); setName(document.name); setContent(document.content); }}>{t("settings.aiSkillsEdit")}</button>}</div>
        {document.readOnly && <p>{t("companionSkills.locked")}</p>}
        <pre>{document.content}</pre>
      </> : <p>{t("settings.aiSkillsSelect")}</p>}
    </section></div>
    {error && <p role="alert" className="inline-error">{error}</p>}
  </div>;
}
