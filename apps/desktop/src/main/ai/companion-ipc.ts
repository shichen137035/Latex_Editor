import { desktopInvoke } from "@latex-editor/contracts/desktop-ipc";
import { handleIpc } from "../ipc.js";
import type { DesktopContext } from "../desktopContext.js";
import type { SettingsRepository } from "../settings.js";

/** Pet requests carry no project id, working-copy overrides, or project edit reports. */
export function registerCompanionChatIpcHandlers(context: DesktopContext | undefined, settings: SettingsRepository): void {
  handleIpc(desktopInvoke.companionChat.conversations, () => context?.companionChats.snapshot() ?? []);
  handleIpc(desktopInvoke.companionChat.createConversation, (_event, mode) => {
    if (!context) throw new Error("Application context is not ready");
    return context.companionChats.create(mode);
  });
  handleIpc(desktopInvoke.companionChat.send, (_event, input) => {
    if (!context) throw new Error("Application context is not ready");
    const conversation = context.companionChats.snapshot().find(item => item.id === input.conversationId);
    if (!conversation) throw new Error("Companion conversation was not found.");
    const copilot = conversation.mode === "chat";
    const model = copilot ? settings.global.aiCopilotModel : settings.global.aiModel;
    const reasoningEffort = copilot ? settings.global.aiCopilotReasoningEffort : settings.global.aiReasoningEffort;
    return context.companionChats.send({ conversationId: input.conversationId, content: input.content,
      permissionMode: settings.global.aiPermissionMode ?? "auto", ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {})
    });
  });
  handleIpc(desktopInvoke.companionChat.cancel, (_event, id) => context?.companionChats.cancel(id));
  handleIpc(desktopInvoke.companionChat.approvals, () => context?.companionChats.approvals.list() ?? []);
  handleIpc(desktopInvoke.companionChat.resolveApproval, (_event, id, allow) => { context?.companionChats.approvals.resolve(id, allow); return Promise.resolve(); });
}
