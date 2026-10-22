import { closeTestCapabilities, testCapabilities } from "../capability-fixture.js";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AIMode, AIPermissionMode, CompanionChatUpdate } from "@latex-editor/contracts";
import { CompanionChatService } from "../../apps/desktop/src/main/ai/companion-chat.js";
import { CompanionSkillRepository } from "../../apps/desktop/src/main/companion-skills.js";
import type { CodexAppServer } from "../../apps/desktop/src/main/ai/codex-app-server.js";
import type { CopilotChatService } from "../../apps/desktop/src/main/ai/copilot-chat.js";

const roots: string[] = [];
afterEach(async () => { closeTestCapabilities(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(mode: AIMode, gate?: Promise<void>, existingRoot?: string, defaultPermission: AIPermissionMode = "auto") {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), "texweave-pet-chat-"));
  if (!existingRoot) roots.push(root);
  const listeners = new Set<Parameters<CodexAppServer["onEvent"]>[0]>();
  const callbacks = new Map<string, Set<(event: { data: Record<string, unknown>; agentId?: string }) => void>>();
  const session = { sessionId: "pet-session", abort: vi.fn(async () => undefined), send: vi.fn(async (input: { prompt: string }) => { void input; return "reply"; }),
    on: (type: string | ((event: { data: Record<string, unknown> }) => void), handler?: (event: { data: Record<string, unknown> }) => void) => {
      const key = typeof type === "string" ? type : "*", callback = typeof type === "string" ? handler! : type;
      const current = callbacks.get(key) ?? new Set(); current.add(callback); callbacks.set(key, current);
      return () => current.delete(callback);
    }
  };
  const codex = { onEvent: (callback: Parameters<CodexAppServer["onEvent"]>[0]) => { listeners.add(callback); return () => listeners.delete(callback); },
    startTurn: vi.fn(async (input: Parameters<CodexAppServer["startTurn"]>[0]) => { await gate; input.onThreadReady?.("pet-thread"); return { threadId: "pet-thread", turnId: "pet-turn" }; }),
    interruptTurn: vi.fn(async () => undefined), stop: vi.fn(async () => undefined)
  };
  const copilot = { session: vi.fn(async (...args: unknown[]) => { void args; await gate; return session; }), releaseSession: vi.fn(async () => undefined), dispose: vi.fn(async () => undefined) };
  const updates: CompanionChatUpdate[] = [];
  const { service: capabilities, settings } = await testCapabilities(root);
  const skills = new CompanionSkillRepository(resolve("resources/ai/companion"), join(root, "ai", "companion"));
  const service = new CompanionChatService({ capabilities, skills, capabilityMode: () => defaultPermission, userDataPath: root, codex: codex as unknown as CodexAppServer, copilot: copilot as unknown as CopilotChatService, onUpdate: update => updates.push(update) });
  await service.initialize();
  const conversation = existingRoot ? service.snapshot()[0]! : await service.create(mode);
  const emit = (type: string, data: Record<string, unknown>, threadId = "pet-thread") => {
    if (mode === "codex") for (const listener of listeners) listener({ method: type, params: { threadId, ...data } });
    else for (const listener of [...(callbacks.get("*") ?? []), ...(callbacks.get(type) ?? [])]) listener({ data });
  };
  const send = () => service.send({ conversationId: conversation.id, content: "How do I use TeXWeave?", model: "test-model", reasoningEffort: "low" });
  const finish = () => emit(mode === "codex" ? "turn/completed" : "session.idle", { turn: { id: "pet-turn", status: "completed" } });
  return { root, service, capabilities, settings, skills, conversation, codex, copilot, session, updates, emit, send, finish, message: () => service.snapshot()[0]!.messages.at(-1)!, listeners, callbacks };
}

it("Copilot restores context when the provider returns a replacement session", async () => {
  const f = await fixture("chat");
  try {
    await f.send(); f.finish(); await vi.waitFor(() => expect(f.service.busy).toBe(false));
    f.session.sessionId = "replacement-pet-session";
    await f.send();
    expect(f.copilot.session.mock.calls[1]![0]).toBe("pet-session");
    expect(f.session.send.mock.calls[1]![0].prompt).toContain("Earlier conversation:");
    expect(f.session.send.mock.calls[1]![0].prompt).toContain("companion-settings:");
    f.finish(); await vi.waitFor(() => expect(f.service.busy).toBe(false));
    await f.send();
    expect(f.session.send.mock.calls[2]![0].prompt).toBe("How do I use TeXWeave?");
  } finally { await f.service.dispose(); }
});

