import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { CompileResult } from "@latex-editor/contracts";
import { failedCompilation, publishWorkspaceCompilation } from "../../apps/desktop/src/main/compile-preview.js";

it("publishes the immutable AI PDF and readable log without overwriting project output", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-compile-preview-"));
  try {
    const artifact = join(root, "artifact.pdf"), latest = join(root, "latest.pdf"), log = join(root, "scratch.log"), projectPdf = join(root, "project.pdf");
    await writeFile(artifact, "AI PDF"); await writeFile(latest, "later PDF"); await writeFile(log, "compiler details"); await writeFile(projectPdf, "old project PDF");
    const result: CompileResult = { compilationId: "build", status: "succeeded", exitCode: 0, mainFile: "main.tex", startedAt: "", finishedAt: "", durationMs: 1, diagnostics: [], stdoutTail: "", stderrTail: "", pdfPath: latest, pdfArtifactPath: artifact, logPath: log };
    const emit = vi.fn();
    const published = await publishWorkspaceCompilation("project", result, { resolveFilePath: async (_id, path) => join(root, path) }, emit);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ projectId: "project", origin: "ai-workspace", result: expect.objectContaining({ pdfDataUrl: `data:application/pdf;base64,${Buffer.from("AI PDF").toString("base64")}` }) }));
    expect(await readFile(published.logPath!, "utf8")).toBe("compiler details");
    expect(await readFile(projectPdf, "utf8")).toBe("old project PDF");
  } finally { await rm(root, { recursive: true, force: true }); }
});
it("never publishes an old PDF from a failed AI build", async () => {
  const emit = vi.fn();
  const result = { status: "failed", pdfPath: "old.pdf" } as CompileResult;
  await publishWorkspaceCompilation("project", result, {} as never, emit);
  expect(emit.mock.calls[0]![0].result.pdfDataUrl).toBeUndefined();
  expect(failedCompilation("chapter.tex", new Error("Disk full"))).toMatchObject({ status: "failed", mainFile: "chapter.tex", diagnostics: [expect.objectContaining({ code: "COMPILATION_FAILED", message: "Disk full" })] });
});
