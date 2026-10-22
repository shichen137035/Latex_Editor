import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { addTokenUsage, codexUsageDelta, readTokenUsage } from "../../apps/desktop/src/main/ai/tokenUsage.js";
import { AIResponse } from "../../apps/desktop/src/renderer/ai/AIResponse.js";
import { AIApprovalCard } from "../../apps/desktop/src/renderer/ai/AIApprovalCard.js";

describe("Provider token accounting", () => {
  it("preserves real million-token usage and exposes cache as a subset, without adding it twice", () => {
    const usage = readTokenUsage({ inputTokens: 2159834, cachedInputTokens: 2061440, outputTokens: 19092, totalTokens: 2178926 })!;
    expect(usage.totalTokens).toBe(2178926);
    expect(usage.inputTokens - usage.cachedInputTokens! + usage.outputTokens).toBe(117486);
    const html = renderToStaticMarkup(createElement(AIResponse, { message: { id: "m", role: "assistant", content: "Done", createdAt: 1, tokenUsage: usage }, projectRoot: "" }));
    expect(html).toContain("2,178.93k"); expect(html).toContain("2,061.44k"); expect(html).toContain("19.09k");
  });
  it("differences cumulative cache counts and ignores repeated totals", () => {
    const first = codexUsageDelta(undefined, { total: { inputTokens: 1000, cachedInputTokens: 800, outputTokens: 100 }, last: { inputTokens: 500, cachedInputTokens: 400, outputTokens: 50 } })!;
    const next = codexUsageDelta(first.cumulative, { total: { inputTokens: 1600, cachedInputTokens: 1200, outputTokens: 200 } })!;
    expect(addTokenUsage(first.delta, next.delta)).toEqual({ inputTokens: 1100, cachedInputTokens: 800, outputTokens: 150, totalTokens: 1250 });
    const repeated = codexUsageDelta(next.cumulative, { total: next.cumulative })!;
    expect(addTokenUsage(next.delta, repeated.delta)).toEqual(next.delta);
  });
  it("does not invent a zero cache count for old or incomplete provider records", () => {
    expect(readTokenUsage({ inputTokens: 100, outputTokens: 20 })).not.toHaveProperty("cachedInputTokens");
    expect(readTokenUsage({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 101 })).not.toHaveProperty("cachedInputTokens");
    expect(addTokenUsage({ inputTokens: 100, outputTokens: 20, totalTokens: 120 }, { inputTokens: 200, cachedInputTokens: 100, outputTokens: 20, totalTokens: 220 })).not.toHaveProperty("cachedInputTokens");
  });
  it("places approval decisions before long descriptions in the shared project/pet card", () => {
    const html = renderToStaticMarkup(createElement(AIApprovalCard, { request: { id: "a", conversationId: "c", status: "pending", description: "LONG_PREVIEW".repeat(500), paths: [] }, onResolve: async () => undefined }));
    expect(html.indexOf("<button")).toBeLessThan(html.indexOf("LONG_PREVIEW"));
    expect(html.match(/<button/g)).toHaveLength(2);
  });
});
