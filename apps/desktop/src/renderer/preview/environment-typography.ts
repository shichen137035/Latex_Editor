import catalog from "../../../../../resources/environments/preview-environments.json" with { type: "json" };
import type { EnvironmentDefinition, EnvironmentMatchRule } from "./types.js";

export const titleNumericFields = {
  titleFontSize: { min: 10, max: 72, step: 1 },
  titleFontWeight: { min: 100, max: 900, step: 100 },
  titleLineHeight: { min: 1, max: 2.5, step: 0.05 },
  titleLetterSpacing: { min: -0.05, max: 0.15, step: 0.005 }
} as const;
export type TitleNumericField = keyof typeof titleNumericFields;
export type TitleTypography = Record<TitleNumericField, number> & { titleFontFamily: string };
const configuration = catalog as unknown as { defaultStyle: TitleTypography; familyStyles: Record<string, Partial<TitleTypography>>; previewEnvironments: Array<{ id: string; match: EnvironmentMatchRule; style?: Partial<TitleTypography> }> };
export const titleFontChoices = [catalog.defaultStyle.titleFontFamily, '"DM Sans", "Segoe UI", sans-serif', '"Segoe UI", "Microsoft YaHei", sans-serif', 'Georgia, "Times New Roman", serif'];

export function validTitleNumber(field: TitleNumericField, value: unknown): value is number {
  const { min, max } = titleNumericFields[field];
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Catalog defaults are shared by existing saved definitions, custom environments and samples. */
export function environmentTitleTypography(environmentId: string, family: string, definition?: EnvironmentDefinition): TitleTypography {
  const id = environmentId.replace(/-star$/, "");
  const command = definition?.match.kind === "command" ? definition.match.command.replace(/\*$/, "") : undefined;
  const entry = configuration.previewEnvironments.find(item => item.id === id)
    ?? (command ? configuration.previewEnvironments.find(item => item.match.kind === "command" && item.match.command === command) : undefined);
  const familyStyle = configuration.familyStyles[family] ?? {};
  const defaults = { ...configuration.defaultStyle, ...familyStyle, ...entry?.style };
  const result: TitleTypography = { ...defaults };
  for (const field of Object.keys(titleNumericFields) as TitleNumericField[]) {
    const value = definition?.style[field];
    result[field] = validTitleNumber(field, value) ? value : defaults[field];
  }
  result.titleFontFamily = typeof definition?.style.titleFontFamily === "string" && definition.style.titleFontFamily.trim() || defaults.titleFontFamily;
  return result;
}
