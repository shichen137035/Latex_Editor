import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { CopilotClient, CopilotSession, GetAuthStatusResponse, ModelInfo, PermissionRequest, Tool } from "@github/copilot-sdk" with { "resolution-mode": "import" };
import type { AIModelOption, AIStatus } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import { createCopilotLoginLaunchCommand, createCopilotLoginScript, type CopilotLoginResult } from "./copilot-login.js";
import { isLatexCompilerCommand } from "./ai-approvals.js";
import { resolveReasoningEffort } from "./reasoning-effort.js";

type LoginAttempt = { startedAt: number; scriptPath?: string; resultPath?: string; result?: CopilotLoginResult };
type ReasoningEffort = NonNullable<ModelInfo["defaultReasoningEffort"]>;

export async function createTeXWeaveCompileTool(handler: (arguments_: { mainFile?: string }) => Promise<string>): Promise<Tool<{ mainFile?: string }>> {
  const { defineTool } = await import("@github/copilot-sdk");
  return defineTool<{ mainFile?: string }>("texweave_compile", {
    description: "Compile the current TeXWeave AI working copy with the project's configured LaTeX compiler. Returns status and diagnostics. Use this instead of running a LaTeX compiler in a shell.",
    parameters: { type: "object", properties: { mainFile: { type: "string", description: "Optional project-relative main .tex path; defaults to the project's configured main file." } }, additionalProperties: false },
    skipPermission: true,
    handler: handler
  });
}

/** GitHub Copilot Chat runtime, used against TeXWeave's reviewable project snapshot. */
export class CopilotChatService {
  readonly #home: string;
  readonly #cliRoot: string;
  #client: CopilotClient | undefined;
  readonly #sessions = new Map<string, CopilotSession>();
  readonly #sessionModels = new Map<string, string>();
  #auth?: GetAuthStatusResponse;
  #installing: Promise<void> | undefined;
  #statusPending: Promise<AIStatus> | undefined;
  #loginAttempt: LoginAttempt | undefined;
  #models: AIModelOption[] | undefined;

  constructor(userDataPath: string) {
    this.#home = join(userDataPath, "ai", "copilot-home");
    this.#cliRoot = join(userDataPath, "tools", "copilot-cli");
  }

