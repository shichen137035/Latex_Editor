import { describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectImageService } from "../../apps/desktop/src/main/images.js";
import { createDocumentInsertions } from "../../apps/desktop/src/renderer/workbench/documentInsertions.js";

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
    resolveFilePath.mockClear();
    expect((await service.resolve("p", "chapters/main.tex", "../../outside.png")).exists).toBe(false);
    expect(resolveFilePath).not.toHaveBeenCalled();
  } finally { await unlink(image); await rmdir(root); }
});
