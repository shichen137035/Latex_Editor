import { useEffect, useRef, useState } from "react";
import type { DictionaryPackage } from "@latex-editor/contracts";
import { getLocale, t } from "../i18n/index.js";
import { languageName } from "../i18n/displayNames.js";
import { useSettings } from "../settings/service.js";
import { LatexToolchainSettingsPanel } from "../settings/LatexToolchainSettingsPanel.js";
import { pendingSetupLanguages, suggestedSetupLanguages } from "./languages.js";
import { toolchainReadiness } from "../settings/toolchainReadiness.js";
import "./first-run-setup.css";

export function FirstRunSetup({ onActiveChange }: { onActiveChange: (active: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    void window.latexEditor!.installation.setupStatus().then(status => {
      if (mounted) { setOpen(status.required); setSaved(status.dictionaryIds); }
    }).catch(reason => { if (mounted) setError(String(reason)); });
    return () => { mounted = false; };
  }, []);
  useEffect(() => { onActiveChange(open); }, [open, onActiveChange]);
  if (error) return <aside className="setup-status-error" role="alert">{t("setup.statusError")} {error}<button onClick={() => window.location.reload()}>{t("setup.retry")}</button></aside>;
  return open ? <SetupDialog saved={saved} onClose={() => setOpen(false)}/> : null;
}

function SetupDialog({ saved, onClose }: { saved: string[]; onClose: () => void }) {
  const store = useSettings();
  const [step, setStep] = useState<"languages" | "tools">("languages");
  const [catalog, setCatalog] = useState<DictionaryPackage[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toolBusy, setToolBusy] = useState(false);
  const [installing, setInstalling] = useState("");
  const [error, setError] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const locked = busy || toolBusy;
  const pending = pendingSetupLanguages(catalog, selected);
  useEffect(() => {
    let mounted = true;
    void window.latexEditor!.spellcheck.listDictionaries().then(items => {
      if (mounted) { setCatalog(items); setSelected(suggestedSetupLanguages(items, getLocale(), saved)); }
    }).catch(reason => { if (mounted) setError(String(reason)); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [saved]);
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    const retainFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target)) panel.current?.focus();
    };
    document.addEventListener("focusin", retainFocus);
    return () => { document.removeEventListener("focusin", retainFocus); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  const next = async () => {
    setBusy(true); setError("");
    let failed = false;
    try {
      for (const item of pending) {
        setInstalling(item.id);
        try {
          const installed = await window.latexEditor!.spellcheck.installDictionary(item.id);
          setCatalog(items => items.map(current => current.id === item.id ? installed : current));
        } catch { failed = true; setError(`${t("setup.languageError")} ${languageName(item.languageCode, item.displayName)}`); break; }
      }
      if (!failed) setStep("tools");
    } finally { setInstalling(""); setBusy(false); }
  };
  const finish = async () => {
    setBusy(true); setError("");
    try {
      await window.latexEditor!.installation.completeSetup(catalog.filter(item => item.installed && selected.includes(item.id)).map(item => item.id));
      await store.load(store.projectId());
      onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const normalized = query.toLocaleLowerCase().trim();
  const visible = catalog.filter(item => !normalized || `${item.id} ${item.displayName} ${languageName(item.languageCode)}`.toLocaleLowerCase().includes(normalized));
  return <div className="first-run-backdrop"><div ref={panel} className="first-run-setup" role="dialog" aria-modal="true" aria-labelledby="setup-title" tabIndex={-1} onKeyDown={event => {
    event.stopPropagation();
    if (event.key !== "Tab") return;
    const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') ?? []).filter(element => element.getClientRects().length);
    const target = event.shiftKey ? elements.at(-1) : elements[0];
    if (!elements.length || (event.shiftKey ? document.activeElement === elements[0] || document.activeElement === panel.current : document.activeElement === elements.at(-1) || document.activeElement === panel.current)) { event.preventDefault(); target?.focus(); }
  }}>
    <header><h1 id="setup-title">{t("setup.title")}</h1><p>{t("setup.subtitle")}</p><ol className="setup-steps"><li aria-current={step === "languages" ? "step" : undefined}>{t("setup.languages")}</li><li aria-current={step === "tools" ? "step" : undefined}>{t("setup.tools")}</li></ol></header>
    <div className="setup-content">
      {step === "languages" ? <section><h2>{t("setup.languages")}</h2><p>{t("setup.languagesHint")}</p>
        <input type="search" aria-label={t("settings.spellcheckSearch")} placeholder={t("settings.spellcheckSearch")} value={query} disabled={locked} onChange={event => setQuery(event.target.value)}/>
        {loading && <p role="status">{t("setup.loading")}</p>}
        <div className="setup-language-list">{visible.map(item => <label className="setup-language" key={item.id}><input type="checkbox" data-dictionary={item.id} checked={selected.includes(item.id)} disabled={locked || item.installed} onChange={event => setSelected(ids => event.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id))}/><span><strong>{item.id === "zh-CN" ? t("settings.spellcheckChinese") : item.id === "ja-JP" ? t("settings.spellcheckJapanese") : languageName(item.languageCode, item.displayName)}</strong><small>{item.languageCode}</small></span>{item.installed && <em>{t("settings.spellcheckInstalledBadge")}</em>}{installing === item.id && <span role="status">{t("settings.spellcheckInstalling")}</span>}</label>)}</div>
      </section> : <section><h2>{t("setup.tools")}</h2><LatexToolchainSettingsPanel store={store} onBusyChange={setToolBusy}/><p className="setup-hint">{t("setup.incomplete")}</p></section>}
      {error && <p role="alert" className="inline-error">{error}</p>}
    </div>
    <footer><button data-setup-later disabled={locked} onClick={onClose}>{t("setup.later")}</button><div>{step === "languages" && <button data-setup-tools disabled={locked} onClick={() => { setStep("tools"); setError(""); }}>{t("toolchainGuide.skipLanguages")}</button>}{step === "tools" && <button disabled={locked} onClick={() => { setStep("languages"); setError(""); }}>{t("setup.back")}</button>}{step === "languages" ? <button className="primary" data-setup-next disabled={locked || loading} onClick={() => void next()}>{pending.length ? t("setup.installLanguages") : t("setup.next")}</button> : <button className="primary" data-setup-finish disabled={locked} onClick={() => void finish()}>{t(toolchainReadiness(store.snapshot().toolchain, store.get("engine")).ready ? "setup.finish" : "toolchainGuide.finishWithout")}</button>}</div></footer>
  </div></div>;
}
