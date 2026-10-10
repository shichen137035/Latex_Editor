import type { CSSProperties } from "react";
import { environmentColorRoles } from "./environment-colors.js";
import { semanticForeground } from "../themes/semanticColors.js";
import type { EnvironmentDefinition } from "./types.js";
import { environmentTitleTypography } from "./environment-typography.js";
import { environmentPreview, previewSizingStyle } from "./environment-preview.js";

export function environmentBlockStyle(environmentId: string, family: string, definition?: EnvironmentDefinition): CSSProperties {
  const colors = environmentColorRoles(environmentId, definition);
  const typography = environmentTitleTypography(environmentId, family, definition);
  return {
    ...previewSizingStyle(environmentPreview(environmentId, definition).sizing),
    "--preview-title-font": typography.titleFontFamily,
    "--preview-title-size": `${typography.titleFontSize}px`,
    "--preview-title-weight": typography.titleFontWeight,
    "--preview-title-leading": typography.titleLineHeight,
    "--preview-title-spacing": `${typography.titleLetterSpacing}em`,
    "--block-accent": colors.accent,
    "--block-fill": colors.fill,
    "--block-border": colors.border,
    "--block-selected-border": colors.selectedBorder,
    "--block-label-bg": colors.labelBackground,
    "--block-label-text": colors.labelText,
    "--block-content-text": definition?.style.colorMode === "fixed" ? semanticForeground(colors.fill) : "var(--color-text-primary)"
  } as CSSProperties;
}
