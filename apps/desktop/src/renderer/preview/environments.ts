import { t } from "../i18n/index.js";
import catalog from "../../../../../resources/environments/preview-environments.json" with { type: "json" };
import type { EnvironmentBehavior, EnvironmentDefinition, EnvironmentMatchRule, EnvironmentStyle } from "./types.js";

type ConfigEntry = {
  id: string;
  enabled?: boolean;
  builtIn?: boolean;
  labelKey?: string;
  label?: string;
  labels?: Record<string, string>;
  family: EnvironmentDefinition["family"];
  match: EnvironmentMatchRule;
  style?: Partial<EnvironmentStyle>;
  behavior?: Partial<EnvironmentBehavior>;
};

type EnvironmentCatalog = {
  defaultStyle: EnvironmentStyle;
  familyStyles: Partial<Record<EnvironmentDefinition["family"], Partial<EnvironmentStyle>>>;
  defaultBehavior: EnvironmentBehavior;
  previewEnvironments: ConfigEntry[];
};

/** Load the built-in catalog from resources; source code only validates and normalizes it. */
function loadConfiguredDefaults(): EnvironmentDefinition[] {
  const configuration = catalog as unknown as EnvironmentCatalog;
  const ids = new Set<string>();
  return configuration.previewEnvironments.map((entry) => {
    if (!entry.id || ids.has(entry.id)) throw new Error(t("ui.environments.invalid_or_duplicate_preview_environment_id", { value1: entry.id }));
    ids.add(entry.id);
    return {
      id: entry.id,
      enabled: entry.enabled ?? true,
      builtIn: entry.builtIn ?? true,
      match: { ...entry.match },
      labelKey: entry.labelKey ?? `environment.${entry.id}`,
      ...(entry.label ? { label: entry.label } : {}),
      ...(entry.labels ? { labels: { ...entry.labels } } : {}),
      family: entry.family,
      style: { ...configuration.defaultStyle, ...configuration.familyStyles[entry.family], ...entry.style },
      behavior: { ...configuration.defaultBehavior, ...entry.behavior }
    };
  });
}

export const DEFAULT_ENVIRONMENTS: EnvironmentDefinition[] = loadConfiguredDefaults();

export function environmentOptionBrackets(definition?: EnvironmentDefinition): boolean {
  return definition?.behavior.showOptionBrackets
    ?? DEFAULT_ENVIRONMENTS.find(entry => entry.id === definition?.id)?.behavior.showOptionBrackets
    ?? catalog.defaultBehavior.showOptionBrackets;
}

/** Preserve saved overrides while appending built-ins introduced by later releases. */
export function includeNewBuiltInEnvironments(definitions: EnvironmentDefinition[]): EnvironmentDefinition[] {
  const existing = new Set(definitions.map((definition) => definition.id));
  return cloneEnvironmentDefinitions([
    ...definitions,
    ...DEFAULT_ENVIRONMENTS.filter((definition) => definition.builtIn && !existing.has(definition.id))
  ]);
}

export function cloneEnvironmentDefinitions(definitions: EnvironmentDefinition[] = DEFAULT_ENVIRONMENTS): EnvironmentDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    ...(definition.labels ? { labels: { ...definition.labels } } : {}),
    match: { ...definition.match },
    style: { ...definition.style },
    behavior: {
      ...definition.behavior,
      inlineEditable: definition.behavior.inlineEditable ?? true,
      allowChildren: definition.behavior.allowChildren ?? true,
      showHeader: definition.behavior.showHeader ?? true,
      showLabel: definition.behavior.showLabel ?? true,
      showOptionBrackets: environmentOptionBrackets(definition)
    }
  }));
}

export function environmentWithOverrides(overrides: Record<string, boolean>, definitions: EnvironmentDefinition[] = DEFAULT_ENVIRONMENTS): EnvironmentDefinition[] {
  return cloneEnvironmentDefinitions(definitions).map((definition) => ({ ...definition, enabled: overrides[definition.id] ?? definition.enabled }));
}

export function definitionForId(definitions: EnvironmentDefinition[], id: string): EnvironmentDefinition | undefined {
  return definitions.find((definition) => definition.id === id);
}
