import { createHash } from "node:crypto";
import type { EnvironmentDefinition } from "@latex-editor/editor-core/preview/types" with { "resolution-mode": "import" };
import type { PreviewDirectiveDefinition } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import { CapabilityError, objectSchema, type Schema } from "./types.js";

export type DefinitionKey = "environments" | "previewDirectives";
type Definition = { id: string; builtIn: boolean; enabled: boolean; label?: string; family?: string; match: Record<string, unknown>; [key: string]: unknown };
const revision = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const matchKey = (value: Record<string, unknown>) => JSON.stringify(Object.keys(value).sort().map(key => [key, value[key]]));
const text = (maxLength = 256): Schema => ({ type: "string", maxLength });
const choice = (...values: string[]): Schema => ({ type: "string", enum: values });
const flag = { type: "boolean" };
const localized = objectSchema(Object.fromEntries(["en", "ja", "zh-CN", "zh-TW", "ko", "fr", "kk"].map(locale => [locale, text(100)])));

/** Closed patch schemas: clients never resend a whole configuration catalog. */
export async function customizationSchemas() {
  const { environmentFamilies } = await import("@latex-editor/contracts");
  const style: Record<string, Schema> = Object.fromEntries(["baseColor", "accentToken", "fillToken", "borderToken", "selectedBorderToken", "labelBackgroundToken", "labelTextToken"].map(key => [key, text()]));
  style.colorMode = choice("adaptive", "fixed"); style.titleFontFamily = text();
  for (const key of ["titleFontSize", "titleFontWeight", "titleLineHeight", "titleLetterSpacing", "captionFontSize", "imageMaxHeightVh", "imageGridMinWidth", "imageGridGap", "tableCellMaxHeightEm", "tableEditorMaxHeight", "tableExpandedFontSize"]) style[key] = { type: "number" };
  const behavior: Record<string, Schema> = Object.fromEntries(["inlineEditable", "allowChildren", "showHeader", "showLabel", "showOptionBrackets", "showCaption", "captionEditable", "allowExpandedEditor", "expandedToolbar", "listItemEditing", "listShowCount"].map(key => [key, flag]));
  Object.assign(behavior, { renderer: choice("auto", "content", "math", "code", "list", "figure", "table"), imageClickAction: choice("settings", "replace", "source", "inspect"), tableToolbar: choice("selected", "always", "hidden"), blockHandler: choice("", "builtin.list"), listStyle: choice("ordered", "unordered", "description"), listItemCommand: text(64), listMarker: choice("decimal", "lower-alpha", "lower-roman", "disc", "circle", "square", "none") });
  const match = { anyOf: [objectSchema({ kind: { const: "latex-environment" }, name: text(128) }, ["kind", "name"]), objectSchema({ kind: { const: "command" }, command: text(128) }, ["kind", "command"]), objectSchema({ kind: { const: "display-math" } }, ["kind"]), objectSchema({ kind: { const: "virtual-block" }, type: text(64) }, ["kind", "type"]), objectSchema({ kind: { const: "custom-pattern" }, pattern: text() }, ["kind", "pattern"])] };
  const blockPatch = objectSchema({ enabled: flag, label: text(100), labels: localized, family: choice(...environmentFamilies), match, style: objectSchema(style), behavior: objectSchema(behavior) });
  const commandPatch = objectSchema({ enabled: flag, label: text(100), labels: localized, match: objectSchema({ kind: { const: "command" }, name: text(128) }, ["kind", "name"]), display: choice("divider", "placeholder", "spacer"), color: text(7), colorMode: choice("adaptive", "fixed"), placement: choice("nested", "trailing", "independent") });
  return { blockPatch, commandPatch };
}

