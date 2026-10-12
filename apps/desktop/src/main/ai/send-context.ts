import { readFile, stat } from "node:fs/promises";
import type { AIContextSnapshotFile, ProjectTreeNode } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import { collectGraphicDependencies } from "../graphic-dependencies.js";
import { isSnapshotTextPath, MAX_WORKSPACE_ASSET_BYTES, MAX_WORKSPACE_ASSET_COUNT, MAX_WORKSPACE_ASSET_TOTAL_BYTES } from "./workspaceFiles.js";

type Files = {
  listTree(projectId: string): Promise<ProjectTreeNode[]>;
  readText(projectId: string, path: string): Promise<{ content: string }>;
  resolveFilePath(projectId: string, path: string, mustExist?: boolean): Promise<string>;
};

/** Capture the project when a queued message actually starts, not while it waits. */
export async function prepareAISendContext(files: Files, projectId: string | undefined, overrides: AIContextSnapshotFile[] = []) {
  if (!projectId) return {};
  const collect = (nodes: ProjectTreeNode[]): string[] => nodes.flatMap(node => node.kind === "file" ? [node.relativePath] : node.children ? collect(node.children) : []);
  const projectPaths = collect(await files.listTree(projectId));
  let snapshot = await Promise.all(projectPaths.filter(isSnapshotTextPath).map(async path => ({ path, content: (await files.readText(projectId, path)).content })));
  const overrideMap = new Map(overrides.map(file => [file.path.replaceAll("\\", "/"), file.content]));
  snapshot = snapshot.map(file => overrideMap.has(file.path) ? { ...file, content: overrideMap.get(file.path)! } : file);
  for (const [path, content] of overrideMap) if (!snapshot.some(file => file.path === path)) snapshot.push({ path, content });
  const graphics = collectGraphicDependencies(snapshot, projectPaths);
  const assets: Array<{ path: string; content: Uint8Array }> = [];
  let omittedAssets = 0, assetBytes = 0;
  for (const path of graphics.resolved) {
    if (assets.length >= MAX_WORKSPACE_ASSET_COUNT) { omittedAssets++; continue; }
    const absolute = await files.resolveFilePath(projectId, path, true);
    const metadata = await stat(absolute);
    if (!metadata.isFile() || metadata.size > MAX_WORKSPACE_ASSET_BYTES || assetBytes + metadata.size > MAX_WORKSPACE_ASSET_TOTAL_BYTES) { omittedAssets++; continue; }
    const content = await readFile(absolute);
    assets.push({ path, content }); assetBytes += content.byteLength;
  }
  return { snapshot, assets, omittedAssets, unresolvedGraphics: graphics.unresolved, projectPaths };
}
