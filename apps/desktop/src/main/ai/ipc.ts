import { desktopInvoke } from "@latex-editor/contracts/desktop-ipc";
import { handleIpc } from "../ipc.js";
import { dialog } from "electron";
import { readFile, stat } from "node:fs/promises";
import type { AIContextSnapshotFile, ProjectTreeNode } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { DesktopContext } from "../desktopContext.js";
import type { SettingsRepository } from "../settings.js";
import { collectGraphicDependencies } from "./tex-dependencies.js";
import { isSnapshotTextPath, MAX_WORKSPACE_ASSET_BYTES, MAX_WORKSPACE_ASSET_COUNT, MAX_WORKSPACE_ASSET_TOTAL_BYTES } from "./workspaceFiles.js";

/** Register AI and Copilot renderer requests separately from core project IPC. */
export function registerAiIpcHandlers(context: DesktopContext | undefined, settings: SettingsRepository): void {
  handleIpc(desktopInvoke.ai.detect, () => context?.ai.detect());
  handleIpc(desktopInvoke.ai.install, async () => {
    if (context === undefined) throw new Error("Application context is not ready");
    const status = await context.ai.install();
    if (status.executablePath) await settings.set("aiCodexExecutable", status.executablePath);
    return status;
  });
  handleIpc(desktopInvoke.ai.status, () => context?.ai.refresh());
  handleIpc(desktopInvoke.ai.models, () => context?.aiWorkspaces.listModels());
  handleIpc(desktopInvoke.ai.skills, () => context?.aiWorkspaces.listSkills());
  handleIpc(desktopInvoke.ai.saveSkill, (_event, input) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.saveSkill(input);
  });
  handleIpc(desktopInvoke.ai.setSkillEnabled, (_event, input) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.setSkillEnabled(input);
  });
  handleIpc(desktopInvoke.ai.login, () => context?.ai.login());
  handleIpc(desktopInvoke.ai.logout, () => context?.ai.logout());
  handleIpc(desktopInvoke.ai.copilotStatus, () => context?.copilot.status());
  handleIpc(desktopInvoke.ai.installCopilot, () => context?.copilot.installCli());
  handleIpc(desktopInvoke.ai.loginCopilot, () => context?.copilot.login());
  handleIpc(desktopInvoke.ai.logoutCopilot, () => context?.copilot.logout());
  handleIpc(desktopInvoke.ai.copilotModels, () => context?.aiWorkspaces.listCopilotModels());
  handleIpc(desktopInvoke.ai.conversations, (_event, projectId) => context?.aiWorkspaces.snapshot(projectId));
  handleIpc(desktopInvoke.ai.createConversation, (_event, mode, projectId) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.create({ mode, ...(projectId ? { projectId } : {}) });
  });
  handleIpc(desktopInvoke.ai.setConversationMode, (_event, id, mode) => context?.aiWorkspaces.setMode(id, mode));
  handleIpc(desktopInvoke.ai.renameConversation, (_event, id, title) => context?.aiWorkspaces.renameConversation(id, title));
  handleIpc(desktopInvoke.ai.removeConversation, (_event, id) => context?.aiWorkspaces.remove(id));
  handleIpc(desktopInvoke.ai.approvals, (_event, projectId) => context?.aiWorkspaces.listApprovals(projectId) ?? []);
  handleIpc(desktopInvoke.ai.resolveApproval, (_event, id, allow) => context?.aiWorkspaces.approvals.resolve(id, allow));
  handleIpc(desktopInvoke.ai.markChangeSetApplied, (_event, id, hunkIds, error) => context?.aiWorkspaces.markChangeSetApplied(id, hunkIds, error));
  handleIpc(desktopInvoke.ai.resolveChangeSet, (_event, id, decisions, applied) => context?.aiWorkspaces.resolveChangeSet(id, decisions, applied));
  handleIpc(desktopInvoke.ai.pickAttachments, async (_event, projectId) => {
    if (!context) throw new Error("Application context is not ready");
    const selected = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    return selected.canceled ? [] : context.aiWorkspaces.selectAttachments(projectId, selected.filePaths);
  });
  handleIpc(desktopInvoke.ai.addPastedImage, (_event, projectId, mimeType, data) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.addPastedImage(projectId, mimeType, data);
  });
  handleIpc(desktopInvoke.ai.addPastedFile, (_event, projectId, name, data) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.addPastedFile(projectId, name, data);
  });
  handleIpc(desktopInvoke.ai.send, async (_event, input) => {
    if (!context) throw new Error("Application context is not ready");
    const conversation = context.aiWorkspaces.snapshot(input.projectId).conversations.find((item) => item.id === input.conversationId);
    if (!conversation) throw new Error("AI conversation was not found for this project.");
    if (conversation.projectId !== input.projectId) throw new Error("AI conversations can only access their associated project.");
    let snapshot: AIContextSnapshotFile[] = [];
    const assets: Array<{ path: string; content: Uint8Array }> = [];
    let omittedAssets = 0;
    let unresolvedGraphics: string[] = [];
    let projectPaths: string[] = [];
    if (input.projectId) {
      const collect = (nodes: ProjectTreeNode[]): string[] => nodes.flatMap((node) => node.kind === "file" ? [node.relativePath] : node.children ? collect(node.children) : []);
      projectPaths = collect(await context.files.listTree(input.projectId) as ProjectTreeNode[]);
      const paths = projectPaths.filter(isSnapshotTextPath);
      snapshot = (await Promise.all(paths.map(async (path) => {
        const value = await context!.files.readText(input.projectId!, path) as { content?: unknown };
        return typeof value?.content === "string" ? { path, content: value.content } : undefined;
      }))).filter((item): item is AIContextSnapshotFile => Boolean(item));
      const overrideMap = new Map((input.overrides ?? []).map((file) => [file.path.replaceAll("\\", "/"), file.content]));
      snapshot = snapshot.map((file) => overrideMap.has(file.path) ? { ...file, content: overrideMap.get(file.path)! } : file);
      for (const [path, content] of overrideMap) if (!snapshot.some((file) => file.path === path)) snapshot.push({ path, content });
      const graphicDependencies = collectGraphicDependencies(snapshot, projectPaths);
      unresolvedGraphics = graphicDependencies.unresolved;
      let assetBytes = 0;
      for (const path of graphicDependencies.resolved) {
        if (assets.length >= MAX_WORKSPACE_ASSET_COUNT) { omittedAssets++; continue; }
        const absolutePath = await context.files.resolveFilePath(input.projectId, path, true);
        const metadata = await stat(absolutePath);
        if (!metadata.isFile() || metadata.size > MAX_WORKSPACE_ASSET_BYTES || assetBytes + metadata.size > MAX_WORKSPACE_ASSET_TOTAL_BYTES) { omittedAssets++; continue; }
        const content = await readFile(absolutePath);
        assets.push({ path, content });
        assetBytes += content.byteLength;
      }
    }
    const model = conversation.mode === "chat" ? settings.global.aiCopilotModel : settings.global.aiModel;
    const reasoningEffort = conversation.mode === "chat" ? settings.global.aiCopilotReasoningEffort : settings.global.aiReasoningEffort;
    return context.aiWorkspaces.send({ conversationId: input.conversationId, ...(input.taskId ? { taskId: input.taskId } : {}), content: input.content, permissionMode: settings.global.aiPermissionMode ?? "auto", attachmentIds: input.attachmentIds ?? [], projectPaths, ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}), ...(snapshot.length ? { snapshot } : {}), ...(assets.length ? { assets } : {}), ...(omittedAssets ? { omittedAssets } : {}), ...(unresolvedGraphics.length ? { unresolvedGraphics } : {}), ...(input.contextText ? { contextText: input.contextText } : {}) });
  });
  handleIpc(desktopInvoke.ai.cancel, (_event, taskId) => context?.aiWorkspaces.cancel(taskId));
  handleIpc(desktopInvoke.ai.setExecutable, async (_event, path) => {
    await settings.set("aiCodexExecutable", path);
    await context?.ai.stop();
    return context?.ai.detect();
  });
}
