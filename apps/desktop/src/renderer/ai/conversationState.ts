import type { AIConversation } from "@latex-editor/contracts";

/** IPC responses and push events can arrive out of order, even within one millisecond. */
export function newestConversation(current: AIConversation | undefined, incoming: AIConversation): AIConversation {
  if (!current || current.id !== incoming.id) return incoming;
  if (current.revision !== undefined && incoming.revision !== undefined && current.revision !== incoming.revision) return current.revision > incoming.revision ? current : incoming;
  if (current.messages.length !== incoming.messages.length) return current.messages.length > incoming.messages.length ? current : incoming;
  const previous = current.messages.at(-1), next = incoming.messages.at(-1);
  if (previous?.id === next?.id) {
    if (previous?.status === "error" && next?.status === "complete") return current;
    if (previous?.status === "complete" && next?.status === "error") return incoming;
    if (previous?.status !== "streaming" && next?.status === "streaming") return current;
    if (previous?.status === "streaming" && next?.status !== "streaming") return incoming;
  }
  return current.updatedAt > incoming.updatedAt ? current : incoming;
}
