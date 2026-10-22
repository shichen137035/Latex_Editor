import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { LatexToolchain, PreferenceKey, PreferenceValues, SettingsSnapshot, SettingsPreset, SettingsPresetKind, SettingsPresetDocument } from "@latex-editor/contracts" with { "resolution-mode": "import" };

type StoredPreset = SettingsPreset & { document: SettingsPresetDocument };

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
  async compareAndSet(key: PreferenceKey, expected: unknown, value: unknown, projectId?: string, effective?: unknown): Promise<SettingsSnapshot> {
    return this.set(key, value, projectId, { expected, ...(effective === undefined ? {} : { effective }) });
  }
  async set(key: PreferenceKey, value: unknown, projectId?: string, compare?: { expected: unknown; effective?: unknown }): Promise<SettingsSnapshot> {
    const operation = this.queue.then(async () => {
      const { preferenceDefaults, validPreference, projectPreferenceKeys, sanitizePreferences } = await import("@latex-editor/contracts");
      if (!Object.hasOwn(preferenceDefaults, key) || (value !== undefined && !validPreference(key, value)) || (projectId && !projectPreferenceKeys.includes(key))) throw new Error("Invalid setting or scope");
      const assertExpected = (current: unknown) => { if (compare && (JSON.stringify(current) !== JSON.stringify(compare.expected) || Object.hasOwn(compare, "effective") && JSON.stringify(current ?? this.global[key] ?? preferenceDefaults[key]) !== JSON.stringify(compare.effective))) { const error = new Error("Setting changed after the operation was planned."); Object.assign(error, { code: "SETTINGS_CONFLICT" }); throw error; } };
      if (projectId) {
        const path = await this.projectPath(projectId);
        const preferences = sanitizePreferences((await this.read(path)).preferences, true);
        assertExpected(preferences[key]);
        if (value === undefined) delete preferences[key]; else Object.assign(preferences, { [key]: value });
        await this.write(path, { version: 1, preferences });
      } else {
        assertExpected(this.global[key]);
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
  private async readPresets(): Promise<StoredPreset[]> {
    const { validPresetDocument } = await import("@latex-editor/contracts");
    const stored = (await this.read(join(this.root, "settings-presets.json"))).presets;
    if (!Array.isArray(stored)) return [];
    return stored.map(item => item?.document ? item : { ...item, document: { format: "texweave-settings-preset", version: 1, kind: "settings", name: item?.name, preferences: item?.preferences } }).filter(item => item && typeof item.id === "string" && /^[a-f0-9-]{36}$/.test(item.id) && typeof item.updatedAt === "string" && validPresetDocument(item.document))
      .slice(0, 900).map(item => ({ id: item.id, name: item.document.name, kind: item.document.kind, updatedAt: item.updatedAt, document: item.document }));
  }
  async listPresets(kind: SettingsPresetKind = "settings"): Promise<SettingsPreset[]> {
    await this.queue;
    return (await this.readPresets()).filter(item => item.kind === kind).map(({ id, name, updatedAt, kind }) => ({ id, name, updatedAt, kind })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async savePreset(name: string, id?: string, kind: SettingsPresetKind = "settings", extra?: Partial<SettingsPresetDocument>, projectId?: string): Promise<SettingsPreset> {
    let saved: SettingsPreset | undefined;
    const operation = this.queue.then(async () => {
      const { preferenceDefaults, sanitizePreferences, managerPresetKeys, validPresetDocument } = await import("@latex-editor/contracts");
      if (typeof name !== "string" || !name.trim() || name.trim().length > 80) throw new Error("settingsPresets.invalidName");
      if (!Object.hasOwn(managerPresetKeys, kind)) throw new Error("settingsPresets.invalidFile");
      const presets = await this.readPresets(), existing = id === undefined ? undefined : presets.find(item => item.id === id && item.kind === kind);
      if (id !== undefined && !existing) throw new Error("settingsPresets.notFound");
      const trimmed = name.trim();
      if (presets.some(item => item.kind === kind && item.id !== id && item.name.normalize("NFKC").toLowerCase() === trimmed.normalize("NFKC").toLowerCase())) throw new Error("settingsPresets.duplicateName");
      if (!existing && presets.filter(item => item.kind === kind).length >= 100) throw new Error("settingsPresets.limit");
      const project = projectId ? sanitizePreferences((await this.read(await this.projectPath(projectId))).preferences, true) : {};
      const current = { ...preferenceDefaults, ...this.global, ...project };
      const preferences = Object.fromEntries(managerPresetKeys[kind].map(key => [key, current[key]]));
      const document: SettingsPresetDocument = { format: "texweave-settings-preset", version: 1, kind, ...extra, preferences: extra?.preferences ?? preferences, name: trimmed };
      if (!validPresetDocument(document) || document.kind !== kind) throw new Error("settingsPresets.invalidFile");
      const preset: StoredPreset = { id: existing?.id ?? randomUUID(), name: trimmed, kind, updatedAt: new Date().toISOString(), document };
      await this.write(join(this.root, "settings-presets.json"), { version: 2, presets: [...presets.filter(item => item.id !== preset.id), preset] });
      saved = { id: preset.id, name: preset.name, kind, updatedAt: preset.updatedAt };
    });
    this.queue = operation.catch(() => undefined); await operation;
    return saved!;
  }
  async presetDocument(id: string): Promise<SettingsPresetDocument> {
    await this.queue;
    const preset = (await this.readPresets()).find(item => item.id === id);
    if (!preset) throw new Error("settingsPresets.notFound");
    return preset.document;
  }
  async importPreset(document: SettingsPresetDocument): Promise<SettingsPreset> {
    const { validPresetDocument } = await import("@latex-editor/contracts");
    if (!validPresetDocument(document)) throw new Error("settingsPresets.invalidFile");
    return this.savePreset(document.name, undefined, document.kind, document);
  }
  async applyPreset(id: string, projectId?: string): Promise<SettingsSnapshot> {
    const operation = this.queue.then(async () => {
      const { preferenceDefaults, sanitizePreferences, projectPreferenceKeys } = await import("@latex-editor/contracts");
      const preset = (await this.readPresets()).find(item => item.id === id);
      if (!preset) throw new Error("settingsPresets.notFound");
      if (projectId && !["shortcuts", "blockEnvironments", "previewCommands"].includes(preset.kind)) throw new Error("settingsPresets.invalidFile");
      if (projectId) {
        const path = await this.projectPath(projectId), previous = await this.read(path);
        const next = { ...sanitizePreferences(previous.preferences, true), ...Object.fromEntries(Object.entries(preset.document.preferences).filter(([key]) => projectPreferenceKeys.includes(key as PreferenceKey))) };
        await this.write(path, { version: 1, preferences: next });
      } else {
        const next = { ...this.global, ...(preset.kind === "settings" ? preferenceDefaults : {}), ...preset.document.preferences, ...(this.global.lastProject === undefined ? {} : { lastProject: this.global.lastProject }) };
        const toolchain = preset.kind === "toolchain" && preset.document.toolchain ? preset.document.toolchain : this.toolchain;
        await this.write(join(this.root, "settings.json"), { version: 1, preferences: next, toolchain });
        this.global = next; this.toolchain = toolchain;
      }
    });
    this.queue = operation.catch(() => undefined); await operation;
    return this.snapshot(projectId);
  }
  async removePreset(id: string): Promise<void> {
    const operation = this.queue.then(async () => {
      const presets = await this.readPresets();
      if (!presets.some(item => item.id === id)) throw new Error("settingsPresets.notFound");
      await this.write(join(this.root, "settings-presets.json"), { version: 2, presets: presets.filter(item => item.id !== id) });
    });
    this.queue = operation.catch(() => undefined); await operation;
  }
}
