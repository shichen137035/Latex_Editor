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
import { mergeConversation, newestConversation } from "../../apps/desktop/src/renderer/ai/conversationState.js";

const roots: string[] = [];
for (const mode of ["chat", "codex"] as const) {
  it(`${mode} accumulates reply token usage without duplicate counts or previous-turn totals`, async () => {
    const f = await fixture(mode);
    let disposed = false;
    try {
      await f.send();
      expect(f.message().tokenUsage).toBeUndefined();
      const emitUsage = (input: number, output: number, id: string, previous = 90000) => {
        if (mode === "chat") f.emit("assistant.usage", { apiCallId: id, inputTokens: input, outputTokens: output, reasoningTokens: 50, cacheReadTokens: 100 });
        else f.emit("thread/tokenUsage/updated", { turnId: "turn", tokenUsage: { total: { inputTokens: previous + input, outputTokens: output, totalTokens: previous + input + output }, last: { inputTokens: input, outputTokens: output, totalTokens: input + output } } });
      };
      emitUsage(1200, 300, "call-1");
      emitUsage(1200, 300, "call-1");
      if (mode === "codex") {
        f.emit("thread/tokenUsage/updated", { turnId: "old-turn", tokenUsage: { total: { inputTokens: 999999, outputTokens: 999999 }, last: { inputTokens: 999999, outputTokens: 999999 } } });
        f.emit("thread/tokenUsage/updated", { turnId: "turn", tokenUsage: { total: { inputTokens: 90000, outputTokens: 0 }, last: { inputTokens: 100, outputTokens: 100 } } });
      }
      expect(f.message().tokenUsage).toEqual({ inputTokens: 1200, outputTokens: 300, totalTokens: 1500 });
      if (mode === "chat") emitUsage(800, 200, "call-2");
      else f.emit("thread/tokenUsage/updated", { turnId: "turn", tokenUsage: { total: { inputTokens: 92000, outputTokens: 500, totalTokens: 92500 }, last: { inputTokens: 800, outputTokens: 200, totalTokens: 1000 } } });
      expect(f.message().tokenUsage).toEqual({ inputTokens: 2000, outputTokens: 500, totalTokens: 2500 });
      f.finish();
      await vi.waitFor(() => expect(f.message().status).toBe("complete"));
      await f.service.dispose();
      disposed = true;
      const reopened = await fixture(mode, undefined, f.root);
      try {
        const saved = reopened.service.snapshot("project").conversations.find(item => item.id === f.conversation.id)!;
        expect(saved.messages.at(-1)?.tokenUsage?.totalTokens).toBe(2500);
      } finally { await reopened.service.dispose(); }
    } finally { if (!disposed) await f.service.dispose(); }
  });
}

