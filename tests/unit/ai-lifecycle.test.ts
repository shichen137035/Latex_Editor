import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { AIConversation } from "@latex-editor/contracts";
import { AIWorkspaceService } from "../../apps/desktop/src/main/ai/ai-workspace.js";
import { randomUUID } from "node:crypto";
import type { CodexAppServer } from "../../apps/desktop/src/main/ai/codex-app-server.js";
import type { CopilotChatService } from "../../apps/desktop/src/main/ai/copilot-chat.js";
import { createWorkspaceBlockApi } from "../../apps/desktop/src/main/ai/workspace-block-api.js";
import { newestConversation } from "../../apps/desktop/src/renderer/ai/conversationState.js";

const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(mode: "chat" | "codex") {
  const root = await mkdtemp(join(tmpdir(), "texweave-lifecycle-")); roots.push(root);
  let listener: Parameters<CodexAppServer["onEvent"]>[0] = () => undefined;
  let workspace = "";
  type Event = { data: Record<string, unknown>; agentId?: string };
  const callbacks = new Map<string, Set<(event: Event) => void>>();
  const session = {
    sessionId: "copilot-test", abort: vi.fn(async () => undefined), send: vi.fn(async () => "message"),
    on: (type: string | ((event: Event) => void), callback?: (event: Event) => void) => {
      const key = typeof type === "string" ? type : "*", handler = typeof type === "string" ? callback! : type;
      const listeners = callbacks.get(key) ?? new Set(); listeners.add(handler); callbacks.set(key, listeners);
      return () => listeners.delete(handler);
    }
  };
  const codex = { onEvent: (callback: typeof listener) => { listener = callback; return () => undefined; }, startTurn: async (input: Parameters<CodexAppServer["startTurn"]>[0]) => { workspace = input.cwd; input.onThreadReady?.("thread"); return { threadId: "thread", turnId: "turn" }; } } as unknown as CodexAppServer;
  const updates: AIConversation[] = [];
  const service = new AIWorkspaceService({ userDataPath: root, codex,
    copilot: { dispose: async () => undefined, session: async (_id: unknown, _model: unknown, _newId: unknown, path: string) => { workspace = path; return session; } } as unknown as CopilotChatService,
    projectFiles: { resolveFilePath: async (_id, path) => join(root, "project", path) }, projectExists: () => true,
    builtInSkillsRoot: join(root, "skills"), compileWorkspace: async () => { throw new Error("Unexpected compile"); }, setMainFile: async () => undefined,
    createBlockApi: ({ projectId, workspaceRoot }) => createWorkspaceBlockApi({ id: projectId, name: "Test", canonicalPath: workspaceRoot, createdAt: "", registeredAt: "", writable: true, missing: false }, workspaceRoot),
    onUpdate: (kind, payload) => { if (kind === "conversation") updates.push(payload as AIConversation); }
  });
  await service.initialize(); const conversation = await service.create({ projectId: "project", mode });
  const send = () => service.send({ conversationId: conversation.id, content: "Edit", snapshot: [{ path: "main.tex", content: "\\begin{document}Old text.\\end{document}" }] });
  const emit = (type: string, data: Record<string, unknown> = {}, agentId?: string) => {
    if (mode === "codex") listener({ method: type, params: { threadId: "thread", ...data } });
    else for (const callback of [...(callbacks.get("*") ?? []), ...(callbacks.get(type) ?? [])]) callback({ data, ...(agentId ? { agentId } : {}) });
  };
  return { root, service, session, conversation, send, emit, updates, workspace: () => workspace, message: () => service.snapshot("project").conversations[0]!.messages.at(-1)! };
}

