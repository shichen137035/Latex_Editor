import { dialog, ipcMain } from "electron";
import type { AIContextSnapshotFile, ProjectTreeNode } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { DesktopContext } from "../desktopContext.js";
import type { SettingsRepository } from "../settings.js";

/** Register AI and Copilot renderer requests separately from core project IPC. */
export function registerAiIpcHandlers(context: DesktopContext | undefined, settings: SettingsRepository): void {
  ipcMain.handle("ai:detect", () => context?.ai.detect());
  ipcMain.handle("ai:install", async () => {
    if (context === undefined) throw new Error("Application context is not ready");
    const status = await context.ai.install();
    if (status.executablePath) await settings.set("aiCodexExecutable", status.executablePath);
    return status;
  });
  ipcMain.handle("ai:status", () => context?.ai.refresh());
  ipcMain.handle("ai:models", () => context?.aiWorkspaces.listModels());
  ipcMain.handle("ai:skills", () => context?.aiWorkspaces.listSkills());
  ipcMain.handle("ai:skill:save", (_event, input: { name: string; content: string; create?: boolean }) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.saveSkill(input);
  });
  ipcMain.handle("ai:login", () => context?.ai.login());
  ipcMain.handle("ai:logout", () => context?.ai.logout());
  ipcMain.handle("ai:copilot:status", () => context?.copilot.status());
  ipcMain.handle("ai:copilot:install", () => context?.copilot.installCli());
  ipcMain.handle("ai:copilot:login", () => context?.copilot.login());
  ipcMain.handle("ai:copilot:logout", () => context?.copilot.logout());
  ipcMain.handle("ai:copilot:models", () => context?.aiWorkspaces.listCopilotModels());
  ipcMain.handle("ai:conversations", (_event, projectId?: string) => context?.aiWorkspaces.snapshot(projectId));
  ipcMain.handle("ai:conversation:create", (_event, mode: "chat" | "codex", projectId?: string) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.create({ mode, ...(projectId ? { projectId } : {}) });
  });
  ipcMain.handle("ai:conversation:mode", (_event, id: string, mode: "chat" | "codex") => context?.aiWorkspaces.setMode(id, mode));
  ipcMain.handle("ai:conversation:rename", (_event, id: string, title: string) => context?.aiWorkspaces.renameConversation(id, title));
  ipcMain.handle("ai:conversation:remove", (_event, id: string) => context?.aiWorkspaces.remove(id));
  ipcMain.handle("ai:approvals", (_event, projectId?: string) => context?.aiWorkspaces.listApprovals(projectId) ?? []);
  ipcMain.handle("ai:approval:resolve", (_event, id: string, allow: boolean) => context?.aiWorkspaces.approvals.resolve(id, allow));
  ipcMain.handle("ai:change-set:applied", (_event, id: string, hunkIds: string[], error?: string) => context?.aiWorkspaces.markChangeSetApplied(id, hunkIds, error));
  ipcMain.handle("ai:change-set:resolve", (_event, id: string, decisions: Record<string, "accepted" | "rejected">, applied: boolean) => context?.aiWorkspaces.resolveChangeSet(id, decisions, applied));
  ipcMain.handle("ai:attachments:pick", async (_event, projectId: string) => {
    if (!context) throw new Error("Application context is not ready");
    const selected = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    return selected.canceled ? [] : context.aiWorkspaces.selectAttachments(projectId, selected.filePaths);
  });
  ipcMain.handle("ai:send", async (_event, input: { conversationId: string; projectId?: string; content: string; contextText?: string; overrides?: AIContextSnapshotFile[]; attachmentIds?: string[] }) => {
    if (!context) throw new Error("Application context is not ready");
    const conversation = context.aiWorkspaces.snapshot(input.projectId).conversations.find((item) => item.id === input.conversationId);
    if (!conversation) throw new Error("AI conversation was not found for this project.");
    if (conversation.projectId !== input.projectId) throw new Error("AI conversations can only access their associated project.");
    let snapshot: AIContextSnapshotFile[] = [];
    if (input.projectId) {
      const collect = (nodes: ProjectTreeNode[]): string[] => nodes.flatMap((node) => node.kind === "file" ? [node.relativePath] : node.children ? collect(node.children) : []);
      const paths = collect(await context.files.listTree(input.projectId) as ProjectTreeNode[]).filter((path) => /\.(?:tex|bib|sty|cls|txt|md|cfg|def|ltx|ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|yml|yaml|toml|xml|svg)$/i.test(path) || path.replaceAll("\\", "/").toLocaleLowerCase() === ".texweave/settings.json");
      snapshot = (await Promise.all(paths.map(async (path) => {
        const value = await context!.files.readText(input.projectId!, path) as { content?: unknown };
        return typeof value?.content === "string" ? { path, content: value.content } : undefined;
      }))).filter((item): item is AIContextSnapshotFile => Boolean(item));
      const overrideMap = new Map((input.overrides ?? []).map((file) => [file.path.replaceAll("\\", "/"), file.content]));
      snapshot = snapshot.map((file) => overrideMap.has(file.path) ? { ...file, content: overrideMap.get(file.path)! } : file);
      for (const [path, content] of overrideMap) if (!snapshot.some((file) => file.path === path)) snapshot.push({ path, content });
    }
    const model = conversation.mode === "chat" ? settings.global.aiCopilotModel : settings.global.aiModel;
    const reasoningEffort = conversation.mode === "chat" ? settings.global.aiCopilotReasoningEffort : settings.global.aiReasoningEffort;
    return context.aiWorkspaces.send({ conversationId: input.conversationId, content: input.content, permissionMode: settings.global.aiPermissionMode ?? "auto", attachmentIds: input.attachmentIds ?? [], ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}), ...(snapshot.length ? { snapshot } : {}), ...(input.contextText ? { contextText: input.contextText } : {}) });
  });
  ipcMain.handle("ai:cancel", (_event, taskId: string) => context?.aiWorkspaces.cancel(taskId));
  ipcMain.handle("ai:set-executable", async (_event, path: string) => {
    await settings.set("aiCodexExecutable", path);
    await context?.ai.stop();
    return context?.ai.detect();
  });
}
