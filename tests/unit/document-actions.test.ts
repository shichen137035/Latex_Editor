import { describe, expect, it, vi } from "vitest";
import type { CompileResult } from "@latex-editor/contracts";
import { createDocumentActions } from "../../apps/desktop/src/renderer/workbench/documentActions.js";

function setup() {
  const result: CompileResult & { pdfDataUrl?: string } = { compilationId: "run", status: "succeeded", exitCode: 0, mainFile: "main.tex", startedAt: "2026-01-01", finishedAt: "2026-01-01", durationMs: 1, diagnostics: [], stdoutTail: "", stderrTail: "", pdfDataUrl: "new PDF" };
  const run = vi.fn(async () => result);
  const saveAll = vi.fn(async () => undefined);
  const options = { api: { compile: { run } }, project: { id: "project", mainFile: "main.tex" }, activePath: "main.tex", tree: [], compileState: "idle", guard: { busy: false, alive: true }, saveAll, saveActive: vi.fn(), setCompileState: vi.fn(), setCompileResult: vi.fn(), setPdfDataUrl: vi.fn(), setLayout: vi.fn(), setBottomTab: vi.fn(), setBottomVisible: vi.fn(), onCompileBatch: vi.fn(), onPdfReady: vi.fn(), onIdle: vi.fn() } as unknown as Parameters<typeof createDocumentActions>[0];
  return { options, run, saveAll, result, actions: createDocumentActions(options) };
}
describe("project compilation actions", () => {
  it("saves once, compiles main then the selected TeX, and displays only the selected result", async () => {
    const test = setup(); test.options.activePath = "supplement/main.tex";
    const secondary = { ...test.result, mainFile: test.options.activePath, pdfDataUrl: "supplement PDF" };
    test.run.mockResolvedValueOnce(test.result).mockResolvedValueOnce(secondary);
    await test.actions.compile();
    expect(test.saveAll).toHaveBeenCalledOnce();
    expect(test.run.mock.calls).toEqual([["project", "main.tex"], ["project", "supplement/main.tex"]]);
    expect(test.options.onCompileBatch).toHaveBeenCalledWith([test.result, secondary]);
    expect(test.options.setPdfDataUrl).toHaveBeenCalledExactlyOnceWith("supplement PDF");
    expect(test.options.onPdfReady).toHaveBeenCalledWith(secondary);
    expect(test.options.project.mainFile).toBe("main.tex");
  });
  it.each(["references.bib", "diagram.png", "main.tex", undefined])("compiles only main when selecting %s", async path => {
    const test = setup(); test.options.activePath = path;
    await test.actions.compile();
    expect(test.run).toHaveBeenCalledExactlyOnceWith("project", "main.tex");
  });
  it.each(["failure", "exception"])("continues to the secondary document after main %s, retaining both results", async kind => {
    const test = setup(); test.options.activePath = "other.tex";
    const secondary = { ...test.result, mainFile: "other.tex", pdfDataUrl: "other PDF" };
    if (kind === "exception") test.run.mockRejectedValueOnce(new Error("main missing resource"));
    else test.run.mockResolvedValueOnce({ ...test.result, status: "failed" });
    test.run.mockResolvedValueOnce(secondary);
    await test.actions.compile();
    expect(test.options.onCompileBatch).toHaveBeenCalledWith([expect.objectContaining({ mainFile: "main.tex", status: "failed" }), secondary]);
    expect(test.options.setBottomVisible).toHaveBeenCalledWith(true);
    expect(test.options.setPdfDataUrl).toHaveBeenCalledWith("other PDF");
  });
  it("does not replace the displayed PDF with main when the selected document fails", async () => {
    const test = setup(); test.options.activePath = "fragment.tex";
    test.run.mockResolvedValueOnce(test.result).mockResolvedValueOnce({ ...test.result, mainFile: "fragment.tex", status: "failed" });
    await test.actions.compile();
    expect(test.run).toHaveBeenCalledTimes(2);
    expect(test.options.setPdfDataUrl).not.toHaveBeenCalled();
    expect(test.options.onPdfReady).not.toHaveBeenCalled();
    expect(test.options.setBottomVisible).toHaveBeenCalledWith(true);
  });
  it("stops the batch when cancelled instead of starting another document", async () => {
    const test = setup(); test.options.activePath = "other.tex";
    test.run.mockResolvedValueOnce({ ...test.result, status: "cancelled" });
    await test.actions.compile();
    expect(test.run).toHaveBeenCalledOnce();
    expect(test.options.setPdfDataUrl).not.toHaveBeenCalled();
  });
  it("shows the compiled document in both single and split layouts", async () => {
    const test = setup();
    await test.actions.compile();
    const update = vi.mocked(test.options.setLayout).mock.calls[0]![0];
    if (typeof update !== "function") throw new Error("Expected a layout updater");
    expect(update({ mode: "single", singlePane: "source" } as never)).toMatchObject({ mode: "single", singlePane: "pdf" });
    expect(update({ mode: "split", leftPane: "preview", rightPane: "preview" } as never)).toMatchObject({ mode: "split", leftPane: "preview", rightPane: "pdf" });
  });
  it("saves all files and serializes repeated requests even during saving", async () => {
    const test = setup();
    let finish!: () => void;
    test.saveAll.mockImplementationOnce(() => new Promise(done => { finish = done; }));
    const pending = test.actions.compile();
    await test.actions.compile();
    expect(test.saveAll).toHaveBeenCalledOnce();
    expect(test.run).not.toHaveBeenCalled();
    finish(); await pending;
    expect(test.run).toHaveBeenCalledOnce();
    expect(test.options.setPdfDataUrl).toHaveBeenCalledWith("new PDF");
    expect(test.options.onIdle).toHaveBeenCalledOnce();
  });
  it("preserves the last good PDF when the build fails", async () => {
    const test = setup(); test.result.status = "failed"; test.result.pdfDataUrl = "old PDF returned by the tool";
    await test.actions.compile();
    expect(test.options.setPdfDataUrl).not.toHaveBeenCalled();
    expect(test.options.setBottomVisible).toHaveBeenCalledWith(true);
  });
  it("reports save failures and releases the compile gate", async () => {
    const test = setup(); test.saveAll.mockRejectedValueOnce(new Error("Disk full"));
    await test.actions.compile();
    expect(test.run).not.toHaveBeenCalled();
    expect(test.options.setCompileResult).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", diagnostics: [expect.objectContaining({ message: "Disk full" })] }));
    expect(test.options.guard?.busy).toBe(false);
  });
  it.each(["closed", "main changed"])("discards a result when the project is %s", async reason => {
    const test = setup();
    test.options.activePath = "other.tex";
    let finish!: (result: typeof test.result) => void;
    test.run.mockImplementationOnce(() => new Promise(done => { finish = done; }));
    const pending = test.actions.compile();
    await Promise.resolve();
    if (reason === "closed") test.options.guard!.alive = false;
    else test.options.isCurrent = () => false;
    finish(test.result); await pending;
    expect(test.options.setPdfDataUrl).not.toHaveBeenCalled();
    expect(test.options.setCompileResult).not.toHaveBeenCalled();
    expect(test.run).toHaveBeenCalledOnce();
  });
});
