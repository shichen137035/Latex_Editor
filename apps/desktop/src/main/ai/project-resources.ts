import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectTreeNode } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import { isAIEditableProjectPath } from "@latex-editor/contracts/ai-paths";
import { isSnapshotTextPath, isWorkspaceAssetPath, MAX_WORKSPACE_ASSET_BYTES, MAX_WORKSPACE_ASSET_COUNT, MAX_WORKSPACE_ASSET_TOTAL_BYTES, safeRelativePath } from "./workspaceFiles.js";

// Compiler byproducts must not reintroduce stale bibliography/build state.
const isResourcePath = (path: string) => isAIEditableProjectPath(path)
  && (isWorkspaceAssetPath(path) || !isSnapshotTextPath(path))
  && !/\.(?:aux|bbl|blg|log|fls|fdb_latexmk|synctex(?:\.gz)?|toc|out|nav|snm|vrb|bcf|run\.xml)$/i.test(path);

export type ProjectResourceAccess = {
  resolveFilePath(projectId: string, path: string, mustExist?: boolean): Promise<string>;
  listTree?(projectId: string): Promise<ProjectTreeNode[]>;
};
export const flattenProjectFiles = (nodes: ProjectTreeNode[]): string[] => nodes.flatMap(node => node.kind === "file" ? [node.relativePath] : flattenProjectFiles(node.children ?? []));

/** Inspect the real project separately from its deliberately partial AI working copy. */
export function createProjectResources(files: ProjectResourceAccess, projectId: string, workspaceRoot: string) {
  let queue = Promise.resolve();
  const projectPaths = async () => flattenProjectFiles(await files.listTree?.(projectId) ?? []).filter(isAIEditableProjectPath);
  const workspaceFiles = async () => {
    const entries = new Map<string, number>();
    const walk = async (directory: string, prefix = "") => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!isAIEditableProjectPath(path) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(join(directory, entry.name), path);
        else if (entry.isFile()) entries.set(path, (await lstat(join(directory, entry.name))).size);
      }
    };
    await walk(workspaceRoot);
    return entries;
  };
  const list = async (input: Record<string, unknown> = {}) => {
    const [project, workspace] = await Promise.all([projectPaths(), workspaceFiles()]);
    const query = typeof input.query === "string" ? input.query.toLowerCase() : "";
    const paths = [...new Set([...project, ...workspace.keys()])].filter(path => path.toLowerCase().includes(query)).sort();
    const offset = typeof input.offset === "number" && Number.isInteger(input.offset) ? Math.max(0, input.offset) : 0;
    const limit = typeof input.limit === "number" && Number.isInteger(input.limit) ? Math.max(1, Math.min(200, input.limit)) : 100;
    const original = new Set(project);
    return { total: paths.length, files: paths.slice(offset, offset + limit).map(path => ({ path, inProject: original.has(path), inWorkingCopy: workspace.has(path), canMaterialize: isResourcePath(path), ...(workspace.has(path) ? { size: workspace.get(path) } : {}) })), nextOffset: offset + limit < paths.length ? offset + limit : null };
  };
  const materialize = (paths: string[]) => {
    const run = async () => {
      if (!Array.isArray(paths) || paths.length > MAX_WORKSPACE_ASSET_COUNT || paths.some(path => typeof path !== "string")) throw new Error("Supply at most 200 project-relative resource paths.");
      const [project, workspace] = await Promise.all([projectPaths(), workspaceFiles()]);
      const available = new Set(project);
      const existingAssets = [...workspace].filter(([path]) => isResourcePath(path));
      let count = existingAssets.length, total = existingAssets.reduce((sum, [, size]) => sum + size, 0);
      const copied: string[] = [], existing: string[] = [], failures: Array<{ path: string; reason: string }> = [];
      for (const path of [...new Set(paths)]) {
        try {
          const relative = safeRelativePath(path);
          if (!isResourcePath(relative)) throw new Error("Source files are supplied by the editable snapshot; compiler byproducts cannot be imported as resources.");
          if (workspace.has(relative)) { existing.push(relative); continue; }
          if (!available.has(relative)) throw new Error("Resource is not present in the project file inventory.");
          const source = await files.resolveFilePath(projectId, relative, true);
          const info = await lstat(source);
          if (!info.isFile() || info.isSymbolicLink()) throw new Error("Resource must be a regular project file.");
          if (info.size > MAX_WORKSPACE_ASSET_BYTES || total + info.size > MAX_WORKSPACE_ASSET_TOTAL_BYTES || count >= MAX_WORKSPACE_ASSET_COUNT) throw new Error("Working copy resource limit reached (20 MB per file, 50 MB / 200 files total).");
          const bytes = await readFile(source);
          if (bytes.length > MAX_WORKSPACE_ASSET_BYTES || total + bytes.length > MAX_WORKSPACE_ASSET_TOTAL_BYTES) throw new Error("Resource grew beyond the working copy limit.");
          const target = await ensureWorkspaceParent(workspaceRoot, relative);
          await writeFile(target, bytes, { flag: "wx" });
          total += bytes.length; count++; copied.push(relative);
        } catch (error) { failures.push({ path, reason: error instanceof Error ? error.message : String(error) }); }
      }
      return { copied, existing, failures };
    };
    const result = queue.then(run);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };
  const dynamicTools = [
    { name: "texweave_list_project_files", description: "Search all actual project files, including resources not yet referenced or copied to the working copy. Check this inventory before claiming a resource is missing. Results distinguish original project files from working-copy files; use nextOffset to page.", inputSchema: { type: "object", properties: { query: { type: "string", description: "Case-insensitive path substring, e.g. angle or .png; omit to list all files." }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 200 } }, additionalProperties: false } },
    { name: "texweave_materialize_files", description: "Copy existing project resources (images, fonts, binary data, etc.) into the AI working copy for inspection or compilation, preserving relative paths and existing edits. Source text comes from the editable snapshot; compiler byproducts are excluded. Returns per-file successes and failures. Does not modify the original project.", inputSchema: { type: "object", properties: { paths: { type: "array", items: { type: "string" }, maxItems: 200 } }, required: ["paths"], additionalProperties: false } }
  ];
  const toolHandlers: Record<string, (input: Record<string, unknown>) => Promise<string>> = {
    texweave_list_project_files: async input => JSON.stringify(await list(input)),
    texweave_materialize_files: async input => JSON.stringify(await materialize(input.paths as string[]))
  };
  return { list, materialize, projectPaths, workspaceFiles, dynamicTools, toolHandlers };
}

export async function createCopilotResourceTools(resources: ReturnType<typeof createProjectResources>) {
  const { defineTool } = await import("@github/copilot-sdk");
  return resources.dynamicTools.map(tool => defineTool<Record<string, unknown>>(tool.name, { description: tool.description, parameters: tool.inputSchema, skipPermission: true, handler: resources.toolHandlers[tool.name]! }));
}

async function ensureWorkspaceParent(root: string, relative: string): Promise<string> {
  let parent = await realpath(root);
  const parts = relative.split("/");
  for (const part of parts.slice(0, -1)) {
    parent = join(parent, part);
    try {
      const info = await lstat(parent);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Resource path crosses a symbolic link or non-directory.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(parent);
    }
  }
  return join(parent, parts.at(-1)!);
}
