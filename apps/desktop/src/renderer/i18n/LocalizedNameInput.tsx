import { useEffect, useState } from "react";
import { getLocale, t, type Locale } from "./index.js";
import { LanguageSelect } from "./LanguageSelect.js";
import "./localized-name-input.css";

/** Editing locale follows the interface, independently of the display-language preference. */
export function LocalizedNameInput({ id, label, names, overrides, fallback, onChange }: {
  id: string; label: string; names: Record<string, string>; overrides?: Record<string, string> | undefined;
  fallback(locale: Locale): string; onChange(names: Record<string, string>): void;
}) {
  const locale = getLocale();
  const [nameLocale, setNameLocale] = useState<Locale>(locale);
  useEffect(() => setNameLocale(locale), [locale, id]);
  return <div className="localized-name-field"><span>{label}</span>
    <div className="localized-name-control">
      <input name="localizedName" aria-label={label} value={overrides?.[nameLocale] ?? names[nameLocale] ?? ""}
        placeholder={fallback(nameLocale)} onChange={event => onChange({ ...overrides, [nameLocale]: event.target.value })}/>
      <LanguageSelect name="localizedNameLocale" aria-label={t("environment.nameLocale")} value={nameLocale} onValueChange={language => setNameLocale(language as Locale)}/>
    </div><small>{t("environment.nameFallback")}</small>
  </div>;
}
