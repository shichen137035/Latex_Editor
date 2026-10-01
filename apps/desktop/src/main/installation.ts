import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { LatexToolchain } from "@latex-editor/contracts" with { "resolution-mode": "import" };

/**
 * Filesystem contract shared by the installer and the running application.
 *
 * The installer owns the application directory. Everything below userData is
 * user data and therefore has an explicit lifetime. In particular, a project
 * is never stored below this root and is never removed by this service.
 */
export type { ComponentOwnership, ComponentId, InstalledComponent, InstallationState, RemoveUserDataOptions } from "@latex-editor/contracts" with { "resolution-mode": "import" };
import type { ComponentOwnership, InstalledComponent, InstallationState, RemoveUserDataOptions } from "@latex-editor/contracts" with { "resolution-mode": "import" };

const defaultState = (appVersion: string): InstallationState => ({
  schemaVersion: 1,
  product: "TeXWeave",
  appVersion,
  installMode: "recommended",
  requestedComponents: ["core"],
  components: []
});

/**
 * Records component ownership and performs narrowly-scoped cleanup.
 *
 * This is intentionally not a generic "delete app data" helper. Cleanup is
 * an allow-list of known directories/files, so a project path can never be
 * passed through to recursive deletion by accident.
 */
export class InstallationStateService {
  readonly root: string;
  readonly configRoot: string;
  readonly statePath: string;
  private state: InstallationState;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(userDataRoot: string, private readonly appVersion: string) {
    this.root = userDataRoot;
    this.configRoot = join(userDataRoot, "config");
    this.statePath = join(this.configRoot, "installation.json");
    this.state = defaultState(appVersion);
  }

  async initialize(): Promise<void> {
    try {
      const value = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<InstallationState>;
      if (value && value.schemaVersion === 1 && Array.isArray(value.components)) {
        this.state = {
          ...defaultState(this.appVersion),
          ...value,
          appVersion: this.appVersion,
          components: value.components.filter((component): component is InstalledComponent => Boolean(component && typeof component === "object" && typeof (component as InstalledComponent).id === "string"))
        };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // A corrupt state file must not prevent the editor from starting.
        this.state = defaultState(this.appVersion);
      }
    }
    // The NSIS page writes this small hand-off before the first launch. It is
    // a request, not proof of installation; actual component ownership is
    // recorded only after a component has been verified by the application.
    try {
      const selection = JSON.parse(await readFile(join(this.configRoot, "installer-selection.json"), "utf8")) as { installMode?: unknown; uiLanguage?: unknown; languagePacks?: unknown; spellcheck?: unknown; latexRuntime?: unknown };
      if (selection.installMode === "recommended" || selection.installMode === "custom") this.state.installMode = selection.installMode;
      if (typeof selection.uiLanguage === "string") this.state.installerLanguage = selection.uiLanguage;
      this.state.requestedComponents = ["core", ...(selection.languagePacks === true ? ["language-packs" as const] : []), ...(selection.spellcheck === true ? ["spellcheck" as const] : []), ...(selection.latexRuntime === true ? ["latex-runtime" as const] : [])];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.state.requestedComponents = ["core"];
    }
    await this.persist();
  }

  snapshot(): InstallationState {
    return structuredClone(this.state);
  }

  async setInstallMode(mode: InstallationState["installMode"], installDirectory?: string): Promise<InstallationState> {
    return this.update((next) => {
      next.installMode = mode;
      if (installDirectory) next.installDirectory = resolve(installDirectory);
      else delete next.installDirectory;
    });
  }

  async recordComponent(component: Omit<InstalledComponent, "installedAt">): Promise<InstallationState> {
    return this.update((next) => {
      next.components = next.components.filter((item) => item.id !== component.id);
      next.components.push({ ...component, installedAt: new Date().toISOString() });
    });
  }

  async recordEnvironment(toolchain: LatexToolchain): Promise<InstallationState> {
    return this.update((next) => {
      next.environment = structuredClone(toolchain);
      next.lastEnvironmentCheck = new Date().toISOString();
      const existing = next.components.find((component) => component.id === "latex-runtime");
      const ownership: ComponentOwnership = existing?.ownership ?? "external";
      next.components = next.components.filter((component) => component.id !== "latex-runtime");
      next.components.push({ id: "latex-runtime", version: toolchain.version ?? "detected", ownership, installedAt: existing?.installedAt ?? new Date().toISOString(), ...(toolchain.rootPath ? { path: toolchain.rootPath } : {}) });
    });
  }

  async removeUserData(options: RemoveUserDataOptions): Promise<void> {
    // Explicit paths only. Projects are intentionally absent from this list.
    const directories: Array<[boolean, string]> = [
      [options.themes, join(this.root, "themes")],
      [options.languages, join(this.root, "languages")],
      [options.spellcheck, join(this.root, "spellcheck")],
      [options.templates, join(this.root, "templates")],
      [options.cache, join(this.root, "cache")]
    ];
    await Promise.all(directories.filter(([enabled]) => enabled).map(([, path]) => rm(path, { recursive: true, force: true })));
    if (options.settings) {
      await Promise.all([
        rm(join(this.root, "config"), { recursive: true, force: true }),
        rm(join(this.root, "settings.json"), { force: true }),
        rm(join(this.root, "registry.sqlite"), { force: true }),
        rm(join(this.root, "registry.sqlite-wal"), { force: true }),
        rm(join(this.root, "registry.sqlite-shm"), { force: true })
      ]);
    }
    this.state = defaultState(this.appVersion);
    await this.persist();
  }

  private async update(mutator: (next: InstallationState) => void): Promise<InstallationState> {
    const operation = this.queue.then(async () => {
      const next = structuredClone(this.state);
      mutator(next);
      this.state = next;
      await this.persist();
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return this.snapshot();
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state, null, 2), "utf8");
    await rename(temporary, this.statePath);
  }
}
