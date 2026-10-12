import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CopilotChatService } from "../../apps/desktop/src/main/ai/copilot-chat.js";
import type { SessionConfig } from "@github/copilot-sdk";

const sdk = vi.hoisted(() => {
  const session = { sessionId: "thinking-test", setModel: vi.fn(async () => undefined), disconnect: vi.fn(async () => undefined) };
  return {
    session,
    start: vi.fn(async () => undefined), stop: vi.fn(async () => undefined),
    createSession: vi.fn(async (config: { sessionId: string } & Pick<SessionConfig, "onPermissionRequest" | "tools">) => ({ ...session, sessionId: config.sessionId })),
    resumeSession: vi.fn(async (sessionId: string) => ({ ...session, sessionId })),
    deleteSession: vi.fn(async () => undefined),
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
  start = sdk.start; stop = sdk.stop; createSession = sdk.createSession; resumeSession = sdk.resumeSession; deleteSession = sdk.deleteSession; listModels = sdk.listModels;
} }));

it("releases completed sessions and callbacks without deleting resumable history", async () => {
  const root = mkdtempSync(join(tmpdir(), "texweave-copilot-release-"));
  const service = new CopilotChatService(root);
  try {
    const disconnectedBefore = sdk.session.disconnect.mock.calls.length;
    const deletedBefore = sdk.deleteSession.mock.calls.length;
    for (let index = 0; index < 20; index++) {
      const session = await service.session(undefined, "reasoning-model", `idle-${index}`, join(root, String(index)), "high", [{ name: "edit", handler: () => "source snapshot" }]);
      expect(service.runtimeStats).toEqual({ sessions: 1, workspaces: 1 });
      await service.releaseSession(session.sessionId);
      expect(service.runtimeStats).toEqual({ sessions: 0, workspaces: 0 });
    }
    expect(sdk.session.disconnect.mock.calls.length - disconnectedBefore).toBe(20);
    expect(sdk.deleteSession.mock.calls.length).toBe(deletedBefore);
    const resumed = await service.session("idle-19", "reasoning-model", "unused", root, "high");
    expect(resumed.sessionId).toBe("idle-19");
    await service.releaseSession(resumed.sessionId);
  } finally { await service.dispose(); rmSync(root, { recursive: true, force: true }); }
});

it("reclaims turn callbacks when session creation fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "texweave-copilot-failed-"));
  const service = new CopilotChatService(root);
  try {
    sdk.createSession.mockRejectedValueOnce(new Error("failed startup"));
    await expect(service.session(undefined, "reasoning-model", "failed", root, "high", [{ name: "edit", handler: () => "snapshot" }])).rejects.toThrow("failed startup");
    expect(service.runtimeStats).toEqual({ sessions: 0, workspaces: 0 });
  } finally { await service.dispose(); rmSync(root, { recursive: true, force: true }); }
});

it("shares one Copilot client when background requests start concurrently", async () => {
  const root = mkdtempSync(join(tmpdir(), "texweave-copilot-concurrent-"));
  const service = new CopilotChatService(root);
  try {
    const startsBefore = sdk.start.mock.calls.length;
    const sessions = await Promise.all(["first", "second"].map(id => service.session(undefined, "reasoning-model", id, join(root, id), "high")));
    expect(sdk.start.mock.calls.length - startsBefore).toBe(1);
    await Promise.all(sessions.map(session => service.releaseSession(session.sessionId)));
    expect(service.runtimeStats).toEqual({ sessions: 0, workspaces: 0 });
  } finally { await service.dispose(); rmSync(root, { recursive: true, force: true }); }
});

it("dispatches cached session tools through the current turn's snapshot tracker", async () => {
  const root = mkdtempSync(join(tmpdir(), "texweave-tools-"));
  const service = new CopilotChatService(root);
  try {
    const first = vi.fn(() => "first"), second = vi.fn(() => "second");
    const session = await service.session(undefined, "reasoning-model", "tool-test", root, "high", [{ name: "edit", handler: first }]);
    const tool = sdk.createSession.mock.calls.at(-1)![0].tools![0]!;
    await service.session(session.sessionId, "reasoning-model", "tool-test", root, "high", [{ name: "edit", handler: second }]);
    expect(await tool.handler!({}, { sessionId: session.sessionId, toolCallId: "call", toolName: "edit", arguments: {} })).toBe("second");
    expect(first).not.toHaveBeenCalled(); expect(second).toHaveBeenCalledOnce();
  } finally { await service.dispose(); rmSync(root, { recursive: true, force: true }); }
});

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

it("keeps web research available and updates permissions in cached Copilot sessions", async () => {
  const root = mkdtempSync(join(tmpdir(), "texweave-permissions-"));
  const service = new CopilotChatService(root);
  const ask = vi.fn(async () => false);
  try {
    const session = await service.session(undefined, "reasoning-model", "permission-test", root, "high", [], "auto", ask);
    const approve = sdk.createSession.mock.calls.at(-1)![0].onPermissionRequest!;
    expect(await approve({ kind: "url", url: "https://example.com", intention: "Web research" }, { sessionId: session.sessionId })).toMatchObject({ kind: "approve-once" });
    const write = { kind: "write" as const, fileName: join(root, "..", "external.tex"), intention: "External edit", diff: "", canOfferSessionApproval: false };
    expect(await approve(write, { sessionId: session.sessionId })).toMatchObject({ kind: "reject" });
    expect(ask).toHaveBeenCalledTimes(1);
    const cached = await service.session(session.sessionId, "reasoning-model", "permission-test", root, "high", [], "full", ask);
    expect(cached).toBe(session);
    expect(await approve(write, { sessionId: session.sessionId })).toMatchObject({ kind: "approve-once" });
    expect(ask).toHaveBeenCalledTimes(1);
    await service.session(session.sessionId, "reasoning-model", "permission-test", root, "high", [], "ask", ask);
    expect(await approve(write, { sessionId: session.sessionId })).toMatchObject({ kind: "reject" });
    expect(ask).toHaveBeenCalledTimes(2);
  } finally {
    await service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
