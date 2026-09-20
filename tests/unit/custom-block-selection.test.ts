import { describe, expect, it } from "vitest";
import type { SemanticBlock } from "@latex-editor/contracts";
import { boundaryRepairCandidates, normalizeDocumentSelection } from "../../apps/desktop/src/renderer/custom-blocks/selection.js";
import { defaultBindings, eventBinding, validBinding } from "../../apps/desktop/src/renderer/settings/commands.js";

describe("custom block selection workflow", () => {
  it("uses a configurable non-conflicting Ctrl+Alt+B binding", () => {
    expect(defaultBindings["block.createFromSelection"]).toBe("Mod+Alt+B");
    expect(validBinding("Mod+Alt+B")).toBe(true);
    expect(eventBinding({ ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, key: "b" } as KeyboardEvent)).toBe("Mod+Alt+B");
  });

  it("normalizes surrounding whitespace without changing the selected content", () => {
    const source = "  selected text  ";
    expect(normalizeDocumentSelection(source, { fileId: "main.tex", start: 0, end: source.length, origin: "source" }))
      .toEqual({ fileId: "main.tex", start: 2, end: 15, origin: "source" });
  });

  it("offers expand and both trim directions when both boundaries cross blocks", () => {
    const blocks: SemanticBlock[] = [
      { id: "left", type: "lemma", origin: "environment", fileId: "main.tex", range: { start: 0, end: 20 } },
      { id: "right", type: "proof", origin: "environment", fileId: "main.tex", range: { start: 80, end: 100 } }
    ];
    expect(boundaryRepairCandidates({ start: 10, end: 90 }, blocks, "main.tex")).toEqual([
      { kind: "expand", range: { start: 0, end: 100 } },
      { kind: "trim-before", range: { start: 10, end: 80 } },
      { kind: "trim-after", range: { start: 20, end: 90 } }
    ]);
  });

  it("does not repair already-laminar nested blocks", () => {
    const blocks: SemanticBlock[] = [{ id: "nested", type: "equation", origin: "environment", fileId: "main.tex", range: { start: 20, end: 40 } }];
    expect(boundaryRepairCandidates({ start: 10, end: 50 }, blocks, "main.tex")).toEqual([]);
  });
});
