import { lstat, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import type { Project } from "@latex-editor/contracts" with { "resolution-mode": "import" };

function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return Boolean(rel && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** Only the owned build directory is disposable; structure, settings, snapshots and sources are persistent data. */
export async function clearRegisteredProjectCaches(projects: Project[], hooks: {
  release(projectId: string): Promise<void>;
  clearBrowserCache(): Promise<void>;
  clearRegistry(): void;
}): Promise<void> {
  const targets: string[] = [];
  // Validate every project before removing anything. Linked metadata must never redirect cleanup elsewhere.
  for (const project of projects) {
    try {
      const root = await realpath(project.canonicalPath);
      const metadata = join(root, ".texweave"), build = join(metadata, "build");
      for (const path of [metadata, build]) {
        const info = await lstat(path);
        if (info.isSymbolicLink() || !info.isDirectory() || !contained(root, await realpath(path))) throw new Error("Refusing to clear linked or invalid project cache directories.");
      }
      targets.push(build);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const project of projects) await hooks.release(project.id);
  for (const target of new Set(targets)) await rm(target, { recursive: true, force: true });
  await hooks.clearBrowserCache();
  // A cleanup failure leaves registrations available so the user can fix the issue and retry.
  hooks.clearRegistry();
}
