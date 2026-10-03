import { describe, expect, it } from "vitest";
import { AppError, type BlockGraphSnapshot, type ProjectTreeNode } from "@latex-editor/contracts";
import { createProjectBlockServices, type DocumentStructureFilePort } from "@latex-editor/application";

class MemoryProjectFiles implements DocumentStructureFilePort {
  readonly files = new Map<string, string>();
  async readText(projectId: string, relativePath: string) {
    const content = this.files.get(`${projectId}:${relativePath}`);
    if (content === undefined) throw new AppError("FILE_NOT_FOUND", relativePath);
    return { content };
  }
  async writeText(projectId: string, relativePath: string, content: string) {
    this.files.set(`${projectId}:${relativePath}`, content);
  }
  async listTree(): Promise<ProjectTreeNode[]> { return []; }
}

describe("project block services composition", () => {
  it("serializes source-graph and relation mutations through one canonical graph instance", async () => {
    const files = new MemoryProjectFiles();
    let serial = 0;
    const services = createProjectBlockServices({ files, ids: { next: () => `generated-${++serial}` } });
    expect(services.structure.graphs).toBe(services.blockGraph);
    await services.blockGraph.addBlock("project", { id: "A", type: "theorem" });
    await services.blockGraph.addBlock("project", { id: "B", type: "lemma" });

    let releaseMutation!: () => void;
    let announceMutationStarted!: () => void;
    const mutationStarted = new Promise<void>((resolve) => { announceMutationStarted = resolve; });
    const holdMutation = new Promise<void>((resolve) => { releaseMutation = resolve; });
    const sourceMutation = services.blockGraph.withGraphMutation("project", async (graph) => {
      graph.updateBlock("A", { title: "Updated title" });
      announceMutationStarted();
      await holdMutation;
    });
    await mutationStarted;

    const relationMutation = services.relations.createRelation("project", "A", "B");
    const relationFinishedBeforeSourceWrite = await Promise.race([
      relationMutation.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 0))
    ]);
    releaseMutation();
    expect(relationFinishedBeforeSourceWrite).toBe(false);
    await Promise.all([sourceMutation, relationMutation]);

    const snapshot: BlockGraphSnapshot = await services.blockGraph.snapshot("project");
    expect(snapshot.blocks.find((block) => block.id === "A")?.title).toBe("Updated title");
    expect(snapshot.relations).toHaveLength(1);
    expect(files.files.has("project:.texweave/structure.json")).toBe(true);
  });
});
