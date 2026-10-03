import { describe, expect, it } from "vitest";
import type { BlockGraphSnapshot, SemanticBlock } from "@latex-editor/contracts";
import { blockSection, candidateRelationState, focusableRelationBlock, projectRelationCandidates, relationDocumentIds, relationEndpoints, relationScope } from "../../apps/desktop/src/renderer/relations/model.js";
import { environmentAccent } from "../../apps/desktop/src/renderer/preview/environment-colors.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";

function block(id: string, role: string, start: number, origin: SemanticBlock["origin"] = "environment"): SemanticBlock {
  return { id, type: role, role, origin, fileId: "main.tex", range: { start, end: start + 10 }, state: "active", capabilities: { connectable: origin !== "virtual", deletable: false, renameable: false, retypable: false } };
}

const snapshot: BlockGraphSnapshot = {
  version: 1,
  blocks: [block("section", "section", 0), block("definition", "definition", 20), block("lemma", "lemma", 40), block("virtual", "paragraph", 60, "virtual")],
  dependencies: [{ from: "definition", to: "lemma" }],
  structuralParents: [{ parent: "section", child: "definition" }, { parent: "section", child: "lemma" }, { parent: "lemma", child: "virtual" }]
};

describe("v0.3.4 relation workflow projection", () => {
  it("preserves ancestor context and document hierarchy while filtering", () => {
    const result = projectRelationCandidates(snapshot, "lemma", { hierarchyScope: "all", role: "definition", origin: "all", label: "all", textQuery: "" });
    expect([...result.matchIds]).toEqual(["definition"]);
    expect(result.contextIds.has("section")).toBe(true);
    expect(result.autoExpandedIds.has("section")).toBe(true);
    expect(result.roots[0]?.children.map((node) => node.block.id)).toEqual(["definition", "lemma"]);
  });

  it("does not force expansion without filters and keeps containment separate from logical validity", () => {
    const result = projectRelationCandidates(snapshot, "section", { hierarchyScope: "all", role: "all", origin: "all", label: "all", textQuery: "" });
    expect(result.autoExpandedIds.size).toBe(0);
    expect(candidateRelationState(snapshot, "section", "lemma", "prerequisite").disabledReason).toBeUndefined();
    expect(candidateRelationState(snapshot, "section", "lemma", "consequence").disabledReason).toBeUndefined();
  });

  it("keeps direction semantics and existing relation state consistent", () => {
    expect(relationEndpoints("lemma", "definition", "prerequisite")).toEqual({ from: "definition", to: "lemma" });
    expect(relationEndpoints("lemma", "definition", "consequence")).toEqual({ from: "lemma", to: "definition" });
    expect(candidateRelationState(snapshot, "lemma", "definition", "both").existingDirection).toBe("prerequisite");
    expect(candidateRelationState(snapshot, "lemma", "virtual", "both").disabledReason).toBe("virtual-endpoint");
  });

  it("allows relation focus only for active relation-capable blocks", () => {
    const graph = { ...snapshot, blocks: [...snapshot.blocks, block("equation", "equation", 80), { ...block("orphan", "lemma", 100), state: "orphaned" as const }] };
    expect(focusableRelationBlock(graph, "lemma")?.id).toBe("lemma");
    expect(focusableRelationBlock(graph, "virtual")).toBeUndefined();
    expect(focusableRelationBlock(graph, "equation")).toBeUndefined();
    expect(focusableRelationBlock(graph, "orphan")).toBeUndefined();
    expect(focusableRelationBlock(graph, "missing")).toBeUndefined();
    expect(relationScope(graph, "equation", "both", 2).blockIds).toEqual([]);
    expect(candidateRelationState(graph, "equation", "lemma", "both").disabledReason).toBe("virtual-endpoint");
  });

  it("uses logical direction and depth for the frontend scope without including containment edges", () => {
    const graph = { ...snapshot, blocks: [...snapshot.blocks, block("theorem", "theorem", 80), block("corollary", "corollary", 100)], dependencies: [...snapshot.dependencies, { from: "lemma", to: "theorem" }, { from: "theorem", to: "corollary" }] };
    expect(relationScope(graph, "lemma", "prerequisite", 1).blockIds).toEqual(["lemma", "definition"]);
    expect(relationScope(graph, "lemma", "consequence", 1).blockIds).toEqual(["lemma", "theorem"]);
    expect(relationScope(graph, "lemma", "consequence", 2).entries).toContainEqual({ blockId: "corollary", distance: 2, direction: "dependent" });
    expect(relationScope(graph, "virtual", "both", 2).blockIds).toEqual([]);
    expect(relationScope(graph, "deleted", "both", 2).blockIds).toEqual([]);
  });

  it("keeps source content with related blocks while preserving unrelated sections only as context", () => {
    const scope = relationScope(snapshot, "lemma", "both", 1);
    const ids = relationDocumentIds(snapshot, scope);
    expect(ids.has("virtual")).toBe(true);
    expect(ids.has("section")).toBe(false);
    const projected = projectRelationCandidates(snapshot, "lemma", { hierarchyScope: "all", role: "all", origin: "all", label: "all", textQuery: "" }, ids);
    expect(projected.contextIds.has("section")).toBe(true);
    expect(projected.matchIds.has("section")).toBe(false);
    expect(blockSection(snapshot, "lemma")?.id).toBe("section");
  });

  it("distinguishes statement environment colors and respects configured style overrides", () => {
    const theorem = DEFAULT_ENVIRONMENTS.find(environment => environment.id === "theorem")!;
    const lemma = DEFAULT_ENVIRONMENTS.find(environment => environment.id === "lemma")!;
    expect(environmentAccent("theorem", theorem)).not.toBe(environmentAccent("lemma", lemma));
    expect(environmentAccent("custom:lemma*", lemma)).toBe(environmentAccent("lemma", lemma));
    expect(environmentAccent("lemma", { ...lemma, style: { ...lemma.style, accentToken: "#123456" } })).toBe("#123456");
    const custom = environmentAccent("project-note");
    environmentAccent("other-note");
    expect(environmentAccent("project-note")).toBe(custom);
  });
});
