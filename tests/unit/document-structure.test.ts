import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AppError, type BlockApiResult, type BlockDetail, type DocumentStructure, type ProjectTreeNode } from "@latex-editor/contracts";
import { ProjectBlockGraphService } from "../../packages/application/src/block-graph-service.js";
import { ProjectRelationService } from "../../packages/application/src/relation-service.js";
import { ProjectDocumentStructureService, type DocumentStructureFilePort } from "../../packages/application/src/document-structure-service.js";
import { BlockGraphManager } from "../../packages/editor-core/src/block-graph.js";
import { environmentsFromCatalog, type EnvironmentCatalog } from "../../packages/editor-core/src/preview/catalog.js";
import { createBlockTools, createCopilotBlockTools } from "../../apps/desktop/src/main/ai/block-tools.js";

function data<T>(result: BlockApiResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.data;
}
const definitions = environmentsFromCatalog(JSON.parse(readFileSync("resources/environments/preview-environments.json", "utf8")) as EnvironmentCatalog);
function setup(source: string, extra: Record<string, string> = {}) {
  const files = new Map(Object.entries({ "main.tex": source, ...extra }));
  let next = 0, writes = 0;
  const port: DocumentStructureFilePort = {
    async readText(_projectId, path) {
      const content = files.get(path);
      if (content === undefined) throw new AppError("FILE_NOT_FOUND", path);
      return { content };
    },
    async writeText(_projectId, path, content) { writes++; files.set(path, content); },
    async listTree() { return [...files.keys()].map((relativePath): ProjectTreeNode => ({ kind: "file", name: relativePath, relativePath })); }
  };
  const ids = { next: () => `block-${++next}` };
  const graph = new ProjectBlockGraphService(port, ids);
  const service = new ProjectDocumentStructureService(port, graph, ids, async () => definitions);
  return { files, port, graph, service, api: service.api("project"), ids, writes: () => writes };
}
const paper = String.raw`\documentclass{article}
\begin{document}
\section{Consistency}\label{sec:consistency}
\begin{theorem}[Fixed-K]\label{thm:fixed}
Let the estimator be consistent.

\begin{equation}\label{eq:one}
x=y
\end{equation}

Therefore the conclusion holds.
\end{theorem}
\section{Empty}
\end{document}`;

