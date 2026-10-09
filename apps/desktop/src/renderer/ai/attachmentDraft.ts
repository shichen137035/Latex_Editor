import { t } from "../i18n/index.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AIAttachment } from "@latex-editor/contracts";

type Api = NonNullable<Window["latexEditor"]>["ai"];
type Generation = { id: string; items: AIAttachment[]; loading: boolean; closed: boolean; ready?: Promise<void> };
type Payload = { attachmentDraftId: string; attachmentIds: string[] };
const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Owns UI drafts and late asynchronous results independently of conversation creation. */
export class AttachmentDraftController {
  #generation = this.#newGeneration();
  #closed = false;
  #conversationId: string | undefined;
  readonly #listeners = new Set<(state: { items: AIAttachment[]; loading: boolean }) => void>();
  constructor(readonly api: Api, readonly projectId: string, readonly onError: (error: unknown) => void, conversationId?: string) { this.#conversationId = conversationId; }
  subscribe(listener: (state: { items: AIAttachment[]; loading: boolean }) => void) { this.#listeners.add(listener); this.#publish(); return () => { this.#listeners.delete(listener); }; }
  start() { return this.#ready(this.#generation); }
  adoptConversation(id: string) { this.#conversationId = id; }
  switchConversation(id: string | undefined) {
    if (this.#closed || this.#conversationId === id) return;
    this.#conversationId = id;
    const previous = this.#generation;
    this.#generation = this.#newGeneration();
    this.#publish();
    void this.#close(previous).catch(this.onError);
    void this.start().catch(this.onError);
  }
  async pick(): Promise<void> {
    const generation = this.#generation;
    if (this.#closed || generation.loading) return;
    generation.loading = true; this.#publish();
    try {
      await this.#ready(generation);
      if (generation.closed) return;
      const selected = await this.api.pickAttachments(this.projectId, generation.id);
      if (!generation.closed) generation.items = [...generation.items, ...selected];
    } catch (error) { if (!generation.closed) this.onError(error); }
    finally { generation.loading = false; this.#publish(); }
  }
  async paste(files: File[]): Promise<void> {
    const generation = this.#generation;
    if (this.#closed || generation.loading || !files.length) return;
    if (files.some(file => file.size > 20 * 1024 * 1024)) { this.onError(new Error(t("ui.attachmentDraft.attachments_must_be_smaller_than_20_mb"))); return; }
    if (generation.items.length + files.length > 20 || [...generation.items, ...files].reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) { this.onError(new Error(t("ai.pasteFileLimit"))); return; }
    generation.loading = true; this.#publish();
    try {
      await this.#ready(generation);
      for (const file of files) {
        if (generation.closed) break;
        const data = new Uint8Array(await file.arrayBuffer());
        if (generation.closed) break;
        const item = imageTypes.has(file.type.toLowerCase())
          ? await this.api.addPastedImage(this.projectId, file.type, data, generation.id)
          : await this.api.addPastedFile(this.projectId, file.name, data, generation.id);
        if (!generation.closed) { generation.items = [...generation.items, item]; this.#publish(); }
      }
    } catch (error) { if (!generation.closed) this.onError(error); }
    finally { generation.loading = false; this.#publish(); }
  }
  async remove(id: string): Promise<void> {
    const generation = this.#generation;
    try {
      await this.#ready(generation);
      await this.api.removeAttachments(this.projectId, generation.id, [id]);
      if (!generation.closed) { generation.items = generation.items.filter(item => item.id !== id); this.#publish(); }
    } catch (error) { if (!generation.closed) this.onError(error); }
  }
  async payload(): Promise<Payload> {
    const generation = this.#generation;
    await this.#ready(generation);
    if (generation.closed || generation.loading) throw new Error(t("ui.attachmentDraft.the_attachment_draft_changed_please_try_again"));
    return { attachmentDraftId: generation.id, attachmentIds: generation.items.map(item => item.id) };
  }
  sent(payload: Payload): void {
    const generation = this.#generation;
    if (generation.id !== payload.attachmentDraftId || generation.closed) return;
    generation.items = generation.items.filter(item => !payload.attachmentIds.includes(item.id));
    this.#publish();
  }
  async dispose(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#close(this.#generation);
    this.#listeners.clear();
  }
  #newGeneration(): Generation { return { id: crypto.randomUUID(), items: [], loading: false, closed: false }; }
  #ready(generation: Generation): Promise<void> {
    if (this.#closed || generation.closed) return Promise.reject(new Error(t("ui.attachmentDraft.attachment_draft_is_closed")));
    return generation.ready ??= this.api.openAttachmentDraft(this.projectId, generation.id);
  }
  async #close(generation: Generation): Promise<void> {
    generation.closed = true; generation.items = [];
    if (!generation.ready) return;
    await generation.ready.catch(() => undefined);
    await this.api.closeAttachmentDraft(this.projectId, generation.id);
  }
  #publish() { if (!this.#closed) for (const listener of this.#listeners) listener({ items: this.#generation.items, loading: this.#generation.loading }); }
}

export function useAttachmentDraft(api: Api | undefined, projectId: string, conversationId: string | undefined, onError: (error: unknown) => void) {
  const report = useRef(onError); report.current = onError;
  const client = useMemo(() => api ? new AttachmentDraftController(api, projectId, error => report.current(error), conversationId) : undefined, [api, projectId]);
  const [state, setState] = useState<{ items: AIAttachment[]; loading: boolean }>({ items: [], loading: false });
  const timers = useRef(new Map<AttachmentDraftController, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    if (!client) return;
    clearTimeout(timers.current.get(client)); timers.current.delete(client);
    const unsubscribe = client.subscribe(setState);
    void client.start().catch(error => report.current(error));
    const pending = timers.current;
    return () => {
      unsubscribe();
      pending.set(client, setTimeout(() => { pending.delete(client); void client.dispose().catch(error => console.warn("Could not release attachment draft", error)); }, 0));
    };
  }, [client]);
  useEffect(() => { client?.switchConversation(conversationId); }, [client, conversationId]);
  return { client, attachments: state.items, loading: state.loading };
}
