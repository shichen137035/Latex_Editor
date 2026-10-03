export interface TextPatch { start: number; removed: string; inserted: string }
export type EditOperation = { kind: "text"; fileId: string; patch: TextPatch } | { kind: "file"; fileId: string; before: string | undefined; after: string | undefined } | { kind: "structure" };
export type HistoryDirection = "undo" | "redo";

/** Store only changed text, not a complete copy of a large paper per edit. */
export function textPatch(before: string, after: string): TextPatch {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let suffix = 0;
  while (suffix < before.length - start && suffix < after.length - start && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++;
  return { start, removed: before.slice(start, before.length - suffix), inserted: after.slice(start, after.length - suffix) };
}

/** Monaco supplies old-document offsets, avoiding a full-file scan per key. */
export function patchFromEdits(before: string, after: string, edits: Array<{ start: number; end: number; newLength: number }>): TextPatch {
  if (!edits.length) return textPatch(before, after);
  const start = Math.min(...edits.map(edit => edit.start)), end = Math.max(...edits.map(edit => edit.end));
  const delta = edits.reduce((sum, edit) => sum + edit.newLength - (edit.end - edit.start), 0);
  // Nested editor edits (e.g. pairing/completion) can update the model before
  // an older change notification reaches React. Do not trust stale offsets.
  if (before.length + delta !== after.length) return textPatch(before, after);
  return { start, removed: before.slice(start, end), inserted: after.slice(start, end + delta) };
}

export function applyTextPatch(content: string, patch: TextPatch, direction: HistoryDirection): string {
  const [expected, replacement] = direction === "undo" ? [patch.inserted, patch.removed] : [patch.removed, patch.inserted];
  if (patch.start > content.length || content.slice(patch.start, patch.start + expected.length) !== expected) throw new Error("The document changed outside this edit history. Undo was stopped to protect its contents.");
  return content.slice(0, patch.start) + replacement + content.slice(patch.start + expected.length);
}

/** Project-scoped chronological history shared by Code, Visual and block tools. */
export class EditHistory {
  private past: EditOperation[] = [];
  private future: EditOperation[] = [];
  private typingUntil = 0;
  private pending: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private executing = false;
  private revision = 0;
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get busy(): boolean { return this.executing; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void { for (const listener of this.listeners) listener(); }
  breakGroup(): void { this.typingUntil = 0; }
  clear(): void { this.past = []; this.future = []; this.breakGroup(); this.revision++; this.notify(); }

  recordText(fileId: string, before: string, after: string, typing = false, now = Date.now(), knownPatch?: TextPatch): void {
    if (before === after) return;
    const patch = knownPatch ?? textPatch(before, after);
    const last = this.past.at(-1);
    const smallEdit = typing && patch.inserted.length <= 2 && patch.removed.length <= 2;
    if (smallEdit && now < this.typingUntil && !this.future.length && last?.kind === "text" && last.fileId === fileId
      && patch.start >= last.patch.start - 1 && patch.start <= last.patch.start + last.patch.inserted.length + 1) {
      const start = Math.min(last.patch.start, patch.start);
      const end = Math.max(last.patch.start + last.patch.inserted.length, patch.start + patch.removed.length);
      const removed = before.slice(start, last.patch.start) + last.patch.removed + before.slice(last.patch.start + last.patch.inserted.length, end);
      const inserted = after.slice(start, end + patch.inserted.length - patch.removed.length);
      const merged = textPatch(removed, inserted);
      if (!merged.removed && !merged.inserted) this.past.pop();
      else this.past[this.past.length - 1] = { kind: "text", fileId, patch: { ...merged, start: start + merged.start } };
    } else this.past.push({ kind: "text", fileId, patch });
    this.future = [];
    this.revision++;
    this.typingUntil = smallEdit ? now + 750 : 0;
    this.trim();
    this.notify();
  }

  recordStructure(): void {
    this.breakGroup(); this.past.push({ kind: "structure" }); this.future = []; this.revision++; this.trim(); this.notify();
  }
  recordFile(fileId: string, before: string | undefined, after: string | undefined): void {
    if (before === after) return;
    this.breakGroup(); this.past.push({ kind: "file", fileId, before, after }); this.future = []; this.revision++; this.trim(); this.notify();
  }
  renameFile(from: string, to: string): void {
    for (const entry of [...this.past, ...this.future]) if (entry.kind !== "structure" && (entry.fileId === from || entry.fileId.startsWith(`${from}/`))) entry.fileId = to + entry.fileId.slice(from.length);
    this.breakGroup();
  }
  forgetFile(path: string): void {
    const keep = (entry: EditOperation) => entry.kind === "structure" || (entry.fileId !== path && !entry.fileId.startsWith(`${path}/`));
    this.past = this.past.filter(keep); this.future = this.future.filter(keep); this.breakGroup(); this.notify();
  }
  private trim(): void {
    // Bound both the number of operations and retained edit payloads.
    const size = (entry: EditOperation) => entry.kind === "text" ? (entry.patch.removed.length + entry.patch.inserted.length) * 2 : entry.kind === "file" ? ((entry.before?.length ?? 0) + (entry.after?.length ?? 0)) * 2 : 0;
    let bytes = this.past.reduce((sum, entry) => sum + size(entry), 0);
    while (this.past.length > 100 || (bytes > 16 * 1024 * 1024 && this.past.length > 1)) bytes -= size(this.past.shift()!);
  }
  replay(direction: HistoryDirection, apply: (operation: EditOperation, direction: HistoryDirection) => void | Promise<void>): Promise<void> {
    const run = async () => {
      this.breakGroup();
      const from = direction === "undo" ? this.past : this.future;
      const to = direction === "undo" ? this.future : this.past;
      const entry = from.at(-1);
      if (!entry) return;
      const revision = this.revision, destinationIndex = to.length;
      this.executing = true; this.notify();
      try {
        await apply(entry, direction);
        // Only move an operation after it has successfully been applied.
        const index = from.indexOf(entry);
        if (index >= 0) from.splice(index, 1);
        if (revision === this.revision) to.push(entry);
        else if (direction === "redo") to.splice(destinationIndex, 0, entry);
      } finally { this.executing = false; this.notify(); }
    };
    const request = this.pending.then(run);
    this.pending = request.catch(() => undefined);
    return request;
  }
}
