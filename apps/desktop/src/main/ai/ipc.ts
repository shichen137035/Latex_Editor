import { desktopInvoke } from "@latex-editor/contracts/desktop-ipc";
import { handleIpc } from "../ipc.js";
import { dialog } from "electron";
import type { WebContents } from "electron";
import type { DesktopContext } from "../desktopContext.js";
import type { SettingsRepository } from "../settings.js";

/** Project-writing conversations, skills, attachments, and edit review. Accounts live in providers-ipc. */
export function registerAiIpcHandlers(context: DesktopContext | undefined, settings: SettingsRepository): void {
  const draftOwners = new Map<string, { projectId: string; sender: WebContents; dispose(): void }>();
  const assertDraftOwner = (sender: WebContents, projectId: string, draftId: string) => {
    const owner = draftOwners.get(draftId);
    if (!owner || owner.sender !== sender || owner.projectId !== projectId) throw new Error("Attachments belong to another draft or window.");
  };
  handleIpc(desktopInvoke.ai.openAttachmentDraft, (event, projectId, draftId) => {
    if (!context) throw new Error("Application context is not ready");
    const current = draftOwners.get(draftId);
    if (current) assertDraftOwner(event.sender, projectId, draftId);
    context.aiWorkspaces.openAttachmentDraft(projectId, draftId);
    if (current) return;
    const destroyed = () => {
      draftOwners.delete(draftId);
      void context.aiWorkspaces.attachments.close({ projectId, draftId }).catch(error => console.warn("Could not close attachment draft", error));
    };
    draftOwners.set(draftId, { projectId, sender: event.sender, dispose: () => event.sender.removeListener("destroyed", destroyed) });
    event.sender.once("destroyed", destroyed);
  });
  handleIpc(desktopInvoke.ai.closeAttachmentDraft, async (event, projectId, draftId) => {
    const owner = draftOwners.get(draftId);
    if (!owner) return;
    assertDraftOwner(event.sender, projectId, draftId);
    draftOwners.delete(draftId); owner.dispose();
    await context?.aiWorkspaces.attachments.close({ projectId, draftId });
  });
  handleIpc(desktopInvoke.ai.removeAttachments, async (event, projectId, draftId, ids) => {
    assertDraftOwner(event.sender, projectId, draftId);
    await context?.aiWorkspaces.attachments.remove({ projectId, draftId }, ids);
  });
  handleIpc(desktopInvoke.ai.skills, () => context?.aiWorkspaces.listSkills());
  handleIpc(desktopInvoke.ai.saveSkill, (_event, input) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.saveSkill(input);
  });
  handleIpc(desktopInvoke.ai.setSkillEnabled, (_event, input) => {
    if (!context) throw new Error("Application context is not ready");
    return context.aiWorkspaces.setSkillEnabled(input);
  });
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
  handleIpc(desktopInvoke.ai.dismissChangeSet, (_event, id) => context?.aiWorkspaces.dismissChangeSet(id));
  handleIpc(desktopInvoke.ai.pickAttachments, async (event, projectId, draftId) => {
    if (!context) throw new Error("Application context is not ready");
    assertDraftOwner(event.sender, projectId, draftId);
    const selected = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    if (selected.canceled) return [];
    assertDraftOwner(event.sender, projectId, draftId);
    return context.aiWorkspaces.selectAttachments(projectId, selected.filePaths, draftId);
  });
  handleIpc(desktopInvoke.ai.addPastedImage, (event, projectId, mimeType, data, draftId) => {
    if (!context) throw new Error("Application context is not ready");
    assertDraftOwner(event.sender, projectId, draftId);
    return context.aiWorkspaces.addPastedImage(projectId, mimeType, data, draftId);
  });
  handleIpc(desktopInvoke.ai.addPastedFile, (event, projectId, name, data, draftId) => {
    if (!context) throw new Error("Application context is not ready");
    assertDraftOwner(event.sender, projectId, draftId);
    return context.aiWorkspaces.addPastedFile(projectId, name, data, draftId);
  });
  handleIpc(desktopInvoke.ai.send, async (event, input) => {
    if (!context) throw new Error("Application context is not ready");
    const conversation = context.aiWorkspaces.snapshot(input.projectId).conversations.find((item) => item.id === input.conversationId);
    if (!conversation) throw new Error("AI conversation was not found for this project.");
    if (conversation.projectId !== input.projectId) throw new Error("AI conversations can only access their associated project.");
    if (input.attachmentIds?.length) assertDraftOwner(event.sender, input.projectId!, input.attachmentDraftId!);
    const model = conversation.mode === "chat" ? settings.global.aiCopilotModel : settings.global.aiModel;
    const reasoningEffort = conversation.mode === "chat" ? settings.global.aiCopilotReasoningEffort : settings.global.aiReasoningEffort;
    const request = { ...input, permissionMode: settings.global.aiPermissionMode ?? "auto" as const, ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}) };
    return input.editMessageId
      ? context.aiWorkspaces.editAndResend({ ...request, messageId: input.editMessageId })
      : context.aiWorkspaces.send(request);
  });
  handleIpc(desktopInvoke.ai.sendQueued, (_event, conversationId, messageId) => context?.aiWorkspaces.sendQueued(conversationId, messageId));
  handleIpc(desktopInvoke.ai.removeQueued, (_event, conversationId, messageId) => context?.aiWorkspaces.removeQueued(conversationId, messageId));
  handleIpc(desktopInvoke.ai.cancel, (_event, taskId) => context?.aiWorkspaces.cancel(taskId));
}
