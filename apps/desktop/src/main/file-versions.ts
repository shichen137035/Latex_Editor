/** Cheap metadata checks for open editor files; no source is read during idle polling. */
export async function readFileVersions(files: { getFileVersion(projectId: string, path: string): Promise<string> }, projectId: string, paths: string[]): Promise<Record<string, string | null>> {
  if (!Array.isArray(paths) || paths.length > 128 || paths.some(path => typeof path !== "string" || !path || path.length > 4096)) throw new Error("Invalid file version request.");
  return Object.fromEntries(await Promise.all([...new Set(paths)].map(async path => {
    try { return [path, await files.getFileVersion(projectId, path)] as const; }
    catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOENT" || code === "FILE_NOT_FOUND") return [path, null] as const;
      throw error;
    }
  })));
}
