import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { AIModelOption, AIStatus } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import { findCodexExecutable, findExecutableOnPath, getManagedCodexExecutable } from "./codex-discovery.js";
import { isLatexCompilerCommand, isWorkspacePath } from "./ai-approvals.js";
import { resolveReasoningEffort } from "./reasoning-effort.js";

type JsonRecord = Record<string, unknown>;
type PendingRequest = { resolve(value: unknown): void; reject(reason: Error): void; timer: NodeJS.Timeout };
type MutableAIStatus = { auth: AIStatus["auth"]; process: AIStatus["process"]; executablePath?: string | undefined; accountLabel?: string | undefined; error?: string | undefined };
type DynamicTool = { name: string; description: string; inputSchema: Record<string, unknown> };

/** Owns a lazy Codex App Server process and keeps credentials in app user data, never in Renderer or a project. */
export class CodexAppServer {
  readonly #userDataPath: string;
  readonly #configuredExecutable: () => string;
  readonly #clientVersion: string;
  readonly #onStatus: (status: AIStatus) => void;
  readonly #onApprovalDecision: ((event: { method: string; command?: string; approved: boolean }) => void) | undefined;
  #child: ChildProcessWithoutNullStreams | undefined;
  #nextRequestId = 0;
  #pending = new Map<number, PendingRequest>();
  #status: AIStatus = { auth: "unknown", process: "stopped" };
  #startPromise: Promise<void> | undefined;
  #account: JsonRecord | undefined;
  #loginId: string | undefined;
  #eventListeners = new Set<(event: { method: string; params: JsonRecord }) => void>();
  #threadWorkspaces = new Map<string, string>();
  #fileChangePaths = new Map<string, string[]>();
  #models: AIModelOption[] | undefined;
  #dynamicToolHandlers = new Map<string, (arguments_: JsonRecord) => Promise<string>>();

  constructor(options: { userDataPath: string; executable: () => string; version: string; onStatus?: (status: AIStatus) => void; onApprovalDecision?: (event: { method: string; command?: string; approved: boolean }) => void }) {
    this.#userDataPath = options.userDataPath;
    this.#configuredExecutable = options.executable;
    this.#clientVersion = options.version;
    this.#onStatus = options.onStatus ?? (() => undefined);
    this.#onApprovalDecision = options.onApprovalDecision;
  }

