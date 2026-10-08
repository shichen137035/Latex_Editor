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
      },
      interruptTurn: async (threadId: string) => listener({ method: "turn/completed", params: { threadId, turn: { status: "interrupted" } } })
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
    return { root, service, conversation, input: () => input!, startedTurn: () => input !== undefined, finished: () => completed, emit: (method: string, params: Record<string, unknown>) => listener({ method, params: { threadId: "thread", ...params } }) };
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

  it("stops an active Codex turn and immediately clears its running state", async () => {
    const f = await fixture();
    const started = await f.service.send({ conversationId: f.conversation.id, content: "Keep working" });
    await f.service.cancel(started.taskId);
    const conversation = f.service.snapshot("project").conversations[0]!;
    expect(conversation.messages.at(-1)?.status).toBe("complete");
    expect(f.service.snapshot("project").changeSets).toEqual([]);
    await f.service.dispose();
  });

  it("honors a stop request received before the AI provider starts", async () => {
    const f = await fixture();
    const taskId = "f56f19d3-11e2-4ec2-97fb-ae16a44716c4";
    await f.service.cancel(taskId);
    const started = await f.service.send({ conversationId: f.conversation.id, taskId, content: "Cancel before startup" });
    expect(started.conversation.messages.at(-1)?.status).toBe("complete");
    expect(started.conversation.messages.at(-1)?.content).toBe("Generation stopped.");
    expect(f.startedTurn()).toBe(false);
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
    const selected = await f.service.selectAttachments("project", [text, second, image]);
    const pastedImageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pccAAAAASUVORK5CYII=", "base64");
    const pastedImage = await f.service.addPastedImage("project", "image/png", new Uint8Array(pastedImageBytes));
    const pastedFileBytes = Buffer.from("\\section{Pasted notes}\n", "utf8");
    const pastedFile = await f.service.addPastedFile("project", "notes\\pasted.tex", new Uint8Array(pastedFileBytes));
    expect(pastedFile.name).toBe("pasted.tex");
    await expect(f.service.addPastedFile("project", "too-large.txt", new Uint8Array(20 * 1024 * 1024 + 1))).rejects.toThrow("smaller than 20 MB");
    await expect(f.service.addPastedFile("project", "..", new Uint8Array([1]))).rejects.toThrow("file name is invalid");
    await expect(f.service.addPastedImage("project", "image/png", new Uint8Array([1, 2, 3]))).rejects.toThrow("supported image");
    const attachments = [...selected, pastedImage, pastedFile];
    await f.service.send({ conversationId: f.conversation.id, content: "Read attachments", attachmentIds: attachments.map((item) => item.id) });
    const turn = f.input();
    const expectedContents = [await readFile(text), await readFile(second), await readFile(image), pastedImageBytes, pastedFileBytes];
    for (const [index, attachment] of attachments.entries()) {
      const copied = join(turn.cwd, ".texweave", "ai-attachments", attachment.id, attachment.name);
      expect(await readFile(copied)).toEqual(expectedContents[index]);
      expect(turn.prompt).toContain(copied);
    }
    expect(turn.imagePaths).toHaveLength(2);
    expect(await readFile(join(turn.cwd, ".texweave", "ai-attachments", pastedImage.id, pastedImage.name))).toEqual(pastedImageBytes);
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
    await direct.input().toolHandlers!.find_blocks!({ query: "paragraph" });
    direct.emit("turn/completed", { turn: { status: "completed" } });
    await vi.waitFor(() => expect(direct.finished()).toBe(true));
    expect(direct.service.snapshot("project").changeSets[0]!.files.map((file) => file.path)).toEqual([".texweave/structure.json"]);
    await direct.service.dispose();
  });

  it("does not propose an automatically refreshed structure index after source edits", async () => {
    const f = await fixture();
    const source = "\\begin{document}\nOriginal paragraph.\n\\end{document}";
    await f.service.send({ conversationId: f.conversation.id, content: "Revise the paragraph", snapshot: [{ path: "main.tex", content: source }] });
    await writeFile(join(f.input().cwd, "main.tex"), source.replace("Original", "Updated"));
    // A read-only block query refreshes source ranges and fingerprints in structure.json.
    const result = await f.input().toolHandlers!.find_blocks!({ query: "Updated" });
    expect(JSON.parse(result).ok).toBe(true);
    f.emit("turn/completed", { turn: { status: "completed" } });
    await vi.waitFor(() => expect(f.finished()).toBe(true));
    expect(f.service.snapshot("project").changeSets[0]!.files.map((file) => file.path)).toEqual(["main.tex"]);
    await f.service.dispose();
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
