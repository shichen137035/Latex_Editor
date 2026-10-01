import { useLayoutEffect, useRef } from "react";

export interface UnsavedParticipant {
  hasChanges(): boolean;
  /** Commit a local Preview draft to the document before saving files. */
  commit?(): void;
  save?(): Promise<void>;
}

export class UnsavedChangesRegistry {
  private readonly participants = new Set<UnsavedParticipant>();
  register(participant: UnsavedParticipant): () => void {
    this.participants.add(participant);
    return () => { this.participants.delete(participant); };
  }
  hasChanges(): boolean { return [...this.participants].some(participant => participant.hasChanges()); }
  async saveAll(flush: (commit: () => void) => void): Promise<void> {
    const drafts = [...this.participants].filter(participant => participant.hasChanges() && participant.commit);
    // Flushing updates the Workbench's file snapshots synchronously. Saving an
    // old React closure here would silently omit newly committed Preview edits.
    flush(() => { for (const participant of drafts) participant.commit?.(); });
    for (const participant of [...this.participants]) {
      if (participant.hasChanges() && participant.save) {
        await participant.save();
        // File writes resolve before React necessarily renders the new clean
        // tab state. Flush that state before deciding whether changes remain.
        flush(() => undefined);
      }
    }
    if (this.hasChanges()) throw new Error("Some changes could not be saved.");
  }
}

export const unsavedChanges = new UnsavedChangesRegistry();

/** Stable registration, with getters/actions always reading the latest render. */
export function useUnsavedChanges(participant: UnsavedParticipant): void {
  const latest = useRef(participant);
  latest.current = participant;
  useLayoutEffect(() => unsavedChanges.register({
    hasChanges: () => latest.current.hasChanges(),
    commit: () => latest.current.commit?.(),
    save: async () => { await latest.current.save?.(); }
  }), []);
}

export async function resolveExit(registry: UnsavedChangesRegistry, options: {
  confirm(): Promise<"save" | "discard" | "cancel">;
  flush(commit: () => void): void;
  reportError(error: unknown): Promise<void>;
}): Promise<boolean> {
  try {
    if (!registry.hasChanges()) return true;
    const choice = await options.confirm();
    if (choice === "cancel") return false;
    if (choice === "save") await registry.saveAll(options.flush);
    return true;
  } catch (error) {
    await options.reportError(error);
    return false;
  }
}
