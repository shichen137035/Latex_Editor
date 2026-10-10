import { useEffect, useState } from "react";
import { themeColorRanges, type ThemeColorParameters } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import type { useSettings } from "../settings/service.js";
import { effectiveThemeColorParameters, semanticColorRoles } from "./semanticColors.js";

function ParameterInput({ field, value, onCommit }: { field: keyof typeof themeColorRanges; value: number; onCommit(value: number): void }) {
  const percent = !field.endsWith("Contrast"), scale = percent ? 100 : 1;
  const [draft, setDraft] = useState(String(Math.round(value * scale * 100) / 100));
  useEffect(() => setDraft(String(Math.round(value * scale * 100) / 100)), [value, scale]);
  const bounds = themeColorRanges[field];
  const commit = () => {
    const next = Number(draft) / scale;
    if (draft.trim() && Number.isFinite(next) && next >= bounds.min && next <= bounds.max) onCommit(next);
    else setDraft(String(value * scale));
  };
  return <div className="theme-color-number"><input aria-label={t(`colors.parameter.${field}`)} type="number" min={bounds.min * scale} max={bounds.max * scale} step={bounds.step * scale} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }}/><span>{percent ? "%" : ":1"}</span></div>;
}

export function ThemeColorSettings({ store }: { store: ReturnType<typeof useSettings> }) {
  const activeTheme = store.global("theme"), profiles = store.global("themeColorProfiles");
  const [effective, setEffective] = useState(effectiveThemeColorParameters);
  useEffect(() => {
    const update = () => setEffective(effectiveThemeColorParameters());
    window.addEventListener("texweave:semantic-colors-changed", update); update();
    return () => window.removeEventListener("texweave:semantic-colors-changed", update);
  }, []);
  const patch = (next: Partial<ThemeColorParameters>) => void store.set("themeColorProfiles", { ...store.global("themeColorProfiles"), [activeTheme]: { ...store.global("themeColorProfiles")[activeTheme], ...next } });
  const reset = () => { const next = { ...profiles }; delete next[activeTheme]; void store.set("themeColorProfiles", next); };
  return <section className="theme-color-settings"><header><div><h3>{t("colors.themeSettings")}</h3><p>{t("colors.themeHint")}</p></div><button type="button" disabled={!profiles[activeTheme]} onClick={reset}>{t("settings.reset")}</button></header>
    <div className="theme-color-samples">{["--env-section-base", "--env-algorithm-base", "--env-assumption-base"].map(seed => {
      const roles = semanticColorRoles(seed);
      return <span key={seed} style={{ color: roles.labelText, background: roles.labelBackground, borderColor: roles.border }}>{t("colors.sample")}</span>;
    })}</div>
    <label className="preference-row"><span><strong>{t("colors.parameter.mode")}</strong></span><select value={effective.mode} onChange={event => patch({ mode: event.target.value as ThemeColorParameters["mode"] })}>{["auto", "light", "dark"].map(mode => <option key={mode} value={mode}>{t(`colors.mode.${mode}`)}</option>)}</select></label>
    {(Object.keys(themeColorRanges) as Array<keyof typeof themeColorRanges>).map(field => <label className="preference-row" key={field}><span><strong>{t(`colors.parameter.${field}`)}</strong></span><ParameterInput field={field} value={effective[field]} onCommit={value => patch({ [field]: value })}/></label>)}
  </section>;
}