  getStatus(): AIStatus { return { ...this.#status }; }

  async listModels(): Promise<AIModelOption[]> {
    await this.#ensureStarted();
    const models: AIModelOption[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = asRecord(await this.#request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }));
      const data = Array.isArray(response.data) ? response.data : [];
      for (const value of data) {
        const model = asRecord(value);
        if (typeof model.model !== "string" || !model.model) continue;
        models.push({ id: model.model, name: typeof model.displayName === "string" && model.displayName ? model.displayName : model.model,
          ...(typeof model.description === "string" && model.description ? { description: model.description } : {}), isDefault: model.isDefault === true,
          supportedReasoningEfforts: (Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : []).flatMap((value) => {
            const option = asRecord(value);
            return typeof option.reasoningEffort === "string" ? [{ effort: option.reasoningEffort, ...(typeof option.description === "string" ? { description: option.description } : {}) }] : [];
          }),
          ...(typeof model.defaultReasoningEffort === "string" ? { defaultReasoningEffort: model.defaultReasoningEffort } : {}) });
      }
      const next = typeof response.nextCursor === "string" && response.nextCursor ? response.nextCursor : undefined;
      if (!next || seenCursors.has(next)) break;
      seenCursors.add(next);
      cursor = next;
    } while (models.length < 500);
    this.#models = models;
    return models;
  }

  onEvent(listener: (event: { method: string; params: JsonRecord }) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  /** Starts a project-editing turn in the app-owned workspace; the UI reviews its diff before applying it. */
  async startTurn(input: { cwd: string; prompt: string; threadId?: string; mode: "chat" | "codex"; model?: string; reasoningEffort?: string; dynamicTools?: DynamicTool[]; toolHandlers?: Record<string, (arguments_: JsonRecord) => Promise<string>>; skills?: Array<{ name: string; path: string }> }): Promise<{ threadId: string; turnId: string }> {
    await this.#ensureStarted();
    const models = this.#models ?? await this.listModels();
    const model = input.model ? models.find((item) => item.id === input.model) : models.find((item) => item.isDefault);
    const effort = resolveReasoningEffort(model, input.reasoningEffort);
    const sandbox = "workspace-write";
    const threadResult = input.threadId
      ? asRecord(await this.#request("thread/resume", { threadId: input.threadId, cwd: input.cwd }))
      : asRecord(await this.#request("thread/start", {
        cwd: input.cwd,
        approvalPolicy: "on-request",
        sandbox,
        experimentalRawEvents: false,
        ...(input.dynamicTools?.length ? { dynamicTools: input.dynamicTools } : {})
      }));
    const thread = asRecord(threadResult.thread);
    const threadId = typeof thread.id === "string" ? thread.id : input.threadId;
    if (!threadId) throw new Error("Codex did not return a conversation thread id.");
    this.#threadWorkspaces.set(threadId, input.cwd);
    for (const [name, handler] of Object.entries(input.toolHandlers ?? {})) this.#dynamicToolHandlers.set(`${threadId}:${name}`, handler);
    const turnInput: Array<Record<string, unknown>> = [{ type: "text", text: input.prompt }];
    for (const skill of input.skills ?? []) turnInput.push({ type: "skill", name: skill.name, path: skill.path });
    const turnResult = asRecord(await this.#request("turn/start", {
      threadId,
      input: turnInput,
      cwd: input.cwd,
      approvalPolicy: "on-request",
      sandbox,
      ...(input.model ? { model: input.model } : {}),
      ...(effort ? { effort } : {})
    }));
    const turn = asRecord(turnResult.turn);
    if (typeof turn.id !== "string") throw new Error("Codex did not return a turn id.");
    return { threadId, turnId: turn.id };
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.#request("turn/interrupt", { threadId, turnId });
  }

  async detect(): Promise<AIStatus> {
    const executablePath = findCodexExecutable({ userDataPath: this.#userDataPath, configured: this.#configuredExecutable() });
    this.#setStatus(executablePath
      ? { ...this.#status, process: this.#status.process === "not_detected" ? "stopped" : this.#status.process, executablePath, error: undefined }
      : { auth: "unknown", process: "not_detected", error: "Codex CLI was not found in PATH, TeXWeave's tools, or the VS Code extension directories. Install it or provide its full executable path." });
    return this.getStatus();
  }

  /** Installs the official npm CLI into TeXWeave's user-data directory; never changes global PATH. */
  async install(): Promise<AIStatus> {
    const installRoot = join(this.#userDataPath, "tools", "codex-cli");
    const npm = await resolveNpmInvocation();
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn(npm.command, [...npm.prefixArgs, "install", "--prefix", installRoot, "--no-audit", "--no-fund", "@openai/codex@latest"], {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false
      });
      let output = "";
      const append = (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-6000); };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Codex CLI installation failed (npm exit ${code ?? "unknown"}). ${output.trim().slice(-1800)}`)));
    });

    const nativeExecutable = getManagedCodexExecutable(installRoot);
    if (!nativeExecutable) throw new Error("Codex was downloaded, but its native executable could not be found. Check that npm installed the platform package.");
    await access(nativeExecutable);
    return { ...this.#status, process: "stopped", executablePath: nativeExecutable, error: undefined };
  }

  async refresh(): Promise<AIStatus> {
    await this.#ensureStarted();
    if (this.#status.process === "running") await this.#readAccount();
    return this.getStatus();
  }

  async login(): Promise<AIStatus> {
    await this.#ensureStarted();
    this.#setStatus({ ...this.#status, auth: "authenticating", error: undefined });
    const response = asRecord(await this.#request("account/login/start", { type: "chatgpt" }));
    const authUrl = typeof response.authUrl === "string" ? response.authUrl : undefined;
    this.#loginId = typeof response.loginId === "string" ? response.loginId : undefined;
    if (!authUrl) throw new Error("Codex did not return a browser sign-in URL.");
    const parsedAuthUrl = new URL(authUrl);
    if (parsedAuthUrl.protocol !== "https:" || !(["openai.com", "chatgpt.com"].some((domain) => parsedAuthUrl.hostname === domain || parsedAuthUrl.hostname.endsWith(`.${domain}`)))) {
      throw new Error("Codex returned an unexpected sign-in URL; it was not opened.");
    }
    const { shell } = await import("electron");
    await shell.openExternal(authUrl);
    return this.getStatus();
  }

  async logout(): Promise<AIStatus> {
    await this.#ensureStarted();
    await this.#request("account/logout", {});
    this.#account = undefined;
    this.#loginId = undefined;
    this.#setStatus({ ...this.#status, auth: "signed_out", accountLabel: undefined, error: undefined });
    return this.getStatus();
  }

  async stop(): Promise<void> {
    this.#models = undefined;
    const child = this.#child;
    this.#child = undefined;
    if (child && child.exitCode === null) child.kill();
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Codex connection closed.")); }
    this.#pending.clear();
    this.#threadWorkspaces.clear();
    this.#fileChangePaths.clear();
    this.#setStatus({ ...this.#status, process: "stopped" });
  }

  async #ensureStarted(): Promise<void> {
    if (this.#status.process === "running" && this.#child) return;
    if (this.#startPromise) return this.#startPromise;
    this.#startPromise = this.#start();
    try { await this.#startPromise; } finally { this.#startPromise = undefined; }
  }

  async #start(): Promise<void> {
    const detected = await this.detect();
    const executablePath = detected.executablePath;
    if (!executablePath) {
      this.#setStatus(detected);
      throw new Error(detected.error ?? "Codex CLI is unavailable.");
    }
    this.#setStatus({ auth: "unknown", process: "starting", executablePath });
    const codexHome = join(this.#userDataPath, "ai", "codex-home");
    try {
      // Codex requires an explicitly supplied CODEX_HOME to exist on first launch.
      await mkdir(codexHome, { recursive: true });
      const child = spawn(executablePath, ["app-server", "--listen", "stdio://"], {
        cwd: this.#userDataPath,
        env: { ...process.env, CODEX_HOME: codexHome },
        stdio: "pipe",
        windowsHide: true,
        shell: false
      });
      this.#child = child;
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => { if (this.#child === child) this.#handleLine(line); });
      child.stderr.on("data", () => { /* Never forward raw Codex stderr; it may contain private prompt or account details. */ });
      const fail = (error: Error) => { if (this.#child === child) this.#failProcess(error.message); };
      child.once("error", fail);
      child.stdin.on("error", fail);
      child.once("exit", (code) => {
        if (this.#child !== child) return;
        this.#child = undefined;
        this.#rejectPending(new Error(`Codex App Server exited (${code ?? "signal"}).`));
        this.#setStatus({ ...this.#status, process: code === 0 ? "stopped" : "crashed", auth: "unknown", error: code === 0 ? undefined : "Codex App Server stopped unexpectedly." });
      });
      await this.#request("initialize", { clientInfo: { name: "texweave", title: "TeXWeave", version: this.#clientVersion }, capabilities: { experimentalApi: true } });
      this.#notify("initialized", {});
      this.#setStatus({ ...this.#status, process: "running", error: undefined });
      await this.#readAccount();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.stop();
      this.#setStatus({ ...this.#status, process: "crashed", auth: "error", error: message });
      throw error;
    }
  }

  async #readAccount(): Promise<void> {
    const response = asRecord(await this.#request("account/read", {}));
    const account = asRecord(response.account);
    this.#account = account;
    const type = typeof account.type === "string" ? account.type : undefined;
    const auth = type === "chatgpt" ? "signed_in" : type === "apiKey" ? "signed_out" : "signed_out";
    const label = typeof account.email === "string" ? account.email : typeof account.planType === "string" && auth === "signed_in" ? `ChatGPT · ${account.planType}` : undefined;
    this.#setStatus({ ...this.#status, auth, accountLabel: label, error: undefined });
  }

  #handleLine(line: string): void {
    let message: JsonRecord;
    try { message = JSON.parse(line) as JsonRecord; } catch { return; }
    if ((typeof message.id === "number" || typeof message.id === "string") && typeof message.method === "string") {
      const params = asRecord(message.params);
      if (message.method === "item/tool/call") {
        void this.#handleDynamicToolCall(message.id, params);
        return;
      }
      const workspace = typeof params.threadId === "string" ? this.#threadWorkspaces.get(params.threadId) : undefined;
      const commandIsInWorkspace = workspace && typeof params.cwd === "string" && isWorkspacePath(params.cwd, workspace);
      // The model may edit its private snapshot through either native file patches or shell
      // commands. Allow both command and stdin approvals only inside that snapshot; the
      // App Server's workspace-write sandbox prevents writes to the original project.
      const workspaceCommandApproved = message.method === "item/commandExecution/requestApproval"
        && commandIsInWorkspace
        && (params.kind === undefined || params.kind === "command" || params.kind === "writeStdin")
        && !params.networkApprovalContext
        && !(typeof params.command === "string" && isLatexCompilerCommand(params.command));
      const fileChangeApproved = message.method === "item/fileChange/requestApproval"
        && workspace
        && (typeof params.grantRoot !== "string" || isWorkspacePath(params.grantRoot, workspace))
        && typeof params.itemId === "string"
        && (this.#fileChangePaths.get(`${params.threadId}:${params.itemId}`)?.length ?? 0) > 0
        && this.#fileChangePaths.get(`${params.threadId}:${params.itemId}`)!.every((path) => isWorkspacePath(path, workspace));
      this.#onApprovalDecision?.({ method: message.method, ...(typeof params.command === "string" ? { command: params.command } : {}), approved: Boolean(workspaceCommandApproved || fileChangeApproved) });
      this.#child?.stdin.write(`${JSON.stringify({ id: message.id, result: { decision: workspaceCommandApproved || fileChangeApproved ? "accept" : "decline" } })}\n`);
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error && typeof message.error === "object") pending.reject(new Error(String((message.error as JsonRecord).message ?? "Codex request failed.")));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") {
      const event = { method: message.method, params: asRecord(message.params) };
      const item = asRecord(event.params.item);
      if (event.method === "item/started" && item.type === "fileChange" && typeof event.params.threadId === "string" && typeof item.id === "string") {
        this.#fileChangePaths.set(`${event.params.threadId}:${item.id}`, fileChangePaths(item.changes));
      }
      if (event.method === "item/fileChange/patchUpdated" && typeof event.params.threadId === "string" && typeof event.params.itemId === "string") {
        this.#fileChangePaths.set(`${event.params.threadId}:${event.params.itemId}`, fileChangePaths(event.params.changes));
      }
      for (const listener of this.#eventListeners) listener(event);
      if (message.method === "turn/completed" && typeof event.params.threadId === "string") {
        this.#threadWorkspaces.delete(event.params.threadId);
        for (const key of this.#dynamicToolHandlers.keys()) if (key.startsWith(`${event.params.threadId}:`)) this.#dynamicToolHandlers.delete(key);
        for (const key of this.#fileChangePaths.keys()) if (key.startsWith(`${event.params.threadId}:`)) this.#fileChangePaths.delete(key);
      }
    }
    if (message.method === "account/updated") void this.#readAccount().catch(() => undefined);
    if (message.method === "account/login/completed") {
      const params = asRecord(message.params);
      if (this.#loginId && params.loginId !== this.#loginId) return;
      this.#loginId = undefined;
      if (params.success === false) this.#setStatus({ ...this.#status, auth: "error", error: typeof params.error === "string" ? params.error : "ChatGPT sign-in failed." });
      else void this.#readAccount().catch(() => undefined);
    }
  }

  async #handleDynamicToolCall(requestId: string | number, params: JsonRecord): Promise<void> {
    const threadId = typeof params.threadId === "string" ? params.threadId : "";
    const toolName = typeof params.tool === "string" ? params.tool : "";
    const handler = this.#dynamicToolHandlers.get(`${threadId}:${toolName}`);
    let text: string;
    let success = false;
    try {
      if (!handler) throw new Error(`TeXWeave tool '${toolName || "unknown"}' is unavailable for this conversation. Start a new AI conversation to load current project tools.`);
      const arguments_ = params.arguments && typeof params.arguments === "object" ? params.arguments as JsonRecord : {};
      text = await handler(arguments_);
      success = true;
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
    }
    if (!this.#child || this.#child.exitCode !== null) return;
    this.#child.stdin.write(`${JSON.stringify({ id: requestId, result: { contentItems: [{ type: "inputText", text }], success } })}\n`);
  }

  #request(method: string, params: JsonRecord): Promise<unknown> {
    const child = this.#child;
    if (!child || child.exitCode !== null) return Promise.reject(new Error("Codex App Server is not running."));
    const id = ++this.#nextRequestId;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(id); reject(new Error(`Codex request timed out: ${method}`)); }, method === "account/login/start" ? 60_000 : 20_000);
      this.#pending.set(id, { resolve: resolvePromise, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      });
    });
  }

  #notify(method: string, params: JsonRecord): void {
    this.#child?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  #failProcess(message: string): void {
    this.#child = undefined;
    this.#rejectPending(new Error(message));
    this.#setStatus({ ...this.#status, process: "crashed", auth: "error", error: message });
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.#pending.clear();
  }

  #setStatus(status: MutableAIStatus): void {
    this.#status = Object.fromEntries(Object.entries(status).filter(([, value]) => value !== undefined)) as unknown as AIStatus;
    this.#onStatus(this.getStatus());
  }
}

function asRecord(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function fileChangePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  const paths = value.map((change) => asRecord(change).path);
  return paths.every((path): path is string => typeof path === "string") ? paths : [];
}

async function resolveNpmInvocation(): Promise<{ command: string; prefixArgs: string[] }> {
  if (process.platform !== "win32") return { command: "npm", prefixArgs: [] };

  const nodePath = findExecutableOnPath("node.exe");
  if (nodePath) {
    const npmCliPath = join(dirname(nodePath), "node_modules", "npm", "bin", "npm-cli.js");
    try { await access(npmCliPath); return { command: nodePath, prefixArgs: [npmCliPath] }; } catch { /* handled by the actionable error below */ }
  }
  throw new Error("One-click installation needs Node.js and npm available on PATH. Install Node.js, then retry.");
}
