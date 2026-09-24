import messages from "./locales/en.json" with { type: "json" };
import japanese from "./locales/ja.json" with { type: "json" };
import simplifiedChinese from "./locales/zh-CN.json" with { type: "json" };
import traditionalChinese from "./locales/zh-TW.json" with { type: "json" };
import korean from "./locales/ko.json" with { type: "json" };
import french from "./locales/fr.json" with { type: "json" };

type MessageKey = keyof typeof messages;
export type Locale = "en" | "ja" | "zh-CN" | "zh-TW" | "ko" | "fr";
const catalogs: Record<Locale, Record<string, string>> = {
  en: messages as Record<string, string>, ja: japanese as Record<string, string>,
  "zh-CN": simplifiedChinese as Record<string, string>, "zh-TW": traditionalChinese as Record<string, string>,
  ko: korean as Record<string, string>, fr: french as Record<string, string>
};
let locale: Locale = "en";
export function setLocale(value: Locale): void { locale = value in catalogs ? value : "en"; }

export function t(key: string, variables?: Record<string, string | number>): string {
  let value = key === "app.version" ? `v${__APP_VERSION__}` : catalogs[locale][key] ?? catalogs.en[key] ?? key;
  for (const [name, replacement] of Object.entries(variables ?? {})) {
    value = value.replaceAll(`{{${name}}}`, String(replacement));
  }
  return value;
}

export type { MessageKey };
