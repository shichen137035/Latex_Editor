import catalog from "../../../../../resources/environments/preview-environments.json" with { type: "json" };
import type { EnvironmentBehavior, EnvironmentDefinition, EnvironmentStyle } from "./types.js";
import type { CSSProperties } from "react";
import { blockHandler } from "./block-handlers.js";

export const previewNumericFields = {
  captionFontSize: { min: 10, max: 36, step: 1 },
  imageMaxHeightVh: { min: 10, max: 100, step: 1 },
  imageGridMinWidth: { min: 60, max: 800, step: 10 },
  imageGridGap: { min: 0, max: 80, step: 1 },
  tableCellMaxHeightEm: { min: 2, max: 40, step: 1 },
  tableEditorMaxHeight: { min: 48, max: 800, step: 10 },
  tableExpandedFontSize: { min: 10, max: 36, step: 1 }
} as const;
export type PreviewNumericField = keyof typeof previewNumericFields;
export type PreviewSizing = Record<PreviewNumericField, number>;
export const previewRenderers = ["auto", "content", "math", "code", "list", "figure", "table"] as const;
export const imageClickActions = ["settings", "replace", "source", "inspect"] as const;
export const tableToolbarModes = ["selected", "always", "hidden"] as const;
const configuration = catalog as unknown as {
  defaultStyle: PreviewSizing;
  familyStyles: Record<string, Partial<EnvironmentStyle>>;
  familyRenderers: Record<string, Exclude<EnvironmentBehavior["renderer"], "auto" | undefined>>;
  defaultBehavior: Required<EnvironmentBehavior>;
  previewEnvironments: Array<{ id: string; family: string; behavior?: Partial<EnvironmentBehavior>; style?: Partial<EnvironmentStyle> }>;
};
const catalogEntries = new Map(configuration.previewEnvironments.map(entry => [entry.id, entry]));

export function validPreviewNumber(field: PreviewNumericField, value: unknown): value is number {
  const bounds = previewNumericFields[field];
  return typeof value === "number" && Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
}

/** Rendering policy and sizes are resolved from the same resource catalog as block settings. */
export function environmentPreview(environmentId: string, definition?: EnvironmentDefinition) {
  const entry = catalogEntries.get(definition?.id ?? environmentId);
  const family = definition?.family ?? entry?.family ?? "generic";
  const defaults = { ...configuration.defaultBehavior, ...entry?.behavior };
  const behavior: Required<EnvironmentBehavior> = { ...defaults, ...definition?.behavior };
  for (const key of ["inlineEditable", "allowChildren", "showHeader", "showLabel", "showOptionBrackets", "showCaption", "captionEditable", "allowExpandedEditor", "expandedToolbar", "listItemEditing", "listShowCount"] as const) {
    if (typeof behavior[key] !== "boolean") behavior[key] = defaults[key];
  }
  if (!previewRenderers.includes(behavior.renderer)) behavior.renderer = defaults.renderer;
  if (!imageClickActions.includes(behavior.imageClickAction)) behavior.imageClickAction = defaults.imageClickAction;
  if (!tableToolbarModes.includes(behavior.tableToolbar)) behavior.tableToolbar = defaults.tableToolbar;
  const renderer = behavior.renderer === "auto" ? configuration.familyRenderers[family] ?? configuration.familyRenderers.generic! : behavior.renderer;
  if (!["ordered", "unordered", "description"].includes(behavior.listStyle)) behavior.listStyle = defaults.listStyle;
  if (!["decimal", "lower-alpha", "lower-roman", "disc", "circle", "square", "none"].includes(behavior.listMarker)) behavior.listMarker = defaults.listMarker;
  if (!/^[A-Za-z@]+$/.test(behavior.listItemCommand)) behavior.listItemCommand = defaults.listItemCommand;
  const handler = renderer === "list" ? blockHandler(behavior.blockHandler || "builtin.list") : undefined;
  const sizingDefaults = { ...configuration.defaultStyle, ...configuration.familyStyles[family], ...entry?.style };
  const sizing = {} as PreviewSizing;
  for (const field of Object.keys(previewNumericFields) as PreviewNumericField[]) {
    const value = definition?.style[field];
    sizing[field] = validPreviewNumber(field, value) ? value : sizingDefaults[field]!;
  }
  return { renderer: renderer === "list" && !handler ? "content" : renderer, behavior, sizing, handler };
}

export function previewSizingStyle(sizing: PreviewSizing): CSSProperties {
  return {
    "--preview-caption-size": `${sizing.captionFontSize}px`,
    "--preview-image-height": `${sizing.imageMaxHeightVh}vh`,
    "--preview-image-grid-min": `${sizing.imageGridMinWidth}px`,
    "--preview-image-grid-gap": `${sizing.imageGridGap}px`,
    "--preview-table-cell-height": `${sizing.tableCellMaxHeightEm}em`,
    "--preview-table-editor-height": `${sizing.tableEditorMaxHeight}px`,
    "--preview-table-expanded-size": `${sizing.tableExpandedFontSize}px`
  } as CSSProperties;
}

export function imageClickAction(configuration: ReturnType<typeof environmentPreview>, defaultMode: "gui" | "source") {
  if (!configuration.behavior.inlineEditable) return "inspect";
  return configuration.behavior.imageClickAction === "settings" ? defaultMode === "source" ? "source" : "replace" : configuration.behavior.imageClickAction;
}
