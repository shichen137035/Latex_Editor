import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectBlockGraphService, ProjectRelationService } from "@latex-editor/application";
import { AppError } from "@latex-editor/contracts";
import { AIWorkspaceService } from "../../apps/desktop/src/main/ai/ai-workspace.js";
import { isReadOnlyWorkspaceCommand, isWorkspacePath } from "../../apps/desktop/src/main/ai/ai-approvals.js";
import type { CodexAppServer } from "../../apps/desktop/src/main/ai/codex-app-server.js";
import type { CopilotChatService } from "../../apps/desktop/src/main/ai/copilot-chat.js";
import { createWorkspaceBlockApi } from "../../apps/desktop/src/main/ai/workspace-block-api.js";
import { isSnapshotTextPath, isWorkspaceAssetPath } from "../../apps/desktop/src/main/ai/workspaceFiles.js";
import { collectGraphicDependencies } from "../../apps/desktop/src/main/ai/tex-dependencies.js";
import { isAIEditableProjectPath, isAIReviewableProjectPath } from "@latex-editor/contracts/ai-paths";

describe("AI project context and workspace reads", () => {
  let root: string | undefined;
  afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

  it("exports browser-compatible ESM and synchronous main-process CommonJS entry points", () => {
    const requireFromTest = createRequire(import.meta.url);
    const esmPath = execFileSync(process.execPath, ["--input-type=module", "-e", "process.stdout.write(import.meta.resolve('@latex-editor/contracts/ai-paths'))"], { encoding: "utf8" });
    expect(esmPath).toMatch(/ai-paths\.js$/);
    expect(requireFromTest.resolve("@latex-editor/contracts/ai-paths")).toMatch(/ai-paths\.cjs$/);
    expect(requireFromTest("@latex-editor/contracts/ai-paths").isAIEditableProjectPath("main.tex")).toBe(true);
  });

  it("keeps internal metadata available in the working copy but outside AI file changes", () => {
    expect(isSnapshotTextPath(".texweave/structure.json")).toBe(true);
    expect(isSnapshotTextPath(".texweave/ai-inputs/chat-input-1.txt")).toBe(true);
    expect(isWorkspaceAssetPath("figures/result.png")).toBe(true);
    expect(isWorkspaceAssetPath(".latex-editor/build/result.png")).toBe(false);
    expect(isSnapshotTextPath(".texweave/history/manifests/abc.json")).toBe(false);
    expect(isAIEditableProjectPath("chapters/main.tex")).toBe(true);
    expect(isAIReviewableProjectPath(".texweave/structure.json")).toBe(true);
    expect(isAIReviewableProjectPath(".texweave/history/manifests/abc.json")).toBe(false);
    for (const path of [".texweave/structure.json", ".texweave\\structure.json", "chapters/.texweave/structure.json", ".latex-editor/config.json", "../main.tex", "C:\\outside.tex"]) {
      expect(isAIEditableProjectPath(path)).toBe(false);
    }
  });

  it("resolves only project graphics referenced by TeX and honors graphicspath and comments", () => {
    const dependencies = collectGraphicDependencies([
      { path: "main.tex", content: "\\graphicspath{{figures/}}\n\\includegraphics{angle}\n% \\includegraphics{missing}\n\\includegraphics[width=\\linewidth]{plots/result.pdf}" }
    ], ["figures/angle.png", "figures/angle.pdf", "plots/result.pdf", "unused/other.png"]);
    expect(dependencies.resolved).toEqual(["figures/angle.pdf", "figures/angle.png", "plots/result.pdf"]);
    expect(dependencies.unresolved).toEqual([]);
  });

  it("copies project text and provides metadata-first tools instead of injecting complete source", async () => {
    root = mkdtempSync(join(tmpdir(), "texweave-ai-context-"));
    const builtInSkillsRoot = join(root, "skills");
    mkdirSync(join(builtInSkillsRoot, "context-check"), { recursive: true });
    writeFileSync(join(builtInSkillsRoot, "context-check", "SKILL.md"), "---\nname: context-check\ndescription: Test skill.\n---\n\nSkill-only guidance marker.\n", "utf8");
    let turn: Parameters<CodexAppServer["startTurn"]>[0] | undefined;
    const codex = {
      onEvent: () => () => undefined,
      startTurn: async (input: NonNullable<typeof turn>) => {
        turn = input;
        return { threadId: "test-thread", turnId: "test-turn" };
      }
    } as unknown as CodexAppServer;
    const createService = () => new AIWorkspaceService({
      userDataPath: root,
      codex,
      copilot: { dispose: async () => undefined } as unknown as CopilotChatService,
      projectFiles: { resolveFilePath: async (_id, path) => join(root!, "project", path) },
      projectExists: () => true,
      builtInSkillsRoot,
      compileWorkspace: async () => { throw new Error("Unexpected compile"); },
      createBlockApi: ({ projectId, workspaceRoot }) => createWorkspaceBlockApi({ id: projectId, name: "Test", canonicalPath: workspaceRoot, createdAt: "", registeredAt: "", writable: true, missing: false }, workspaceRoot)
    });
    const service = createService();
    await service.initialize();
    expect(service.listSkills()).toEqual([expect.objectContaining({ name: "context-check", enabled: true })]);
    await service.setSkillEnabled({ name: "context-check", enabled: false });
    expect(service.listSkills()).toEqual([expect.objectContaining({ name: "context-check", enabled: false })]);
    const conversation = await service.create({ projectId: "test-project", mode: "codex" });
    await service.send({ conversationId: conversation.id, content: "What is in this project?", snapshot: [{ path: "main.tex", content: "\\documentclass{article}\n\\begin{document}\nContext marker\n\\end{document}\n" }], assets: [{ path: "figures/result.png", content: new Uint8Array([137, 80, 78, 71]) }] });
    expect(turn?.prompt).toContain("Available text files (1):\nmain.tex");
    expect(turn?.prompt).toContain("Referenced graphics materialized into this working copy (1):\nfigures/result.png");
    expect(turn?.prompt).not.toContain("Context marker");
    expect(turn?.prompt).not.toContain("Skill-only guidance marker");
    expect(turn?.skills).toEqual([]);
    const found = JSON.parse(await turn!.toolHandlers!.find_blocks!({ type: "paragraph" }));
    const source = JSON.parse(await turn!.toolHandlers!.get_block_source!({ blockId: found.data[0].id }));
    expect(source.data.content).toContain("Context marker");
    expect(readFileSync(join(turn!.cwd, "main.tex"), "utf8")).toContain("Context marker");
    expect(readFileSync(join(turn!.cwd, "figures", "result.png"))).toEqual(Buffer.from([137, 80, 78, 71]));
    await service.dispose();
    const restored = createService();
    try {
      await restored.initialize();
      expect(restored.listSkills()).toEqual([expect.objectContaining({ name: "context-check", enabled: false })]);
    } finally { await restored.dispose(); }
  });

  it("materializes newly referenced graphics before compile and returns recorder-confirmed inputs", async () => {
    root = mkdtempSync(join(tmpdir(), "texweave-ai-compile-assets-"));
    const userData = join(root, "user-data");
    const projectRoot = join(root, "project");
    const plotPath = join(projectRoot, "plots", "result.png");
    mkdirSync(join(projectRoot, "plots"), { recursive: true });
    writeFileSync(plotPath, Buffer.from([137, 80, 78, 71]));
    let turn: Parameters<CodexAppServer["startTurn"]>[0] | undefined;
    const codex = { onEvent: () => () => undefined, startTurn: async (input: NonNullable<typeof turn>) => { turn = input; return { threadId: "compile-assets-thread", turnId: "compile-assets-turn" }; } } as unknown as CodexAppServer;
    const service = new AIWorkspaceService({
      userDataPath: userData,
      codex,
      copilot: { dispose: async () => undefined } as unknown as CopilotChatService,
      projectFiles: {
        resolveFilePath: async (_id, path) => join(projectRoot, path),
        listTree: async () => [
          { name: "main.tex", relativePath: "main.tex", kind: "file" },
          { name: "plots", relativePath: "plots", kind: "directory", children: [{ name: "result.png", relativePath: "plots/result.png", kind: "file" }] }
        ]
      },
      projectExists: () => true,
      builtInSkillsRoot: join(root, "skills"),
      compileWorkspace: async ({ workspaceRoot }) => {
        expect(readFileSync(join(workspaceRoot, "plots", "result.png"))).toEqual(Buffer.from([137, 80, 78, 71]));
        return { compilationId: "compile-assets", status: "succeeded", exitCode: 0, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z", durationMs: 1000, mainFile: "main.tex", diagnostics: [], recorderInputs: ["main.tex", "plots/result.png"], stdoutTail: "", stderrTail: "" };
      },
      setMainFile: async () => undefined,
      createBlockApi: ({ projectId, workspaceRoot }) => createWorkspaceBlockApi({ id: projectId, name: "Test", canonicalPath: workspaceRoot, createdAt: "", registeredAt: "", writable: true, missing: false }, workspaceRoot)
    });
    try {
      await service.initialize();
      const conversation = await service.create({ projectId: "test-project", mode: "codex" });
      await service.send({ conversationId: conversation.id, content: "Add a plot", snapshot: [{ path: "main.tex", content: "\\documentclass{article}\n\\begin{document}Text\\end{document}\n" }] });
      const inventory = JSON.parse(await turn!.toolHandlers!.texweave_list_project_files!({ query: "result" }));
      expect(inventory.files).toContainEqual(expect.objectContaining({ path: "plots/result.png", inProject: true, inWorkingCopy: false }));
      writeFileSync(join(turn!.cwd, "main.tex"), "\\documentclass{article}\n\\begin{document}\\includegraphics{plots/result}\\end{document}\n");
      const compileOutput = await turn!.toolHandlers!.texweave_compile!({});
      expect(compileOutput).toContain("Project graphics copied before this compile: plots/result.png");
      expect(compileOutput).toContain("Recorder-confirmed project inputs (2):\nmain.tex\nplots/result.png");
    } finally { await service.dispose(); }
  });

  it("approves ordinary reads in the copied workspace and rejects commands that change files or leave it", () => {
    const rootPath = join("C:\\", "Users", "test", "workspace");
    expect(isWorkspacePath(join(rootPath, "chapter"), rootPath)).toBe(true);
    expect(isWorkspacePath(join(rootPath, "..", "other"), rootPath)).toBe(false);
    const shell = '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command ';
    expect(isReadOnlyWorkspaceCommand(`${shell}'Get-ChildItem -LiteralPath . -File -Name'`)).toBe(true);
    expect(isReadOnlyWorkspaceCommand(`${shell}'Get-Content -LiteralPath main.tex'`)).toBe(true);
    expect(isReadOnlyWorkspaceCommand(`${shell}'Remove-Item -LiteralPath main.tex'`)).toBe(false);
    expect(isReadOnlyWorkspaceCommand(`${shell}'Get-Content -LiteralPath ..\\auth.json'`)).toBe(false);
    expect(isReadOnlyWorkspaceCommand(`${shell}'Get-ChildItem .; Remove-Item main.tex'`)).toBe(false);
  });

  it("requires explicit relation approval even in full access mode and commits through the shared service", async () => {
    root = mkdtempSync(join(tmpdir(), "texweave-ai-relations-"));
    let turn: Parameters<CodexAppServer["startTurn"]>[0] | undefined;
    const codex = { onEvent: () => () => undefined, startTurn: async (input: NonNullable<typeof turn>) => { turn = input; return { threadId: "relation-thread", turnId: "relation-turn" }; } } as unknown as CodexAppServer;
    const metadata = new Map<string, string>();
    const graph = new ProjectBlockGraphService({ readText: async (_id, path) => { const content = metadata.get(path); if (content === undefined) throw new AppError("FILE_NOT_FOUND", path); return { content }; }, writeText: async (_id, path, content) => { metadata.set(path, content); } }, { next: () => "unused" });
    await graph.addBlock("p", { id: "A", type: "theorem" }); await graph.addBlock("p", { id: "B", type: "lemma" });
    let id = 0;
    const relations = new ProjectRelationService(graph, { next: () => `r${++id}` });
    const service = new AIWorkspaceService({
      userDataPath: root, codex, copilot: { dispose: async () => undefined } as unknown as CopilotChatService,
      projectFiles: { resolveFilePath: async (_id, path) => join(root!, "project", path) }, projectExists: () => true, builtInSkillsRoot: join(root, "skills"),
      compileWorkspace: async () => { throw new Error("Unexpected compile"); },
      createBlockApi: ({ projectId, workspaceRoot }) => createWorkspaceBlockApi({ id: projectId, name: "Test", canonicalPath: workspaceRoot, createdAt: "", registeredAt: "", writable: true, missing: false }, workspaceRoot),
      relationAccess: { api: project => relations.aiAPI(project), commit: (project, proposal) => relations.commitRelationProposal(project, proposal), reject: (project, proposal) => relations.rejectProposal(project, proposal) }
    });
    try {
      await service.initialize(); const conversation = await service.create({ projectId: "p", mode: "codex" });
      await service.send({ conversationId: conversation.id, content: "Link A to B", permissionMode: "full", snapshot: [{ path: "main.tex", content: "\\begin{document}Text\\end{document}" }] });
      const pending = turn!.toolHandlers!.relation_propose_create!({ sourceId: "A", targetId: "B", reason: "B depends on A" });
      await vi.waitFor(() => expect(service.listApprovals("p")).toHaveLength(1));
      expect(await relations.getDependents("p", "A")).toEqual([]);
      service.approvals.resolve(service.listApprovals("p")[0]!.id, true);
      const committed = JSON.parse(await pending);
      expect(committed.data).toMatchObject({ status: "committed", relation: { createdBy: "ai", sourceId: "A", targetId: "B" } });
      const rejected = turn!.toolHandlers!.relation_propose_reverse!({ relationId: committed.data.relation.id });
      await vi.waitFor(() => expect(service.listApprovals("p")).toHaveLength(1));
      service.approvals.resolve(service.listApprovals("p")[0]!.id, false);
      expect(JSON.parse(await rejected).data.status).toBe("rejected");
      expect(await relations.getDependents("p", "A")).toEqual(["B"]);
    } finally { await service.dispose(); relations.dispose(); }
  });
});
