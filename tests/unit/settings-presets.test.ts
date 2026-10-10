import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SettingsRepository } from "../../apps/desktop/src/main/settings.js";
import { validPresetDocument } from "../../packages/contracts/src/settings-presets.js";
import { StyleResourceRepository } from "../../apps/desktop/src/main/style-resources.js";
import { ThemeRepository } from "../../apps/desktop/src/main/themes.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "texweave-presets-")); roots.push(root);
  const path = async (id: string) => join(root, id, ".texweave/settings.json");
  const repository = new SettingsRepository(join(root, "user"), path);
  await repository.initialize();
  return { repository, restart: async () => { const next = new SettingsRepository(join(root, "user"), path); await next.initialize(); return next; } };
}
it("restores a durable complete global preset while preserving project overrides and machine state", async () => {
  const { repository, restart } = await fixture();
  await repository.set("theme", "dark"); await repository.set("fontSize", 18);
  await repository.set("fontSize", 24, "paper");
  const preset = await repository.savePreset("Writing");
  await repository.set("theme", "light"); await repository.set("sourceMinimap", false);
  await repository.set("lastProject", "other");
  const toolchain = { distribution: "texlive" as const, available: true, detectedAt: "2026-10-10" };
  await repository.saveToolchain(toolchain);
  const reloaded = await restart();
  expect(await reloaded.listPresets()).toEqual([preset]);
  await reloaded.applyPreset(preset.id);
  expect((await reloaded.snapshot("paper"))).toMatchObject({ global: { theme: "dark", fontSize: 18, sourceMinimap: true, lastProject: "other" }, project: { fontSize: 24 }, toolchain });
});
it("updates and renames a preset, and deletion leaves the applied preferences untouched", async () => {
  const { repository } = await fixture();
  const preset = await repository.savePreset("Writing");
  await repository.set("fontSize", 20);
  expect(await repository.savePreset("Review", preset.id)).toMatchObject({ id: preset.id, name: "Review" });
  await repository.set("fontSize", 12); await repository.applyPreset(preset.id);
  await repository.removePreset(preset.id);
  expect(await repository.listPresets()).toEqual([]);
  expect((await repository.snapshot()).global.fontSize).toBe(20);
  await expect(repository.applyPreset(preset.id)).rejects.toThrow("settingsPresets.notFound");
});
it("serializes concurrent saves and rejects duplicate names without overwriting presets", async () => {
  const { repository } = await fixture();
  await expect(repository.savePreset(" ")).rejects.toThrow("settingsPresets.invalidName");
  await expect(repository.savePreset("x".repeat(81))).rejects.toThrow("settingsPresets.invalidName");
  const results = await Promise.allSettled([repository.savePreset("Review"), repository.savePreset(" review ")]);
  expect(results.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
  expect(await repository.listPresets()).toHaveLength(1);
  await repository.savePreset("Writing");
  expect(await repository.listPresets()).toHaveLength(2);
});

it("isolates manager preset namespaces and restores only that manager's preferences", async () => {
  const { repository } = await fixture();
  await repository.set("keybindings", { "edit.find": "Mod+G" });
  const keyboard = await repository.savePreset("Work", undefined, "shortcuts");
  await repository.savePreset("Work", undefined, "themes");
  await repository.set("keybindings", {}); await repository.set("theme", "dark");
  await repository.applyPreset(keyboard.id);
  expect((await repository.snapshot()).global).toMatchObject({ keybindings: { "edit.find": "Mod+G" }, theme: "dark" });
  expect(await repository.listPresets("themes")).toHaveLength(1);
  const exported = await repository.presetDocument(keyboard.id);
  expect(exported.kind).toBe("shortcuts"); expect(Object.keys(exported.preferences)).toEqual(["keybindings", "referenceLinkModifier"]);
  expect(validPresetDocument({ ...exported, kind: "themes" })).toBe(false);
  await repository.removePreset(keyboard.id);
  await repository.importPreset(exported);
  expect(await repository.listPresets("shortcuts")).toHaveLength(1);
});

it("loads eligible manager presets into a project without changing global settings", async () => {
  const { repository } = await fixture();
  await repository.set("keybindings", { "edit.find": "Mod+G" }, "paper");
  const preset = await repository.savePreset("Project", undefined, "shortcuts", undefined, "paper");
  await repository.set("fontSize", 22, "other");
  await repository.applyPreset(preset.id, "other");
  expect((await repository.snapshot("other"))).toMatchObject({ global: {}, project: { fontSize: 22, keybindings: { "edit.find": "Mod+G" } } });
  expect(validPresetDocument({ format: "texweave-settings-preset", version: 1, kind: "styleResources", name: "bad", preferences: {}, resources: [{ name: "bad", files: [{ targetPath: "../escape.sty", content: "test" }] }] })).toBe(false);
});

it("restores resource contents and custom CSS without duplicating an unchanged import", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-preset-assets-")); roots.push(root);
  const styles = new StyleResourceRepository(join(root, "resources"), root); await styles.initialize();
  const packs = [{ name: "Writing", files: [{ targetPath: "nested/writing.sty", content: "\\ProvidesPackage{writing}" }] }];
  await styles.importPresetResources(packs); await styles.importPresetResources(packs);
  expect(await styles.list()).toHaveLength(1);
  const resource = (await styles.list())[0]!;
  expect((await styles.getResource(resource.id))!.files[0]!.content).toBe(packs[0]!.files[0]!.content);
  const themes = new ThemeRepository(join(root, "resources"), join(root, "themes")); await themes.initialize();
  const theme = { id: "original-theme", name: "Custom Rose", css: ":root{--color-bg-panel:#fff0f6}" };
  const id = await themes.importPresetTheme(theme);
  expect(await themes.importPresetTheme(theme)).toBe(id);
  expect((await themes.list()).find(item => item.id === id)?.name).toBe("Custom Rose");
});
