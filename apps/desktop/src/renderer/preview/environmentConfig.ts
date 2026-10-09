import { catalogs, getLocale, t } from "../i18n/index.js";
import { environmentName, environmentNames } from "../i18n/displayNames.js";
import { cloneEnvironmentDefinitions, DEFAULT_ENVIRONMENTS, environmentOptionBrackets } from "./environments.js";
import type { EnvironmentDefinition, EnvironmentMatchRule } from "./types.js";
import { settings } from "../settings/service.js";
import { environmentTitleTypography, titleNumericFields, validTitleNumber, type TitleNumericField } from "./environment-typography.js";
import { environmentPreview, previewNumericFields, previewRenderers, imageClickActions, tableToolbarModes, validPreviewNumber, type PreviewNumericField } from "./environment-preview.js";
import type { EnvironmentBehavior } from "./types.js";
import { validLocalizedNames } from "@latex-editor/contracts";


const families: EnvironmentDefinition["family"][] = ["section", "theorem", "definition", "proof", "equation", "remark", "example", "figure", "table", "list", "quote", "code", "virtual", "generic"];

function isDefinition(value: unknown): value is EnvironmentDefinition {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EnvironmentDefinition>;
  return typeof item.id === "string" && typeof item.enabled === "boolean" && typeof item.builtIn === "boolean" && typeof item.labelKey === "string" && validLocalizedNames(item.labels) && Boolean(item.match) && Boolean(item.style) && Boolean(item.behavior) && families.includes(item.family as EnvironmentDefinition["family"]);
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
    labelKey: "",
    labels: { [getLocale()]: t("ui.environmentConfig.custom", { value1: suffix }) },
    family: "generic",
    style: {
      accentToken: "#2f84c5",
      fillToken: "transparent",
      labelBackgroundToken: "#edf7fd",
      labelTextToken: "#246893",
      borderToken: "rgba(70, 95, 120, 0.10)",
      selectedBorderToken: "#2f6bb2"
    },
    behavior: { inlineEditable: true, allowChildren: true, showHeader: true, showLabel: true, showOptionBrackets: environmentOptionBrackets() }
  };
}

