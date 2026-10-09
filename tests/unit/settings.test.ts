import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { SettingsRepository } from "../../apps/desktop/src/main/settings.js";
import { preferenceDefaults, sanitizePreferences } from "../../packages/contracts/src/settings.js";
import { setLocale, t } from "../../apps/desktop/src/renderer/i18n/index.js";

describe("v0.2.3 foundations", () => {
  it("falls back to English and then the key without changing semantic identities", () => {
    setLocale("ja");
    expect(t("environment.theorem")).toBe("定理");
    expect(t("environment.corollary")).toBe("系");
    expect(t("future.missing")).toBe("future.missing");
    setLocale("en");
    expect(t("environment.theorem")).toBe("Theorem");
  });
  it("rejects invalid preferences and global-only project overrides", () => {
    expect(preferenceDefaults.documentWordCompletion).toBe(true);
    expect(preferenceDefaults.autoPairSymbols).toBe(true);
    expect(preferenceDefaults.mathPreviewOnHover).toBe(false);
    expect(preferenceDefaults.autoSaveDelaySeconds).toBe(3);
    expect(sanitizePreferences({ autoSaveDelaySeconds: 1 })).toEqual({ autoSaveDelaySeconds: 1 });
    expect(sanitizePreferences({ autoSaveDelaySeconds: 3600 }, true)).toEqual({ autoSaveDelaySeconds: 3600 });
    for (const autoSaveDelaySeconds of [0, -1, 1.5, 3601, Infinity, NaN, "3", null]) {
      expect(sanitizePreferences({ autoSaveDelaySeconds })).toEqual({});
    }
    expect(preferenceDefaults.wheelAcceleration.decayMs).toBe(250);
    expect(preferenceDefaults.warnIncompatibleEnvironmentConversion).toBe(true);
    expect(preferenceDefaults.tables.defaultStyle).toBe("booktabs-three-line");
    expect(preferenceDefaults.referenceLinkModifier).toBe("ctrl");
    expect(preferenceDefaults.spellCheckMode).toBe("auto");
    expect(preferenceDefaults.spellCheckLanguage).toBe("en-US");
    // Custom theme ids are valid; path-like values remain invalid.
    expect(sanitizePreferences({ fontSize: -3, theme: "../broken", locale: "ja", wordWrap: true, documentWordCompletion: false, autoPairSymbols: false, mathPreviewOnHover: true })).toEqual({ locale: "ja", wordWrap: true, documentWordCompletion: false, autoPairSymbols: false, mathPreviewOnHover: true });
    expect(sanitizePreferences({ mathPreviewOnHover: true }, true)).toEqual({ mathPreviewOnHover: true });
    expect(sanitizePreferences({ spellCheckMode: "manual", spellCheckLanguage: "ja-JP" })).toEqual({ spellCheckMode: "manual", spellCheckLanguage: "ja-JP" });
    expect(sanitizePreferences({ referenceLinkModifier: "alt" })).toEqual({ referenceLinkModifier: "alt" });
    expect(sanitizePreferences({ warnIncompatibleEnvironmentConversion: false })).toEqual({ warnIncompatibleEnvironmentConversion: false });
    expect(sanitizePreferences({ referenceLinkModifier: "mouse" })).toEqual({});
    expect(sanitizePreferences({ spellCheckMode: "manual", spellCheckLanguage: "not a language" }, true)).toEqual({});
    expect(sanitizePreferences({ theme: "dark", keybindings: {}, toolchain: { latexmk: "C:/tool.exe" }, fontSize: 20 }, true)).toEqual({ keybindings: {}, fontSize: 20 });
  });
  it("persists concurrent updates atomically, isolates projects and resets overrides", async () => {
    const root = await mkdtemp(join(tmpdir(), "texweave-settings-"));
    try {
      const projectPath = async (id: string) => join(root, id, ".texweave", "settings.json");
      const repository = new SettingsRepository(join(root, "user"), projectPath);
      await repository.initialize();
      await Promise.all([repository.set("fontSize", 18), repository.set("theme", "dark"), repository.set("locale", "ja")]);
      await repository.set("fontSize", 24, "a");
      await repository.set("autoSaveDelaySeconds", 10);
      await repository.set("autoSaveDelaySeconds", 5, "a");
      expect((await repository.snapshot("a")).project.autoSaveDelaySeconds).toBe(5);
      expect((await repository.snapshot("b")).global.autoSaveDelaySeconds).toBe(10);
      expect((await repository.snapshot("a")).project.fontSize).toBe(24);
      expect((await repository.snapshot("b")).project).toEqual({});
      await expect(repository.set("locale", "ja", "a")).rejects.toThrow();
      await repository.set("fontSize", undefined, "a");
      expect((await repository.snapshot("a")).project.fontSize).toBeUndefined();
      const restarted = new SettingsRepository(join(root, "user"), projectPath);
      await restarted.initialize();
      expect((await restarted.snapshot()).global).toMatchObject({ fontSize: 18, theme: "dark", locale: "ja" });
      expect((await restarted.snapshot("a")).project.autoSaveDelaySeconds).toBe(5);
      await restarted.set("autoSaveDelaySeconds", undefined, "a");
      expect((await restarted.snapshot("a")).project.autoSaveDelaySeconds).toBeUndefined();
      expect(JSON.parse(await readFile(join(root, "user", "settings.json"), "utf8")).version).toBe(1);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
