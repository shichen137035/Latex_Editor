import { afterEach, describe, expect, it, vi } from "vitest";
import { startSnapshotTimer } from "../../apps/desktop/src/renderer/workbench/snapshotTimer.js";

afterEach(() => vi.useRealTimers());
describe("project snapshot deadlines", () => {
  it("counts from project open and repeats independently of other snapshot requests", async () => {
    vi.useFakeTimers();
    let now = 0;
    const automatic = vi.fn(async () => undefined);
    const stop = startSnapshotTimer(0, 600_000, automatic, () => now);
    now = 599_999; await vi.advanceTimersByTimeAsync(599_999);
    expect(automatic).not.toHaveBeenCalled();
    // A manual/safety snapshot has no influence on this project's deadline.
    now = 600_000; await vi.advanceTimersByTimeAsync(1);
    expect(automatic).toHaveBeenCalledTimes(1);
    now = 1_200_000; await vi.advanceTimersByTimeAsync(600_000);
    expect(automatic).toHaveBeenCalledTimes(2);
    stop(); now = 1_800_000; await vi.advanceTimersByTimeAsync(600_000);
    expect(automatic).toHaveBeenCalledTimes(2);
  });
  it("retains the opening anchor when the configured interval changes", async () => {
    vi.useFakeTimers();
    let now = 180_000;
    const due = vi.fn(async () => undefined);
    const stop = startSnapshotTimer(0, 300_000, due, () => now);
    now = 299_999; await vi.advanceTimersByTimeAsync(119_999);
    expect(due).not.toHaveBeenCalled();
    now = 300_000; await vi.advanceTimersByTimeAsync(1);
    expect(due).toHaveBeenCalledOnce(); stop();
  });
  it("does not queue overlapping captures or replay missed background deadlines", async () => {
    vi.useFakeTimers();
    let now = 0;
    let finish!: () => void;
    const due = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const stop = startSnapshotTimer(0, 60_000, due, () => now);
    now = 180_000; await vi.advanceTimersByTimeAsync(60_000);
    expect(due).toHaveBeenCalledOnce();
    now = 240_000; await vi.advanceTimersByTimeAsync(60_000);
    expect(due).toHaveBeenCalledOnce();
    finish(); await Promise.resolve(); await Promise.resolve();
    now = 300_000; await vi.advanceTimersByTimeAsync(60_000);
    expect(due).toHaveBeenCalledTimes(2); stop(); finish();
  });
});
