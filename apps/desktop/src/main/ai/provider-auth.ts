import type { AIMode, AIStatus } from "@latex-editor/contracts" with { "resolution-mode": "import" };

type Account = { status(): Promise<AIStatus | undefined>; login(): Promise<AIStatus | undefined> };

/** One application-wide login attempt per provider, shared by every chat entry point. */
export class AIProviderAuthentication {
  private readonly pending = new Map<AIMode, Promise<AIStatus | undefined>>();
  constructor(private readonly accounts: Record<AIMode, Account>) {}

  login(mode: AIMode): Promise<AIStatus | undefined> {
    const existing = this.pending.get(mode);
    if (existing) return existing;
    const request = (async () => {
      const account = this.accounts[mode];
      const status = await account.status();
      return status?.auth === "signed_in" || status?.auth === "authenticating" ? status : account.login();
    })();
    this.pending.set(mode, request);
    const clear = () => { if (this.pending.get(mode) === request) this.pending.delete(mode); };
    void request.then(clear, clear);
    return request;
  }
}
