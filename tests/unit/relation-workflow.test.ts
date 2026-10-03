import { describe, expect, it } from "vitest";
import type { BlockGraphSnapshot, SemanticBlock } from "@latex-editor/contracts";
import { candidateRelationState, projectRelationCandidates, relationEndpoints } from "../../apps/desktop/src/renderer/relations/model.js";

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
});
