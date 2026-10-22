import { expect, it, vi } from "vitest";
import type { AIStatus } from "@latex-editor/contracts";
import { AIProviderAuthentication } from "../../apps/desktop/src/main/ai/provider-auth.js";

it("reuses an existing account or browser authorization instead of opening another login", async () => {
  const codex = { status: vi.fn(async (): Promise<AIStatus> => ({ auth: "signed_in", process: "running", accountLabel: "existing" })), login: vi.fn() };
  const chat = { status: vi.fn(async (): Promise<AIStatus> => ({ auth: "authenticating", process: "running" })), login: vi.fn() };
  const accounts = new AIProviderAuthentication({ codex, chat });
  expect((await accounts.login("codex"))?.accountLabel).toBe("existing");
  expect((await accounts.login("chat"))?.auth).toBe("authenticating");
  expect(codex.login).not.toHaveBeenCalled(); expect(chat.login).not.toHaveBeenCalled();
});

it("coalesces login requests from both chat surfaces and keeps providers independent", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const codex = { status: vi.fn(async (): Promise<AIStatus> => { await gate; return { auth: "signed_out", process: "running" }; }), login: vi.fn(async (): Promise<AIStatus> => ({ auth: "authenticating", process: "running" })) };
  const chat = { status: vi.fn(async (): Promise<AIStatus> => ({ auth: "signed_in", process: "running" })), login: vi.fn() };
  const accounts = new AIProviderAuthentication({ codex, chat });
  const projectRequest = accounts.login("codex"), petRequest = accounts.login("codex");
  expect(petRequest).toBe(projectRequest);
  expect((await accounts.login("chat"))?.auth).toBe("signed_in");
  release(); await Promise.all([projectRequest, petRequest]);
  expect(codex.status).toHaveBeenCalledOnce(); expect(codex.login).toHaveBeenCalledOnce();
});

it("allows retry after a failed login attempt", async () => {
  const account = { status: vi.fn(async (): Promise<AIStatus> => ({ auth: "signed_out", process: "running" })), login: vi.fn<() => Promise<AIStatus>>().mockRejectedValueOnce(new Error("Browser failed")).mockResolvedValue({ auth: "authenticating", process: "running" }) };
  const accounts = new AIProviderAuthentication({ codex: account, chat: account });
  await expect(accounts.login("codex")).rejects.toThrow("Browser failed");
  expect((await accounts.login("codex"))?.auth).toBe("authenticating");
  expect(account.login).toHaveBeenCalledTimes(2);
});
