import { randomUUID } from "node:crypto";
import type { Project, PreviewDirectiveDefinition } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { EnvironmentDefinition } from "@latex-editor/editor-core/preview/types" with { "resolution-mode": "import" };

/** Same checked file service as the app, with its root pointed at the review copy. */
export async function createWorkspaceBlockApi(project: Project, workspaceRoot: string, definitions: () => Promise<EnvironmentDefinition[]> = async () => [], directives?: () => Promise<PreviewDirectiveDefinition[]>) {
  const [{ ProjectBlockGraphService, ProjectDocumentStructureService }, { NodeProjectFileService }] = await Promise.all([import("@latex-editor/application"), import("@latex-editor/filesystem-node")]);
  const files = new NodeProjectFileService({ getProject: () => ({ ...project, canonicalPath: workspaceRoot, writable: true, missing: false }), touchEditedAt: () => undefined });
  const graph = new ProjectBlockGraphService(files, { next: randomUUID });
  return new ProjectDocumentStructureService(files, graph, { next: randomUUID }, definitions, directives).api(project.id);
}