export async function effectiveDefinitions(key: DefinitionKey, raw: unknown, blockDefaults: EnvironmentDefinition[]): Promise<Definition[]> {
  const saved = raw as Definition[];
  if (key === "environments") return [...saved, ...blockDefaults.filter(item => !saved.some(entry => entry.id === item.id))] as unknown as Definition[];
  const { includeNewBuiltInDirectives } = await import("@latex-editor/contracts");
  return includeNewBuiltInDirectives(saved as unknown as PreviewDirectiveDefinition[]) as unknown as Definition[];
}

export function definitionResult(definition: Definition) { return { definition, revision: revision(definition) }; }

export async function prepareDefinition(key: DefinitionKey, raw: unknown, args: Record<string, unknown>, blockDefaults: EnvironmentDefinition[]) {
  const definitions = await effectiveDefinitions(key, raw, blockDefaults);
  const existing = definitions.find(item => item.id === args.id);
  if ((args.mode === "create") === Boolean(existing)) throw new CapabilityError("CONFLICT", existing ? "Definition id already exists; read it before updating." : "Definition not found; create it or select an existing id.");
  if (args.mode === "update" && (typeof args.expectedRevision !== "string" || args.expectedRevision !== revision(existing))) throw new CapabilityError("CONFLICT", "Definition changed since it was read; read it again before updating.");
  if (args.mode === "update" && args.baseId) throw new CapabilityError("INVALID_ARGUMENTS", "baseId is only used when creating a block definition.");
  const patch = args.patch as Record<string, unknown>;
  if (!Object.keys(patch).length) throw new CapabilityError("INVALID_ARGUMENTS", "Provide at least one requested definition change.");
  let base = existing;
  if (!base && key === "environments") {
    base = definitions.find(item => item.id === args.baseId);
    if (!base) throw new CapabilityError("INVALID_ARGUMENTS", "Choose baseId from the block definition catalog when creating a block.");
  }
  if (existing?.builtIn && patch.match && matchKey(existing.match) !== matchKey(patch.match as Record<string, unknown>)) throw new CapabilityError("INVALID_ARGUMENTS", "Built-in match rules cannot be renamed; create a custom derivative instead.");
  const next: Definition = { ...(base ?? { enabled: true, match: {}, label: "", display: "divider", color: "#637da4", colorMode: "adaptive", placement: "nested" }), ...patch, id: String(args.id), builtIn: existing?.builtIn ?? false } as Definition;
  if (!existing && key === "environments") next.labelKey = "";
  if (!existing) { delete next.labels; next.enabled = typeof patch.enabled === "boolean" ? patch.enabled : true; }
  if (patch.labels) next.labels = { ...existing?.labels as object, ...patch.labels as object };
  if (key === "environments") {
    for (const field of ["style", "behavior"] as const) next[field] = { ...base?.[field] as object, ...patch[field] as object };
    if (!existing && !patch.match) throw new CapabilityError("INVALID_ARGUMENTS", "A new block needs its own match rule.");
  }
  if (next.enabled && definitions.some(item => item.id !== next.id && item.enabled && matchKey(item.match) === matchKey(next.match))) throw new CapabilityError("CONFLICT", "Another enabled definition already uses this match rule.");
  const saved = raw as Definition[];
  const value = saved.some(item => item.id === next.id) ? saved.map(item => item.id === next.id ? next : item) : [...saved, next];
  const { validPreference } = await import("@latex-editor/contracts");
  if (!validPreference(key, value)) throw new CapabilityError("INVALID_ARGUMENTS", "Invalid definition. Use supported matches, colors, typography ranges and registered handlers.");
  const summary = (item: Definition | undefined) => item ? { id: item.id, ...Object.fromEntries(Object.keys(patch).map(key => [key, ["style", "behavior", "labels"].includes(key) ? Object.fromEntries(Object.keys(patch[key] as object).map(field => [field, (item[key] as Record<string, unknown> | undefined)?.[field] ?? null])) : item[key] ?? null])) } : null;
  return { value, definition: next, summary: { before: summary(existing), after: summary(next) } };
}
