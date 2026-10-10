import messages from "./locales/en.json" with { type: "json" };
import japanese from "./locales/ja.json" with { type: "json" };
import simplifiedChinese from "./locales/zh-CN.json" with { type: "json" };
import traditionalChinese from "./locales/zh-TW.json" with { type: "json" };
import korean from "./locales/ko.json" with { type: "json" };
import french from "./locales/fr.json" with { type: "json" };
import kazakh from "./locales/kk.json" with { type: "json" };

export type MessageKey = keyof typeof messages;
export const supportedLocales = ["en", "ja", "zh-CN", "zh-TW", "ko", "fr", "kk"] as const;
export type Locale = typeof supportedLocales[number];
export const catalogs: Readonly<Record<Locale, Readonly<Record<string, string>>>> = {
  en: messages, ja: japanese, "zh-CN": simplifiedChinese,
  "zh-TW": traditionalChinese, ko: korean, fr: french, kk: kazakh
};
let locale: Locale = "en";
export function getLocale(): Locale { return locale; }
export function setLocale(value: Locale): void { locale = value in catalogs ? value : "en"; }

export function t(key: string, variables?: Record<string, string | number>): string {
  let value = catalogs[locale][key] ?? catalogs.en[key] ?? key;
  for (const [name, replacement] of Object.entries(variables ?? {})) value = value.replaceAll(`{{${name}}}`, String(replacement));
  return value;
}
