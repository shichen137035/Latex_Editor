import { describe, expect, it } from "vitest";
import { resolveReasoningEffort } from "../../apps/desktop/src/main/ai/reasoning-effort.js";

describe("AI thinking depth", () => {
  const model = { id: "test-model", name: "Test", isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }] };
  it("applies a supported choice and restores the model default after a manual override", () => {
    expect(resolveReasoningEffort(model, "high")).toBe("high");
    expect(resolveReasoningEffort(model, "")).toBe("medium");
  });
  it("does not send unsupported saved choices when changing models or using automatic routing", () => {
    expect(resolveReasoningEffort(model, "max")).toBe("medium");
    expect(resolveReasoningEffort({ id: "auto", name: "Auto", isDefault: true }, "high")).toBeUndefined();
    expect(resolveReasoningEffort(undefined, "high")).toBeUndefined();
  });
});
