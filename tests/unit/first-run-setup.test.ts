import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DictionaryPackage } from "@latex-editor/contracts";
import { InstallationStateService } from "../../apps/desktop/src/main/installation.js";
import { pendingSetupLanguages, suggestedSetupLanguages } from "../../apps/desktop/src/renderer/setup/languages.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it("preserves completed setup and language choices when upgrading or restarting", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-setup-")); roots.push(root);
  const service = new InstallationStateService(root, "0.6.7"); await service.initialize();
  expect(service.snapshot().setupCompletedAt).toBeUndefined();
  const completed = await service.completeSetup(["en-US", "zh-CN", "en-US"]);
  const restarted = new InstallationStateService(root, "0.6.8"); await restarted.initialize();
  expect(restarted.snapshot()).toMatchObject({ appVersion: "0.6.8", setupCompletedAt: completed.setupCompletedAt, setupDictionaryIds: ["en-US", "zh-CN"] });
  await expect(restarted.completeSetup(["../../escape"])).rejects.toThrow("Invalid setup languages");
  expect(restarted.snapshot().setupDictionaryIds).toEqual(["en-US", "zh-CN"]);
});

it("recommends the interface language and retries only languages not yet installed", () => {
  const catalog = [
    { id: "en-US", languageCode: "en-US", installed: true },
    { id: "zh-CN", languageCode: "zh-CN", installed: false },
    { id: "de", languageCode: "de", installed: false },
    { id: "fr", languageCode: "fr", installed: false }
  ] as DictionaryPackage[];
  const selected = suggestedSetupLanguages(catalog, "zh-TW", ["fr", "no-longer-available"]);
  expect(selected).toEqual(["en-US", "zh-CN", "fr"]);
  expect(pendingSetupLanguages(catalog, selected).map(item => item.id)).toEqual(["zh-CN", "fr"]);
  catalog[1]!.installed = true;
  expect(pendingSetupLanguages(catalog, selected).map(item => item.id)).toEqual(["fr"]);
});
