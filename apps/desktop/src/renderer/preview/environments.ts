import catalog from "../../../../../resources/environments/preview-environments.json" with { type: "json" };
import type { EnvironmentBehavior, EnvironmentDefinition, EnvironmentMatchRule, EnvironmentStyle } from "./types.js";

type ConfigEntry = {
  id: string;
  enabled?: boolean;
  builtIn?: boolean;
  labelKey?: string;
  label?: string;
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
    if (!entry.id || ids.has(entry.id)) throw new Error(`Invalid or duplicate Preview environment id: ${entry.id}`);
    ids.add(entry.id);
    return {
      id: entry.id,
      enabled: entry.enabled ?? true,
      builtIn: entry.builtIn ?? true,
      match: { ...entry.match },
      labelKey: entry.labelKey ?? `environment.${entry.id}`,
      ...(entry.label ? { label: entry.label } : {}),
      family: entry.family,
      style: { ...configuration.defaultStyle, ...configuration.familyStyles[entry.family], ...entry.style },
      behavior: { ...configuration.defaultBehavior, ...entry.behavior }
    };
  });
}

export const DEFAULT_ENVIRONMENTS: EnvironmentDefinition[] = loadConfiguredDefaults();

export function cloneEnvironmentDefinitions(definitions: EnvironmentDefinition[] = DEFAULT_ENVIRONMENTS): EnvironmentDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    match: { ...definition.match },
    style: { ...definition.style },
    behavior: { ...definition.behavior }
  }));
}

export function environmentWithOverrides(overrides: Record<string, boolean>, definitions: EnvironmentDefinition[] = DEFAULT_ENVIRONMENTS): EnvironmentDefinition[] {
  return cloneEnvironmentDefinitions(definitions).map((definition) => ({ ...definition, enabled: overrides[definition.id] ?? definition.enabled }));
}

export function definitionForId(definitions: EnvironmentDefinition[], id: string): EnvironmentDefinition | undefined {
  return definitions.find((definition) => definition.id === id);
}
