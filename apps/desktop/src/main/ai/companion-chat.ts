import { restoredConversationHistory } from "./context-policy.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AIConversation, AIMessage, AIMode, AIPermissionMode, AITokenUsage, CompanionChatUpdate } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { CopilotSession } from "@github/copilot-sdk" with { "resolution-mode": "import" };
import type { CodexAppServer } from "./codex-app-server.js";
import type { CopilotChatService } from "./copilot-chat.js";
import { AIApprovalRequests } from "./approval-requests.js";
import { updateReasoning, updateResponseText } from "./message-stream.js";
import { addTokenUsage, codexUsageDelta, readTokenUsage } from "./tokenUsage.js";
import { CAPABILITY_TOOLS_VERSION, capabilityWorkflow, copilotCapabilityTools, skillIndex, unavailableCapabilityTools, type CapabilityService } from "../capabilities/gateway.js";
import type { CompanionSkillRepository } from "../companion-skills.js";

type SendInput = { conversationId: string; content: string; model?: string; reasoningEffort?: string; permissionMode?: AIPermissionMode };
type Turn = {
  id: string; conversation: AIConversation; message: AIMessage; complete: boolean; canceled: boolean;
  threadId?: string; turnId?: string; session?: CopilotSession; usage?: AITokenUsage;
  idleTimer?: ReturnType<typeof setTimeout>; unsubscribe: Array<() => void>; finishing?: Promise<void>;
};
type PromptContext = { sessionId: string; fingerprint: string };
const prompt = "You are the TeXWeave pet assistant. Help the user with the application, LaTeX, or general conversation. This is an application-wide conversation, independent of project-writing chats. It remains available while projects are opened, closed, or switched. No project is attached to this conversation. Do not claim to inspect or change project files or application settings without a supported tool result. Do not edit application configuration or installation files through shell commands. Explain unavailable operations clearly and guide the user to the relevant interface.";
const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Global pet history and turns. Owns neither provider authentication nor project workspaces. */
export class CompanionChatService {
  readonly approvals: AIApprovalRequests;
  private conversations: AIConversation[] = [];
  /** Persisted independently of UI history, so restarting does not repeat unchanged context. */
  private readonly promptContexts = new Map<string, PromptContext>();
  private coreContent: Promise<string> | undefined;
  private readonly root: string;
  private readonly path: string;
  private readonly turns = new Map<string, Turn>();
  private readonly starting = new Set<Promise<void>>();
  private readonly finishing = new Set<Promise<void>>();
  private readonly pending = new Map<string, AIConversation>();
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private writes = Promise.resolve();
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(private readonly options: { userDataPath: string; codex: CodexAppServer; copilot: CopilotChatService; capabilities?: CapabilityService; skills?: CompanionSkillRepository; capabilityMode?(): AIPermissionMode; onUpdate(update: CompanionChatUpdate): void }) {
    this.root = join(options.userDataPath, "ai", "companion");
    this.path = join(this.root, "conversations.json");
    this.approvals = new AIApprovalRequests(payload => options.onUpdate({ kind: "approval", payload }));
    this.unsubscribe = options.codex.onEvent(event => this.codexEvent(event.method, event.params));
  }

