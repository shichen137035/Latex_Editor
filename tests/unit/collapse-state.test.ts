import { afterEach, describe, expect, it, vi } from "vitest";
import { readCollapsedOutline, readCollapsedPreview, writeCollapsedOutline, writeCollapsedPreview } from "../../apps/desktop/src/renderer/collapseState.js";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import { buildPreviewRenderIndex } from "../../apps/desktop/src/renderer/preview/renderModel.js";

function mockStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  });
}

function indexFor(source: string) {
  return buildPreviewRenderIndex(parsePreview(source, "main.tex", DEFAULT_ENVIRONMENTS).nodes);
}

afterEach(() => vi.unstubAllGlobals());

describe("collapsed document state", () => {
  it("restores a block after unrelated source shifts, but opens it when its content changes", () => {
    mockStorage();
    const original = String.raw`\section{Intro}
Text.
\begin{theorem}\label{th:one}
The claim.
\end{theorem}
`;
    const index = indexFor(original);
    const theorem = index.entries.find((entry) => entry.node.kind === "block" && entry.node.environmentId === "theorem")!;
    writeCollapsedPreview("project-a", "main.tex", index, original, new Set([theorem.id]));

    const shifted = `% preface\n${original}`;
    const shiftedIndex = indexFor(shifted);
    const shiftedTheorem = shiftedIndex.entries.find((entry) => entry.node.kind === "block" && entry.node.environmentId === "theorem")!;
    expect(readCollapsedPreview("project-a", "main.tex", shiftedIndex, shifted)).toEqual(new Set([shiftedTheorem.id]));

    const modified = shifted.replace("The claim.", "A revised claim.");
    expect(readCollapsedPreview("project-a", "main.tex", indexFor(modified), modified).size).toBe(0);
    expect(readCollapsedPreview("project-b", "main.tex", shiftedIndex, shifted).size).toBe(0);
  });

  it("keeps Outline expansion separate by project and file", () => {
    mockStorage();
    writeCollapsedOutline("project-a", "main.tex", new Set(["section:intro"]));
    expect(readCollapsedOutline("project-a", "main.tex")).toEqual(new Set(["section:intro"]));
    expect(readCollapsedOutline("project-a", "other.tex").size).toBe(0);
    expect(readCollapsedOutline("project-b", "main.tex").size).toBe(0);
  });
});