export function duplicateEnvironment(definition: EnvironmentDefinition, existing: EnvironmentDefinition[]): EnvironmentDefinition {
  const base = `${definition.id}-copy`;
  let id = base;
  let suffix = 2;
  while (existing.some(item => item.id === id)) id = `${base}-${suffix++}`;
  const names = environmentNames(definition);
  if (!Object.keys(names).length) names[getLocale()] = environmentName(definition);
  const labels = Object.fromEntries(Object.entries(names).map(([locale, name]) => {
    const template = catalogs[locale as keyof typeof catalogs]?.["environment.copySuffix"] ?? catalogs.en["environment.copySuffix"]!;
    return [locale, template.replaceAll("{{name}}", name)];
  }));
  const copy = cloneEnvironmentDefinitions([definition])[0]!;
  delete copy.label;
  return { ...copy, id, builtIn: false, labelKey: "", labels };
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
    const preview = environmentPreview(definition.id, definition);
    const previewAttributes = Object.entries(preview.sizing).filter(([key]) => definition.style[key as PreviewNumericField] !== undefined || preview.renderer === "figure" || preview.renderer === "table").map(([key, value]) => `${key}="${value}"`).join(" ");
    const behaviorAttributes = Object.entries(preview.behavior).map(([key, value]) => `${key}="${escapeXml(String(value))}"`).join(" ");
    const names = Object.entries(definition.labels ?? {}).map(([locale, name]) => `    <name locale="${escapeXml(locale)}" value="${escapeXml(name)}" />`).join("\n");
    return `  <environment id="${escapeXml(definition.id)}" enabled="${definition.enabled}" builtIn="${definition.builtIn}" family="${definition.family}" label="${escapeXml(definition.label ?? "")}" labelKey="${escapeXml(definition.labelKey)}">
${names ? names + "\n" : ""}    <match type="${definition.match.kind}" value="${escapeXml(matchValue(definition.match))}" />
    <style accentToken="${escapeXml(definition.style.accentToken)}" fillToken="${escapeXml(definition.style.fillToken)}" borderToken="${escapeXml(definition.style.borderToken)}" selectedBorderToken="${escapeXml(definition.style.selectedBorderToken)}" labelBackgroundToken="${escapeXml(definition.style.labelBackgroundToken)}" labelTextToken="${escapeXml(definition.style.labelTextToken)}" ${titleAttributes} ${previewAttributes} />
    <behavior ${behaviorAttributes} />
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
  throw new Error(t("ui.environmentConfig.unsupported_match_type", { value1: kind }));
}

export function parseEnvironmentXml(xml: string): EnvironmentDefinition[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = document.querySelector("parsererror");
  if (parserError) throw new Error(parserError.textContent?.trim() || t("ui.environmentConfig.invalid_xml"));
  const definitions = Array.from(document.querySelectorAll("environment")).map((element): EnvironmentDefinition => {
    const id = element.getAttribute("id")?.trim() ?? "";
    const family = element.getAttribute("family") as EnvironmentDefinition["family"] | null;
    const matchElement = element.querySelector(":scope > match");
    const styleElement = element.querySelector(":scope > style");
    const behaviorElement = element.querySelector(":scope > behavior");
    if (!id || !family || !families.includes(family) || !matchElement || !styleElement || !behaviorElement) throw new Error(t("ui.environmentConfig.environment_is_incomplete", { value1: id || "?" }));
    const label = element.getAttribute("label")?.trim();
    const labels: Record<string, string> = {};
    for (const name of Array.from(element.querySelectorAll(":scope > name"))) {
      const locale = name.getAttribute("locale")?.trim();
      if (!locale || Object.hasOwn(labels, locale)) throw new Error(t("environment.invalidNameLocale", { id }));
      Object.defineProperty(labels, locale, { value: name.getAttribute("value") ?? "", enumerable: true, configurable: true, writable: true });
    }
    const typography: Partial<Record<TitleNumericField, number>> = {};
    for (const field of Object.keys(titleNumericFields) as TitleNumericField[]) {
      const raw = styleElement.getAttribute(field);
      if (raw === null) continue;
      const value = Number(raw);
      if (!raw.trim() || !validTitleNumber(field, value)) throw new Error(t("ui.environmentConfig.invalid_for_environment", { value1: field, value2: id }));
      typography[field] = value;
    }
    const titleFontFamily = styleElement.getAttribute("titleFontFamily")?.trim();
    const showOptionBrackets = behaviorElement.getAttribute("showOptionBrackets");
    if (showOptionBrackets !== null && showOptionBrackets !== "true" && showOptionBrackets !== "false") throw new Error(t("ui.environmentConfig.invalid_showoptionbrackets_for_environment", { value1: id }));
    const previewBehavior: Partial<EnvironmentBehavior> = {};
    for (const key of ["showCaption", "captionEditable", "allowExpandedEditor", "expandedToolbar"] as const) {
      const raw = behaviorElement.getAttribute(key);
      if (raw === null) continue;
      if (raw !== "true" && raw !== "false") throw new Error(t("ui.environmentConfig.invalid_for_environment", { value1: key, value2: id }));
      previewBehavior[key] = raw === "true";
    }
    for (const [key, choices] of [["renderer", previewRenderers], ["imageClickAction", imageClickActions], ["tableToolbar", tableToolbarModes]] as const) {
      const raw = behaviorElement.getAttribute(key);
      if (raw === null) continue;
      if (!(choices as readonly string[]).includes(raw)) throw new Error(t("ui.environmentConfig.invalid_for_environment", { value1: key, value2: id }));
      Object.assign(previewBehavior, { [key]: raw });
    }
    const previewSizing: Partial<Record<PreviewNumericField, number>> = {};
    for (const key of Object.keys(previewNumericFields) as PreviewNumericField[]) {
      const raw = styleElement.getAttribute(key);
      if (raw === null) continue;
      if (!raw.trim() || !validPreviewNumber(key, Number(raw))) throw new Error(t("ui.environmentConfig.invalid_for_environment", { value1: key, value2: id }));
      previewSizing[key] = Number(raw);
    }
    return {
      id,
      enabled: booleanAttribute(element, "enabled", true),
      builtIn: booleanAttribute(element, "builtIn", false),
      match: parseMatch(matchElement.getAttribute("type") ?? "", matchElement.getAttribute("value") ?? ""),
      labelKey: element.getAttribute("labelKey") ?? (booleanAttribute(element, "builtIn", false) ? `environment.${id}` : ""),
      ...(label ? { label } : {}),
      ...(Object.keys(labels).length ? { labels } : {}),
      family,
      style: {
        ...typography,
        ...previewSizing,
        ...(titleFontFamily ? { titleFontFamily } : {}),
        accentToken: styleElement.getAttribute("accentToken") || "--env-generic-accent",
        fillToken: styleElement.getAttribute("fillToken") || "transparent",
        borderToken: styleElement.getAttribute("borderToken") || "--env-border-default",
        selectedBorderToken: styleElement.getAttribute("selectedBorderToken") || "--env-border-selected",
        labelBackgroundToken: styleElement.getAttribute("labelBackgroundToken") || "--env-generic-label-bg",
        labelTextToken: styleElement.getAttribute("labelTextToken") || "--env-generic-label-text"
      },
      behavior: {
        ...previewBehavior,
        inlineEditable: booleanAttribute(behaviorElement, "inlineEditable", true),
        allowChildren: booleanAttribute(behaviorElement, "allowChildren", true),
        showHeader: booleanAttribute(behaviorElement, "showHeader", true),
        showLabel: booleanAttribute(behaviorElement, "showLabel", true),
        ...(showOptionBrackets !== null ? { showOptionBrackets: showOptionBrackets === "true" } : {})
      }
    };
  });
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw new Error(t("ui.environmentConfig.duplicate_environment_id", { value1: definition.id }));
    ids.add(definition.id);
  }
  if (!definitions.length) throw new Error(t("ui.environmentConfig.at_least_one_environment_definition_is_required"));
  return definitions;
}
