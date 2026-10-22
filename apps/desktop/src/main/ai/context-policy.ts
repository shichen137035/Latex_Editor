import type { AIMessage } from "@latex-editor/contracts" with { "resolution-mode": "import" };

/** Shared by the fixed bridge and native Responses adapter, never a permission override. */
export const contextEfficiencyPolicy = "Batch related block IDs; use filtered compact results and pagination. Read exact source only for relevant blocks. Reuse schemas and inspected content until a write, revision conflict or relevant user edit makes them stale. Tool handlers return JSON text: parse once and print needed data, not escaped strings or nested allSettled envelopes. If a call is pending, await that same call using the longest supported wait (up to 60 seconds per wait where available). Never run short polling loops, clock queries, repeated execution or unrelated reads while waiting for approval. Do not claim failure or rejection until the call resolves. Read attachment sections relevant to the request; do not dump whole large documents or project indexes by default. Never abbreviate text used as an exact edit precondition.";

/** Only used when starting a new provider session. Native continuations retain their own history. */
export function restoredConversationHistory(messages: AIMessage[]): string {
  const parts: string[] = [];
  let budget = 12_000;
  const recent = messages.filter(message => message.role === "user" || message.role === "assistant").slice(-6);
  for (const message of [...recent].reverse()) {
    const text = message.content.trim();
    if (!text) continue;
    const excerpt = text.length > 3000 ? `${text.slice(0, 1400)}\n[Earlier message excerpt: middle omitted; consult current source before editing.]\n${text.slice(-1400)}` : text;
    const part = `${message.role.toUpperCase()}: ${excerpt}`;
    if (part.length > budget) break;
    parts.unshift(part); budget -= part.length + 2;
  }
  return parts.join("\n\n");
}
