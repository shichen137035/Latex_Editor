import type { CSSProperties } from "react";
import type { PreviewDirectiveDefinition } from "@latex-editor/contracts";
import { semanticColorRoles } from "../themes/semanticColors.js";
export function directiveColorStyle(item?: PreviewDirectiveDefinition): CSSProperties {
  const base = item?.color ?? "#8094a7", roles = semanticColorRoles(base);
  return { "--directive-color": item?.colorMode === "fixed" ? base : roles.accent, "--directive-label-text": item?.colorMode === "fixed" ? base : roles.labelText, "--directive-fill": item?.colorMode === "fixed" ? `color-mix(in srgb, ${base} 6%, var(--color-bg-panel))` : roles.fill, "--directive-border": item?.colorMode === "fixed" ? base : roles.border } as CSSProperties;
}
