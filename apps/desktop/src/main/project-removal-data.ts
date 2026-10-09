import { lstat, readdir, realpath, rm } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import type { ProjectHistoryService } from "./project-history.js";

/** Only TeXWeave-owned metadata is eligible; source files and root build outputs stay intact. */
export async function removeProjectData(rootPath: string, projectId: string, retention: "versions" | "none", history: ProjectHistoryService): Promise<void> {
  const { consolidateProjectMetadata } = await import("@latex-editor/filesystem-node");
  await consolidateProjectMetadata(rootPath);
  const root = await realpath(rootPath);
  const metadata = join(root, ".texweave");
  try {
    const info = await lstat(metadata);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Refusing to clean a linked or invalid .texweave directory");
    const actual = await realpath(metadata), path = relative(root, actual);
    if (!path || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error("Project metadata is outside the project");
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (retention === "versions") {
    const historyPath = join(metadata, "history");
    try {
      const info = await lstat(historyPath);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Refusing to clean a linked or invalid history directory");
      // Reject linked history stores before opening SQLite or traversing their objects.
      for (const name of ["history.db", "objects", "manifests"]) {
        try { if ((await lstat(join(historyPath, name))).isSymbolicLink()) throw new Error("Linked history data cannot be cleaned"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      await history.retainVersions(projectId);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    for (const entry of await readdir(metadata)) if (entry !== "history") await rm(join(metadata, entry), { recursive: true, force: true });
  } else await rm(metadata, { recursive: true, force: true });
}
