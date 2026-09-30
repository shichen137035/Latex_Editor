import { describe, expect, it } from "vitest";
import { AppError, inferBlockKind, type CreateSemanticBlockInput, type ParsedBlockDescriptor } from "@latex-editor/contracts";
import { ProjectBlockGraphService, type BlockGraphFilePort } from "../../packages/application/src/block-graph-service.js";
import { BlockGraphManager } from "../../packages/editor-core/src/block-graph.js";

function createGraph(...ids: string[]): BlockGraphManager {
  const graph = BlockGraphManager.empty();
  for (const id of ids) graph.addBlock({ id, type: "statement" });
  return graph;
}

describe("v0.3.0 block relationship graph", () => {
  it("classifies blocks independently of origin and migrates v1 records by type", () => {
    const graph = BlockGraphManager.fromUnknown({
      version: 1,
      blocks: [
        { id: "section", type: "section", origin: "environment" },
        { id: "equation", type: "equation", origin: "environment" },
        { id: "paragraph", type: "paragraph", origin: "virtual" },
        { id: "custom", type: "custom", origin: "user" },
        { id: "future", type: "future-widget", origin: "environment" }
      ], dependencies: [], structuralParents: []
    });
    const snapshot = graph.toSnapshot();
    expect(snapshot.version).toBe(2);
    expect(snapshot.blocks.map(({ id, kind }) => [id, kind])).toEqual([
      ["section", "structural"], ["equation", "content"], ["paragraph", "content"], ["custom", "structural"], ["future", "structural"]
    ]);
    expect(graph.validateStructure()).toContainEqual(expect.objectContaining({ code: "UNKNOWN_BLOCK_KIND", blockId: "future", severity: "info" }));
  });

  it("warns about content children without rejecting or rewriting the structure", () => {
    const graph = BlockGraphManager.empty();
    graph.addBlock({ id: "equation", type: "equation", origin: "environment" });
    graph.addBlock({ id: "paragraph", type: "paragraph", origin: "virtual" });
    graph.addBlock({ id: "custom", type: "custom", origin: "user" });
    graph.setStructuralParent("paragraph", "equation");
    graph.setStructuralParent("custom", "equation");

    expect(graph.getStructuralChildren("equation")).toEqual(["custom", "paragraph"]);
    expect(graph.validateStructure()).toContainEqual(expect.objectContaining({
      code: "CONTENT_BLOCK_HAS_CHILDREN", severity: "warning", blockId: "equation",
      details: { childCount: 2, childIds: ["custom", "paragraph"] }
    }));
    expect(graph.validateGraph()).toEqual(expect.arrayContaining([expect.objectContaining({ code: "CONTENT_BLOCK_HAS_CHILDREN", type: "content-block-has-children" })]));
  });

  it("traverses chains, skip edges, diamonds, distances, and depth limits without reducing declared edges", () => {
    const graph = createGraph("A", "B", "C", "D", "X");
    graph.addDependency("A", "B");
    graph.addDependency("B", "D");
    graph.addDependency("A", "C");
    graph.addDependency("C", "D");
    graph.addDependency("A", "D");

    expect(graph.getDirectPrerequisites("D")).toEqual(["A", "B", "C"]);
    expect(graph.getAllPrerequisites("D")).toEqual(["A", "B", "C"]);
    expect(graph.getAllConsequences("A")).toEqual(["B", "C", "D"]);
    expect(graph.getPrerequisiteDistances("D")).toEqual({ A: 1, B: 1, C: 1 });
    expect(graph.getConsequenceClosure("A", { maxDepth: 1 }).all).toEqual(["B", "C", "D"]);
    expect(graph.getBlocksBetween("A", "D")).toEqual(["A", "B", "C", "D"]);
    expect(graph.hasDirectDependency("A", "D")).toBe(true);
    expect(graph.getAllPrerequisites("X")).toEqual([]);
  });

  it("terminates on logical cycles and reports strongly connected components", () => {
    const graph = createGraph("A", "B", "C", "D", "E");
    graph.addDependency("A", "B");
    graph.addDependency("B", "C");
    graph.addDependency("C", "A");
    graph.addDependency("D", "E");

    expect(graph.getAllPrerequisites("A")).toEqual(["B", "C"]);
    expect(graph.detectDependencyCycles()).toEqual([{ blockIds: ["A", "B", "C"] }]);
    expect(graph.getStronglyConnectedComponents()).toEqual(expect.arrayContaining([["A", "B", "C"], ["D"], ["E"]]));
    expect(graph.validateGraph()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "dependency-cycle", severity: "warning", blockIds: ["A", "B", "C"] })
    ]));
  });

  it("keeps structural containment separate and rejects structural cycles", () => {
    const graph = createGraph("section", "lemma", "equation", "result");
    graph.setStructuralParent("lemma", "section");
    graph.setStructuralParent("equation", "lemma");

    expect(graph.getStructuralParent("equation")).toBe("lemma");
    expect(graph.getStructuralAncestors("equation")).toEqual(["lemma", "section"]);
    expect(graph.getStructuralDescendants("section")).toEqual(["equation", "lemma"]);
    expect(graph.isStructuralAncestor("section", "equation")).toBe(true);
    expect(() => graph.setStructuralParent("section", "equation")).toThrowError(AppError);
    expect(graph.getDirectPrerequisites("equation")).toEqual([]);
  });

  it("finds direct and indirect structural overlaps in prerequisite closures", () => {
    const graph = createGraph("A", "B", "X", "Y", "D");
    graph.setStructuralParent("B", "A");
    graph.addDependency("A", "X");
    graph.addDependency("B", "Y");
    graph.addDependency("X", "D");
    graph.addDependency("Y", "D");

    expect(graph.findStructuralOverlapsInPrerequisites("D")).toEqual([
      { ancestor: "A", descendant: "B", ancestorDirect: false, descendantDirect: false }
    ]);
    expect(graph.validateGraph()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "prerequisite-structural-overlap", blockIds: ["D", "A", "B"] })
    ]));
  });

  it("reports logical layering within prerequisites while preserving every direct edge", () => {
    const graph = createGraph("A", "B", "C");
    graph.addDependency("A", "B");
    graph.addDependency("A", "C");
    graph.addDependency("B", "C");

    expect(graph.findLogicalRelationsWithinPrerequisites("C")).toEqual([{ from: "A", to: "B", direct: true }]);
    expect(graph.getDirectPrerequisites("C")).toEqual(["A", "B"]);
    expect(graph.validateGraph()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "prerequisite-logical-relation", blockIds: ["C", "A", "B"] })
    ]));
  });

  it("removes incident relationships without inferring replacement dependencies", () => {
    const graph = createGraph("A", "B", "C", "D");
    graph.addDependency("A", "B");
    graph.addDependency("D", "B");
    graph.addDependency("B", "C");
    graph.setStructuralParent("B", "A");
    graph.setStructuralParent("C", "B");

    graph.removeBlock("B");

    expect(graph.toSnapshot().dependencies).toEqual([]);
    expect(graph.toSnapshot().structuralParents).toEqual([]);
    expect(graph.hasDirectDependency("A", "C")).toBe(false);
  });

  it("validates corrupt persisted relationships without hanging or silently rewriting them", () => {
    const graph = BlockGraphManager.fromUnknown({
      version: 1,
      blocks: [{ id: "A", type: "statement" }, { id: "B", type: "statement" }],
      dependencies: [
        { from: "A", to: "B" },
        { from: "A", to: "B" },
        { from: "A", to: "A" },
        { from: "missing", to: "B" }
      ],
      structuralParents: [{ parent: "A", child: "B" }, { parent: "B", child: "A" }]
    });
    const types = graph.validateGraph().map((diagnostic) => diagnostic.type);
    expect(types).toEqual(expect.arrayContaining([
      "duplicate-dependency", "self-dependency", "dangling-dependency", "structural-cycle"
    ]));
    expect(graph.toSnapshot().dependencies).toHaveLength(4);
  });
});

