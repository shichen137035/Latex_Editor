import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIWorkspaceService } from "../../apps/desktop/src/main/ai/ai-workspace.js";
import type { CodexAppServer } from "../../apps/desktop/src/main/ai/codex-app-server.js";
import type { CopilotChatService } from "../../apps/desktop/src/main/ai/copilot-chat.js";

describe("AI composer attachments and reasoning", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
  async function fixture() {
    const root = await mkdtemp(join(tmpdir(), "texweave-composer-"));
    roots.push(root);
    let listener: Parameters<CodexAppServer["onEvent"]>[0] = () => undefined;
    let input: Parameters<CodexAppServer["startTurn"]>[0] | undefined;
    let completed = false;
    const codex = {
      onEvent: (callback: typeof listener) => { listener = callback; return () => undefined; },
      startTurn: async (turn: NonNullable<typeof input>) => {
        input = turn;
        turn.onThreadReady?.("thread");
        listener({ method: "item/reasoning/summaryTextDelta", params: { threadId: "thread", itemId: "reason", summaryIndex: 0, delta: "Inspect " } });
        return { threadId: "thread", turnId: "turn" };
      }
    } as unknown as CodexAppServer;
    const service = new AIWorkspaceService({
      userDataPath: root, codex,
      copilot: { dispose: async () => undefined } as unknown as CopilotChatService,
      projectFiles: { resolveFilePath: async (_id, path) => join(root, "project", path) },
      projectExists: () => true,
      builtInSkillsRoot: join(root, "skills"),
      compileWorkspace: async () => { throw new Error("Unexpected compile"); },
      onUpdate: (kind, payload) => {
        if (kind === "conversation" && (payload as { messages: Array<{ status?: string }> }).messages.at(-1)?.status === "complete") completed = true;
      }
    });
    await service.initialize();
    const conversation = await service.create({ projectId: "project", mode: "codex" });
    return { root, service, conversation, input: () => input!, finished: () => completed, emit: (method: string, params: Record<string, unknown>) => listener({ method, params: { threadId: "thread", ...params } }) };
  }

  it("keeps early summary events, section boundaries and authoritative summaries separate from the answer", async () => {
    const f = await fixture();
    await f.service.send({ conversationId: f.conversation.id, content: "Review" });
    f.emit("item/reasoning/summaryTextDelta", { itemId: "reason", summaryIndex: 0, delta: "sources." });
    f.emit("item/reasoning/summaryTextDelta", { itemId: "reason", summaryIndex: 1, delta: "Check labels." });
    f.emit("item/reasoning/textDelta", { itemId: "reason", delta: "Non-summary data" });
    f.emit("item/completed", { item: { id: "reason", type: "reasoning", summary: ["Inspect the sources.", "Check labels."] } });
    f.emit("item/agentMessage/delta", { delta: "Done." });
    const message = f.service.snapshot("project").conversations[0]!.messages.at(-1)!;
    expect(message.reasoning?.map((part) => part.text)).toEqual(["Inspect the sources.", "Check labels."]);
    expect(message.reasoning?.every((part) => part.complete)).toBe(true);
    expect(message.content).toBe("Done.");
    expect(message.activity).toBe("responding");
    f.emit("turn/completed", { turn: { status: "completed" } });
    await vi.waitFor(() => expect(f.finished()).toBe(true));
    await f.service.dispose();
  });

  it("copies same-name attachments independently, attaches images, and excludes attachment edits from project diffs", async () => {
    const f = await fixture();
    await mkdir(join(f.root, "other"));
    const text = join(f.root, "notes.txt");
    const second = join(f.root, "other", "notes.txt");
    const image = join(f.root, "image.png");
    await writeFile(text, "first"); await writeFile(second, "second"); await writeFile(image, Buffer.from([137, 80, 78, 71]));
    const attachments = await f.service.selectAttachments("project", [text, second, image]);
    await f.service.send({ conversationId: f.conversation.id, content: "Read attachments", attachmentIds: attachments.map((item) => item.id) });
    const turn = f.input();
    for (const [index, attachment] of attachments.entries()) {
      const copied = join(turn.cwd, ".texweave", "ai-attachments", attachment.id, attachment.name);
      expect(await readFile(copied)).toEqual(await readFile([text, second, image][index]!));
      expect(turn.prompt).toContain(copied);
    }
    expect(turn.imagePaths).toHaveLength(1);
    expect(f.service.snapshot("project").conversations[0]!.messages[0]!.attachments).toEqual(attachments);
    await writeFile(join(turn.cwd, ".texweave", "ai-attachments", attachments[0]!.id, "notes.txt"), "ignored diff");
    f.emit("turn/completed", { turn: { status: "completed" } });
    await vi.waitFor(() => expect(f.finished()).toBe(true));
    expect(f.service.snapshot("project").changeSets).toEqual([]);
    expect(await readFile(text, "utf8")).toBe("first");
    const foreign = await f.service.create({ projectId: "different", mode: "codex" });
    await expect(f.service.send({ conversationId: foreign.id, content: "Read", attachmentIds: [attachments[0]!.id] })).rejects.toThrow("this project");
    await f.service.dispose();
  });
});
