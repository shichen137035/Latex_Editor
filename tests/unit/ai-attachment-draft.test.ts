import { describe, expect, it, vi } from "vitest";
import { AttachmentDraftController } from "../../apps/desktop/src/renderer/ai/attachmentDraft.js";
import type { AIAttachment } from "@latex-editor/contracts";
type Api = NonNullable<Window["latexEditor"]>["ai"];
const file = (name = "paste.txt") => ({ name, type: "text/plain", size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }) as File;
function setup() {
  const api = { openAttachmentDraft: vi.fn(async () => undefined), closeAttachmentDraft: vi.fn(async () => undefined),
    removeAttachments: vi.fn(async () => undefined), pickAttachments: vi.fn(async (): Promise<AIAttachment[]> => []),
    addPastedFile: vi.fn(async (_project: string, name: string) => ({ id: name, name, size: 4 })), addPastedImage: vi.fn() };
  const error = vi.fn(), state = { items: [] as AIAttachment[], loading: false };
  const client = new AttachmentDraftController(api as unknown as Api, "project", error);
  client.subscribe(next => Object.assign(state, next));
  return { api, client, state, error };
}
describe("attachment composer lifetime", () => {
  it("removes backend entries and closes its draft on leaving the view", async () => {
    const f = setup(); await f.client.paste([file()]);
    const payload = await f.client.payload();
    await f.client.remove("paste.txt");
    expect(f.api.removeAttachments).toHaveBeenCalledWith("project", payload.attachmentDraftId, ["paste.txt"]);
    expect(f.state.items).toEqual([]);
    await f.client.dispose();
    expect(f.api.closeAttachmentDraft).toHaveBeenCalledWith("project", payload.attachmentDraftId);
  });
  it("rejects late picker results after switching conversations", async () => {
    const f = setup(); let finish!: (items: AIAttachment[]) => void;
    f.api.pickAttachments.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const operation = f.client.pick(); await vi.waitFor(() => expect(f.api.pickAttachments).toHaveBeenCalledOnce());
    f.client.switchConversation("other-conversation");
    finish([{ id: "old", name: "old.txt", size: 4 }]); await operation;
    expect(f.state.items).toEqual([]); expect(f.api.closeAttachmentDraft).toHaveBeenCalledOnce();
    await f.client.dispose();
  });
  it("does not upload clipboard data that finishes reading after unmount", async () => {
    const f = setup(); let finish!: (value: ArrayBuffer) => void;
    const delayed = file(); delayed.arrayBuffer = () => new Promise(resolve => { finish = resolve; });
    const operation = f.client.paste([delayed]); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await f.client.dispose(); finish(new ArrayBuffer(4)); await operation;
    expect(f.api.addPastedFile).not.toHaveBeenCalled();
  });
  it("adopts a newly created conversation without clearing attachments and retains retry payloads", async () => {
    const f = setup(); await f.client.paste([file()]);
    const payload = await f.client.payload(); f.client.adoptConversation("created-by-send"); f.client.switchConversation("created-by-send");
    expect(await f.client.payload()).toEqual(payload);
    expect(f.api.closeAttachmentDraft).not.toHaveBeenCalled();
    // A rejected send does not call sent(); the same draft is available to retry.
    expect(f.state.items).toHaveLength(1); f.client.sent(payload); expect(f.state.items).toEqual([]);
    await f.client.dispose();
  });
});
