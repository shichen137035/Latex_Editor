import type { EnvironmentDefinition } from "../preview/types.js";
import type { PreviewDirectiveDefinition, StyleResource, ThemeDefinition } from "@latex-editor/contracts";
import { defaultPreviewDirectives } from "@latex-editor/contracts";
import { DEFAULT_ENVIRONMENTS } from "../preview/environments.js";
import { catalogs, getLocale, t } from "./index.js";

export function environmentName(definition: EnvironmentDefinition): string {
  const original = DEFAULT_ENVIRONMENTS.find(item => item.id === definition.id);
  const defaultLabel = original?.label ?? catalogs.en[definition.labelKey];
  if (definition.label && (!definition.builtIn || definition.label !== defaultLabel)) return definition.label;
  const translated = t(definition.labelKey);
  return translated === definition.labelKey ? definition.label ?? definition.id : translated;
}

export function directiveName(definition: PreviewDirectiveDefinition): string {
  const original = defaultPreviewDirectives.find(item => item.id === definition.id);
  if (!definition.builtIn || !original || definition.label !== original.label) return definition.label;
  const key = `directive.name.${definition.id}`;
  const translated = t(key);
  return translated === key ? definition.label : translated;
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
