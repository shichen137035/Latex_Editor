import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ProjectService } from "../../packages/application/src/index.js";
import { systemClock, type Clock, type IdGenerator } from "../../packages/domain/src/index.js";
import { NodeProjectEnvironment, NodeProjectFileService } from "../../packages/filesystem-node/src/index.js";
import { SQLiteProjectRegistry } from "../../packages/registry-sqlite/src/index.js";
import { FileResourceCatalog } from "../../packages/resource-catalog/src/index.js";

export interface TestBackend {
  root: string;
  registry: SQLiteProjectRegistry;
  projects: ProjectService;
  files: NodeProjectFileService;
  resources: FileResourceCatalog;
  cleanup(): Promise<void>;
}

export async function createTestBackend(options?: { clock?: Clock; ids?: IdGenerator }): Promise<TestBackend> {
  const root = await mkdtemp(resolve(tmpdir(), "latex-editor-test-"));
  const registry = new SQLiteProjectRegistry(resolve(root, "registry.sqlite"));
  registry.initialize();
  const resources = new FileResourceCatalog(resolve(process.cwd(), "resources"));
  await resources.reload();
  const projects = new ProjectService({
    registry,
    environment: new NodeProjectEnvironment(),
    templates: resources,
    clock: options?.clock ?? systemClock,
    ids: options?.ids ?? { next: randomUUID }
  });
  const files = new NodeProjectFileService(projects);
  return {
    root,
    registry,
    projects,
    files,
    resources,
    async cleanup() {
      registry.close();
      await rm(root, { recursive: true, force: true });
    }
  };
}
