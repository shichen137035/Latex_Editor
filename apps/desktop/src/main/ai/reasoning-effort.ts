import type { AIModelOption } from "@latex-editor/contracts" with { "resolution-mode": "import" };

/** Revalidate saved preferences against model capabilities, including model switches. */
export function resolveReasoningEffort(model: AIModelOption | undefined, preference: string | undefined): string | undefined {
  const supported = model?.supportedReasoningEfforts ?? [];
  if (preference && supported.some((option) => option.effort === preference)) return preference;
  const fallback = model?.defaultReasoningEffort;
  return fallback && supported.some((option) => option.effort === fallback) ? fallback : undefined;
}
