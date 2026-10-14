import type { AIConversation, AIMessage } from "@latex-editor/contracts";

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

/** IPC clones the entire history on each delta. Keep untouched messages memoizable. */
export function reuseConversationMessages(current: AIConversation | undefined, incoming: AIConversation): AIConversation {
  if (!current || current === incoming || current.id !== incoming.id) return incoming;
  const previous = new Map(current.messages.map(message => [message.id, message]));
  const messages = incoming.messages.map(message => {
    const existing = previous.get(message.id);
    return existing && sameMessage(existing, message) ? existing : message;
  });
  if (messages.length === current.messages.length && messages.every((message, index) => message === current.messages[index])) return { ...incoming, messages: current.messages };
  return { ...incoming, messages };
}

export function mergeConversation(current: AIConversation | undefined, incoming: AIConversation): AIConversation {
  return reuseConversationMessages(current, newestConversation(current, incoming));
}

function sameMessage(a: AIMessage, b: AIMessage): boolean {
  return a === b || (a.id === b.id && a.role === b.role && a.content === b.content && a.createdAt === b.createdAt
    && a.status === b.status && a.activity === b.activity && a.completedAt === b.completedAt
    && sameParts(a.reasoning, b.reasoning) && sameParts(a.responseParts, b.responseParts) && sameParts(a.attachments, b.attachments));
}

function sameParts<T extends object>(a: T[] | undefined, b: T[] | undefined): boolean {
  return a === b || Boolean(a && b && a.length === b.length && a.every((part, index) => {
    const next = b[index]!;
    const keys = Object.keys(part) as Array<keyof T>;
    return keys.length === Object.keys(next).length && keys.every(key => part[key] === next[key]);
  }));
}
