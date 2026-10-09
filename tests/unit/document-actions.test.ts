import { describe, expect, it, vi } from "vitest";
import type { CompileResult } from "@latex-editor/contracts";
import { createDocumentActions } from "../../apps/desktop/src/renderer/workbench/documentActions.js";

function setup() {
  const result: CompileResult & { pdfDataUrl?: string } = { compilationId: "run", status: "succeeded", exitCode: 0, mainFile: "main.tex", startedAt: "2026-01-01", finishedAt: "2026-01-01", durationMs: 1, diagnostics: [], stdoutTail: "", stderrTail: "", pdfDataUrl: "new PDF" };
  const run = vi.fn(async () => result);
  const saveAll = vi.fn(async () => undefined);
  const options = { api: { compile: { run } }, project: { id: "project", mainFile: "main.tex" }, activePath: "chapter.tex", tree: [], compileState: "idle", guard: { busy: false, alive: true }, saveAll, saveActive: vi.fn(), setCompileState: vi.fn(), setCompileResult: vi.fn(), setPdfDataUrl: vi.fn(), setLayout: vi.fn(), setBottomTab: vi.fn(), setBottomVisible: vi.fn(), onPdfReady: vi.fn(), onIdle: vi.fn() } as unknown as Parameters<typeof createDocumentActions>[0];
  return { options, run, saveAll, result, actions: createDocumentActions(options) };
}
describe("project compilation actions", () => {
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
    let finish!: (result: typeof test.result) => void;
    test.run.mockImplementationOnce(() => new Promise(done => { finish = done; }));
    const pending = test.actions.compile();
    await Promise.resolve();
    if (reason === "closed") test.options.guard!.alive = false;
    else test.options.isCurrent = () => false;
    finish(test.result); await pending;
    expect(test.options.setPdfDataUrl).not.toHaveBeenCalled();
    expect(test.options.setCompileResult).not.toHaveBeenCalled();
  });
});