describe("v0.5.3 source-aware document block API", () => {
  it("inserts a PDF-neutral semantic placeholder through the shared block API", async () => {
    const { api, files, graph, ids } = setup(paper);
    const inserted = data(await api.insert_block({ parentId: null, fileId: "main.tex", position: "end", block: { type: "placeholder" } }));
    expect(inserted).toMatchObject({ type: "placeholder", kind: "structural", origin: "virtual", capabilities: { connectable: true } });
    expect(data(await api.get_block_source({ blockId: inserted.id })).content).toBe("% tw:block-begin type=placeholder\n\n% tw:block-end");
    expect(files.get("main.tex")).not.toContain("\\begin{placeholder}");
    const relations = new ProjectRelationService(graph, ids);
    const scope = await relations.getRelationScope("project", { focusIds: [inserted.id], direction: "both", depth: 0 });
    const display = await relations.getDisplayScope("project", scope, { includeContent: true, includeStructuralParents: false });
    expect(display.contentBlockIds).toEqual(inserted.children.map(child => child.id));
  });

  it("preserves canonical relation IDs and creator metadata across source edits and index refresh", async () => {
    const { api, graph, service, ids } = setup(paper);
    const indexed = data(await service.snapshot("project"));
    const theorem = Object.values(indexed.blocks).find(block => block.type === "theorem")!;
    const empty = Object.values(indexed.blocks).find(block => block.title === "Empty")!;
    const relations = new ProjectRelationService(graph, ids);
    const relation = await relations.createRelation("project", theorem.id, empty.id, { createdBy: "ai" });
    const paragraph = data(await api.get_block_source({ blockId: theorem.childIds[0]! }));
    data(await api.replace_block_content({ blockId: paragraph.blockId, expectedRevision: paragraph.revision, content: `${paragraph.content} Updated prose.` }));
    const refreshed = data(await service.snapshot("project"));
    expect(refreshed.relations).toEqual([relation]);
    expect(await relations.getRelation("project", relation.id)).toEqual(relation);
  });

  it("persists a record index with ordered adjacency, exact body ranges and no duplicated source", async () => {
    const { service, files, graph } = setup(paper);
    const structure = data(await service.snapshot("project"));
    expect(structure.schemaVersion).toBe(2);
    expect(Array.isArray(structure.blocks)).toBe(false);
    const theorem = Object.values(structure.blocks).find((block) => block.type === "theorem")!;
    expect(theorem.childIds.map((id) => structure.blocks[id]!.type)).toEqual(["paragraph", "equation", "paragraph"]);
    const equation = Object.values(structure.blocks).find((block) => block.type === "equation")!;
    expect(equation.childIds).toEqual([]);
    expect(paper.slice(equation.source.range.start, equation.source.range.end)).toContain("\\begin{equation}");
    expect(paper.slice(equation.source.bodyRange!.start, equation.source.bodyRange!.end)).not.toContain("\\begin{equation}");
    const persisted = files.get(".texweave/structure.json")!;
    expect(persisted).not.toContain("Let the estimator");
    expect(data(await service.snapshot("project")).structureRevision).toBe(structure.structureRevision);
    expect((await graph.snapshot("project")).blocks.some((block) => block.id === theorem.id)).toBe(true);
  });

  it("generates a placeholder only for childless structural blocks, materializes and restores it", async () => {
    const { api, files } = setup(paper);
    const empty = data(await api.find_blocks({ type: "section", query: "Empty" }))[0]!;
    const detail = data(await api.get_block({ blockId: empty.id }));
    expect(detail.children).toHaveLength(1);
    expect(detail.children[0]!.placeholder).toBe(true);
    const placeholder = data(await api.get_block({ blockId: detail.children[0]!.id }));
    const paragraph = data(await api.replace_block_content({ blockId: placeholder.id, expectedRevision: placeholder.revision, content: "New empty-section text." }));
    expect(paragraph.id).toBe(placeholder.id);
    expect(paragraph.placeholder).toBeUndefined();
    expect(files.get("main.tex")).toContain("New empty-section text.");
    data(await api.delete_block({ blockId: paragraph.id, expectedRevision: paragraph.revision }));
    expect(data(await api.get_block({ blockId: empty.id })).children[0]!.placeholder).toBe(true);

    const nested = setup("\\section{A}\n\\subsection{B}");
    const outer = data(await nested.api.find_blocks({ type: "section" }))[0]!;
    expect(data(await nested.api.get_block({ blockId: outer.id })).children.map((block) => block.type)).toEqual(["subsection"]);
  });

  it("does not create paragraphs/cells/rows under normal figure, table or math blocks", async () => {
    const { api } = setup(String.raw`\begin{figure}\includegraphics{x}\caption{X}\end{figure}
\begin{table}\begin{tabular}{cc}a & b \\ c & d\end{tabular}\end{table}
\[\begin{array}{cc}a & b\end{array}\]`);
    const blocks = data(await api.list_blocks());
    expect(blocks.map((block) => block.type)).toEqual(["figure", "table", "display-math"]);
    expect(blocks.every((block) => block.kind === "content" && block.childCount === 0)).toBe(true);
  });

  it("returns lightweight cards, child summaries and real aux numbers rather than ordinals", async () => {
    const { api } = setup(paper, { "main.aux": String.raw`\newlabel{thm:fixed}{{2.3}{4}{Fixed-K}{theorem.2.3}{}}` });
    const card = data(await api.find_blocks({ type: "theorem", number: "2.3" }))[0]!;
    expect(card.number).toBe("2.3"); expect(card.ordinal).toBe(1);
    expect(card).not.toHaveProperty("source"); expect(card).not.toHaveProperty("content");
    const detail = data(await api.get_block({ blockId: card.id }));
    expect(detail.children.map((block) => block.type)).toEqual(["paragraph", "equation", "paragraph"]);
    expect(detail.parent?.title).toBe("Consistency");
    const equation = data(await api.find_blocks({ type: "equation", ordinal: 1 }))[0]!;
    expect(equation.number).toBeUndefined();
    expect(data(await api.find_blocks({ type: "equation", number: "1" }))).toEqual([]);
    expect(data(await api.get_blocks({ blockIds: [card.id, equation.id] }))).toHaveLength(2);
  });

  it("edits prose without touching math, advances revisions and rejects stale/structural writes", async () => {
    const { api, files } = setup(paper);
    const theorem = data(await api.find_blocks({ type: "theorem" }))[0]!;
    const detail = data(await api.get_block({ blockId: theorem.id }));
    const paragraph = data(await api.get_block_source({ blockId: detail.children[0]!.id }));
    expect(paragraph.content).not.toContain("\\label{thm:fixed}");
    const edited = data(await api.replace_block_content({ blockId: paragraph.blockId, expectedRevision: paragraph.revision, content: "The estimator is consistent." }));
    expect(edited.revision).toBe(paragraph.revision + 1);
    expect(files.get("main.tex")).toContain("x=y");
    expect(files.get("main.tex")).toContain("\\label{thm:fixed}");
    expect(await api.replace_block_content({ blockId: paragraph.blockId, expectedRevision: paragraph.revision, content: "stale" })).toMatchObject({ ok: false, error: { code: "STALE_BLOCK", currentRevision: edited.revision } });
    const currentTheorem = data(await api.get_block({ blockId: theorem.id }));
    expect(await api.replace_block_content({ blockId: theorem.id, expectedRevision: currentTheorem.revision, content: "bad" })).toMatchObject({ ok: false, error: { code: "STRUCTURAL_BLOCK_HAS_NO_DIRECT_CONTENT" } });
    expect(files.get("main.tex")).not.toContain("stale");
  });

  it("preserves separated metadata across restart and flags it stale after a content edit", async () => {
    const { api, port, ids, files } = setup(paper);
    const card = data(await api.find_blocks({ type: "theorem" }))[0]!;
    const theorem = data(await api.get_block({ blockId: card.id }));
    data(await api.set_block_semantic({ blockId: theorem.id, expectedRevision: theorem.revision, summary: { text: "Fixed-K consistency", source: "ai" }, tags: { user: ["important"], ai: ["consistency"] } }));
    const reloaded = new ProjectDocumentStructureService(port, new ProjectBlockGraphService(port, ids), ids, async () => definitions).api("project");
    expect(data(await reloaded.find_blocks({ tags: ["important"], query: "consistency" }))[0]?.id).toBe(theorem.id);
    files.set("main.tex", paper.replace("Let the estimator", "Assume the estimator"));
    const stale = data(await reloaded.get_block({ blockId: theorem.id }));
    expect(stale.semanticStale).toBe(true);
    expect(stale.summary).toBe("Fixed-K consistency");
  });

  it("inserts ordered siblings and deletes a structural subtree rather than unwrapping", async () => {
    const { api, files } = setup(paper);
    const theorem = data(await api.find_blocks({ type: "theorem" }))[0]!;
    const detail = data(await api.get_block({ blockId: theorem.id }));
    const inserted = data(await api.insert_block({ parentId: theorem.id, position: { before: detail.children[1]!.id }, block: { type: "paragraph", content: "Inserted before math." } }));
    expect(inserted.parent?.id).toBe(theorem.id);
    expect(data(await api.get_block({ blockId: theorem.id })).children.map((block) => block.id)).toContain(inserted.id);
    const updated = data(await api.get_block({ blockId: theorem.id }));
    const removed = data(await api.delete_block({ blockId: theorem.id, expectedRevision: updated.revision }));
    expect(removed.deletedIds).toContain(inserted.id);
    expect(files.get("main.tex")).not.toContain("\\begin{theorem}");
    expect(files.get("main.tex")).not.toContain("x=y");
    expect(files.get("main.tex")).toContain("\\section{Empty}");
  });

  it("allows explicit content children with a nonfatal warning", async () => {
    const { api } = setup("\\begin{equation}\nx=y\n\\end{equation}");
    const equation = data(await api.find_blocks({ type: "equation" }))[0]!;
    const result = await api.insert_block({ parentId: equation.id, position: "end", block: { type: "custom", content: "Nested user content" } });
    expect(result).toMatchObject({ ok: true, warnings: [expect.objectContaining({ code: "CONTENT_BLOCK_HAS_CHILDREN", blockId: equation.id })] });
    expect(data(result).parent?.id).toBe(equation.id);
    expect(data(result).children.map((child) => child.type)).toEqual(["paragraph"]);
  });

  it("migrates the existing graph without losing stable IDs or explicit dependencies", async () => {
    const { api, files, graph, service } = setup(paper);
    const indexed = data(await service.snapshot("project"));
    const theorem = Object.values(indexed.blocks).find((block) => block.type === "theorem")!;
    const empty = Object.values(indexed.blocks).find((block) => block.title === "Empty")!;
    const legacy = BlockGraphManager.fromUnknown(JSON.parse(files.get(".texweave/structure.json")!)).toSnapshot();
    legacy.dependencies = [{ from: theorem.id, to: empty.id }];
    delete legacy.relations;
    delete legacy.relationSchemaVersion;
    files.set(".texweave/structure.json", JSON.stringify(legacy));
    const migrated = data(await service.snapshot("project"));
    expect(migrated.dependencies).toEqual(legacy.dependencies);
    expect(data(await api.get_block({ blockId: theorem.id })).id).toBe(theorem.id);
    await graph.updateBlock("project", theorem.id, { metadata: { parserFingerprint: theorem.identity!.parserFingerprint, userFlag: true } });
    expect((JSON.parse(files.get(".texweave/structure.json")!) as DocumentStructure).schemaVersion).toBe(2);
    expect(data(await service.snapshot("project")).blocks[theorem.id]!.metadata?.userFlag).toBe(true);
  });

  it("treats an exact-range user wrapper as the parent rather than an empty duplicate", async () => {
    const source = "Only one paragraph.";
    const { api, files } = setup(source);
    files.set(".texweave/structure.json", JSON.stringify({ version: 2, blocks: [{ id: "custom-wrapper", type: "custom", kind: "structural", origin: "user", name: "Selected prose", fileId: "main.tex", range: { start: 0, end: source.length }, state: "active" }], dependencies: [], structuralParents: [] }));
    const wrapper = data(await api.get_block({ blockId: "custom-wrapper" }));
    expect(wrapper.children.map((block) => block.type)).toEqual(["paragraph"]);
    expect(wrapper.children[0]!.placeholder).toBeUndefined();
  });

  it("shares the same tool dispatch for AI edits and protects concurrent revisions", async () => {
    const { api } = setup(paper);
    const { dynamicTools, toolHandlers } = createBlockTools(api);
    expect(dynamicTools).toHaveLength(9);
    const cards = data(JSON.parse(await toolHandlers.find_blocks!({ type: "paragraph" })) as BlockApiResult<Array<{ id: string }>>);
    const current = data(await api.get_block({ blockId: cards[0]!.id }));
    const results = await Promise.all(["First", "Second"].map((content) => toolHandlers.replace_block_content!({ blockId: current.id, expectedRevision: current.revision, content })));
    expect(results.map((result) => (JSON.parse(result) as BlockApiResult<BlockDetail>).ok)).toEqual([true, false]);
    expect(JSON.parse(results[1]!).error.code).toBe("STALE_BLOCK");
  });

  it("registers the same schemas and working handlers with the Copilot SDK", async () => {
    const { api } = setup(paper);
    const codex = createBlockTools(api).dynamicTools;
    const copilot = await createCopilotBlockTools(api);
    expect(copilot.map((tool) => tool.name)).toEqual(codex.map((tool) => tool.name));
    expect(copilot.every((tool) => tool.skipPermission)).toBe(true);
    const find = copilot.find((tool) => tool.name === "find_blocks")!;
    const input = { type: "theorem" };
    const result = JSON.parse(await find.handler!(input, { sessionId: "test", toolCallId: "test", toolName: find.name, arguments: input }) as string) as BlockApiResult<Array<{ label?: string }>>;
    expect(data(result)[0]?.label).toBe("thm:fixed");
  });

  it("does not rewrite the index on unchanged reads and handles multi-file insertions explicitly", async () => {
    const { api, writes } = setup(paper, { "appendix.tex": "\\section{Appendix}\nText." });
    data(await api.list_blocks());
    const count = writes();
    data(await api.list_blocks()); data(await api.find_blocks({ query: "Appendix" }));
    expect(writes()).toBe(count);
    expect(await api.insert_block({ parentId: null, position: "end", block: { type: "paragraph", content: "Test" } })).toMatchObject({ ok: false, error: { code: "INVALID_GRAPH_QUERY" } });
    const inserted = data(await api.insert_block({ parentId: null, fileId: "appendix.tex", position: "start", block: { type: "section", title: "New", content: "New text." } }));
    expect(inserted.location.fileId).toBe("appendix.tex");
  });

  it("rejects invalid wrapper replacements and crossing insertions before writing source", async () => {
    const { api, files } = setup(paper);
    const equation = data(await api.find_blocks({ type: "equation" }))[0]!;
    const detail = data(await api.get_block({ blockId: equation.id }));
    expect(await api.replace_block_content({ blockId: equation.id, expectedRevision: detail.revision, content: "x=z" })).toMatchObject({ ok: false, error: { code: "BLOCK_RANGE_INVALID" } });
    const theorem = data(await api.find_blocks({ type: "theorem" }))[0]!;
    expect(await api.insert_block({ parentId: theorem.id, position: "end", block: { type: "section", title: "Wrong nesting" } })).toMatchObject({ ok: false, error: { code: "BLOCK_RANGE_INVALID" } });
    expect(files.get("main.tex")).toBe(paper);
  });

  it("retains canonical metadata through legacy undo/redo and rejects malformed cycles", async () => {
    const { api, files, graph } = setup(paper);
    const theorem = data(await api.find_blocks({ type: "theorem" }))[0]!;
    const current = data(await api.get_block({ blockId: theorem.id }));
    data(await api.set_block_semantic({ blockId: theorem.id, expectedRevision: current.revision, summary: { text: "Keep me", source: "user" } }));
    const empty = data(await api.find_blocks({ type: "section", query: "Empty" }))[0]!;
    await graph.addDependency("project", theorem.id, empty.id);
    await graph.undo("project");
    expect(JSON.parse(files.get(".texweave/structure.json")!).schemaVersion).toBe(2);
    expect(data(await api.get_block({ blockId: theorem.id })).summary).toBe("Keep me");
    await graph.redo("project");
    expect((await graph.snapshot("project")).dependencies).toEqual([{ from: theorem.id, to: empty.id }]);
    const broken = JSON.parse(files.get(".texweave/structure.json")!) as DocumentStructure;
    const originalParent = broken.blocks[theorem.id]!.parentId!;
    broken.blocks[originalParent]!.childIds = broken.blocks[originalParent]!.childIds.filter((id) => id !== theorem.id);
    broken.blocks[theorem.id]!.parentId = theorem.id;
    broken.blocks[theorem.id]!.childIds.push(theorem.id);
    expect(() => BlockGraphManager.fromUnknown(broken)).toThrow(/cycle/);
  });

  it("keeps cached metadata queries lightweight in a large paper", async () => {
    const source = "\\begin{document}\n" + Array.from({ length: 1000 }, (_, index) => `\\begin{theorem}[Result ${index + 1}]\\label{thm:${index + 1}}\nParagraph ${index + 1}.\n\\begin{equation}x=${index + 1}\\end{equation}\n\\end{theorem}\n`).join("\n") + "\\end{document}";
    const { api, files, port, writes } = setup(source);
    const reads: string[] = [];
    const read = port.readText.bind(port);
    port.readText = async (projectId, path) => { reads.push(path); return read(projectId, path); };
    port.getFileVersion = async (_projectId, path) => files.get(path) ?? "missing";
    expect(data(await api.find_blocks({ label: "thm:999" }))[0]?.title).toBe("Result 999");
    const sourceReads = reads.filter((path) => path === "main.tex").length, indexWrites = writes();
    for (let index = 0; index < 4; index++) {
      const card = data(await api.find_blocks({ type: "theorem", ordinal: 1000 }))[0]!;
      expect(card.title).toBe("Result 1000");
      expect(data(await api.get_block({ blockId: card.id })).children.map((child) => child.type)).toEqual(["paragraph", "equation"]);
    }
    expect(reads.filter((path) => path === "main.tex")).toHaveLength(sourceReads);
    expect(writes()).toBe(indexWrites);
  });
});