it("refreshes a memoized reply when usage arrives without text changes", () => {
  const current: AIConversation = { id: "chat", title: "Test", mode: "chat", createdAt: 1, updatedAt: 1, revision: 1, messages: [{ id: "reply", role: "assistant", content: "Answer", createdAt: 1 }] };
  const incoming = { ...current, revision: 2, messages: [{ ...current.messages[0]!, tokenUsage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } }] };
  expect(mergeConversation(current, incoming).messages[0]?.tokenUsage?.totalTokens).toBe(1200);
});
afterEach(async () => { vi.useRealTimers(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(mode: "chat" | "codex", prepareContext?: ConstructorParameters<typeof AIWorkspaceService>[0]["prepareContext"], existingRoot?: string) {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), "texweave-lifecycle-")); if (!existingRoot) roots.push(root);
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
  let turnNumber = 0;
  const currentTurn = () => turnNumber === 1 ? "turn" : `turn-${turnNumber}`;
  const codexMock = { onEvent: (callback: typeof listener) => { listener = callback; return () => undefined; }, interruptTurn: vi.fn(async () => undefined), startTurn: vi.fn(async (input: Parameters<CodexAppServer["startTurn"]>[0]) => { turnNumber++; workspace = input.cwd; input.onThreadReady?.("thread"); return { threadId: "thread", turnId: currentTurn() }; }) };
  const codex = codexMock as unknown as CodexAppServer;
  const updates: AIConversation[] = [];
  const service = new AIWorkspaceService({ userDataPath: root, codex,
    copilot: { dispose: async () => undefined, releaseSession: async () => undefined, session: async (_id: unknown, _model: unknown, _newId: unknown, path: string) => { workspace = path; return session; } } as unknown as CopilotChatService,
    projectFiles: { resolveFilePath: async (_id, path) => join(root, "project", path) }, projectExists: () => true,
    ...(prepareContext ? { prepareContext } : {}),
    builtInSkillsRoot: join(root, "skills"), compileWorkspace: async () => { throw new Error("Unexpected compile"); }, setMainFile: async () => undefined,
    createBlockApi: ({ projectId, workspaceRoot }) => createWorkspaceBlockApi({ id: projectId, name: "Test", canonicalPath: workspaceRoot, createdAt: "", registeredAt: "", writable: true, missing: false }, workspaceRoot),
    onUpdate: (kind, payload) => { if (kind === "conversation") updates.push(payload as AIConversation); }
  });
  await service.initialize(); const conversation = await service.create({ projectId: "project", mode });
  const send = (content = "Edit") => service.send({ conversationId: conversation.id, content, snapshot: [{ path: "main.tex", content: "\\begin{document}Old text.\\end{document}" }] });
  const emit = (type: string, data: Record<string, unknown> = {}, agentId?: string) => {
    if (mode === "codex") listener({ method: type, params: { threadId: "thread", ...data } });
    else for (const callback of [...(callbacks.get("*") ?? []), ...(callbacks.get(type) ?? [])]) callback({ data, ...(agentId ? { agentId } : {}) });
  };
  const finish = () => emit(mode === "chat" ? "session.idle" : "turn/completed", { turn: { id: currentTurn(), status: "completed" } });
  return { root, service, session, codexMock, conversation, send, emit, finish, updates, workspace: () => workspace, message: () => service.snapshot("project").conversations[0]!.messages.at(-1)! };
}

