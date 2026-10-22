import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SettingsSnapshot } from "@latex-editor/contracts";

const state = vi.hoisted(() => ({ snapshot: { global: {}, project: {} } as SettingsSnapshot, project: "project-a" as string | undefined }));
vi.mock("../../apps/desktop/src/renderer/settings/service.js", () => ({ settings: {
  snapshot: () => state.snapshot, projectId: () => state.project, subscribe: () => () => undefined,
  setStrict: async (key: string, value: unknown, scope: "global" | "project") => { Object.assign(state.snapshot[scope], { [key]: value }); },
  applyPreset: vi.fn()
} }));
vi.mock("../../apps/desktop/src/renderer/settings/commands.js", () => ({ commandCatalog: {}, commands: {} }));
vi.mock("../../apps/desktop/src/renderer/i18n/index.js", () => ({ t: (key: string) => key, supportedLocales: ["en"] }));
vi.mock("../../apps/desktop/src/renderer/i18n/displayNames.js", () => ({ themeName: (theme: { name: string }) => theme.name }));
vi.mock("../../apps/desktop/src/renderer/i18n/LanguageSelect.js", () => ({ nativeLanguageName: (locale: string) => locale }));

import { companionApi } from "../../apps/desktop/src/renderer/companion/runtime.js";
const skillList = vi.fn(async () => []);
const themeList = vi.fn(async () => [{ id: "custom-one", name: "One", source: "user", css: ":root{}", filePath: "private-path" }]);
const createPreset = vi.fn(async (document: unknown) => document);
beforeEach(() => {
  state.snapshot = { global: {}, project: {} }; state.project = "project-a";
  vi.stubGlobal("window", { latexEditor: { companionSkills: { list: skillList }, themes: { list: themeList }, settings: { createPreset } } });
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());

it("keeps discovery compact and does not load skills or theme CSS for ordinary setting discovery", async () => {
  expect(companionApi.settings.list().every(item => !("value" in item))).toBe(true);
  expect(themeList).not.toHaveBeenCalled(); expect(skillList).not.toHaveBeenCalled();
  expect(await companionApi.themes.list()).toEqual([{ id: "custom-one", name: "One", source: "user" }]);
  expect(await companionApi.themes.read("custom-one")).toMatchObject({ css: ":root{}" });
  expect(companionApi.blocks.list().every(item => !("behavior" in item))).toBe(true);
});

it("merges custom block definitions, validates them, and supports ordinary settings undo", async () => {
  const reference = companionApi.blocks.read("section");
  const definition = { ...reference, id: "my-section", builtIn: false, label: "My heading" };
  await companionApi.blocks.upsert(definition, "project");
  expect(companionApi.blocks.read("my-section", "project")).toEqual(definition);
  expect(companionApi.blocks.read("section", "project")).toEqual(reference);
  await expect(companionApi.blocks.upsert({ ...definition, family: "invalid" } as typeof definition, "project")).rejects.toThrow("companion.invalidValue");
  expect(companionApi.blocks.read("my-section", "project")).toEqual(definition);
  await companionApi.settings.undo();
  expect(companionApi.blocks.list("project").some(item => item.id === "my-section")).toBe(false);
  state.project = undefined;
  await expect(companionApi.blocks.upsert(definition, "project")).rejects.toThrow("companion.projectRequired");
});

it("creates a preset without applying it through settings writes", async () => {
  const document = { format: "texweave-settings-preset" as const, version: 1 as const, name: "Calm", kind: "settings" as const, preferences: { fontSize: 18 } };
  await companionApi.invoke({ method: "configurations.create", document });
  expect(createPreset).toHaveBeenCalledWith(document);
  expect(state.snapshot).toEqual({ global: {}, project: {} });
});