describe("v0.3.4 custom blocks and relation validation", () => {
  it("uses one validator for virtual endpoints, self loops, reverse edges, duplicates, and cycle warnings", () => {
    const graph = BlockGraphManager.empty();
    graph.addBlock({ id: "A", type: "definition", origin: "environment" });
    graph.addBlock({ id: "B", type: "lemma", origin: "user" });
    graph.addBlock({ id: "C", type: "theorem", origin: "user" });
    graph.addBlock({ id: "D", type: "proof", origin: "environment" });
    graph.addBlock({ id: "P", type: "paragraph", origin: "virtual" });
    graph.setStructuralParent("D", "A");

    expect(graph.validateDependency("A", "A")).toMatchObject({ status: "invalid", reason: "self-loop" });
    expect(graph.validateDependency("P", "A")).toMatchObject({ status: "invalid", reason: "virtual-endpoint" });
    expect(graph.validateDependency("D", "A")).toMatchObject({ status: "invalid", reason: "descendant-prerequisite" });
    expect(graph.addDependency("A", "B")).toMatchObject({ outcome: "created", validation: { status: "valid" } });
    expect(graph.addDependency("A", "B")).toMatchObject({ outcome: "duplicate" });
    expect(graph.validateDependency("B", "A")).toMatchObject({ status: "invalid", reason: "bidirectional" });
    graph.addDependency("B", "C");
    expect(graph.validateDependency("C", "A")).toMatchObject({ status: "warning", reason: "cycle" });
    expect(graph.addDependency("C", "A")).toMatchObject({ outcome: "created", validation: { status: "warning" } });
  });

  it("enforces laminar custom block ranges and reparents children when a user block is deleted", () => {
    const graph = BlockGraphManager.empty();
    graph.addBlock({ id: "section", type: "section", origin: "environment", fileId: "main.tex", range: { start: 0, end: 100 } });
    graph.addBlock({ id: "theorem", type: "theorem", origin: "environment", fileId: "main.tex", range: { start: 20, end: 40 } });
    graph.addBlock({ id: "paragraph", type: "paragraph", origin: "virtual", fileId: "main.tex", range: { start: 50, end: 70 } });

    expect(graph.validateUserBlock({ fileId: "main.tex", range: { start: 10, end: 90 }, role: "argument" })).toMatchObject({ status: "valid", parentId: "section" });
    graph.addUserBlock({ id: "custom", type: "argument", role: "argument", origin: "user", fileId: "main.tex", range: { start: 10, end: 90 } });
    expect(graph.getStructuralParent("custom")).toBe("section");
    expect(graph.getStructuralParent("theorem")).toBe("custom");
    expect(graph.getStructuralParent("paragraph")).toBe("custom");
    expect(graph.validateUserBlock({ fileId: "main.tex", range: { start: 30, end: 60 }, role: "custom" })).toMatchObject({ status: "invalid", reason: "partial-overlap" });

    graph.addDependency("custom", "theorem");
    graph.deleteUserBlock("custom");
    expect(graph.getStructuralParent("theorem")).toBe("section");
    expect(graph.getStructuralParent("paragraph")).toBe("section");
    expect(graph.toSnapshot().dependencies).toEqual([]);
    expect(() => graph.deleteUserBlock("theorem")).toThrowError(AppError);
  });

  it("builds cycle-safe display neighborhoods without mutating the semantic graph", () => {
    const graph = createGraph("A", "B", "C", "D");
    graph.addDependency("A", "B");
    graph.addDependency("B", "C");
    graph.addDependency("C", "A");
    graph.addDependency("C", "D");
    const before = graph.toSnapshot();

    expect(graph.getRelationNeighborhood("B", "both", 1)).toMatchObject({ blockIds: ["A", "B", "C"], edges: [{ from: "A", to: "B" }, { from: "B", to: "C" }, { from: "C", to: "A" }] });
    expect(graph.getRelationNeighborhood("B", "both", "all").blockIds).toEqual(["A", "B", "C", "D"]);
    expect(graph.toSnapshot()).toEqual(before);
  });

  it("reconciles parser results to stable ids and preserves relations through orphaning", () => {
    const graph = BlockGraphManager.empty();
    const ids = ["section-id", "theorem-id"];
    const parsed = (transientId: string, role: string, start: number, end: number, fingerprint: string, label?: string): ParsedBlockDescriptor => ({
      transientId, origin: "environment", role, kind: inferBlockKind(role), fileId: "main.tex", range: { start, end }, fingerprint, ...(label ? { label } : {})
    });
    const first = graph.reconcileParsedBlocks("main.tex", [
      parsed("section:0", "section", 0, 100, "section-fingerprint"),
      parsed("theorem:20", "theorem", 20, 60, "theorem-fingerprint", "thm:one")
    ], () => ids.shift()!);
    expect(first.created).toEqual(["section-id", "theorem-id"]);
    graph.addDependency("section-id", "theorem-id");

    const second = graph.reconcileParsedBlocks("main.tex", [
      parsed("section:10", "section", 10, 120, "section-fingerprint")
    ], () => "unexpected");
    expect(second.matched).toEqual(["section-id"]);
    expect(second.orphaned).toEqual(["theorem-id"]);
    expect(graph.getBlock("section-id")).toMatchObject({ range: { start: 10, end: 120 }, state: "active" });
    expect(graph.getBlock("theorem-id")).toMatchObject({ state: "orphaned", label: "thm:one" });
    expect(graph.toSnapshot().dependencies).toEqual([{ from: "section-id", to: "theorem-id" }]);
  });

  it("marks a user block conflicted when a fresh parse introduces a partial overlap", () => {
    const graph = BlockGraphManager.empty();
    graph.addUserBlock({ id: "user-id", type: "argument", origin: "user", fileId: "main.tex", range: { start: 50, end: 120 } });
    const result = graph.reconcileParsedBlocks("main.tex", [{
      transientId: "section:0", origin: "environment", role: "section", kind: "structural", fileId: "main.tex",
      range: { start: 0, end: 100 }, fingerprint: "section-fingerprint"
    }], () => "section-id");
    expect(result.conflicted).toEqual(["user-id"]);
    expect(graph.getBlock("user-id")?.state).toBe("conflicted");
    expect(graph.getStructuralParent("user-id")).toBeNull();
  });

  it("maps user block ranges through ordered editor transactions", () => {
    const graph = BlockGraphManager.empty();
    graph.addUserBlock({ id: "user-id", type: "argument", origin: "user", fileId: "main.tex", range: { start: 10, end: 20 } });
    const result = graph.mapUserBlockRanges("main.tex", [
      [{ start: 0, end: 0, newLength: 3 }],
      [{ start: 23, end: 23, newLength: 2 }],
      [{ start: 0, end: 3, newLength: 0 }]
    ]);
    expect(result.updated).toEqual(["user-id"]);
    expect(graph.getBlock("user-id")?.range).toEqual({ start: 10, end: 22 });
  });
});

