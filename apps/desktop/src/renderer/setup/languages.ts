import type { DictionaryPackage } from "@latex-editor/contracts";

export function suggestedSetupLanguages(catalog: DictionaryPackage[], locale: string, saved: string[]): string[] {
  const language = locale.toLowerCase().split("-")[0];
  return catalog.filter(item => item.installed || saved.includes(item.id) || item.languageCode.toLowerCase().split(/[-_]/)[0] === language).map(item => item.id);
}

export function pendingSetupLanguages(catalog: DictionaryPackage[], selected: string[]): DictionaryPackage[] {
  return catalog.filter(item => selected.includes(item.id) && !item.installed);
}
