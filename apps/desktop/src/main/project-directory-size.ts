import { opendir, lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { ProjectDirectorySize } from "@latex-editor/contracts/desktop-ipc";

/** Metadata-only scan, including build/history files; never follow links outside the project. */
export async function projectDirectorySize(path: string): Promise<ProjectDirectorySize> {
  const root = await realpath(path);
  const directories = [root];
  const result: ProjectDirectorySize = { bytes: 0, fileCount: 0, partial: false };
  while (directories.length) {
    const directory = directories.pop()!;
    try {
      if ((await lstat(directory)).isSymbolicLink()) continue;
      const resolved = await realpath(directory);
      const inside = relative(root, resolved);
      if (inside === ".." || inside.startsWith("../") || inside.startsWith("..\\") || isAbsolute(inside)) { result.partial = true; continue; }
      for await (const entry of await opendir(directory)) {
        if (entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        try {
          // lstat also protects against an entry being replaced by a link during the scan.
          const info = await lstat(path);
          if (info.isSymbolicLink()) continue;
          if (info.isDirectory()) directories.push(path);
          else if (info.isFile()) { result.bytes += info.size; result.fileCount++; }
        } catch { result.partial = true; }
      }
    } catch { result.partial = true; }
  }
  return result;
}
