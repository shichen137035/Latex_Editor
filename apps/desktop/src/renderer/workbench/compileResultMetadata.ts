import type { CompileResult } from "@latex-editor/contracts";

/** Diagnostics retain paths and text; only the active PDF viewer retains its bytes. */
export function compileResultMetadata(result: CompileResult & { pdfDataUrl?: string | undefined }): CompileResult {
  if (!("pdfDataUrl" in result)) return result;
  const metadata = { ...result };
  delete metadata.pdfDataUrl;
  return metadata;
}
