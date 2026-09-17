import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LatexToolchain, PreferenceKey, PreferenceValues, SettingsSnapshot } from "@latex-editor/contracts" with { "resolution-mode": "import" };

/** Serial, atomic writes prevent competing renderer updates from losing settings. */
export class SettingsRepository {
  global: Partial<PreferenceValues> = {};
  toolchain: LatexToolchain | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string, private readonly projectPath: (id: string) => Promise<string>) {}
  private async read(path: string): Promise<Record<string, unknown>> {
    try { const value: unknown = JSON.parse(await readFile(path, "utf8")); return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
    catch { return {}; }
  }
  private async write(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), "utf8");
    await rename(temp, path);
  }
  async initialize(): Promise<void> {
    const { sanitizePreferences } = await import("@latex-editor/contracts");
    const saved = await this.read(join(this.root, "settings.json"));
    this.global = sanitizePreferences(saved.preferences);
    if (saved.toolchain && typeof saved.toolchain === "object") this.toolchain = saved.toolchain as LatexToolchain;
  }
  async snapshot(projectId?: string): Promise<SettingsSnapshot> {
    await this.queue;
    const { sanitizePreferences } = await import("@latex-editor/contracts");
    const project = projectId ? sanitizePreferences((await this.read(await this.projectPath(projectId))).preferences, true) : {};
    return { global: this.global, project, ...(this.toolchain ? { toolchain: this.toolchain } : {}) };
  }
  async set(key: PreferenceKey, value: unknown, projectId?: string): Promise<SettingsSnapshot> {
    const operation = this.queue.then(async () => {
      const { validPreference, projectPreferenceKeys, sanitizePreferences } = await import("@latex-editor/contracts");
      if ((value !== undefined && !validPreference(key, value)) || (projectId && !projectPreferenceKeys.includes(key))) throw new Error("Invalid setting or scope");
      if (projectId) {
        const path = await this.projectPath(projectId);
        const preferences = sanitizePreferences((await this.read(path)).preferences, true);
        if (value === undefined) delete preferences[key]; else Object.assign(preferences, { [key]: value });
        await this.write(path, { version: 1, preferences });
      } else {
        const next = { ...this.global };
        if (value === undefined) delete next[key]; else Object.assign(next, { [key]: value });
        await this.write(join(this.root, "settings.json"), { version: 1, preferences: next, toolchain: this.toolchain });
        this.global = next;
      }
    });
    this.queue = operation.catch(() => undefined);
    await operation;
    return this.snapshot(projectId);
  }
  async saveToolchain(toolchain: LatexToolchain): Promise<void> {
    const operation = this.queue.then(async () => {
      await this.write(join(this.root, "settings.json"), { version: 1, preferences: this.global, toolchain });
      this.toolchain = toolchain;
    });
    this.queue = operation.catch(() => undefined);
    await operation;
  }
}
