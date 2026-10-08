export type ProjectCacheReleaser = (projectId: string) => void;
export type ProjectCacheReclamationReason =
  | { kind: "editor-close"; sessionId: string }
  | { kind: "project-removed" }
  | { kind: "shutdown" };
export type ProjectCacheReleaseGuard = (projectId: string, reason: ProjectCacheReclamationReason) => boolean;

/** Coordinates disposal of in-memory, project-scoped caches across services. */
export class ProjectCacheReclamationManager {
  readonly #releasers = new Map<string, { release: ProjectCacheReleaser; canRelease: ProjectCacheReleaseGuard }>();
  readonly #projects = new Set<string>();

  register(name: string, release: ProjectCacheReleaser, canRelease: ProjectCacheReleaseGuard = () => true): () => void {
    if (!name || this.#releasers.has(name)) throw new Error(`A project cache releaser is already registered: ${name}`);
    const participant = { release, canRelease };
    this.#releasers.set(name, participant);
    return () => { if (this.#releasers.get(name) === participant) this.#releasers.delete(name); };
  }

  track(projectId: string): void {
    if (projectId) this.#projects.add(projectId);
  }

  get trackedProjects(): number { return this.#projects.size; }
  get trackedProjectIds(): string[] { return [...this.#projects]; }

  reclaimProject(projectId: string, reason: ProjectCacheReclamationReason): boolean {
    if (!projectId) return false;
    // Check every participant first so one active editor cannot be partially cleared.
    for (const participant of this.#releasers.values()) if (!participant.canRelease(projectId, reason)) return false;
    const errors: unknown[] = [];
    for (const { release } of this.#releasers.values()) {
      try { release(projectId); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, `Could not release every cache for project ${projectId}.`);
    this.#projects.delete(projectId);
    return true;
  }

}
