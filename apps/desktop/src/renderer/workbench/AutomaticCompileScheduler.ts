/** Coalesce accepted AI hunks and wait for an existing manual/project build to finish. */
export class AutomaticCompileScheduler {
  private pending = false;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private readonly options: { canRun(): boolean; compile(): Promise<void>; onError(error: unknown): void; delay?: number }) {}
  request() { if (!this.disposed) { this.pending = true; this.arm(); } }
  idle() { if (this.pending) this.arm(); }
  dispose() { this.disposed = true; this.pending = false; clearTimeout(this.timer); }
  private arm() {
    if (this.disposed || this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.disposed || !this.pending || !this.options.canRun()) return;
      this.pending = false;
      void this.options.compile().catch(error => { if (!this.disposed) this.options.onError(error); }).finally(() => { if (this.pending) this.arm(); });
    }, this.options.delay ?? 350);
  }
}
