import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CopilotChatService } from "../../apps/desktop/src/main/ai/copilot-chat.js";

const sdk = vi.hoisted(() => {
  const session = { sessionId: "thinking-test", setModel: vi.fn(async () => undefined) };
  return {
    session,
    start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
    createSession: vi.fn(async (config: { sessionId: string }) => ({ ...session, sessionId: config.sessionId })),
    listModels: vi.fn(async () => [{ id: "reasoning-model", name: "Reasoning model", capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" as string | undefined }])
  };
});

it("restores provider defaults when the catalog does not advertise a default effort", async () => {
  const root = mkdtempSync(join(tmpdir(), "texweave-reasoning-"));
  const service = new CopilotChatService(root);
  sdk.listModels.mockResolvedValueOnce([{ id: "reasoning-model", name: "Reasoning model", capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: undefined }]);
  try {
    const first = await service.session(undefined, "reasoning-model", "thinking-test", root, "high");
    const reset = await service.session(first.sessionId, "reasoning-model", "thinking-test", root, "");
    expect(reset.sessionId).not.toBe(first.sessionId);
    expect(sdk.createSession.mock.calls.at(-1)?.[0]).not.toHaveProperty("reasoningEffort");
  } finally {
    await service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
vi.mock("@github/copilot-sdk", () => ({ CopilotClient: class {
  start = sdk.start; stop = sdk.stop; createSession = sdk.createSession; listModels = sdk.listModels;
} }));

it("passes thinking depth to new and existing Copilot sessions, including restoring the default", async () => {
  const root = mkdtempSync(join(tmpdir(), "texweave-reasoning-"));
  const service = new CopilotChatService(root);
  try {
    await service.session(undefined, "reasoning-model", "thinking-test", root, "high");
    expect(sdk.createSession).toHaveBeenCalledWith(expect.objectContaining({ model: "reasoning-model", reasoningEffort: "high" }));
    await service.session("thinking-test", "reasoning-model", "thinking-test", root, "low");
    expect(sdk.session.setModel).toHaveBeenLastCalledWith("reasoning-model", { reasoningEffort: "low" });
    await service.session("thinking-test", "reasoning-model", "thinking-test", root, "");
    expect(sdk.session.setModel).toHaveBeenLastCalledWith("reasoning-model", { reasoningEffort: "medium" });
  } finally {
    await service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
