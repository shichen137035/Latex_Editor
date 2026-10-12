import { afterEach, describe, expect, it, vi } from "vitest";
import { readCollapsedOutline, readCollapsedPreview, readExpandedFileTree, writeCollapsedOutline, writeCollapsedPreview, writeExpandedFileTree, releaseCollapseStateCache, collapseStateCacheStats } from "../../apps/desktop/src/renderer/collapseState.js";
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
  it("bounds cached files and reclaims project memory while preserving stored choices", () => {
    mockStorage();
    for (let index = 0; index < 500; index++) writeCollapsedOutline("long-running-project", `file-${index}.tex`, new Set(["section"]));
    expect(collapseStateCacheStats().entries).toBeLessThanOrEqual(128);
    expect(collapseStateCacheStats().characters).toBeLessThanOrEqual(2 * 1024 * 1024);
    releaseCollapseStateCache("long-running-project");
    expect(readCollapsedOutline("long-running-project", "file-0.tex")).toEqual(new Set(["section"]));
    releaseCollapseStateCache("long-running-project");
  });
  it("starts folders closed, persists expansion across reloads and isolates projects", async () => {
    mockStorage();
    expect(readExpandedFileTree("tree-project-a").size).toBe(0);
    writeExpandedFileTree("tree-project-a", new Set(["chapters", "chapters/nested"]));
    // A fresh module has no in-memory cache and must restore from disk storage.
    vi.resetModules();
    const restored = await import("../../apps/desktop/src/renderer/collapseState.js");
    expect(restored.readExpandedFileTree("tree-project-a")).toEqual(new Set(["chapters", "chapters/nested"]));
    expect(restored.readExpandedFileTree("tree-project-b").size).toBe(0);
    expect(restored.readExpandedFileTree("tree-project-a").has("new-folder")).toBe(false);
    restored.writeExpandedFileTree("tree-project-a", new Set());
    vi.resetModules();
    expect((await import("../../apps/desktop/src/renderer/collapseState.js")).readExpandedFileTree("tree-project-a").size).toBe(0);
  });

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
