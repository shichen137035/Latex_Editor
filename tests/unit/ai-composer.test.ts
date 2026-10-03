import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIWorkspaceService } from "../../apps/desktop/src/main/ai/ai-workspace.js";
import type { CodexAppServer } from "../../apps/desktop/src/main/ai/codex-app-server.js";
import type { CopilotChatService } from "../../apps/desktop/src/main/ai/copilot-chat.js";
import { createWorkspaceBlockApi } from "../../apps/desktop/src/main/ai/workspace-block-api.js";

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
      createBlockApi: ({ projectId, workspaceRoot }) => createWorkspaceBlockApi({ id: projectId, name: "Test", canonicalPath: workspaceRoot, createdAt: "", registeredAt: "", writable: true, missing: false }, workspaceRoot),
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

  it("persists renamed conversations and distinguishes provisional edits from explicitly accepted ones", async () => {
    const f = await fixture();
    await f.service.renameConversation(f.conversation.id, "My paper edits");
    await expect(f.service.renameConversation(f.conversation.id, "  ")).rejects.toThrow("conversation name");
    const source = "\\documentclass{article}\n\\begin{document}\nOriginal text.\n\\end{document}\n";
    await f.service.send({ conversationId: f.conversation.id, content: "Edit", permissionMode: "auto", snapshot: [{ path: "main.tex", content: source }] });
    expect(f.input().permissionMode).toBe("auto");
    await writeFile(join(f.input().cwd, "main.tex"), source.replace("Original", "Revised"));
    f.emit("turn/completed", { turn: { status: "completed" } });
    await vi.waitFor(() => expect(f.finished()).toBe(true));
    const changes = f.service.snapshot("project").changeSets[0]!;
    expect(changes.permissionMode).toBe("auto");
    const ids = changes.files.flatMap(file => file.hunks.map(hunk => hunk.id));
    const provisional = await f.service.markChangeSetApplied(changes.id, ids);
    expect(provisional.status).toBe("pending");
    expect(provisional.files.flatMap(file => file.hunks).every(hunk => hunk.applied && hunk.decision === "pending")).toBe(true);
    const accepted = await f.service.resolveChangeSet(changes.id, Object.fromEntries(ids.map(id => [id, "accepted" as const])), true);
    expect(accepted.status).toBe("accepted");
    const unchanged = await f.service.resolveChangeSet(changes.id, Object.fromEntries(ids.map(id => [id, "rejected" as const])), false);
    expect(unchanged.status).toBe("accepted");
    const saved = JSON.parse(await readFile(join(f.root, "ai", "conversations.json"), "utf8"));
    expect(saved.conversations[0].title).toBe("My paper edits");
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

  it("routes block-tool edits into the same source diff review without touching the original project", async () => {
    const f = await fixture();
    const source = "\\begin{document}\nOriginal paragraph.\n\\end{document}";
    await f.service.send({ conversationId: f.conversation.id, content: "Improve prose", snapshot: [{ path: "main.tex", content: source }] });
    const tools = f.input().toolHandlers!;
    const found = JSON.parse(await tools.find_blocks!({ type: "paragraph" }));
    const block = JSON.parse(await tools.get_block_source!({ blockId: found.data[0].id }));
    const result = JSON.parse(await tools.replace_block_content!({ blockId: block.data.blockId, expectedRevision: block.data.revision, content: "Improved paragraph." }));
    expect(result).toMatchObject({ ok: true });
    expect(tools.set_block_semantic).toBeTypeOf("function");
    f.emit("turn/completed", { turn: { status: "completed" } });
    await vi.waitFor(() => expect(f.finished()).toBe(true));
    expect(f.service.snapshot("project").changeSets[0]!.files.map((file) => file.path)).toEqual(["main.tex"]);
    const change = f.service.snapshot("project").changeSets[0]!.files.find((file) => file.path === "main.tex")!;
    expect(change.originalContent).toBe(source);
    expect(change.proposedContent).toContain("Improved paragraph.");
    expect(change.status).toBe("pending");
    await expect(readFile(join(f.root, "project", "main.tex"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await f.service.dispose();
  });

  it("routes semantic summaries through the block API and reviews direct structure edits", async () => {
    const f = await fixture();
    const source = "\\begin{document}\nA paragraph.\n\\end{document}";
    await f.service.send({ conversationId: f.conversation.id, content: "Summarize", snapshot: [{ path: "main.tex", content: source }] });
    const tools = f.input().toolHandlers!;
    const found = JSON.parse(await tools.find_blocks!({ type: "paragraph" }));
    const block = JSON.parse(await tools.get_block!({ blockId: found.data[0].id })).data;
    const result = JSON.parse(await tools.set_block_semantic!({ blockId: block.id, expectedRevision: block.revision, summary: { text: "Short summary", source: "ai" } }));
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    f.emit("turn/completed", { turn: { status: "completed" } });
    await vi.waitFor(() => expect(f.finished()).toBe(true));
    expect(f.service.snapshot("project").changeSets[0]!.files.map((file) => file.path)).toEqual([".texweave/structure.json"]);
    await f.service.dispose();

    const direct = await fixture();
    await direct.service.send({ conversationId: direct.conversation.id, content: "Direct metadata edit", snapshot: [{ path: "main.tex", content: source }] });
    const metadataPath = join(direct.input().cwd, ".texweave", "structure.json");
    await writeFile(metadataPath, `${await readFile(metadataPath, "utf8")}\n`);
    direct.emit("turn/completed", { turn: { status: "completed" } });
    await vi.waitFor(() => expect(direct.finished()).toBe(true));
    expect(direct.service.snapshot("project").changeSets[0]!.files.map((file) => file.path)).toEqual([".texweave/structure.json"]);
    await direct.service.dispose();
  });

  it("preserves large structure metadata so AI can inspect user-defined blocks", async () => {
    const f = await fixture();
    const source = "Selected prose.";
    const structure = JSON.stringify({ version: 2, blocks: [{ id: "user-selected", type: "custom", kind: "structural", origin: "user", name: "Important prose", fileId: "main.tex", range: { start: 0, end: source.length }, state: "active", metadata: { compatibilityPadding: "x".repeat(2 * 1024 * 1024) } }], dependencies: [], structuralParents: [] });
    await f.service.send({ conversationId: f.conversation.id, content: "Inspect my custom block", snapshot: [{ path: "main.tex", content: source }, { path: ".texweave/structure.json", content: structure }] });
    const result = JSON.parse(await f.input().toolHandlers!.get_block!({ blockId: "user-selected" }));
    expect(result.ok).toBe(true);
    expect(result.data.children.map((block: { type: string }) => block.type)).toEqual(["paragraph"]);
    expect(f.input().prompt).not.toContain("compatibilityPadding");
    f.emit("turn/completed", { turn: { status: "completed" } });
    await vi.waitFor(() => expect(f.finished()).toBe(true));
    await f.service.dispose();
  });
});
