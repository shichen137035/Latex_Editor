import type { EnvironmentDefinition, EnvironmentStyle } from "./types.js";
import catalog from "../../../../../resources/environments/preview-environments.json" with { type: "json" };
import { semanticColorRoles } from "../themes/semanticColors.js";
import type { SemanticColorRoles } from "../themes/colorMath.js";
const customPalette = catalog.customColorPalette;
const normalize = (type: string) => type.replace(/^custom:/, "").replace(/(?:-star|\*)$/, "").toLowerCase();
const cssValue = (value: string | undefined, fallback: string) => value ? value.startsWith("--") ? `var(${value})` : value : fallback;

export function environmentBaseColor(type: string, definition?: EnvironmentDefinition): string {
  if (definition?.style.baseColor) return definition.style.baseColor;
  const configured = definition?.style.accentToken;
  if (configured && configured !== `--env-${definition?.family}-accent`) return configured.replace(/^(--env-[\w-]+)-accent$/, "$1-base");
  const name = normalize(type), entry = catalog.previewEnvironments.find(item => item.id === name);
  if (entry) return (entry.style as Partial<EnvironmentStyle> | undefined)?.baseColor ?? `--env-${entry.family}-base`;
  if (definition) return configured?.replace(/-accent$/, "-base") ?? `--env-${definition.family}-base`;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `--env-${customPalette[hash % customPalette.length]}-base`;
}

export function environmentColorRoles(type: string, definition?: EnvironmentDefinition): SemanticColorRoles {
  const adaptive = semanticColorRoles(environmentBaseColor(type, definition));
  if (definition?.style.colorMode !== "fixed") return adaptive;
  const style = definition.style;
  return { accent: cssValue(style.accentToken, adaptive.accent), fill: cssValue(style.fillToken, adaptive.fill), border: cssValue(style.borderToken, adaptive.border), selectedBorder: cssValue(style.selectedBorderToken, adaptive.selectedBorder), labelBackground: cssValue(style.labelBackgroundToken, adaptive.labelBackground), labelText: cssValue(style.labelTextToken, adaptive.labelText) };
}
export function environmentAccent(type: string, definition?: EnvironmentDefinition): string { return environmentColorRoles(type, definition).accent; }

export function environmentDefinition(type: string, definitions: EnvironmentDefinition[]): EnvironmentDefinition | undefined {
  return definitions.find((definition) => definition.id === type || (definition.match.kind === "latex-environment" && definition.match.name === type)
    || (definition.match.kind === "command" && definition.match.command === type) || (definition.match.kind === "virtual-block" && definition.match.type === type));
}