for (const mode of ["chat", "codex"] as const) {
  it(`${mode} keeps a send lease alive when its draft closes during context preparation`, async () => {
    const f = await fixture(mode);
    const draftId = randomUUID(); f.service.openAttachmentDraft("project", draftId);
    const item = await f.service.addPastedFile("project", "background.txt", Buffer.from("Background attachment"), draftId);
    const lease = f.service.acquireAttachments(f.conversation.id, draftId, [item.id]);
    await f.service.attachments.close({ projectId: "project", draftId });
    expect(f.service.attachments.usage().count).toBe(1);
    await f.service.send({ conversationId: f.conversation.id, content: "Read", attachmentLease: lease!, snapshot: [{ path: "main.tex", content: "\\begin{document}Text.\\end{document}" }] });
    expect(await readFile(join(f.workspace(), ".texweave", "ai-attachments", item.id, item.name), "utf8")).toBe("Background attachment");
    expect(f.service.attachments.usage().count).toBe(0);
    await f.service.dispose();
  });
}

it("does not resurrect completed messages when a stale send response arrives with the same timestamp", async () => {
  const f = await fixture("codex");
  const running = (await f.send()).conversation;
  const completed = structuredClone(running); completed.messages.at(-1)!.status = "complete";
  expect(newestConversation(completed, running)).toBe(completed);
  expect(newestConversation(running, completed)).toBe(completed);
  await f.service.dispose();
});

it("finishes Copilot on session idle, keeps authoritative text and ignores sub-agent output", async () => {
  const f = await fixture("chat"); await f.send();
  f.emit("assistant.message_delta", { messageId: "m", deltaContent: "Partial" });
  f.emit("assistant.message", { messageId: "m", content: "Complete answer" });
  f.emit("assistant.message", { messageId: "sub", content: "Child output" }, "child");
  f.emit("assistant.turn_end", { turnId: "t" });
  expect(f.message().status).toBe("streaming");
  f.emit("session.idle", { mode: "autopilot" }); expect(f.message().status).toBe("streaming");
  f.emit("session.idle");
  await vi.waitFor(() => expect(f.updates.at(-1)?.messages.at(-1)?.status).toBe("complete"));
  expect(f.message().content).toBe("Complete answer");
  f.emit("session.idle"); expect(f.service.snapshot("project").changeSets).toEqual([]);
  await f.service.dispose();
});

it.each(["chat", "codex"] as const)("publishes change-collection failure and clears running state for %s", async mode => {
  const f = await fixture(mode); await f.send();
  await rm(f.workspace(), { recursive: true, force: true }); await writeFile(f.workspace(), "not a directory");
  f.emit(mode === "chat" ? "session.idle" : "turn/completed", { turn: { id: "turn", status: "completed" } });
  await vi.waitFor(() => expect(f.updates.at(-1)?.messages.at(-1)?.status).toBe("error"));
  expect(f.message().content).toContain("Could not collect proposed changes");
  await f.service.dispose();
});

it.each(["chat", "codex"] as const)("reports %s disconnection after partial output instead of leaving a spinner", async mode => {
  const f = await fixture(mode); await f.send();
  f.emit(mode === "chat" ? "assistant.message_delta" : "item/agentMessage/delta", { messageId: "m", deltaContent: "Partial", delta: "Partial" });
  f.emit(mode === "chat" ? "session.shutdown" : "transport/closed", { errorReason: "Connection lost", message: "Connection lost" });
  await vi.waitFor(() => expect(f.updates.at(-1)?.messages.at(-1)?.status).toBe("error"));
  expect(f.message().content).toContain("Partial"); expect(f.message().content).toContain("Connection lost");
  await f.service.dispose();
});

it("recovers history persistence after one failed write", async () => {
  const f = await fixture("codex"); await f.send();
  const store = join(f.root, "ai", "conversations.json");
  await rm(store); await mkdir(store);
  f.emit("turn/completed", { turn: { id: "turn", status: "completed" } });
  await vi.waitFor(() => expect(f.message().content).toContain("Could not save AI history"));
  await rm(store, { recursive: true });
  await expect(f.service.renameConversation(f.conversation.id, "Recovered")).resolves.toMatchObject({ title: "Recovered" });
  await f.service.dispose();
});

it("ends an unresponsive Copilot turn explicitly instead of waiting forever", async () => {
  const f = await fixture("chat"); vi.useFakeTimers();
  try {
    await f.send(); await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(f.message().status).toBe("error"); expect(f.message().content).toContain("stopped responding");
    expect(f.session.abort).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); await f.service.dispose(); }
});
