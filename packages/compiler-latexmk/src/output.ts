import { createHash } from "node:crypto";
import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

function targetId(mainFile: string): string {
  const identity = mainFile.replaceAll("\\", "/").replace(/^\.\//, "");
  return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

/** Secondary documents keep their PDF/auxiliary files separate even when basenames coincide. */
export function documentOutputDirectory(root: string, mainFile: string, projectMain?: string): string {
  const path = resolve(root, mainFile), primary = projectMain ? resolve(root, projectMain) : path;
  const same = process.platform === "win32" ? path.toLowerCase() === primary.toLowerCase() : path === primary;
  if (same) return root;
  return resolve(root, ".texweave/build/targets", targetId(mainFile));
}

/** Remove isolated build outputs whose TeX source has been deleted or renamed. */
export async function pruneStaleDocumentOutputs(root: string, sourceFiles: string[]): Promise<void> {
  const targetRoot = resolve(root, ".texweave", "build", "targets");
  let rootReal: string, targetReal: string, metadata;
  try {
    [rootReal, metadata] = await Promise.all([realpath(root), lstat(targetRoot)]);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return;
    targetReal = await realpath(targetRoot);
  } catch { return; }
  const targetRelative = relative(rootReal, targetReal);
  if (targetRelative === ".." || targetRelative.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(targetRelative)) return;
  const retained = new Set(sourceFiles.map(targetId));
  for (const entry of await readdir(targetReal, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{16}$/i.test(entry.name) || retained.has(entry.name.toLowerCase())) continue;
    const candidate = resolve(targetReal, entry.name);
    if (relative(targetReal, candidate) !== entry.name) continue;
    try { await rm(candidate, { recursive: true, force: true }); } catch { /* Cache cleanup must not block PDF discovery. */ }
  }
}

export function targetOutputArguments(args: string[], directory: string): string[] {
  const flags = ["-outdir", "--outdir", "-output-directory", "--output-directory", "-auxdir", "--auxdir", "-aux-directory", "--aux-directory"];
  const kept: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (flags.includes(argument.toLowerCase())) { index++; continue; }
    if (flags.some(flag => argument.toLowerCase().startsWith(flag + "="))) continue;
    kept.push(argument);
  }
  return [...kept, `-outdir=${directory}`];
}