for (const mode of ["chat", "codex"] as const) {
  it.each(["auto", "ask"] as const)(`${mode} uses the selected %s permission consistently for provider and gateway`, async permissionMode => {
    const f = await fixture(mode, undefined, undefined, permissionMode === "auto" ? "ask" : "auto");
    try {
      await f.service.send({ conversationId: f.conversation.id, content: "Change font size", permissionMode });
      const call = async (name: string, args: Record<string, unknown>) => {
        if (mode === "codex") return JSON.parse(await f.codex.startTurn.mock.calls[0]![0].toolHandlers![name]!(args));
        const tools = f.copilot.session.mock.calls[0]![5] as Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<string> }>;
        return JSON.parse(await tools.find(tool => tool.name === name)!.handler(args));
      };
      expect(mode === "codex" ? f.codex.startTurn.mock.calls[0]![0].permissionMode : f.copilot.session.mock.calls[0]![6]).toBe(permissionMode);
      const plan = await call("tw_plan_operation", { id: "settings.fontSize.set", arguments: { scope: "global", value: 18 }, requestId: "selected-mode" });
      const executing = call("tw_execute_operation", { operationId: plan.data.operationId, action: "apply" });
      if (permissionMode === "ask") {
        await vi.waitFor(() => expect(f.service.approvals.list()).toHaveLength(1));
        expect(f.settings.global.fontSize).toBeUndefined();
        f.service.approvals.resolve(f.service.approvals.list()[0]!.id, true);
      }
      expect((await executing).data.status).toBe("verified");
      expect(f.service.approvals.list()).toHaveLength(0);
      expect(f.settings.global.fontSize).toBe(18);
    } finally { await f.service.dispose(); }
  });
  it(`${mode} discovers skills on demand and reports a verified setting change through the same gateway`, async () => {
    const f = await fixture(mode);
    try {
      await f.send();
      const prompt = mode === "codex" ? f.codex.startTurn.mock.calls[0]![0].prompt : f.session.send.mock.calls[0]![0].prompt;
      expect(prompt).toContain("companion-settings:");
      expect(prompt).not.toContain("Questions about how to change a setting do not authorize a change");
      const call = async (name: string, args: Record<string, unknown>) => {
        if (mode === "codex") return JSON.parse(await f.codex.startTurn.mock.calls[0]![0].toolHandlers![name]!(args));
        const tools = f.copilot.session.mock.calls[0]![5] as Array<{ name: string; handler: (args: Record<string, unknown>) => Promise<string> }>;
        return JSON.parse(await tools.find(tool => tool.name === name)!.handler(args));
      };
      expect((await call("tw_get_state", { id: "skills.read", arguments: { name: "companion-settings" } })).data.content).toContain("Questions about how to change a setting do not authorize a change");
      const plan = await call("tw_plan_operation", { id: "settings.wordWrap.set", arguments: { scope: "global", value: false }, requestId: "setting" });
      expect((await call("tw_execute_operation", { operationId: plan.data.operationId, action: "apply" })).data.status).toBe("verified");
      expect(f.settings.global.wordWrap).toBe(false);
      expect(f.message().operations?.[0]).toMatchObject({ status: "verified", before: true, after: false });
      f.finish(); await vi.waitFor(() => expect(f.service.busy).toBe(false));
      await f.capabilities.undo(plan.data.operationId);
      expect(f.settings.global.wordWrap).toBeUndefined();
    } finally { await f.service.dispose(); }
  });
  it(`${mode} chats without a project and persists pet history separately from project history`, async () => {
    const f = await fixture(mode);
    let closed = false;
    try {
      const projectPath = join(f.root, "ai", "conversations.json");
      await mkdir(join(f.root, "ai"), { recursive: true });
      await writeFile(projectPath, "project history stays here");
      const started = await f.send();
      expect(started.conversation.projectId).toBeUndefined();
      expect(started.conversation.activeTaskId).toBe(started.taskId);
      expect(f.service.busy).toBe(true);
      if (mode === "codex") {
        const request = f.codex.startTurn.mock.calls[0]![0];
        expect(request.cwd).toBe(join(f.root, "ai", "companion", "workspaces", f.conversation.id));
        expect(request.prompt).toContain("application-wide conversation");
        expect(request.dynamicTools?.map(tool => tool.name)).toEqual(["tw_search_capabilities", "tw_get_capability", "tw_get_state", "tw_plan_operation", "tw_execute_operation"]);
        expect(request.skills).toBeUndefined();
        expect(request.model).toBe("test-model");
        f.emit("item/agentMessage/delta", { itemId: "answer", delta: "wrong thread" }, "project-thread");
        expect(f.message().content).toBe("");
      } else {
        expect(f.copilot.session.mock.calls[0]?.[1]).toBe("test-model");
        expect(f.copilot.session.mock.calls[0]?.[5]).toHaveLength(5);
        expect(f.session.send.mock.calls[0]?.[0]).toMatchObject({ prompt: expect.stringContaining("application-wide conversation") });
      }
      f.updates.length = 0;
      for (let index = 0; index < 100; index++) f.emit(mode === "codex" ? "item/agentMessage/delta" : "assistant.message_delta", mode === "codex" ? { itemId: "answer", delta: "x" } : { messageId: "answer", deltaContent: "x" });
      expect(f.updates.length).toBeLessThanOrEqual(1);
      expect(f.message().content).toBe("x".repeat(100));
      f.finish();
      await vi.waitFor(() => expect(f.message().status).toBe("complete"));
      await f.service.dispose(); closed = true;
      expect(f.listeners.size).toBe(0);
      expect([...f.callbacks.values()].every(listeners => listeners.size === 0)).toBe(true);
      expect(f.codex.stop).not.toHaveBeenCalled();
      expect(f.copilot.dispose).not.toHaveBeenCalled();
      expect(await readFile(projectPath, "utf8")).toBe("project history stays here");
      const reopened = await fixture(mode, undefined, f.root);
      try { expect(reopened.message().content).toBe("x".repeat(100)); expect(reopened.service.snapshot()[0]?.activeTaskId).toBeUndefined(); }
      finally { await reopened.service.dispose(); }
    } finally { if (!closed) await f.service.dispose(); }
  });

  it(`${mode} handles Stop while its shared provider is still starting`, async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(mode, gate);
    try {
      const pending = f.send();
      await vi.waitFor(() => expect(mode === "codex" ? f.codex.startTurn : f.copilot.session).toHaveBeenCalledOnce());
      await f.service.cancel(f.service.snapshot()[0]!.activeTaskId!);
      release(); await pending;
      expect(f.message().status).toBe("complete");
      expect(f.service.snapshot()[0]?.activeTaskId).toBeUndefined();
      expect(f.service.busy).toBe(false);
      if (mode === "codex") expect(f.codex.interruptTurn).toHaveBeenCalledWith("pet-thread", "pet-turn");
      else { expect(f.session.send).not.toHaveBeenCalled(); expect(f.copilot.releaseSession).toHaveBeenCalledWith("pet-session"); }
    } finally { release(); await f.service.dispose(); }
  });

  it(`${mode} resumes its own provider conversation without injecting duplicate history`, async () => {
    const f = await fixture(mode);
    const read = vi.spyOn(f.skills, "read");
    try {
      await f.send();
      f.emit(mode === "codex" ? "item/agentMessage/delta" : "assistant.message_delta", mode === "codex" ? { itemId: "answer", delta: "First answer" } : { messageId: "answer", deltaContent: "First answer" });
      f.finish();
      await vi.waitFor(() => expect(f.service.busy).toBe(false));
      await f.send();
      if (mode === "codex") {
        expect(f.codex.startTurn.mock.calls[1]?.[0]).toMatchObject({ threadId: "pet-thread" });
        expect(f.codex.startTurn.mock.calls[1]?.[0].prompt).not.toContain("Earlier conversation:");
        expect(f.codex.startTurn.mock.calls[1]?.[0].prompt).not.toContain("Never run short polling loops");
        expect(f.codex.startTurn.mock.calls[1]?.[0].prompt).toBe("How do I use TeXWeave?");
      } else {
        expect(f.copilot.session.mock.calls[1]?.[0]).toBe("pet-session");
        expect(f.session.send.mock.calls[1]?.[0].prompt).not.toContain("Earlier conversation:");
        expect(f.session.send.mock.calls[1]?.[0].prompt).not.toContain("Never run short polling loops");
        expect(f.session.send.mock.calls[1]?.[0].prompt).toBe("How do I use TeXWeave?");
      }
      expect(read.mock.calls).toEqual([["companion-core"]]);
      f.finish();
      await vi.waitFor(() => expect(f.service.busy).toBe(false));
    } finally { await f.service.dispose(); }
  });

  it(`${mode} persists prompt fingerprints and only refreshes a changed workflow index once`, async () => {
    const f = await fixture(mode);
    await f.send(); f.finish();
    await vi.waitFor(() => expect(f.service.busy).toBe(false));
    await f.service.dispose();
    const reopened = await fixture(mode, undefined, f.root);
    const sent = () => mode === "codex" ? reopened.codex.startTurn.mock.calls.at(-1)![0].prompt : reopened.session.send.mock.calls.at(-1)![0].prompt;
    try {
      await reopened.send();
      expect(sent()).toBe("How do I use TeXWeave?");
      reopened.finish(); await vi.waitFor(() => expect(reopened.service.busy).toBe(false));
      await reopened.skills.setEnabled({ name: "companion-themes", enabled: false });
      await reopened.send();
      expect(sent()).toContain("Updated TeXWeave pet context");
      expect(sent()).toContain("companion-settings:");
      expect(sent()).not.toContain("companion-themes:");
      expect(sent()).not.toContain("Earlier conversation:");
      reopened.finish(); await vi.waitFor(() => expect(reopened.service.busy).toBe(false));
      await reopened.send();
      expect(sent()).toBe("How do I use TeXWeave?");
    } finally { await reopened.service.dispose(); }
  });

  it(`${mode} restores bounded history only when replacing the native session`, async () => {
    const f = await fixture(mode);
    await f.send();
    f.emit(mode === "codex" ? "item/agentMessage/delta" : "assistant.message_delta", mode === "codex" ? { itemId: "answer", delta: "First answer" } : { messageId: "answer", deltaContent: "First answer" });
    f.finish(); await vi.waitFor(() => expect(f.service.busy).toBe(false));
    await f.service.dispose();
    const path = join(f.root, "ai", "companion", "conversations.json");
    const saved = JSON.parse(await readFile(path, "utf8"));
    saved.conversations[0][mode === "codex" ? "codexToolsVersion" : "copilotToolsVersion"] = 0;
    await writeFile(path, JSON.stringify(saved));
    const reopened = await fixture(mode, undefined, f.root);
    try {
      await reopened.send();
      const text = mode === "codex" ? reopened.codex.startTurn.mock.calls[0]![0].prompt : reopened.session.send.mock.calls[0]![0].prompt;
      expect(text).toContain("application-wide conversation");
      expect(text).toContain("Earlier conversation:");
      expect(text).toContain("ASSISTANT: First answer");
      expect(text).not.toContain("Updated TeXWeave pet context");
      expect(mode === "codex" ? reopened.codex.startTurn.mock.calls[0]![0].threadId : reopened.copilot.session.mock.calls[0]![0]).toBeUndefined();
    } finally { await reopened.service.dispose(); }
  });

  it(`${mode} upgrades legacy prompt state once without duplicating native history`, async () => {
    const f = await fixture(mode);
    await f.send(); f.finish(); await vi.waitFor(() => expect(f.service.busy).toBe(false));
    await f.service.dispose();
    const path = join(f.root, "ai", "companion", "conversations.json");
    const saved = JSON.parse(await readFile(path, "utf8")); delete saved.promptContexts;
    await writeFile(path, JSON.stringify(saved));
    const reopened = await fixture(mode, undefined, f.root);
    try {
      await reopened.send();
      const text = mode === "codex" ? reopened.codex.startTurn.mock.calls[0]![0].prompt : reopened.session.send.mock.calls[0]![0].prompt;
      expect(text).toContain("Updated TeXWeave pet context");
      expect(text).not.toContain("Earlier conversation:");
      reopened.finish(); await vi.waitFor(() => expect(reopened.service.busy).toBe(false));
      await reopened.send();
      expect(mode === "codex" ? reopened.codex.startTurn.mock.calls[1]![0].prompt : reopened.session.send.mock.calls[1]![0].prompt).toBe("How do I use TeXWeave?");
    } finally { await reopened.service.dispose(); }
  });
}
