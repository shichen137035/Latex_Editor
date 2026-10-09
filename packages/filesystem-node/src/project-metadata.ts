import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rename, rmdir } from "node:fs/promises";
import { join } from "node:path";

const pending = new Map<string, Promise<void>>();
async function inspect(path: string) {
  try { return await lstat(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
async function validateTree(path: string): Promise<void> {
  const info = await inspect(path);
  if (!info) return;
  if (info.isSymbolicLink()) throw new Error("Linked project metadata cannot be consolidated");
  if (info.isDirectory()) for (const name of await readdir(path)) await validateTree(join(path, name));
}

/** One-way consolidation of the old build store; no legacy read/write fallback remains. */
export async function consolidateProjectMetadata(rootPath: string): Promise<void> {
  const root = await realpath(rootPath);
  const previous = pending.get(root) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    const old = join(root, ".latex-editor");
    if (!await inspect(old)) return;
    const destination = join(root, ".texweave");
    await validateTree(old);
    const destinationInfo = await inspect(destination);
    if (destinationInfo && (destinationInfo.isSymbolicLink() || !destinationInfo.isDirectory())) throw new Error("Invalid project metadata directory");
    const merge = async (source: string, target: string): Promise<void> => {
      const sourceInfo = await lstat(source), targetInfo = await inspect(target);
      if (!targetInfo) { await rename(source, target); return; }
      if (targetInfo.isSymbolicLink()) throw new Error("Linked project metadata cannot be consolidated");
      if (sourceInfo.isDirectory() && targetInfo.isDirectory()) {
        for (const name of await readdir(source)) await merge(join(source, name), join(target, name));
        await rmdir(source);
      } else {
        // Preserve both files, including conflicting logs or PDFs.
        await rename(source, `${target}.imported-${randomUUID()}`);
      }
    };
    await mkdir(destination, { recursive: true });
    for (const name of await readdir(old)) await merge(join(old, name), join(destination, name));
    await rmdir(old);
  });
  pending.set(root, next);
  try { await next; } finally { if (pending.get(root) === next) pending.delete(root); }
}
