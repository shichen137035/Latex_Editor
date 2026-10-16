import type { LatexToolchain } from "@latex-editor/contracts";

export const toolchainTools = [["pdflatex", "pdfLaTeX"], ["xelatex", "XeLaTeX"], ["lualatex", "LuaLaTeX"], ["latexmk", "latexmk"], ["bibtex", "BibTeX"], ["biber", "Biber"], ["makeindex", "MakeIndex"]] as const;
type Tool = typeof toolchainTools[number][0];
export function toolReady(toolchain: LatexToolchain | undefined, tool: Tool): boolean {
  return toolchain?.environment ? toolchain.environment[tool]?.status === "ready" : Boolean(toolchain?.[tool]);
}
export function toolchainReadiness(toolchain: LatexToolchain | undefined, engine: "pdflatex" | "xelatex" | "lualatex") {
  const required: Tool[] = ["latexmk", engine];
  const missing = required.filter(tool => !toolReady(toolchain, tool));
  const broken = toolchainTools.filter(([tool]) => toolchain?.environment?.[tool]?.status === "broken").map(([tool]) => tool);
  return { known: Boolean(toolchain), ready: Boolean(toolchain) && !missing.length, complete: toolchainTools.every(([tool]) => toolReady(toolchain, tool)), missing, broken };
}

/** Actionable guidance accompanies the original diagnostic, which stays available. */
export function toolchainRecoveryHint(error: string): "network" | "permission" | "folder" | "verification" | "runtime" | "generic" {
  if (/EACCES|EPERM|access.*denied|permission|unauthorized/i.test(error)) return "permission";
  if (/checksum|digest|verification/i.test(error)) return "verification";
  if (/fetch|download|HTTP|network|ENOTFOUND|ECONN|timed?\s*out|proxy|certificate/i.test(error)) return "network";
  if (/folder|directory|junction|symbolic|absolute|shell control/i.test(error)) return "folder";
  if (/perl|latexmk|executable|spawn/i.test(error)) return "runtime";
  return "generic";
}
