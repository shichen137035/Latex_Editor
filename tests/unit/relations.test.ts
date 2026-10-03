import { describe, expect, it } from "vitest";
import { AppError, type BlockGraphSnapshot, type BlockRelation, type RelationScopeOptions } from "@latex-editor/contracts";
import { BlockGraphManager, migrateRelationData } from "@latex-editor/editor-core";
import { ProjectBlockGraphService, ProjectRelationService, type BlockGraphFilePort } from "@latex-editor/application";
import { createRelationTools } from "../../apps/desktop/src/main/ai/relation-tools.js";
import { protectAIRelationMetadata } from "../../apps/desktop/src/main/ai/relation-review.js";

function graph(ids = ["A", "B", "C", "D", "E", "X"]) {
  const result = BlockGraphManager.empty();
  for (const id of ids) result.addBlock({ id, type: "theorem" });
  return result;
}
function diamond() {
  const blocks = graph(), relations = blocks.relations();
  for (const [source, target] of [["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"], ["D", "E"]]) relations.createRelation(source!, target!, { id: `${source}-${target}`, now: 1 });
  return blocks;
}
const options = (focusIds: string[], direction: RelationScopeOptions["direction"] = "prerequisites", depth: number | "all" = "all"): RelationScopeOptions => ({ focusIds, direction, depth });
class Files implements BlockGraphFilePort {
  data = new Map<string, string>(); fail = false;
  async readText(id: string, path: string) { const content = this.data.get(`${id}:${path}`); if (content === undefined) throw new AppError("FILE_NOT_FOUND", path); return { content }; }
  async writeText(id: string, path: string, content: string) { if (this.fail) throw new Error("Read-only disk"); this.data.set(`${id}:${path}`, content); }
}
function services(snapshot: BlockGraphSnapshot = graph().toSnapshot()) {
  const files = new Files(); files.data.set("p:.texweave/structure.json", JSON.stringify(snapshot));
  let serial = 0;
  const blocks = new ProjectBlockGraphService(files, { next: () => `block-${++serial}` });
  const relations = new ProjectRelationService(blocks, { next: () => `relation-${++serial}` }, () => 10);
  return { files, blocks, relations };
}

describe("v0.5.6 relation validation and mutation", () => {
  it("accepts structural, semantic and placeholder blocks independent of document order or containment", () => {
    const blocks = graph(); blocks.addBlock({ id: "semantic", type: "custom" }); blocks.addBlock({ id: "placeholder", type: "placeholder", origin: "virtual" });
    blocks.setStructuralParent("B", "A");
    expect(blocks.relations().canCreateRelation("B", "A")).toEqual({ valid: true });
    blocks.relations().createRelation("semantic", "placeholder", { id: "semantic-placeholder" });
    expect(blocks.relations().getDependents("semantic")).toEqual(["placeholder"]);
  });
  it.each(["paragraph", "equation", "figure", "image", "table", "itemize", "enumerate", "description"])("rejects %s endpoints even with a connectable override", type => {
    const blocks = graph(); blocks.addBlock({ id: "content", type, capabilities: { connectable: true, deletable: true, renameable: true, retypable: true } });
    expect(blocks.relations().canCreateRelation("content", "A")).toMatchObject({ valid: false, reason: "INVALID_SOURCE" });
    expect(blocks.relations().canCreateRelation("A", "content")).toMatchObject({ valid: false, reason: "INVALID_TARGET" });
  });
  it("rejects missing endpoints, self-relations, duplicates and cycles through both APIs", () => {
    const blocks = diamond(), r = blocks.relations();
    expect(r.canCreateRelation("missing", "A").reason).toBe("SOURCE_NOT_FOUND");
    expect(r.canCreateRelation("A", "missing").reason).toBe("TARGET_NOT_FOUND");
    expect(r.canCreateRelation("A", "A").reason).toBe("SELF_RELATION");
    expect(() => r.createRelation("A", "B", { id: "duplicate" })).toThrow(/DUPLICATE_RELATION/);
    expect(() => blocks.addDependency("E", "A")).toThrow(/CYCLE/);
    expect(r.snapshot().relations).toHaveLength(5);
  });
  it("reverses atomically, retaining identity and creator, and rolls back a cycle-producing reverse", () => {
    const r = diamond().relations(), before = r.snapshot();
    r.createRelation("A", "D", { id: "shortcut", now: 1 });
    expect(() => r.reverseRelation("shortcut", 2)).toThrow(/CYCLE/);
    expect(r.getRelation("shortcut")).toMatchObject({ sourceId: "A", targetId: "D" });
    r.deleteRelation("shortcut");
    expect(r.snapshot()).toEqual(before);
    expect(r.reverseRelation("D-E", 3)).toMatchObject({ id: "D-E", sourceId: "E", targetId: "D", createdBy: "user", createdAt: 1, updatedAt: 3 });
  });
  it("reports attached relations and downstream impact, then cleans relations on block deletion", () => {
    const blocks = diamond(), r = blocks.relations();
    expect(r.getRelationImpact("D")).toMatchObject({ directPrerequisites: ["B", "C"], directDependents: ["E"], downstreamDependents: ["E"], incomingRelations: ["B-D", "C-D"] });
    blocks.removeBlock("D");
    expect(r.getRelation("D-E")).toBeNull(); expect(r.getRelation("A-B")).not.toBeNull();
  });
});

