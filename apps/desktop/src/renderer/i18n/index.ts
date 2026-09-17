import messages from "./locales/en.json" with { type: "json" };
import japanese from "./locales/ja.json" with { type: "json" };

type MessageKey = keyof typeof messages;
let locale: "en" | "ja" = "en";
export function setLocale(value: "en" | "ja"): void { locale = value; }

export function t(key: string, variables?: Record<string, string | number>): string {
  let value = (locale === "ja" ? (japanese as Record<string, string>)[key] : undefined) ?? (messages as Record<string, string>)[key] ?? key;
  for (const [name, replacement] of Object.entries(variables ?? {})) {
    value = value.replaceAll(`{{${name}}}`, String(replacement));
  }
  return value;
}

export type { MessageKey };
