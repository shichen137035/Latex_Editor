import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const catalogs = new Map<string, Record<string, string>>();
function catalog(locale: string): Record<string, string> {
  const name = ["en", "zh-CN", "zh-TW", "ja", "ko", "fr"].includes(locale) ? locale : "en";
  let result = catalogs.get(name);
  if (!result) {
    try { result = JSON.parse(readFileSync(resolve(__dirname, "locales", name + ".json"), "utf8")) as Record<string, string>; }
    catch { result = JSON.parse(readFileSync(resolve(__dirname, "../renderer/i18n/locales", name + ".json"), "utf8")) as Record<string, string>; }
    catalogs.set(name, result);
  }
  return result;
}
export function translateNative(locale: string, key: string, variables?: Record<string, string | number>): string {
  let value = catalog(locale)[key] ?? catalog("en")[key] ?? key;
  for (const [name, replacement] of Object.entries(variables ?? {})) value = value.replaceAll(`{{${name}}}`, String(replacement));
  return value;
}