  async status(): Promise<AIStatus> {
    if (!this.#statusPending) this.#statusPending = this.#readStatus().finally(() => { this.#statusPending = undefined; });
    return this.#statusPending;
  }

  async #readStatus(): Promise<AIStatus> {
    const cliPath = await this.#cliPath().catch(() => undefined);
    if (!cliPath) return { auth: "signed_out", process: "not_detected" };
    try {
      let loginCompleted = false;
      const attempt = this.#loginAttempt;
      if (attempt) {
        let result = attempt.result;
        if (!result && attempt.resultPath) {
          try {
            const content = await readFile(attempt.resultPath, "utf8");
            const parsed = JSON.parse(content.replace(/^\ufeff/, "")) as CopilotLoginResult;
            if (typeof parsed.exitCode !== "number") throw new Error("Invalid Copilot login result.");
            result = parsed;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        if (!result && Date.now() - attempt.startedAt < 10 * 60_000) {
          return { auth: "authenticating", process: "running", executablePath: cliPath };
        }
        this.#loginAttempt = undefined;
        await Promise.all([attempt.scriptPath, attempt.resultPath].filter((path): path is string => Boolean(path)).map((path) => unlink(path).catch(() => undefined)));
        if (!result || result.exitCode !== 0) {
          return { auth: "error", process: "running", executablePath: cliPath, error: result ? safeError(result.error || `Copilot login failed (exit ${result.exitCode}). Check the login window for details.`) : "Copilot login timed out or the login window was closed. Please sign in again." };
        }
        // The SDK runtime was started before OAuth and may retain its old account
        // state. Restart it after CLI success so it loads the newly saved account.
        await this.dispose();
        loginCompleted = true;
      }
      const client = await this.#getClient();
      this.#auth = await client.getAuthStatus();
      return {
        auth: this.#auth.isAuthenticated ? "signed_in" : loginCompleted ? "error" : "signed_out",
        process: "running",
        executablePath: cliPath,
        accountLabel: this.#auth.login,
        error: loginCompleted && !this.#auth.isAuthenticated ? "Copilot CLI completed login, but its saved account was not detected by the SDK. Please check the account shown in the login window." : undefined
      };
    } catch (error) {
      return { auth: "error", process: "crashed", executablePath: cliPath, error: safeError(error) };
    }
  }

  async installCli(): Promise<AIStatus> {
    if (!this.#installing) this.#installing = this.#install().finally(() => { this.#installing = undefined; });
    await this.#installing;
    return this.status();
  }

  async login(): Promise<AIStatus> {
    if (this.#loginAttempt) return this.status();
    const cli = await this.#cliPath().catch(() => undefined);
    if (!cli) throw new Error("Install GitHub Copilot CLI before signing in.");
    if (process.platform === "win32") {
      // Copilot's OAuth flow is terminal-driven: the CLI prints the browser URL,
      // waits for its loopback callback, and may need the user to select a flow.
      // Keep it in its own visible console instead of detached/ignored stdio,
      // which made failed launches and authorization prompts look like a hung page.
      await mkdir(this.#home, { recursive: true });
      const attemptId = randomUUID();
      const loginScript = join(this.#home, `copilot-login-${attemptId}.ps1`);
      const resultPath = join(this.#home, `copilot-login-${attemptId}.json`);
      await writeFile(loginScript, createCopilotLoginScript(cli, this.#home, resultPath), "utf8");
      const launchCommand = createCopilotLoginLaunchCommand(loginScript);
      const launcher = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", launchCommand], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: { ...process.env, COPILOT_HOME: this.#home }
      });
      let launchError = "";
      launcher.stderr?.on("data", (chunk: Buffer) => { launchError = `${launchError}${chunk.toString("utf8")}`.slice(-2000); });
      launcher.stdout?.resume();
      await new Promise<void>((resolvePromise, reject) => {
        launcher.once("error", reject);
        launcher.once("close", (code) => code === 0 ? resolvePromise() : reject(new Error(safeError(launchError || `Unable to open the Copilot login window (exit ${code ?? "unknown"}).`))));
      });
      this.#loginAttempt = { startedAt: Date.now(), scriptPath: loginScript, resultPath };
    } else {
      const child = spawn(cli, ["login", "--web-flow"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, COPILOT_HOME: this.#home }
      });
      await waitForSpawn(child);
      const attempt: LoginAttempt = { startedAt: Date.now() };
      this.#loginAttempt = attempt;
      child.once("exit", (code) => { attempt.result = { exitCode: code ?? 1 }; });
      child.once("error", (error) => { attempt.result = { exitCode: 1, error: safeError(error) }; });
      child.unref();
    }
    return { auth: "authenticating", process: "running", executablePath: cli };
  }

  async logout(): Promise<AIStatus> {
    const client = await this.#getClient();
    await client.rpc.account.logout({});
    return this.status();
  }

  async listModels(): Promise<AIModelOption[]> {
    const client = await this.#getClient();
    const models = await client.listModels();
    this.#models = models.map((model: ModelInfo) => ({ id: model.id, name: model.name, isDefault: model.id === "auto",
      supportedReasoningEfforts: model.capabilities.supports.reasoningEffort ? (model.supportedReasoningEfforts ?? []).map((effort) => ({ effort })) : [],
      ...(model.defaultReasoningEffort ? { defaultReasoningEffort: model.defaultReasoningEffort } : {}) }));
    return this.#models;
  }

  async session(sessionId: string | undefined, model: string | undefined, newSessionId: string, workingDirectory: string, preference?: string, tools: Tool<{ mainFile?: string }>[] = []): Promise<CopilotSession> {
    const client = await this.#getClient();
    const nextModel = model ?? "auto";
    const models = this.#models ?? await this.listModels();
    const reasoningEffort = resolveReasoningEffort(models.find((item) => item.id === nextModel), preference) as ReasoningEffort | undefined;
    const reasoningOptions = reasoningEffort ? { reasoningEffort } : {};
    const modelKey = `${nextModel}:${reasoningEffort ?? ""}`;
    let resetSession = false;
    if (sessionId) {
      const existing = this.#sessions.get(sessionId);
      if (existing) {
        if (this.#sessionModels.get(sessionId) === modelKey) return existing;
        if (reasoningEffort) {
          await existing.setModel(nextModel, reasoningOptions);
          this.#sessionModels.set(sessionId, modelKey);
          return existing;
        }
        // Some Copilot catalogs omit defaults, and setModel without an effort
        // keeps the previous override. An unconfigured session restores the
        // provider default; AIWorkspaceService restores the local chat context.
        resetSession = true;
        this.#sessions.delete(sessionId);
        this.#sessionModels.delete(sessionId);
      }
    }
    const config = {
      workingDirectory,
      streaming: true,
      onPermissionRequest: async (request: PermissionRequest) => request.kind === "shell" && isLatexCompilerCommand(request.fullCommandText, ...request.commands.map((command) => command.identifier))
        ? { kind: "reject" as const, feedback: "Use TeXWeave's texweave_compile tool; independent LaTeX compiler commands are disabled." }
        : { kind: "approve-once" as const },
      hooks: {
        onPreToolUse: async (input: { toolName: string; toolArgs?: unknown }) => {
          if (!["bash", "powershell", "shell", "run_command", "run_in_terminal"].includes(input.toolName)) return { permissionDecision: "allow" as const };
          const command = typeof input.toolArgs === "string" ? input.toolArgs : JSON.stringify(input.toolArgs ?? {}) ?? "";
          return isLatexCompilerCommand(command)
            ? { permissionDecision: "deny" as const, permissionDecisionReason: "Use TeXWeave's texweave_compile tool; independent LaTeX compiler commands are disabled." }
            : { permissionDecision: "allow" as const };
        }
      },
      ...(model ? { model } : {}),
      ...reasoningOptions,
      ...(tools.length ? { tools } : {})
    };
    if (sessionId && !resetSession) {
      try {
        const session = await client.resumeSession(sessionId, config);
        await session.setModel(nextModel, reasoningOptions);
        if (reasoningEffort || !(await session.rpc.model.getCurrent()).reasoningEffort) {
          this.#sessions.set(sessionId, session);
          this.#sessionModels.set(sessionId, modelKey);
          return session;
        }
      }
      catch { /* Local UI history can outlive a removed Copilot session; start a new one. */ }
    }
    const session = await client.createSession({ ...config, sessionId: sessionId ? randomUUID() : newSessionId });
    this.#sessions.set(session.sessionId, session);
    this.#sessionModels.set(session.sessionId, modelKey);
    return session;
  }

  async deleteSession(sessionId: string | undefined): Promise<void> {
    if (!sessionId) return;
    this.#sessions.delete(sessionId);
    this.#sessionModels.delete(sessionId);
    const client = await this.#getClient();
    await client.deleteSession(sessionId).catch(() => undefined);
  }

  async dispose(): Promise<void> {
    this.#models = undefined;
    this.#sessions.clear();
    this.#sessionModels.clear();
    if (!this.#client) return;
    await this.#client.stop().catch(() => undefined);
    this.#client = undefined;
  }

  async #getClient(): Promise<CopilotClient> {
    if (this.#client) return this.#client;
    await mkdir(this.#home, { recursive: true });
    const { CopilotClient: CopilotClientConstructor } = await import("@github/copilot-sdk");
    const client = new CopilotClientConstructor({ baseDirectory: this.#home, workingDirectory: this.#home, logLevel: "error" });
    await client.start();
    this.#client = client;
    return client;
  }

  async #install(): Promise<void> {
    await mkdir(this.#cliRoot, { recursive: true });
    const child = spawn("npm", ["install", "--prefix", this.#cliRoot, "--no-save", "--no-audit", "--no-fund", "@github/copilot"], {
      shell: process.platform === "win32",
      windowsHide: true,
      env: { ...process.env, npm_config_ignore_scripts: "false" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const capture = (chunk: Buffer) => { output = `${output}${chunk.toString("utf8")}`.slice(-3000); };
    child.stdout?.on("data", capture);
    child.stderr?.on("data", capture);
    await new Promise<void>((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`GitHub Copilot CLI installation failed (npm exit ${code ?? "unknown"}). ${output.trim()}`)));
    });
    await this.#cliPath();
  }

  async #cliPath(): Promise<string> {
    const candidates = process.platform === "win32"
      ? [join(this.#cliRoot, "node_modules", ".bin", "copilot.cmd"), join(this.#cliRoot, "node_modules", ".bin", "copilot.ps1")]
      : [join(this.#cliRoot, "node_modules", ".bin", "copilot")];
    for (const candidate of candidates) {
      try { await access(candidate); return candidate; } catch { /* Try the next platform launcher. */ }
    }
    throw new Error("GitHub Copilot CLI is not installed in TeXWeave's user data folder.");
  }
}

function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    child.once("spawn", () => resolvePromise());
    child.once("error", reject);
  });
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:token|authorization|credential)\s*[:=]\s*[^\s,;]+/gi, "sensitive=[redacted]").slice(0, 500);
}
