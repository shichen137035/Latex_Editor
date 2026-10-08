import type { EnvironmentDefinition } from "@latex-editor/editor-core/preview/types";
import type { IdGenerator } from "@latex-editor/domain";
import type { PreviewDirectiveDefinition } from "@latex-editor/contracts";
import { ProjectBlockGraphService } from "./block-graph-service.js";
import { ProjectDocumentStructureService, type DocumentStructureFilePort } from "./document-structure-service.js";
import { ProjectRelationService } from "./relation-service.js";
import { ProjectCacheReclamationManager } from "./project-cache-reclamation.js";

export interface ProjectBlockServices {
  /** Owns canonical metadata persistence, per-project serialization, and graph history. */
  blockGraph: ProjectBlockGraphService;
  /** Derives source-backed document blocks and updates the shared graph metadata. */
  structure: ProjectDocumentStructureService;
  /** Stores logical relations through the same graph transaction boundary. */
  relations: ProjectRelationService;
  /** Reclaims every registered project-scoped in-memory cache. */
  cacheReclamation: ProjectCacheReclamationManager;
}

/**
 * Compose one shared project block model. Keeping these services distinct
 * preserves their responsibilities while preventing duplicate mutation locks
 * and histories for the same project.
 */
export function createProjectBlockServices(options: {
  files: DocumentStructureFilePort;
  ids: IdGenerator;
  definitions?: (projectId: string) => Promise<EnvironmentDefinition[]>;
  directives?: (projectId: string) => Promise<PreviewDirectiveDefinition[]>;
  now?: () => number;
}): ProjectBlockServices {
  const cacheReclamation = new ProjectCacheReclamationManager();
  const blockGraph = new ProjectBlockGraphService(options.files, options.ids, cacheReclamation);
  const structure = new ProjectDocumentStructureService(options.files, blockGraph, options.ids, options.definitions, options.directives);
  cacheReclamation.register("block-graph", projectId => blockGraph.releaseProjectCache(projectId));
  cacheReclamation.register("document-structure", projectId => structure.releaseProjectCache(projectId));
  const relations = new ProjectRelationService(blockGraph, options.ids, options.now);
  return { blockGraph, structure, relations, cacheReclamation };
}