for (const mode of ["chat", "codex"] as const) {
  it(`${mode} batches streamed history updates and delivers completion without stale trailing updates`, async () => {
    const f = await fixture(mode);
    await f.send();
    f.updates.length = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    for (let index = 0; index < 100; index++) {
      f.emit(mode === "chat" ? "assistant.message_delta" : "item/agentMessage/delta",
        mode === "chat" ? { messageId: "answer", deltaContent: "x" } : { itemId: "answer", delta: "x" });
      f.emit(mode === "chat" ? "assistant.reasoning_delta" : "item/reasoning/summaryTextDelta",
        mode === "chat" ? { reasoningId: "reason", deltaContent: "y" } : { itemId: "reason", delta: "y" });
    }
    // IPC snapshots include the whole history, so a token burst must not copy it per token.
    expect(f.updates.length).toBeLessThanOrEqual(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(f.updates.length).toBe(1);
    expect(f.updates[0]!.messages.at(-1)!.content).toBe("x".repeat(100));
    expect(f.updates[0]!.messages.at(-1)!.reasoning?.[0]?.text).toBe("y".repeat(100));
    if (mode === "codex") {
      for (let index = 0; index < 100; index++) f.emit("item/commandExecution/outputDelta", { delta: "Log output" });
      await vi.advanceTimersByTimeAsync(50);
      expect(f.updates.length).toBe(1);
    }
    f.emit(mode === "chat" ? "assistant.message_delta" : "item/agentMessage/delta",
      mode === "chat" ? { messageId: "answer", deltaContent: "last" } : { itemId: "answer", delta: "last" });
    f.finish();
    await vi.waitFor(() => expect(f.updates.at(-1)?.messages.at(-1)?.status).toBe("complete"));
    expect(f.updates.at(-1)!.messages.at(-1)!.content).toBe("x".repeat(100) + "last");
    const completedCount = f.updates.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(f.updates.length).toBe(completedCount);
    await f.service.dispose();
    const closing = await fixture(mode);
    await closing.send();
    closing.emit(mode === "chat" ? "assistant.message_delta" : "item/agentMessage/delta",
      mode === "chat" ? { messageId: "next", deltaContent: "Pending at shutdown" } : { itemId: "next", delta: "Pending at shutdown" });
    const shutdownCount = closing.updates.length;
    await closing.service.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(closing.updates.length).toBe(shutdownCount);
    expect(vi.getTimerCount()).toBe(0);
  });

  it(`${mode} settles a queued context preparation before saving final shutdown history`, async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let preparations = 0;
    const f = await fixture(mode, async () => { if (++preparations === 2) await gate; return {}; });
    try {
      await f.send("First request");
      await f.send("Keep this queued request");
      f.finish();
      await vi.waitFor(() => expect(preparations).toBe(2));
      const shutdown = f.service.dispose();
      // The queue dispatch is already preparing context when shutdown begins.
      let shutdownFinished = false;
      void shutdown.then(() => { shutdownFinished = true; });
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(shutdownFinished).toBe(false);
      release();
      await shutdown;
      const saved = JSON.parse(await readFile(join(f.root, "ai/conversations.json"), "utf8")) as { conversations: AIConversation[] };
      expect(saved.conversations[0]!.queuedMessages).toEqual([expect.objectContaining({ content: "Keep this queued request", error: "ai.queueInterrupted" })]);
      expect(saved.conversations[0]!.queuePaused).toBe(true);
      expect(mode === "chat" ? f.session.send : f.codexMock.startTurn).toHaveBeenCalledTimes(1);
    } finally { release(); await f.service.dispose(); }
  });

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

it("keeps completed history memoizable across streamed IPC snapshots without losing edits", () => {
  const current: AIConversation = { id: "chat", mode: "codex", title: "Test", createdAt: 1, updatedAt: 1, messages: [
    { id: "user", role: "user", content: "Please help", createdAt: 1 },
    { id: "assistant", role: "assistant", content: "First", createdAt: 2, status: "streaming", reasoning: [{ id: "r", text: "Thought", complete: false }] }
  ] };
  const incoming = structuredClone(current);
  incoming.updatedAt = 2;
  incoming.messages[1]!.content += " response";
  const merged = mergeConversation(current, incoming);
  expect(merged.messages[0]).toBe(current.messages[0]);
  expect(merged.messages[1]).toBe(incoming.messages[1]);
  const identical = mergeConversation(merged, structuredClone(merged));
  expect(identical.messages).toBe(merged.messages);
  const edited = structuredClone(merged);
  edited.updatedAt = 3;
  edited.messages[0]!.content = "Revised request";
  edited.messages[1]!.reasoning![0]!.complete = true;
  const revised = mergeConversation(merged, edited);
  expect(revised.messages[0]).toBe(edited.messages[0]);
  expect(revised.messages[1]).toBe(edited.messages[1]);
  expect(mergeConversation(revised, merged)).toBe(revised);
});

it("streams safe approve-for-me source edits into acknowledged checkpoints before the AI turn ends", async () => {
  const f = await fixture("codex");
  const original = "\\begin{document}\nFirst.\n\\end{document}\n";
  const started = await f.service.send({ conversationId: f.conversation.id, content: "Revise the text", permissionMode: "auto", snapshot: [{ path: "main.tex", content: original }] });
  const checkpoint = "\\begin{document}\nRevised.\n\\end{document}\n";
  await writeFile(join(f.workspace(), "main.tex"), checkpoint);
  await vi.waitFor(() => expect(f.service.snapshot("project").changeSets.length).toBe(1), { timeout: 4000 });
  const first = f.service.snapshot("project").changeSets[0]!;
  expect(first.permissionMode).toBe("auto");
  await f.service.markChangeSetApplied(first.id, first.files.flatMap(file => file.hunks.map(hunk => hunk.id)));
  await writeFile(join(f.workspace(), "main.tex"), `${checkpoint}Added line.\n`);
  f.emit("turn/completed", { turn: { id: "turn", status: "completed" } });
  await vi.waitFor(() => expect(f.service.snapshot("project").changeSets.length).toBe(2), { timeout: 4000 });
  const final = f.service.snapshot("project").changeSets.find(changes => changes.id !== first.id)!;
  expect(final.messageId).toBe(first.messageId);
  expect(final.messageId).toBe(f.message().id);
  expect(final.files[0]?.originalContent).toBe(checkpoint);
  expect(final.files[0]?.proposedContent).toBe(`${checkpoint}Added line.\n`);
  expect(started.taskId).toBeTruthy();
  await expect(f.service.dismissChangeSet([first.id, final.id])).rejects.toThrow("Resolve all unapplied AI changes");
  expect(f.service.snapshot("project").changeSets).toHaveLength(2);
  await f.service.markChangeSetApplied(final.id, final.files.flatMap(file => file.hunks.map(hunk => hunk.id)));
  await f.service.dismissChangeSet([first.id, final.id]);
  expect(f.service.snapshot("project").changeSets).toHaveLength(0);
  expect(JSON.parse(await readFile(join(f.root, "ai", "conversations.json"), "utf8")).changeSets).toHaveLength(0);
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

for (const mode of ["chat", "codex"] as const) {
  it(`${mode} pauses queued work on provider failure until the user sends an entry now`, async () => {
    const f = await fixture(mode);
    try {
      await f.send("First"); await f.send("Second");
      f.emit(mode === "chat" ? "session.shutdown" : "turn/completed", { errorReason: "Disconnected", turn: { id: "turn", status: "failed" } });
      await vi.waitFor(() => expect(f.service.snapshot("project").conversations[0]!.queuePaused).toBe(true));
      const conversation = f.service.snapshot("project").conversations[0]!;
      expect(conversation.messages).toHaveLength(2); expect(conversation.queuedMessages).toHaveLength(1);
      await f.service.sendQueued(conversation.id, conversation.queuedMessages![0]!.id);
      expect(f.service.snapshot("project").conversations[0]!.messages.at(-2)?.content).toBe("Second");
    } finally { await f.service.dispose(); }
  });

  it(`${mode} defers a priority entry until an interrupted initial preparation has settled`, async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const prepare = vi.fn(async () => {
      if (prepare.mock.calls.length === 1) await gate;
      return { snapshot: [{ path: "main.tex", content: "Source" }] };
    });
    const f = await fixture(mode, prepare);
    try {
      const first = f.send("First");
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
      const pending = await f.send("Priority");
      const priority = f.service.sendQueued(f.conversation.id, pending.conversation.queuedMessages![0]!.id);
      release(); await first; await priority;
      expect(mode === "chat" ? f.session.send : f.codexMock.startTurn).toHaveBeenCalledOnce();
      expect(f.service.snapshot("project").conversations[0]!.messages.at(-2)?.content).toBe("Priority");
    } finally { release(); await f.service.dispose(); }
  });

  it(`${mode} drains queued messages in order only after the preceding turn completes`, async () => {
    const f = await fixture(mode);
    try {
      await f.send("First");
      expect(await f.send("Second")).toMatchObject({ queued: true });
      expect(await f.send("Third")).toMatchObject({ queued: true });
      expect(f.service.snapshot("project").conversations[0]!.messages).toHaveLength(2);
      f.finish();
      await vi.waitFor(() => expect(f.service.snapshot("project").conversations[0]!.messages.at(-2)?.content).toBe("Second"));
      await vi.waitFor(() => expect(mode === "chat" ? f.session.send.mock.calls.length : f.codexMock.startTurn.mock.calls.length).toBe(2));
      f.finish();
      await vi.waitFor(() => expect(f.service.snapshot("project").conversations[0]!.messages.at(-2)?.content).toBe("Third"));
      const conversation = f.service.snapshot("project").conversations[0]!;
      expect(conversation.messages.filter(item => item.role === "user").map(item => item.content)).toEqual(["First", "Second", "Third"]);
      expect(conversation.queuedMessages).toEqual([]);
    } finally { await f.service.dispose(); }
  });

  it(`${mode} immediately sends the chosen entry after interrupting, leaving other entries in FIFO order`, async () => {
    const f = await fixture(mode);
    try {
      await f.send("First"); await f.send("Second"); await f.send("Third");
      const queued = f.service.snapshot("project").conversations[0]!.queuedMessages!;
      await f.service.sendQueued(f.conversation.id, queued[1]!.id);
      expect(mode === "chat" ? f.session.abort : f.codexMock.interruptTurn).toHaveBeenCalledOnce();
      expect(f.service.snapshot("project").conversations[0]!.messages.at(-2)?.content).toBe("Third");
      if (mode === "codex") {
        f.emit("turn/completed", { turn: { id: "turn", status: "completed" } });
        expect(f.message().status).toBe("streaming");
      }
      f.finish();
      await vi.waitFor(() => expect(f.service.snapshot("project").conversations[0]!.messages.at(-2)?.content).toBe("Second"));
    } finally { await f.service.dispose(); }
  });

  it(`${mode} pauses on Stop and retains queued attachments when their composer draft closes`, async () => {
    const f = await fixture(mode);
    try {
      const running = await f.send("First");
      const draftId = randomUUID(); f.service.openAttachmentDraft("project", draftId);
      const attachment = await f.service.addPastedFile("project", "queued.txt", Buffer.from("Queued attachment"), draftId);
      await f.service.send({ conversationId: f.conversation.id, content: "Attached follow-up", attachmentDraftId: draftId, attachmentIds: [attachment.id] });
      await f.service.attachments.close({ projectId: "project", draftId });
      await f.service.cancel(running.taskId);
      expect(f.service.attachments.usage().count).toBe(1);
      const conversation = f.service.snapshot("project").conversations[0]!;
      expect(conversation.queuePaused).toBe(true); expect(conversation.messages).toHaveLength(2);
      await f.service.sendQueued(conversation.id, conversation.queuedMessages![0]!.id);
      expect(await readFile(join(f.workspace(), ".texweave", "ai-attachments", attachment.id, attachment.name), "utf8")).toBe("Queued attachment");
      expect(f.service.attachments.usage().count).toBe(0);
    } finally { await f.service.dispose(); }
  });

  it(`${mode} queues during initial preparation and reads fresh context only at dispatch`, async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let content = "Original";
    const prepare = vi.fn(async () => {
      if (prepare.mock.calls.length === 1) await gate;
      return { snapshot: [{ path: "main.tex", content }] };
    });
    const f = await fixture(mode, prepare);
    try {
      const first = f.send("First");
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
      const queued = await f.send("Second"); expect(queued.queued).toBe(true);
      expect(prepare).toHaveBeenCalledOnce();
      release(); await first; content = "Fresh project state";
      f.finish();
      await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
      await vi.waitFor(async () => expect(await readFile(join(f.workspace(), "main.tex"), "utf8")).toBe(content));
    } finally { release(); await f.service.dispose(); }
  });
}

it("releases attachments when a queued message is removed without sending", async () => {
  const f = await fixture("chat");
  try {
    await f.send(); const draftId = randomUUID(); f.service.openAttachmentDraft("project", draftId);
    const item = await f.service.addPastedFile("project", "unused.txt", Buffer.from("Unused"), draftId);
    const result = await f.service.send({ conversationId: f.conversation.id, content: "Remove me", attachmentDraftId: draftId, attachmentIds: [item.id] });
    await f.service.removeQueued(f.conversation.id, result.conversation.queuedMessages![0]!.id);
    expect(f.service.attachments.usage().count).toBe(0);
    expect(f.service.snapshot("project").conversations[0]!.queuedMessages).toEqual([]);
  } finally { await f.service.dispose(); }
});

it("does not resurrect a removed queue item when an older IPC response arrives", () => {
  const base: AIConversation = { id: "chat", title: "Test", mode: "chat", messages: [], createdAt: 1, updatedAt: 1, revision: 1, queuedMessages: [{ id: "queued", content: "Waiting", createdAt: 1 }] };
  const removed = { ...base, revision: 2, queuedMessages: [] };
  expect(newestConversation(removed, base)).toBe(removed);
  expect(newestConversation(base, removed)).toBe(removed);
});

it("retains unsent text after closing without automatically restarting tasks", async () => {
  const original = await fixture("codex");
  const running = await original.send("First"); await original.send("Unsent follow-up");
  await original.service.cancel(running.taskId); await original.service.dispose();
  const reopened = await fixture("codex", undefined, original.root);
  try {
    expect(reopened.codexMock.startTurn).not.toHaveBeenCalled();
    const conversation = reopened.service.snapshot("project").conversations.find(item => item.id === original.conversation.id)!;
    expect(conversation.queuePaused).toBe(true);
    expect(conversation.queuedMessages![0]).toMatchObject({ content: "Unsent follow-up", error: "ai.queueInterrupted" });
    await reopened.service.sendQueued(conversation.id, conversation.queuedMessages![0]!.id);
    expect(reopened.codexMock.startTurn).toHaveBeenCalledOnce();
    expect(reopened.service.snapshot("project").conversations.find(item => item.id === conversation.id)!.messages.at(-2)?.content).toBe("Unsent follow-up");
  } finally { await reopened.service.dispose(); }
});
