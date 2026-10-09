import type { SelectHTMLAttributes } from "react";
import { supportedLocales, type Locale } from "./index.js";

/** Autonyms identify a language even when the reader cannot understand the current UI. */
const nativeNames: Readonly<Record<Locale, string>> = {
  en: "English", ja: "日本語", "zh-CN": "简体中文", "zh-TW": "繁體中文", ko: "한국어", fr: "Français"
};

export function nativeLanguageName(code: string): string {
  if (Object.hasOwn(nativeNames, code)) return nativeNames[code as Locale];
  try { return new Intl.DisplayNames([code.replaceAll("_", "-")], { type: "language" }).of(code.replaceAll("_", "-")) ?? code; }
  catch { return code; }
}

type LanguageSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "children" | "value" | "defaultValue" | "onChange" | "multiple"> & {
  value: string;
  onValueChange(value: string): void;
  languages?: readonly string[];
};

/** Locale codes are stable values; option names never depend on the interface locale. */
export function LanguageSelect({ value, onValueChange, languages = supportedLocales, ...props }: LanguageSelectProps) {
  return <select {...props} value={value} onChange={event => onValueChange(event.target.value)}>
    {languages.map(language => <option key={language} value={language}>{nativeLanguageName(language)}</option>)}
  </select>;
}
