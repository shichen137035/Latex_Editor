import { randomUUID } from "node:crypto";
import type { AIApprovalRequest } from "@latex-editor/contracts" with { "resolution-mode": "import" };

/** Suspends a provider tool until the user answers in the app, or the turn ends. */
export class AIApprovalRequests {
  readonly #pending = new Map<string, { request: AIApprovalRequest; resolve(allow: boolean): void; timer: NodeJS.Timeout }>();
  constructor(private readonly publish: (request: AIApprovalRequest) => void) {}

  list(conversationId?: string): AIApprovalRequest[] {
    return [...this.#pending.values()].filter(item => !conversationId || item.request.conversationId === conversationId).map(item => structuredClone(item.request));
  }

  request(input: Omit<AIApprovalRequest, "id" | "status">): Promise<boolean> {
    return new Promise(resolve => {
      const request: AIApprovalRequest = { ...input, id: randomUUID(), status: "pending" };
      const timer = setTimeout(() => this.resolve(request.id, false), 5 * 60_000);
      timer.unref();
      this.#pending.set(request.id, { request, resolve, timer });
      this.publish(structuredClone(request));
    });
  }

  resolve(id: string, allow: boolean): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    pending.resolve(allow === true);
    this.publish({ ...pending.request, status: allow === true ? "approved" : "denied" });
  }

  cancel(conversationId?: string): void {
    for (const [id, { request }] of this.#pending) if (!conversationId || request.conversationId === conversationId) this.resolve(id, false);
  }
}