describe("v0.5.6 traversal, logical scope and display scope", () => {
  it("finds direct/transitive dependencies, distances and shortest paths across a diamond", () => {
    const r = diamond().relations();
    expect(r.getPrerequisites("D")).toEqual(["B", "C"]);
    expect(r.getDependents("A")).toEqual(["B", "C"]);
    expect(r.getAncestors("E").entries).toEqual([{ blockId: "D", distance: 1 }, { blockId: "B", distance: 2 }, { blockId: "C", distance: 2 }, { blockId: "A", distance: 3 }]);
    expect(r.dependsOn("E", "A")).toBe(true); expect(r.dependsOn("A", "E")).toBe(false);
    expect(r.findRelationPath("A", "E")).toHaveLength(4); expect(r.findRelationPath("X", "E")).toBeNull();
    r.createRelation("A", "E", { id: "direct" }); expect(r.findRelationPath("A", "E")).toEqual(["A", "E"]);
  });
  it.each(["prerequisites", "dependents", "both"] as const)("supports %s scopes at depth 0, 1, 2 and all", direction => {
    const r = diamond().relations();
    expect(r.getRelationScope(options(["D"], direction, 0)).blockIds).toEqual(["D"]);
    for (const depth of [1, 2, "all"] as const) {
      const scope = r.getRelationScope(options(["D"], direction, depth));
      expect(scope.blockIds).not.toContain("X");
      expect(scope.entries.every(e => depth === "all" || e.distance <= depth)).toBe(true);
      expect(r.getRelationSubgraph(scope)).toEqual({ nodes: scope.entries, edges: scope.relations });
    }
    expect(r.getRelationScope(options(["D"], direction, "all")).blockIds).toEqual(direction === "prerequisites" ? ["D", "B", "C", "A"] : direction === "dependents" ? ["D", "E"] : ["D", "B", "C", "E", "A"]);
  });
  it("unions multiple focuses using the shortest distance and honors includeFocus", () => {
    const r = diamond().relations();
    const scope = r.getRelationScope(options(["D", "E", "D"]));
    expect(scope.focusIds).toEqual(["D", "E"]); expect(scope.entries.find(e => e.blockId === "A")?.distance).toBe(2);
    expect(r.getRelationScope({ ...options(["D", "E"]), includeFocus: false }).blockIds).toEqual(["B", "C", "A"]);
    expect(() => r.getRelationScope(options(["D"], "both", -1))).toThrow(/Depth/);
  });
  it("uses block containment for content and parent expansion without traversing sibling relations", () => {
    const blocks = diamond(); blocks.addBlock({ id: "section", type: "section" }); blocks.addBlock({ id: "text", type: "paragraph" }); blocks.addBlock({ id: "eq", type: "equation" }); blocks.addBlock({ id: "proof", type: "proof" });
    blocks.setStructuralParent("D", "section"); for (const id of ["text", "eq", "proof"]) blocks.setStructuralParent(id, "D");
    const r = blocks.relations(), scope = r.getRelationScope(options(["D"], "both", 0));
    expect(r.getDisplayScope(scope, { includeContent: false, includeStructuralParents: false }).allBlockIds).toEqual(["D"]);
    expect(r.getDisplayScope(scope, { includeContent: true, includeStructuralParents: true })).toEqual({ relationBlockIds: ["D"], contentBlockIds: ["eq", "proof", "text"], structuralParentIds: ["section"], allBlockIds: ["D", "eq", "proof", "section", "text"] });
  });
  it("traverses and validates a deep chain without recursive stack overflow", () => {
    const size = 6000;
    const blocks = graph(Array.from({ length: size }, (_, i) => `${i}`)).toSnapshot();
    const relations: BlockRelation[] = Array.from({ length: size - 1 }, (_, i) => ({ id: `r${i}`, sourceId: `${i}`, targetId: `${i + 1}`, createdBy: "user", createdAt: 0, updatedAt: 0 }));
    const r = new BlockGraphManager({ ...blocks, relations }).relations();
    expect(r.getAncestors(`${size - 1}`).entries).toHaveLength(size - 1); expect(r.validateRelationGraph()).toEqual([]);
  });
});

