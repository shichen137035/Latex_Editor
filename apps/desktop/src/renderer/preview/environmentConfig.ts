import { cloneEnvironmentDefinitions, DEFAULT_ENVIRONMENTS } from "./environments.js";
import type { EnvironmentDefinition, EnvironmentMatchRule } from "./types.js";
import { settings } from "../settings/service.js";
import { environmentTitleTypography, titleNumericFields, validTitleNumber, type TitleNumericField } from "./environment-typography.js";

export const GLOBAL_ENVIRONMENTS_KEY = "texweave.environments.global.v1";

const families: EnvironmentDefinition["family"][] = ["section", "theorem", "definition", "proof", "equation", "remark", "example", "figure", "table", "list", "quote", "code", "virtual", "generic"];

function isDefinition(value: unknown): value is EnvironmentDefinition {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EnvironmentDefinition>;
  return typeof item.id === "string" && typeof item.enabled === "boolean" && typeof item.builtIn === "boolean" && typeof item.labelKey === "string" && Boolean(item.match) && Boolean(item.style) && Boolean(item.behavior) && families.includes(item.family as EnvironmentDefinition["family"]);
}

export function loadGlobalEnvironments(): EnvironmentDefinition[] {
  const parsed = settings.global("environments");
  if (parsed.length && parsed.every(isDefinition)) return cloneEnvironmentDefinitions(parsed);
  return cloneEnvironmentDefinitions();
}

export function saveGlobalEnvironments(definitions: EnvironmentDefinition[]): void {
  void settings.set("environments", definitions);
}

export function createCustomEnvironment(existing: EnvironmentDefinition[]): EnvironmentDefinition {
  let suffix = 1;
  while (existing.some((item) => item.id === `custom-${suffix}`)) suffix += 1;
  return {
    id: `custom-${suffix}`,
    enabled: true,
    builtIn: false,
    match: { kind: "latex-environment", name: `custom${suffix}` },
    labelKey: `environment.custom-${suffix}`,
    label: `Custom ${suffix}`,
    family: "generic",
    style: {
      accentToken: "#2f84c5",
      fillToken: "transparent",
      labelBackgroundToken: "#edf7fd",
      labelTextToken: "#246893",
      borderToken: "rgba(70, 95, 120, 0.10)",
      selectedBorderToken: "#2f6bb2"
    },
    behavior: { inlineEditable: true, allowChildren: true, showHeader: true, showLabel: true }
  };
}