class MemoryGraphFiles implements BlockGraphFilePort {
  readonly contents = new Map<string, string>();

  async readText(projectId: string, relativePath: string): Promise<{ content: string }> {
    const content = this.contents.get(`${projectId}:${relativePath}`);
    if (content === undefined) throw new AppError("FILE_NOT_FOUND", `Missing ${relativePath}`);
    return { content };
  }

  async writeText(projectId: string, relativePath: string, content: string): Promise<void> {
    this.contents.set(`${projectId}:${relativePath}`, content);
  }
}

describe("project block graph persistence", () => {
  it("assigns stable ids, serializes concurrent mutations, and reloads the project graph", async () => {
    const files = new MemoryGraphFiles();
    const ids = ["block-a", "block-b"];
    const service = new ProjectBlockGraphService(files, { next: () => ids.shift()! });
    const inputs: CreateSemanticBlockInput[] = [{ type: "theorem", title: "A" }, { type: "proof", title: "B" }];
    const [a, b] = await Promise.all(inputs.map((input) => service.createBlock("project", input)));
    await service.addDependency("project", a.id, b.id);
    await service.setStructuralParent("project", b.id, a.id);

    const reloaded = new ProjectBlockGraphService(files, { next: () => "unused" });
    expect(await reloaded.getPrerequisiteClosure("project", b.id)).toMatchObject({ direct: [a.id], all: [a.id] });
    expect(await reloaded.getStructuralParent("project", b.id)).toBe(a.id);
    expect((await reloaded.snapshot("project")).blocks.map((block) => block.id)).toEqual(["block-a", "block-b"]);
    expect(files.contents.get("project:.texweave/structure.json")).toContain('"version": 2');
  });

  it("keeps structural undo separate from editor undo and migrates the legacy metadata path", async () => {
    const files = new MemoryGraphFiles();
    files.contents.set("project:.texweave/block-graph.json", JSON.stringify({ version: 1, blocks: [{ id: "A", type: "definition" }, { id: "B", type: "theorem" }], dependencies: [], structuralParents: [] }));
    const service = new ProjectBlockGraphService(files, { next: () => "unused" });
    await service.addDependency("project", "A", "B");
    expect(service.historyState("project")).toEqual({ canUndo: true, canRedo: false });
    expect((await service.snapshot("project")).dependencies).toEqual([{ from: "A", to: "B" }]);

    expect((await service.undo("project")).dependencies).toEqual([]);
    expect(service.historyState("project")).toEqual({ canUndo: false, canRedo: true });
    expect((await service.redo("project")).dependencies).toEqual([{ from: "A", to: "B" }]);
    expect(files.contents.has("project:.texweave/structure.json")).toBe(true);
  });

  it("persists parser reconciliation without adding it to structural undo history", async () => {
    const files = new MemoryGraphFiles();
    const service = new ProjectBlockGraphService(files, { next: () => "parsed-id" });
    const result = await service.reconcileParsedBlocks("project", {
      fileId: "main.tex",
      blocks: [{ transientId: "temporary", origin: "environment", role: "section", kind: "structural", fileId: "main.tex", range: { start: 0, end: 20 }, fingerprint: "stable" }]
    });
    expect(result.created).toEqual(["parsed-id"]);
    expect(service.historyState("project")).toEqual({ canUndo: false, canRedo: false });
    expect((await service.snapshot("project")).blocks[0]?.id).toBe("parsed-id");
  });
});
