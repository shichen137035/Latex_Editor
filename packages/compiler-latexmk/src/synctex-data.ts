import { stat } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

export interface SyncTexData { state: "ready" | "missing" | "stale"; path?: string; directory?: string; }

/** A PDF and its SyncTeX sidecar are one build result, including separate aux directories. */
export async function findSyncTexData(pdfPath: string, directories: string[] = []): Promise<SyncTexData> {
  const pdf = await stat(pdfPath).catch(() => undefined);
  if (!pdf?.isFile()) return { state: "missing" };
  const job = basename(pdfPath, extname(pdfPath));
  const found: Array<{ path: string; directory: string; modified: number }> = [];
  for (const directory of [...new Set([dirname(pdfPath), ...directories].map(value => resolve(value)))]) {
    for (const suffix of [".synctex.gz", ".synctex"]) {
      const path = resolve(directory, job + suffix), file = await stat(path).catch(() => undefined);
      if (file?.isFile() && file.size > 0) found.push({ path, directory, modified: file.mtimeMs });
    }
  }
  // File-system timestamp resolution varies. Prefer the sidecar nearest the PDF's build time.
  found.sort((a, b) => Math.abs(a.modified - pdf.mtimeMs) - Math.abs(b.modified - pdf.mtimeMs));
  const best = found[0];
  return best ? { state: Math.abs(best.modified - pdf.mtimeMs) <= 2000 ? "ready" : "stale", path: best.path, directory: best.directory } : { state: "missing" };
}

export function syncTexDirectories(root: string, mainFile?: string, args: string[] = []): string[] {
  const directories = [root, ...(mainFile ? [dirname(resolve(root, mainFile))] : []), resolve(root, "build"), resolve(root, "out"), resolve(root, ".latex-editor/build")];
  const flags = ["-outdir", "--outdir", "-output-directory", "--output-directory", "-auxdir", "--auxdir", "-aux-directory", "--aux-directory"];
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!, flag = flags.find(flag => argument.toLowerCase().startsWith(flag + "="));
    const value = flag ? argument.slice(flag.length + 1) : flags.includes(argument.toLowerCase()) ? args[++index] : undefined;
    if (value) directories.push(resolve(root, value));
  }
  return [...new Set(directories)].filter(directory => { const path = relative(root, directory); return path !== ".." && !path.startsWith(".." + sep) && !/^(?:[A-Za-z]:|[/\\])/.test(path); });
}
