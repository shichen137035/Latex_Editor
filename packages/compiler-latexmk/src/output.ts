import { createHash } from "node:crypto";
import { resolve } from "node:path";

/** Secondary documents keep their PDF/auxiliary files separate even when basenames coincide. */
export function documentOutputDirectory(root: string, mainFile: string, projectMain?: string): string {
  const path = resolve(root, mainFile), primary = projectMain ? resolve(root, projectMain) : path;
  const same = process.platform === "win32" ? path.toLowerCase() === primary.toLowerCase() : path === primary;
  if (same) return root;
  const identity = mainFile.replaceAll("\\", "/").replace(/^\.\//, "");
  return resolve(root, ".texweave/build/targets", createHash("sha256").update(identity).digest("hex").slice(0, 16));
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
