import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { CompileResult } from "@latex-editor/contracts" with { "resolution-mode": "import" };

export function failedCompilation(mainFile: string, error: unknown): CompileResult {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "COMPILATION_FAILED";
  const message = code === "TOOLCHAIN_NOT_FOUND" ? "LaTeX toolchain unavailable. Open Settings > Compiler to detect or locate latexmk." : error instanceof Error ? error.message : String(error);
  const now = new Date().toISOString();
  return { compilationId: randomUUID(), status: "failed", exitCode: null, startedAt: now, finishedAt: now, durationMs: 0, mainFile, diagnostics: [{ severity: "error", source: "system", category: "build", code, message }], stdoutTail: "", stderrTail: message };
}

/** Expose an AI build without publishing its unreviewed sources or replacing the project PDF. */
export async function publishWorkspaceCompilation(projectId: string, result: CompileResult,
  files: { resolveFilePath(projectId: string, path: string, mustExist?: boolean): Promise<string> },
  emit: (update: { projectId: string; origin: "ai-workspace"; result: CompileResult & { pdfDataUrl?: string } }) => void
) {
  if (result.logPath) {
    const destination = await files.resolveFilePath(projectId, `.latex-editor/build/${result.compilationId}.log`, false);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(result.logPath, destination);
    result = { ...result, logPath: destination };
  }
  const preview = result.status === "succeeded" && result.pdfPath
    ? { ...result, pdfDataUrl: `data:application/pdf;base64,${(await readFile(result.pdfArtifactPath ?? result.pdfPath)).toString("base64")}` } : result;
  emit({ projectId, origin: "ai-workspace", result: preview });
  return result;
}
