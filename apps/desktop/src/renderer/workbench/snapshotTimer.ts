/** Deadlines belong to the open project, independently of other snapshot events. */
export function startSnapshotTimer(openedAt: number, intervalMs: number, onDue: () => Promise<unknown>, now = () => performance.now()): () => void {
  let stopped = false, busy = false;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    const elapsed = Math.max(0, now() - openedAt);
    const deadline = openedAt + (Math.floor(elapsed / intervalMs) + 1) * intervalMs;
    timer = setTimeout(() => {
      if (stopped) return;
      schedule();
      if (busy) return;
      busy = true;
      // Throttled windows do one check, never replay a backlog of missed ticks.
      void Promise.resolve().then(onDue).finally(() => { busy = false; }).catch(() => undefined);
    }, Math.max(1, deadline - now()));
  };
  schedule();
  return () => { stopped = true; clearTimeout(timer); };
}
