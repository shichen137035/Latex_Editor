import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomaticCompileScheduler } from "../../apps/desktop/src/renderer/workbench/AutomaticCompileScheduler.js";
afterEach(() => vi.useRealTimers());
describe("AI application compilation", () => {
  it("coalesces multiple hunks and waits for manual compilation", async () => {
    vi.useFakeTimers(); let busy = true;
    const compile = vi.fn(async () => undefined);
    const scheduler = new AutomaticCompileScheduler({ canRun: () => !busy, compile, onError: vi.fn() });
    scheduler.request(); scheduler.request(); scheduler.request();
    await vi.advanceTimersByTimeAsync(400);
    expect(compile).not.toHaveBeenCalled();
    busy = false; scheduler.idle();
    await vi.advanceTimersByTimeAsync(400);
    expect(compile).toHaveBeenCalledOnce(); scheduler.dispose();
  });
  it("cancels queued work when leaving the project", async () => {
    vi.useFakeTimers(); const compile = vi.fn(async () => undefined);
    const scheduler = new AutomaticCompileScheduler({ canRun: () => true, compile, onError: vi.fn() });
    scheduler.request(); scheduler.dispose();
    await vi.advanceTimersByTimeAsync(400);
    expect(compile).not.toHaveBeenCalled();
  });
});