  get busy(): boolean { return this.turns.size > 0 || this.starting.size > 0 || this.finishing.size > 0; }
  snapshot(): AIConversation[] { return structuredClone(this.conversations).sort((a, b) => b.updatedAt - a.updatedAt); }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.path, "utf8")) as { version?: number; conversations?: AIConversation[]; promptContexts?: Record<string, PromptContext> };
      if (saved.version !== 1 || !Array.isArray(saved.conversations)) throw new Error("Invalid companion history format.");
      this.conversations = saved.conversations.filter(item => item && /^[0-9a-f-]{36}$/i.test(item.id) && !item.projectId && (item.mode === "chat" || item.mode === "codex") && Array.isArray(item.messages));
      for (const conversation of this.conversations) {
        const context = saved.promptContexts?.[conversation.id];
        if (context && typeof context.sessionId === "string" && context.sessionId.length <= 256 && /^[0-9a-f]{64}$/.test(context.fingerprint)) this.promptContexts.set(conversation.id, context);
      }
      let interrupted = false;
      for (const conversation of this.conversations) {
        if (conversation.activeTaskId) { delete conversation.activeTaskId; interrupted = true; }
        for (const message of conversation.messages) if (message.status === "streaming") {
          message.status = "error"; message.completedAt = Date.now();
          message.content ||= "The previous response was interrupted when TeXWeave closed.";
          interrupted = true;
        }
      }
      if (interrupted) await this.persist();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Companion history could not be read; the original file was left untouched.");
    }
  }

  async create(mode: AIMode): Promise<AIConversation> {
    if (this.disposed) throw new Error("Companion chat is shutting down.");
    if (mode !== "chat" && mode !== "codex") throw new Error("Unknown AI provider.");
    const now = Date.now();
    const conversation: AIConversation = { id: randomUUID(), mode, title: "New chat", createdAt: now, updatedAt: now, messages: [] };
    this.conversations.unshift(conversation);
    await this.persist();
    this.publish(conversation);
    return structuredClone(conversation);
  }

  async send(input: SendInput): Promise<{ conversation: AIConversation; taskId: string }> {
    if (this.disposed) throw new Error("Companion chat is shutting down.");
    const conversation = this.conversations.find(item => item.id === input.conversationId);
    if (!conversation) throw new Error("Companion conversation was not found.");
    if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 40_000) throw new Error("Enter a message under 40,000 characters.");
    if (conversation.activeTaskId) throw new Error("Wait for or stop the current response first.");
    const content = input.content.trim();
    const message: AIMessage = { id: randomUUID(), role: "assistant", content: "", createdAt: Date.now(), status: "streaming", activity: "thinking" };
    conversation.messages.push({ id: randomUUID(), role: "user", content, createdAt: Date.now(), status: "complete" }, message);
    if (conversation.title === "New chat") conversation.title = content.slice(0, 48);
    const turn: Turn = { id: randomUUID(), conversation, message, complete: false, canceled: false, unsubscribe: [] };
    conversation.activeTaskId = turn.id;
    this.turns.set(turn.id, turn);
    this.publish(conversation);
    const start = this.start(turn, input);
    this.starting.add(start);
    try { await start; }
    finally { this.starting.delete(start); }
    return { conversation: structuredClone(conversation), taskId: turn.id };
  }

  private async start(turn: Turn, input: SendInput): Promise<void> {
    try {
      await this.persist();
      const cwd = join(this.root, "workspaces", turn.conversation.id);
      await mkdir(cwd, { recursive: true });
      if (turn.complete) return;
      const skills = (await this.options.skills?.list() ?? []).filter(skill => skill.enabled);
      // The bundled foundation cannot be edited in the app. Extension metadata
      // stays fresh each turn; their bodies remain registry reads on demand.
      if (!this.coreContent && skills.some(skill => skill.name === "companion-core")) this.coreContent = this.options.skills!.read("companion-core").then(skill => skill.content).catch(error => { this.coreContent = undefined; throw error; });
      const context = [prompt, capabilityWorkflow, await this.coreContent ?? "", skillIndex(skills.filter(skill => !skill.readOnly))].filter(Boolean).join("\n\n");
      const fingerprint = createHash("sha256").update(context).digest("hex");
      const text = (sessionId?: string) => {
        const previous = this.promptContexts.get(turn.conversation.id);
        if (sessionId && previous?.sessionId === sessionId && previous.fingerprint === fingerprint) return input.content;
        // A resumed native session already contains its own history, even when
        // migrating an older history file that has no prompt fingerprint yet.
        const history = !sessionId ? restoredConversationHistory(turn.conversation.messages.slice(0, -2)) : "";
        return [sessionId ? "Updated TeXWeave pet context; replace earlier application guidance and workflow index. Consult skills.list for the current enabled workflows; do not reuse disabled workflows." : "", context, history ? `Earlier conversation:\n${history}` : "", input.content].filter(Boolean).join("\n\n");
      };
      const requestApproval = (action: { description: string; command?: string; paths: string[] }) => turn.complete ? Promise.resolve(false) : this.approvals.request({ conversationId: turn.conversation.id, ...action });
      const tools = this.options.capabilities?.bind({ sessionId: turn.conversation.id, origin: "pet", alive: () => !turn.complete && !turn.canceled && !this.disposed,
        permissionMode: () => input.permissionMode ?? this.options.capabilityMode?.() ?? "auto", handlers: {}, skills,
        readSkill: async name => { const skill = await this.options.skills!.read(name); if (!skill.enabled) throw new Error("Skill is disabled"); return skill.content; },
        requestApproval: description => requestApproval({ description, paths: [] }),
        onOperation: report => { turn.message.operations = [...(turn.message.operations ?? []).filter(item => item.operationId !== report.operationId), report]; this.publish(turn.conversation); }
      }) ?? unavailableCapabilityTools();
      if (turn.conversation.mode === "codex") {
        const threadId = turn.conversation.codexToolsVersion === CAPABILITY_TOOLS_VERSION ? turn.conversation.threadId : undefined;
        const started = await this.options.codex.startTurn({ cwd, prompt: text(threadId), mode: "codex", permissionMode: input.permissionMode ?? this.options.capabilityMode?.() ?? "auto", requestApproval,
          ...(threadId ? { threadId } : {}), dynamicTools: tools.dynamicTools, toolHandlers: tools.toolHandlers,
          ...(input.model ? { model: input.model } : {}), ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
          onThreadReady: id => { turn.threadId = id; }
        });
        turn.threadId = started.threadId; turn.turnId = started.turnId;
        turn.conversation.threadId = started.threadId;
        turn.conversation.codexToolsVersion = CAPABILITY_TOOLS_VERSION;
        this.promptContexts.set(turn.conversation.id, { sessionId: started.threadId, fingerprint });
        if (turn.complete || turn.canceled) await this.options.codex.interruptTurn(started.threadId, started.turnId).catch(() => undefined);
      } else {
        const previousSessionId = turn.conversation.copilotToolsVersion === CAPABILITY_TOOLS_VERSION ? turn.conversation.copilotSessionId : undefined;
        const session = await this.options.copilot.session(previousSessionId, input.model, randomUUID(), cwd, input.reasoningEffort, await copilotCapabilityTools(tools), input.permissionMode ?? this.options.capabilityMode?.() ?? "auto", requestApproval);
        turn.session = session; turn.conversation.copilotSessionId = session.sessionId;
        turn.conversation.copilotToolsVersion = CAPABILITY_TOOLS_VERSION;
        if (turn.complete) { await this.options.copilot.releaseSession(session.sessionId); return; }
        this.listenCopilot(turn, session);
        await session.send({ prompt: text(previousSessionId === session.sessionId ? session.sessionId : undefined) });
        this.promptContexts.set(turn.conversation.id, { sessionId: session.sessionId, fingerprint });
      }
      await this.persist();
    } catch (error) { await this.finish(turn, messageOf(error)); throw error; }
  }

  private listenCopilot(turn: Turn, session: CopilotSession): void {
    const refreshIdle = () => {
      clearTimeout(turn.idleTimer);
      if (turn.complete) return;
      turn.idleTimer = setTimeout(() => { if (this.approvals.list(turn.conversation.id).length) { refreshIdle(); return; } void this.cancel(turn.id, "Copilot stopped responding. Please try again.").catch(error => console.warn("Could not stop companion response", error)); }, 10 * 60_000);
      turn.idleTimer.unref?.();
    };
    const usages = new Set<string>();
    turn.unsubscribe.push(session.on(refreshIdle)); refreshIdle();
    turn.unsubscribe.push(session.on("assistant.message_delta", event => {
      if (turn.complete || event.agentId) return;
      turn.message.activity = "responding";
      updateResponseText(turn.message, event.data.messageId, event.data.deltaContent, false); this.publish(turn.conversation, true);
    }));
    turn.unsubscribe.push(session.on("assistant.message", event => {
      if (turn.complete || event.agentId) return;
      turn.message.activity = "responding";
      updateResponseText(turn.message, event.data.messageId, event.data.content, true); this.publish(turn.conversation);
    }));
    turn.unsubscribe.push(session.on("assistant.reasoning_delta", event => {
      if (turn.complete || event.agentId) return;
      updateReasoning(turn.message, event.data.reasoningId, event.data.deltaContent, false); this.publish(turn.conversation, true);
    }));
    turn.unsubscribe.push(session.on("assistant.reasoning", event => {
      if (turn.complete || event.agentId) return;
      updateReasoning(turn.message, event.data.reasoningId, event.data.content, true); this.publish(turn.conversation);
    }));
    turn.unsubscribe.push(session.on("assistant.usage", event => {
      if (turn.complete) return;
      const usage = readTokenUsage(event.data), key = event.data.apiCallId ?? event.id;
      if (!usage || (key && usages.has(key))) return;
      if (key) usages.add(key);
      turn.message.tokenUsage = addTokenUsage(turn.message.tokenUsage, usage); this.publish(turn.conversation, true);
    }));
    const finish = (error?: string) => { void this.finish(turn, error).catch(reason => console.warn("Could not save companion response", reason)); };
    turn.unsubscribe.push(session.on("session.idle", event => { if (!event.agentId && event.data.mode !== "autopilot") finish(); }));
    turn.unsubscribe.push(session.on("session.error", event => finish(event.data.message)));
    turn.unsubscribe.push(session.on("session.shutdown", event => finish(event.data.errorReason ?? "The AI connection closed.")));
  }

  private codexEvent(method: string, params: Record<string, unknown>): void {
    const finish = (turn: Turn, error?: string) => { void this.finish(turn, error).catch(reason => console.warn("Could not save companion response", reason)); };
    if (method === "transport/closed") {
      for (const turn of this.turns.values()) if (turn.conversation.mode === "codex") finish(turn, String(params.message ?? "The AI connection closed."));
      return;
    }
    const turn = [...this.turns.values()].find(item => item.threadId === params.threadId);
    if (!turn || turn.complete) return;
    const eventTurn = params.turn as Record<string, unknown> | undefined;
    const turnId = params.turnId ?? eventTurn?.id;
    if (turn.turnId && typeof turnId === "string" && turnId !== turn.turnId) return;
    if (method === "turn/completed") {
      const failure = eventTurn?.error as { message?: string } | undefined;
      finish(turn, eventTurn?.status === "failed" ? failure?.message ?? "Codex could not complete this response." : undefined); return;
    }
    if (method === "turn/started" && typeof eventTurn?.id === "string") { turn.turnId = eventTurn.id; return; }
    if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
      turn.message.activity = "responding"; updateResponseText(turn.message, String(params.itemId ?? "answer"), params.delta, false);
    } else if (method === "item/reasoning/summaryTextDelta" && typeof params.delta === "string") {
      updateReasoning(turn.message, `${String(params.itemId)}:${String(params.summaryIndex ?? 0)}`, params.delta, false);
    } else if (method === "thread/tokenUsage/updated") {
      const usage = codexUsageDelta(turn.usage, params.tokenUsage);
      if (!usage) return;
      turn.usage = usage.cumulative; turn.message.tokenUsage = addTokenUsage(turn.message.tokenUsage, usage.delta);
    } else if (method === "item/completed") {
      const item = params.item as Record<string, unknown> | undefined;
      if (item?.type === "agentMessage" && typeof item.text === "string") updateResponseText(turn.message, String(item.id ?? "answer"), item.text, true);
      else if (item?.type === "reasoning" && Array.isArray(item.summary)) item.summary.forEach((text, index) => { if (typeof text === "string") updateReasoning(turn.message, `${String(item.id)}:${index}`, text, true); });
      else return;
    } else return;
    this.publish(turn.conversation, true);
  }

  async cancel(taskId: string, error?: string): Promise<void> {
    const turn = this.turns.get(taskId);
    if (!turn) return;
    turn.canceled = true; this.approvals.cancel(turn.conversation.id);
    try {
      if (turn.session) await turn.session.abort();
      else if (turn.threadId && turn.turnId) await this.options.codex.interruptTurn(turn.threadId, turn.turnId);
    } finally { await this.finish(turn, error); }
  }

  private finish(turn: Turn, error?: string): Promise<void> {
    if (turn.finishing) return turn.finishing;
    turn.complete = true; clearTimeout(turn.idleTimer);
    this.options.capabilities?.releaseContext(turn.conversation.id);
    turn.unsubscribe.splice(0).forEach(unsubscribe => unsubscribe());
    this.approvals.cancel(turn.conversation.id);
    turn.message.status = error ? "error" : "complete"; turn.message.completedAt = Date.now();
    if (error) turn.message.content = [turn.message.content, error].filter(Boolean).join("\n\n");
    for (const part of turn.message.reasoning ?? []) part.complete = true;
    delete turn.conversation.activeTaskId; this.turns.delete(turn.id);
    this.publish(turn.conversation);
    turn.finishing = (async () => {
      if (turn.session) await this.options.copilot.releaseSession(turn.session.sessionId).catch(() => undefined);
      await this.persist();
    })();
    const finishing = turn.finishing;
    this.finishing.add(finishing);
    void finishing.then(() => this.finishing.delete(finishing), () => this.finishing.delete(finishing));
    return turn.finishing;
  }

  private publish(conversation: AIConversation, batched = false): void {
    conversation.updatedAt = Date.now(); conversation.revision = (conversation.revision ?? 0) + 1;
    if (this.disposed) return;
    if (batched) {
      this.pending.set(conversation.id, conversation);
      this.updateTimer ??= setTimeout(() => { this.updateTimer = undefined; for (const payload of this.pending.values()) this.options.onUpdate({ kind: "conversation", payload: structuredClone(payload) }); this.pending.clear(); }, 50);
    } else {
      this.pending.delete(conversation.id);
      this.options.onUpdate({ kind: "conversation", payload: structuredClone(conversation) });
    }
    this.saveTimer ??= setTimeout(() => { this.saveTimer = undefined; void this.persist().catch(error => console.warn("Could not save companion history", error)); }, 300);
  }

  private persist(): Promise<void> {
    clearTimeout(this.saveTimer); this.saveTimer = undefined;
    const write = this.writes.then(async () => {
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try { await writeFile(temp, JSON.stringify({ version: 1, conversations: this.conversations, promptContexts: Object.fromEntries(this.promptContexts) }), "utf8"); await rename(temp, this.path); }
      finally { await rm(temp, { force: true }); }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  async dispose(): Promise<void> {
    this.disposed = true; this.unsubscribe(); this.approvals.cancel();
    await Promise.allSettled([...this.turns.keys()].map(id => this.cancel(id)));
    await Promise.allSettled(this.starting);
    await Promise.allSettled(this.finishing);
    clearTimeout(this.updateTimer); this.updateTimer = undefined; this.pending.clear();
    await this.persist();
  }
}
