import { describe, expect, it } from "vitest";
import { AppError, type SemanticBlock } from "@latex-editor/contracts";
import { ProjectBlockGraphService, type BlockGraphFilePort } from "../../packages/application/src/block-graph-service.js";
import { BlockGraphManager } from "../../packages/editor-core/src/block-graph.js";

function createGraph(...ids: string[]): BlockGraphManager {
  const graph = BlockGraphManager.empty();
  for (const id of ids) graph.addBlock({ id, type: "statement" });
  return graph;
}

describe("v0.3.0 block relationship graph", () => {
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
    const inputs: Array<Omit<SemanticBlock, "id">> = [{ type: "theorem", title: "A" }, { type: "proof", title: "B" }];
    const [a, b] = await Promise.all(inputs.map((input) => service.createBlock("project", input)));
    await service.addDependency("project", a.id, b.id);
    await service.setStructuralParent("project", b.id, a.id);

    const reloaded = new ProjectBlockGraphService(files, { next: () => "unused" });
    expect(await reloaded.getPrerequisiteClosure("project", b.id)).toMatchObject({ direct: [a.id], all: [a.id] });
    expect(await reloaded.getStructuralParent("project", b.id)).toBe(a.id);
    expect((await reloaded.snapshot("project")).blocks.map((block) => block.id)).toEqual(["block-a", "block-b"]);
    expect(files.contents.get("project:.texweave/block-graph.json")).toContain('"version": 1');
  });
});
