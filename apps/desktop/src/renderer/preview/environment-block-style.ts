import type { CSSProperties } from "react";
import { environmentAccent } from "./environment-colors.js";
import type { EnvironmentDefinition } from "./types.js";

function cssValue(value: string | undefined, fallback: string): string {
  return value ? (value.startsWith("--") ? `var(${value})` : value) : `var(${fallback})`;
}

export function environmentBlockStyle(environmentId: string, family: string, definition?: EnvironmentDefinition): CSSProperties {
  const accent = environmentAccent(environmentId, definition);
  return {
    "--block-accent": accent,
    "--block-fill": cssValue(definition?.style.fillToken, "--env-generic-fill"),
    "--block-border": cssValue(definition?.style.borderToken, "--env-border-default"),
    "--block-selected-border": cssValue(definition?.style.selectedBorderToken, "--env-border-selected"),
    "--block-label-bg": definition?.style.labelBackgroundToken === `--env-${family}-label-bg`
      ? `color-mix(in srgb, ${accent} 10%, var(--color-bg-panel))`
      : cssValue(definition?.style.labelBackgroundToken, "--env-generic-label-bg"),
    "--block-label-text": definition?.style.labelTextToken === `--env-${family}-label-text`
      ? accent
      : cssValue(definition?.style.labelTextToken, "--env-generic-label-text")
  } as CSSProperties;
}
