import type { AITokenUsage } from "@latex-editor/contracts" with { "resolution-mode": "import" };

const count = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
export function readTokenUsage(value: unknown): AITokenUsage | undefined {
  if (!value || typeof value !== "object") return;
  const data = value as Record<string, unknown>;
  const input = count(data.inputTokens), output = count(data.outputTokens), total = count(data.totalTokens);
  if (input === undefined && output === undefined && total === undefined) return;
  return { inputTokens: input ?? 0, outputTokens: output ?? 0, totalTokens: total ?? (input ?? 0) + (output ?? 0) };
}

export function addTokenUsage(current: AITokenUsage | undefined, delta: AITokenUsage): AITokenUsage {
  return { inputTokens: (current?.inputTokens ?? 0) + delta.inputTokens, outputTokens: (current?.outputTokens ?? 0) + delta.outputTokens, totalTokens: (current?.totalTokens ?? 0) + delta.totalTokens };
}

/** Codex total is cumulative across the thread; last is only the newest model call. */
export function codexUsageDelta(previous: AITokenUsage | undefined, payload: unknown): { cumulative: AITokenUsage; delta: AITokenUsage } | undefined {
  if (!payload || typeof payload !== "object") return;
  const data = payload as Record<string, unknown>, cumulative = readTokenUsage(data.total);
  if (!cumulative) return;
  if (previous && cumulative.totalTokens < previous.totalTokens) return;
  if (!previous) {
    const delta = readTokenUsage(data.last);
    return delta ? { cumulative, delta } : undefined;
  }
  return { cumulative, delta: { inputTokens: Math.max(0, cumulative.inputTokens - previous.inputTokens), outputTokens: Math.max(0, cumulative.outputTokens - previous.outputTokens), totalTokens: Math.max(0, cumulative.totalTokens - previous.totalTokens) } };
}