export function resetBuiltIn(definition: EnvironmentDefinition): EnvironmentDefinition {
  const original = DEFAULT_ENVIRONMENTS.find((item) => item.id === definition.id);
  return original ? cloneEnvironmentDefinitions([original])[0] ?? definition : definition;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function matchValue(match: EnvironmentMatchRule): string {
  if (match.kind === "latex-environment") return match.name;
  if (match.kind === "command") return match.command;
  if (match.kind === "virtual-block") return match.type;
  if (match.kind === "custom-pattern") return match.pattern;
  return "";
}

export function serializeEnvironments(definitions: EnvironmentDefinition[]): string {
  const rows = definitions.map((definition) => {
    const typography = environmentTitleTypography(definition.id, definition.family, definition);
    const titleAttributes = Object.entries(typography).filter(([key]) => key.startsWith("title")).map(([key, value]) => `${key}="${escapeXml(String(value))}"`).join(" ");
    return `  <environment id="${escapeXml(definition.id)}" enabled="${definition.enabled}" builtIn="${definition.builtIn}" family="${definition.family}" label="${escapeXml(definition.label ?? "")}" labelKey="${escapeXml(definition.labelKey)}">
    <match type="${definition.match.kind}" value="${escapeXml(matchValue(definition.match))}" />
    <style accentToken="${escapeXml(definition.style.accentToken)}" fillToken="${escapeXml(definition.style.fillToken)}" borderToken="${escapeXml(definition.style.borderToken)}" selectedBorderToken="${escapeXml(definition.style.selectedBorderToken)}" labelBackgroundToken="${escapeXml(definition.style.labelBackgroundToken)}" labelTextToken="${escapeXml(definition.style.labelTextToken)}" ${titleAttributes} />
    <behavior inlineEditable="${definition.behavior.inlineEditable}" allowChildren="${definition.behavior.allowChildren}" showHeader="${definition.behavior.showHeader}" showLabel="${definition.behavior.showLabel}" />
  </environment>`;
  });
  return `<environments version="1">\n${rows.join("\n")}\n</environments>`;
}

function booleanAttribute(element: Element, name: string, fallback: boolean): boolean {
  const value = element.getAttribute(name);
  return value === null ? fallback : value === "true";
}

function parseMatch(kind: string, value: string): EnvironmentMatchRule {
  if (kind === "latex-environment") return { kind, name: value };
  if (kind === "command") return { kind, command: value };
  if (kind === "display-math") return { kind };
  if (kind === "virtual-block") return { kind, type: value };
  if (kind === "custom-pattern") return { kind, pattern: value };
  throw new Error(`Unsupported match type: ${kind}`);
}

export function parseEnvironmentXml(xml: string): EnvironmentDefinition[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error(parserError.textContent?.trim() || "Invalid XML.");
  const definitions = Array.from(document.querySelectorAll("environment")).map((element): EnvironmentDefinition => {
    const id = element.getAttribute("id")?.trim() ?? "";
    const family = element.getAttribute("family") as EnvironmentDefinition["family"] | null;
    const matchElement = element.querySelector(":scope > match");
    const styleElement = element.querySelector(":scope > style");
    const behaviorElement = element.querySelector(":scope > behavior");
    if (!id || !family || !families.includes(family) || !matchElement || !styleElement || !behaviorElement) throw new Error(`Environment '${id || "?"}' is incomplete.`);
    const label = element.getAttribute("label")?.trim();
    const typography: Partial<Record<TitleNumericField, number>> = {};
    for (const field of Object.keys(titleNumericFields) as TitleNumericField[]) {
      const raw = styleElement.getAttribute(field);
      if (raw === null) continue;
      const value = Number(raw);
      if (!raw.trim() || !validTitleNumber(field, value)) throw new Error(`Invalid ${field} for environment '${id}'.`);
      typography[field] = value;
    }
    const titleFontFamily = styleElement.getAttribute("titleFontFamily")?.trim();
    return {
      id,
      enabled: booleanAttribute(element, "enabled", true),
      builtIn: booleanAttribute(element, "builtIn", false),
      match: parseMatch(matchElement.getAttribute("type") ?? "", matchElement.getAttribute("value") ?? ""),
      labelKey: element.getAttribute("labelKey") || `environment.${id}`,
      ...(label ? { label } : {}),
      family,
      style: {
        ...typography,
        ...(titleFontFamily ? { titleFontFamily } : {}),
        accentToken: styleElement.getAttribute("accentToken") || "--env-generic-accent",
        fillToken: styleElement.getAttribute("fillToken") || "transparent",
        borderToken: styleElement.getAttribute("borderToken") || "--env-border-default",
        selectedBorderToken: styleElement.getAttribute("selectedBorderToken") || "--env-border-selected",
        labelBackgroundToken: styleElement.getAttribute("labelBackgroundToken") || "--env-generic-label-bg",
        labelTextToken: styleElement.getAttribute("labelTextToken") || "--env-generic-label-text"
      },
      behavior: {
        inlineEditable: booleanAttribute(behaviorElement, "inlineEditable", true),
        allowChildren: booleanAttribute(behaviorElement, "allowChildren", true),
        showHeader: booleanAttribute(behaviorElement, "showHeader", true),
        showLabel: booleanAttribute(behaviorElement, "showLabel", true)
      }
    };
  });
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(`Duplicate environment id: ${definition.id}`);
    ids.add(definition.id);
  }
  if (!definitions.length) throw new Error("At least one environment definition is required.");
  return definitions;
}
