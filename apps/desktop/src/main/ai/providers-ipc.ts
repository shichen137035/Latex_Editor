import { desktopInvoke } from "@latex-editor/contracts/desktop-ipc";
import { handleIpc } from "../ipc.js";
import type { DesktopContext } from "../desktopContext.js";
import type { SettingsRepository } from "../settings.js";
import { AIProviderAuthentication } from "./provider-auth.js";

/** Application-wide account and provider environment; independent of either chat history. */
export function registerAIProviderIpcHandlers(context: DesktopContext | undefined, settings: SettingsRepository): void {
  const authentication = new AIProviderAuthentication({
    codex: { status: async () => context?.ai.refresh(), login: async () => context?.ai.login() },
    chat: { status: async () => context?.copilot.status(), login: async () => context?.copilot.login() }
  });
  const requireIdle = () => {
    if (context?.aiWorkspaces.busy || context?.companionChats.busy) throw new Error("Wait for active AI tasks to finish before changing the AI account or environment.");
  };
  handleIpc(desktopInvoke.ai.detect, () => context?.ai.detect());
  handleIpc(desktopInvoke.ai.status, () => context?.ai.refresh());
  handleIpc(desktopInvoke.ai.models, () => context?.ai.listModels());
  handleIpc(desktopInvoke.ai.login, () => authentication.login("codex"));
  handleIpc(desktopInvoke.ai.logout, () => { requireIdle(); return context?.ai.logout(); });
  handleIpc(desktopInvoke.ai.install, async (_event, force) => {
    if (force !== undefined && typeof force !== "boolean") throw new Error("Invalid installation option");
    if (!context) throw new Error("Application context is not ready");
    requireIdle();
    if (force) await context.ai.stop();
    const status = await context.ai.install(force);
    if (status.executablePath) await settings.set("aiCodexExecutable", status.executablePath);
    return status;
  });
  handleIpc(desktopInvoke.ai.setExecutable, async (_event, path) => {
    requireIdle();
    await settings.set("aiCodexExecutable", path);
    await context?.ai.stop();
    return context?.ai.detect();
  });
  handleIpc(desktopInvoke.ai.copilotStatus, () => context?.copilot.status());
  handleIpc(desktopInvoke.ai.copilotModels, () => context?.copilot.listModels());
  handleIpc(desktopInvoke.ai.installCopilot, () => { requireIdle(); return context?.copilot.installCli(); });
  handleIpc(desktopInvoke.ai.loginCopilot, () => authentication.login("chat"));
  handleIpc(desktopInvoke.ai.logoutCopilot, () => { requireIdle(); return context?.copilot.logout(); });
}
