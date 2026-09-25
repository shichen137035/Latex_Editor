import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CopilotClient, CopilotSession, GetAuthStatusResponse, ModelInfo } from "@github/copilot-sdk" with { "resolution-mode": "import" };
import type { AIModelOption, AIStatus } from "@latex-editor/contracts" with { "resolution-mode": "import" };

/** GitHub Copilot Chat runtime, used against TeXWeave's reviewable project snapshot. */
export class CopilotChatService {
  readonly #home: string;
  readonly #cliRoot: string;
  #client: CopilotClient | undefined;
  readonly #sessions = new Map<string, CopilotSession>();
  readonly #sessionModels = new Map<string, string>();
  #auth?: GetAuthStatusResponse;
  #installing: Promise<void> | undefined;

  constructor(userDataPath: string) {
    this.#home = join(userDataPath, "ai", "copilot-home");
    this.#cliRoot = join(userDataPath, "tools", "copilot-cli");
  }

  async status(): Promise<AIStatus> {
    try {
      const client = await this.#getClient();
      this.#auth = await client.getAuthStatus();
      const cliPath = await this.#cliPath().catch(() => undefined);
      return {
        auth: this.#auth.isAuthenticated ? "signed_in" : "signed_out",
        process: cliPath ? "running" : "not_detected",
        executablePath: cliPath,
        accountLabel: this.#auth.login,
        error: undefined
      };
    } catch (error) {
      return { auth: "error", process: "crashed", error: safeError(error) };
    }
  }

  async installCli(): Promise<AIStatus> {
    if (!this.#installing) this.#installing = this.#install().finally(() => { this.#installing = undefined; });
    await this.#installing;
    return this.status();
  }

  async login(): Promise<AIStatus> {
    const cli = await this.#cliPath().catch(() => undefined);
    if (!cli) throw new Error("Install GitHub Copilot CLI before signing in.");
    if (process.platform === "win32") {
      // Copilot's OAuth flow is terminal-driven: the CLI prints the browser URL,
      // waits for its loopback callback, and may need the user to select a flow.
      // Keep it in its own visible console instead of detached/ignored stdio,
      // which made failed launches and authorization prompts look like a hung page.
      await mkdir(this.#home, { recursive: true });
      const loginScript = join(this.#home, "copilot-login.ps1");
      const script = [
        "$ErrorActionPreference = 'Continue'",
        `$env:COPILOT_HOME = '${escapePowerShell(this.#home)}'`,
        `& '${escapePowerShell(cli)}' login --web-flow`,
        "if ($LASTEXITCODE -ne 0) { Write-Host \"Copilot login exited with code $LASTEXITCODE.\" -ForegroundColor Red }",
        "Write-Host ''",
        "Read-Host 'Login finished. Press Enter to close this window' | Out-Null"
      ].join("`r`n");
      await writeFile(loginScript, script, "utf8");
      const scriptArgument = escapePowerShell(loginScript);
      const launchCommand = `Start-Process -FilePath 'powershell.exe' -WindowStyle Normal -ArgumentList @('-NoLogo','-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-File','${scriptArgument}') | Out-Null`;
      const launcher = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-Command", launchCommand], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, COPILOT_HOME: this.#home }
      });
      await waitForSpawn(launcher);
      launcher.unref();
    } else {
      const child = spawn(cli, ["login", "--web-flow"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        env: { ...process.env, COPILOT_HOME: this.#home }
      });
      await waitForSpawn(child);
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
    return models.map((model: ModelInfo) => ({ id: model.id, name: model.name, isDefault: model.id === "auto" }));
  }

  async session(sessionId: string | undefined, model: string | undefined, newSessionId: string, workingDirectory: string): Promise<CopilotSession> {
    const client = await this.#getClient();
    if (sessionId) {
      const existing = this.#sessions.get(sessionId);
      if (existing) {
        const nextModel = model ?? "auto";
        if (this.#sessionModels.get(sessionId) !== nextModel) {
          await existing.setModel(nextModel);
          this.#sessionModels.set(sessionId, nextModel);
        }
        return existing;
      }
    }
    const config = { workingDirectory, onPermissionRequest: async () => ({ kind: "approve-once" as const }), ...(model ? { model } : {}) };
    if (sessionId) {
      try {
        const session = await client.resumeSession(sessionId, config);
        await session.setModel(model ?? "auto");
        this.#sessions.set(sessionId, session);
        this.#sessionModels.set(sessionId, model ?? "auto");
        return session;
      }
      catch { /* Local UI history can outlive a removed Copilot session; start a new one. */ }
    }
    const session = await client.createSession({ ...config, sessionId: newSessionId });
    this.#sessions.set(session.sessionId, session);
    this.#sessionModels.set(session.sessionId, model ?? "auto");
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

function escapePowerShell(value: string): string {
  return value.replaceAll("'", "''");
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:token|authorization|credential)\s*[:=]\s*[^\s,;]+/gi, "sensitive=[redacted]").slice(0, 500);
}
