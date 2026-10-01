import type { EnvironmentBehavior, EnvironmentDefinition, EnvironmentStyle } from "./types.js";

export interface EnvironmentCatalog {
  defaultStyle: EnvironmentStyle;
  familyStyles: Partial<Record<EnvironmentDefinition["family"], Partial<EnvironmentStyle>>>;
  defaultBehavior: EnvironmentBehavior;
  previewEnvironments: Array<Omit<EnvironmentDefinition, "enabled" | "builtIn" | "labelKey" | "style" | "behavior"> & {
    enabled?: boolean; builtIn?: boolean; labelKey?: string;
    style?: Partial<EnvironmentStyle>; behavior?: Partial<EnvironmentBehavior>;
  }>;
}

export function environmentsFromCatalog(configuration: EnvironmentCatalog): EnvironmentDefinition[] {
  return configuration.previewEnvironments.map((entry) => ({
    ...entry, enabled: entry.enabled ?? true, builtIn: entry.builtIn ?? true,
    labelKey: entry.labelKey ?? `environment.${entry.id}`,
    style: { ...configuration.defaultStyle, ...configuration.familyStyles[entry.family], ...entry.style },
    behavior: { ...configuration.defaultBehavior, ...entry.behavior }
  }));
}
