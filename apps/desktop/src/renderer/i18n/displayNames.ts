import type { EnvironmentDefinition } from "../preview/types.js";
import type { PreviewDirectiveDefinition, StyleResource, ThemeDefinition } from "@latex-editor/contracts";
import { defaultPreviewDirectives } from "@latex-editor/contracts";
import { DEFAULT_ENVIRONMENTS } from "../preview/environments.js";
import { catalogs, getLocale, supportedLocales, t, type Locale } from "./index.js";
import { settings } from "../settings/service.js";

export function blockNameLocale(): Locale {
  return settings.global("fixedBlockNameLanguage") ? settings.global("blockNameLanguage") : getLocale();
}

function applyNames(names: Record<string, string>, overrides?: Record<string, string>): Record<string, string> {
  for (const [locale, name] of Object.entries(overrides ?? {})) {
    if (name.trim()) Object.defineProperty(names, locale, { value: name, enumerable: true, configurable: true, writable: true });
  }
  return names;
}

function resolveName(names: Record<string, string>, locale: Locale, fallback: string): string {
  for (const candidate of new Set([locale, ...supportedLocales, ...Object.keys(names)])) {
    const name = Object.hasOwn(names, candidate) ? names[candidate] : undefined;
    if (name?.trim()) return name;
  }
  return fallback;
}

/** Effective entries, without translating arbitrary custom keys or falling back between locales. */
export function environmentNames(definition: EnvironmentDefinition): Record<string, string> {
  const original = DEFAULT_ENVIRONMENTS.find(item => item.id === definition.id);
  const defaultLabel = original?.label ?? (definition.builtIn && definition.labelKey ? catalogs.en[definition.labelKey] : undefined);
  const names: Record<string, string> = {};
  if (definition.label?.trim() && (!definition.builtIn || definition.label !== defaultLabel)) names.en = definition.label;
  else if (definition.builtIn && definition.labelKey) {
    for (const locale of supportedLocales) {
      const translated = catalogs[locale][definition.labelKey];
      if (translated?.trim()) names[locale] = translated;
    }
    if (!names.en && definition.label?.trim()) names.en = definition.label;
  }
  return applyNames(names, definition.labels);
}

/** Current locale, then the language selector order (English first), then other stored locales. */
export function environmentName(definition: EnvironmentDefinition, locale: Locale = blockNameLocale()): string {
  return resolveName(environmentNames(definition), locale, definition.label?.trim() || definition.id);
}

export function directiveNames(definition: PreviewDirectiveDefinition): Record<string, string> {
  const original = defaultPreviewDirectives.find(item => item.id === definition.id);
  const names: Record<string, string> = {};
  if (!definition.builtIn || !original || definition.label !== original.label) {
    if (definition.label.trim()) names.en = definition.label;
  } else {
    for (const locale of supportedLocales) {
      const translated = catalogs[locale][`directive.name.${definition.id}`];
      if (translated?.trim()) names[locale] = translated;
    }
    if (!names.en && definition.label.trim()) names.en = definition.label;
  }
  return applyNames(names, definition.labels);
}

export function directiveName(definition: PreviewDirectiveDefinition, locale: Locale = blockNameLocale()): string {
  return resolveName(directiveNames(definition), locale, definition.label.trim() || definition.id);
}

export function styleResourceName(resource: StyleResource): string {
  return resource.source === "built-in" && catalogs.en[`resource.preset.${resource.id}.name`] ? t(`resource.preset.${resource.id}.name`) : resource.name;
}
export function styleResourceDescription(resource: StyleResource): string {
  return resource.source === "built-in" && catalogs.en[`resource.preset.${resource.id}.description`] ? t(`resource.preset.${resource.id}.description`) : resource.description ?? t("resource.noDescription");
}
export function themeName(theme: ThemeDefinition): string {
  return theme.source === "built-in" && catalogs.en[`theme.${theme.id}`] ? t(`theme.${theme.id}`) : theme.name;
}
export function languageName(code: string, fallback = code): string {
  try { return new Intl.DisplayNames([getLocale()], { type: "language" }).of(code) ?? fallback; }
  catch { return fallback; }
}
export function referenceTypeName(type: string): string {
  const key = `reference.type.${type.toLowerCase()}`;
  return catalogs.en[key] ? t(key) : type;
}
