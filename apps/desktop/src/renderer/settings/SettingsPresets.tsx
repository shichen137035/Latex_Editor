import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SettingsPreset, SettingsPresetKind } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { settings } from "./service.js";

export function SettingsPresets({ kind = "settings", scope = "global", onApplied, onBusyChange }: { kind?: SettingsPresetKind; scope?: "global" | "project"; onApplied?(): void; onBusyChange?(busy: boolean): void }) {
  const [presets, setPresets] = useState<SettingsPreset[]>([]);
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const selectedPreset = presets.find(item => item.id === selected);
  const failure = (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const key = (["invalidName", "notFound", "duplicateName", "limit", "invalidFile"] as const).find(key => message.includes(`settingsPresets.${key}`));
    setError(t(key ? `settingsPresets.${key}` : "settingsPresets.failed"));
  };
  useEffect(() => {
    let active = true;
    void window.latexEditor!.settings.listPresets(kind).then(items => { if (active) setPresets(items); }).catch(reason => { if (active) failure(reason); });
    return () => { active = false; };
  }, [kind]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(""); setNotice("");
    try { await action(); setPresets(await window.latexEditor!.settings.listPresets(kind)); }
    catch (reason) { failure(reason); }
    finally { setBusy(false); }
  };
  const save = (update = false) => {
    if (update && !window.confirm(t("settingsPresets.updateConfirm", { name: selectedPreset?.name ?? "" }))) return;
    void run(async () => {
      const saved = await window.latexEditor!.settings.savePreset(name, update ? selected : undefined, kind, scope === "project" ? settings.projectId() : undefined);
      setSelected(saved.id); setName(saved.name); setNotice(t("settingsPresets.saved", { name: saved.name }));
    });
  };
  return <section className="settings-presets"><h3>{t("settingsPresets.title")}</h3><p>{t(kind === "settings" ? "settingsPresets.hint" : kind === "dictionaries" ? "settingsPresets.dictionaryHint" : "settingsPresets.managerHint")}</p>
    <div className="settings-presets-fields"><label><span>{t("settingsPresets.choose")}</span><select disabled={busy} value={selected} onChange={event => { const id = event.target.value; setSelected(id); setName(presets.find(item => item.id === id)?.name ?? ""); setError(""); setNotice(""); }}><option value="">{t("settingsPresets.none")}</option>{presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label><span>{t("settingsPresets.name")}</span><input disabled={busy} maxLength={80} value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && name.trim() && !busy) { event.preventDefault(); save(); } }}/></label></div>
    <div className="settings-presets-actions"><button type="button" disabled={busy || !name.trim()} onClick={() => save()}>{t("settingsPresets.save")}</button><button type="button" className="primary" disabled={busy || !selectedPreset} onClick={() => void run(async () => { await settings.applyPreset(selected, scope); onApplied?.(); setNotice(t("settingsPresets.loaded", { name: selectedPreset!.name })); })}>{t("settingsPresets.load")}</button><button type="button" disabled={busy || !selectedPreset || !name.trim()} onClick={() => save(true)}>{t("settingsPresets.update")}</button><button type="button" className="danger" disabled={busy || !selectedPreset} onClick={() => {
      if (!window.confirm(t("settingsPresets.deleteConfirm", { name: selectedPreset!.name }))) return;
      void run(async () => { await window.latexEditor!.settings.removePreset(selected); setSelected(""); setName(""); });
    }}>{t("settingsPresets.delete")}</button><button type="button" disabled={busy || !selectedPreset} onClick={() => void run(async () => { if (await window.latexEditor!.settings.exportPreset(selected)) setNotice(t("settingsPresets.exported")); })}>{t("settingsPresets.export")}</button><button type="button" disabled={busy} onClick={() => void run(async () => { const preset = await window.latexEditor!.settings.importPreset(kind); if (preset) { setSelected(preset.id); setName(preset.name); setNotice(t("settingsPresets.imported")); } })}>{t("settingsPresets.import")}</button></div>
    {notice && <small role="status">{notice}</small>}{error && <p role="alert" className="inline-error">{error}</p>}
  </section>;
}

export function SettingsPresetDialog({ kind, scope, title, onClose, onApplied }: { kind: SettingsPresetKind; scope: "global" | "project"; title: string; onClose(): void; onApplied(): void }) {
  const dialog = useRef<HTMLElement>(null), close = useRef(onClose), pending = useRef(false);
  const [busy, setBusy] = useState(false); close.current = onClose; pending.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (!pending.current) close.current(); }
      if (event.key === "Tab") {
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? []).filter(item => item.offsetParent !== null);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => { window.removeEventListener("keydown", keydown, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="settings-preset-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section ref={dialog} className="settings-preset-dialog" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" disabled={busy} aria-label={t("common.close")} onClick={onClose}>×</button></header><SettingsPresets kind={kind} scope={scope} onApplied={onApplied} onBusyChange={setBusy}/></section></div>, document.body);
}
