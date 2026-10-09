import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectImageService } from "../../apps/desktop/src/main/images.js";
import { createDocumentInsertions } from "../../apps/desktop/src/renderer/workbench/documentInsertions.js";
import { ProjectCacheReclamationManager } from "@latex-editor/application";

describe("image replacement", () => {
  const figure = String.raw`\begin{figure}\includegraphics[width=.4\textwidth]{figures/a.png}\includegraphics[width=.5\textwidth]{figures/b.png}\caption{Keep}\label{fig:keep}\end{figure}`;
  function controller(currentContent = figure + " newer paragraph") {
    const changed = vi.fn();
    const activeTab = { path: "chapters/main.tex", content: figure, dirty: false };
    const options = { api: {}, project: { id: "p", writable: true }, store: { get: vi.fn() }, activeTab,
      getActiveTab: () => ({ ...activeTab, content: currentContent }), setEditorContent: changed,
      imageDialog: { kind: "replace", selection: { fileId: activeTab.path, start: 0, end: figure.length, source: figure }, imageIndex: 1 },
      setFigureSelection: vi.fn(), setImageDialog: vi.fn()
    } as unknown as Parameters<typeof createDocumentInsertions>[0];
    return { options, changed, apply: createDocumentInsertions(options).applyImageChoice };
  }
  it("replaces only the selected path and retains options, captions, labels and newer unrelated text", async () => {
    const test = controller();
    await test.apply({ kind: "project", path: "figures/new.webp" });
    expect(test.changed).toHaveBeenCalledWith(figure.replace("figures/b.png", "figures/new.webp") + " newer paragraph");
  });
  it("rejects stale selections and does not modify a different matching figure", async () => {
    const test = controller(figure.replace("figures/b.png", "figures/user.png") + "\n" + figure);
    await expect(test.apply({ kind: "project", path: "figures/new.png" })).rejects.toThrow("figure changed");
    expect(test.changed).not.toHaveBeenCalled();
  });
  it("cancels replacement when the user changes files", async () => {
    const test = controller(); test.options.getActiveTab = () => undefined;
    await createDocumentInsertions(test.options).applyImageChoice({ kind: "project", path: "figures/new.png" });
    expect(test.changed).not.toHaveBeenCalled();
  });
});

it("resolves parent-relative images inside the project and never attempts paths outside it", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-image-resolve-")), image = join(root, "a.png");
  await writeFile(image, "image bytes");
  try {
    const resolveFilePath = vi.fn(async (_project: string, path: string) => {
      if (path !== "figures/chart.png") throw new Error("not found"); return image;
    });
    const service = new ProjectImageService({ resolveFilePath, listTree: vi.fn(), createDirectory: vi.fn(), importEntry: vi.fn() });
    expect(await service.resolve("p", "chapters/main.tex", "../figures/chart.png")).toMatchObject({ exists: true, resolvedPath: "figures/chart.png" });
    expect(await service.resolve("p", "main.tex", "chart", ["figures/"])).toMatchObject({ requestedPath: "chart", resolvedPath: "figures/chart.png", resolutionSource: "graphicspath" });
    resolveFilePath.mockClear();
    expect((await service.resolve("p", "chapters/main.tex", "../../outside.png")).exists).toBe(false);
    expect(resolveFilePath).not.toHaveBeenCalled();
  } finally { await unlink(image); await rmdir(root); }
});

it("bounds image caching, replaces old file versions and releases a project's entries through the cache manager", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-image-cache-"));
  const image = join(root, "a.png");
  await writeFile(image, "image bytes");
  try {
    const files = { resolveFilePath: vi.fn(async () => image), listTree: vi.fn(), createDirectory: vi.fn(), importEntry: vi.fn() };
    const reclamation = new ProjectCacheReclamationManager();
    const service = new ProjectImageService(files, { reclamation, cacheEntries: 1 });
    await service.resolve("a", "main.tex", "a.png");
    await service.resolve("b", "main.tex", "a.png");
    expect(service.cacheStats.entries).toBe(1);
    expect(reclamation.reclaimProject("a", { kind: "project-removed" })).toBe(true);
    expect(service.cacheStats.entries).toBe(1);
    const first = await service.resolve("b", "main.tex", "a.png");
    await writeFile(image, "changed image bytes with a different length");
    const updated = await service.resolve("b", "main.tex", "a.png");
    expect(updated.dataUrl).not.toBe(first.dataUrl);
    expect(service.cacheStats).toEqual({ entries: 1, characters: updated.dataUrl!.length });
    reclamation.reclaimProject("b", { kind: "editor-close", sessionId: "s" });
    expect(service.cacheStats).toEqual({ entries: 0, characters: 0 });
    const uncached = new ProjectImageService(files, { cacheCharacters: 1 });
    expect((await uncached.resolve("a", "main.tex", "a.png")).exists).toBe(true);
    expect(uncached.cacheStats.entries).toBe(0);
  } finally { await unlink(image); await rmdir(root); }
});

it("does not repopulate the cache when an in-flight image read finishes after project reclamation", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-image-cache-flight-")), image = join(root, "a.png");
  await writeFile(image, "image bytes");
  try {
    let finish!: (path: string) => void;
    const files = { resolveFilePath: vi.fn(() => new Promise<string>(resolve => { finish = resolve; })), listTree: vi.fn(), createDirectory: vi.fn(), importEntry: vi.fn() };
    const reclamation = new ProjectCacheReclamationManager(), service = new ProjectImageService(files, { reclamation });
    const pending = service.resolve("p", "main.tex", "a.png");
    reclamation.reclaimProject("p", { kind: "project-removed" });
    finish(image);
    expect((await pending).exists).toBe(true);
    expect(service.cacheStats).toEqual({ entries: 0, characters: 0 });
  } finally { await unlink(image); await rmdir(root); }
});