describe("v0.5.6 persistence, validation and AI proposals", () => {
  it("excludes shell-written relation fields from AI diffs while retaining independent semantic edits", () => {
    const before = JSON.stringify({ relations: [], dependencies: [], relationSchemaVersion: 1, blocks: { A: { summary: "original" } } });
    const proposal = JSON.stringify({ relations: [{ id: "bypass" }], dependencies: [{ from: "A", to: "A" }], relationSchemaVersion: 2, blocks: { A: { summary: "edited" } } });
    const result = protectAIRelationMetadata(before, proposal);
    expect(result.excluded).toBe(true);
    expect(JSON.parse(result.content!)).toEqual({ relations: [], dependencies: [], relationSchemaVersion: 1, blocks: { A: { summary: "edited" } } });
    const live = JSON.stringify({ relations: [{ id: "live" }], dependencies: [] });
    expect(protectAIRelationMetadata(live, undefined)).toEqual({ content: live, excluded: true });
    expect(protectAIRelationMetadata(before, "malformed")).toEqual({ content: before, excluded: true });
  });
  it("deterministically migrates legacy edges and retains corrupted graph evidence for validation", () => {
    const legacy = [{ from: "A", to: "B" }, { from: "B", to: "A" }, { from: "A", to: "B" }, { from: "missing", to: "B" }, { from: "eq", to: "B" }];
    expect(migrateRelationData(undefined, legacy)).toEqual(migrateRelationData(undefined, legacy));
    const snapshot = graph(["A", "B"]).toSnapshot();
    snapshot.blocks.push({ id: "eq", type: "equation", kind: "content" });
    const r = BlockGraphManager.fromUnknown({ ...snapshot, relations: undefined, dependencies: legacy }).relations();
    expect(r.snapshot().relations).toHaveLength(5);
    expect(r.validateRelationGraph().map(i => i.type)).toEqual(expect.arrayContaining(["CYCLE", "DUPLICATE_RELATION", "DANGLING_RELATION", "INVALID_ENDPOINT"]));
    expect(() => migrateRelationData({ version: 99, relations: [] })).toThrow(/schema/);
    expect(() => migrateRelationData({ version: 1, relations: [{ id: "bad" }] })).toThrow(/record/);
  });
  it("saves and reloads stable IDs and metadata, with concurrent writes and shared undo", async () => {
    const { files, blocks, relations } = services();
    const [a, b] = await Promise.all([relations.createRelation("p", "A", "B"), relations.createRelation("p", "A", "C")]);
    const reload = new ProjectRelationService(new ProjectBlockGraphService(files, { next: () => "unused" }), { next: () => "unused" });
    expect(await reload.getRelation("p", a.id)).toEqual(a); expect(await reload.getRelation("p", b.id)).toEqual(b);
    await blocks.undo("p"); expect(await relations.getDependents("p", "A")).toEqual(["B"]);
    await blocks.redo("p"); expect(await relations.getDependents("p", "A")).toEqual(["B", "C"]);
  });
  it("emits successful mutations and invalidation, but emits nothing if persistence fails", async () => {
    const { files, relations } = services(); const events: string[] = []; relations.onEvent((_id, event) => events.push(event.type));
    const r = await relations.createRelation("p", "A", "B"); expect(events).toEqual(["graph-invalidated", "relation-created"]);
    events.length = 0; files.fail = true;
    await expect(relations.reverseRelation("p", r.id)).rejects.toMatchObject({ code: "PERSISTENCE_ERROR" });
    expect(events).toEqual([]); expect(await relations.getRelation("p", r.id)).toEqual(r);
  });
  it("AI proposals do not mutate persistent state and commit with AI attribution only after approval", async () => {
    const { relations } = services(); const api = relations.aiAPI("p");
    const proposal = await api.propose_create({ sourceId: "A", targetId: "B", reason: "B uses A" });
    expect(await api.get_dependents({ blockId: "A" })).toEqual([]);
    const result = await relations.commitRelationProposal("p", proposal.id);
    expect(result).toMatchObject({ sourceId: "A", targetId: "B", createdBy: "ai" });
    expect(await relations.listProposals("p")).toEqual([]);
    await expect(relations.commitRelationProposal("p", proposal.id)).rejects.toMatchObject({ code: "PROPOSAL_NOT_FOUND" });
  });
  it("revalidates delayed proposals for new cycles, changed relations and reclassified endpoints", async () => {
    const { blocks, relations } = services();
    const proposal = await relations.proposeRelationCreate("p", "A", "B");
    await relations.createRelation("p", "B", "A");
    await expect(relations.commitRelationProposal("p", proposal.id)).rejects.toMatchObject({ code: "CYCLE_DETECTED" });
    const r = (await relations.getRelations("p", "A")).incoming[0]!;
    const deletion = await relations.proposeRelationDelete("p", r.id); await relations.reverseRelation("p", r.id);
    await expect(relations.commitRelationProposal("p", deletion.id)).rejects.toMatchObject({ code: "STALE_PROPOSAL" });
    const next = await relations.proposeRelationCreate("p", "A", "C"); await blocks.updateBlock("p", "C", { type: "equation", role: "equation" });
    await expect(relations.commitRelationProposal("p", next.id)).rejects.toMatchObject({ code: "INVALID_ENDPOINT" });
  });
  it("rejects invalid proposals and uses shared scope for AI, with no direct mutation tools", async () => {
    const { relations } = services(diamond().toSnapshot()), api = relations.aiAPI("p");
    await expect(api.propose_create({ sourceId: "E", targetId: "A" })).rejects.toMatchObject({ code: "CYCLE_DETECTED" });
    const tools = createRelationTools(api);
    expect(tools.dynamicTools.some(t => t.name === "relation_create" || t.name.includes("commit"))).toBe(false);
    const result = JSON.parse(await tools.toolHandlers.relation_get_scope!({ ...options(["E"]) }));
    expect(result.data).toEqual(await relations.getRelationScope("p", options(["E"])));
    const invalid = JSON.parse(await tools.toolHandlers.relation_propose_create!({ sourceId: "E", targetId: "A" }));
    expect(invalid.error.code).toBe("CYCLE_DETECTED");
    expect(await api.get_logic_context({ blockId: "E" })).toMatchObject({ focusId: "E", blocks: expect.arrayContaining([expect.objectContaining({ id: "A" })]) });
  });
});
