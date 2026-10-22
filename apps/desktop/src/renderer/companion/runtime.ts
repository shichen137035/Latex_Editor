import type { CompanionRequest, CompanionScope } from "./api.js";
import type { SettingsPresetDocument, SettingsPresetKind } from "@latex-editor/contracts";
import { DEFAULT_ENVIRONMENTS, includeNewBuiltInEnvironments } from "../preview/environments.js";
import type { EnvironmentDefinition } from "../preview/types.js";
import { createCompanionApi } from "./api.js";
import { settings } from "../settings/service.js";
import { commandCatalog, commands, type CommandId } from "../settings/commands.js";
import { t } from "../i18n/index.js";
import { themeName } from "../i18n/displayNames.js";
import { nativeLanguageName } from "../i18n/LanguageSelect.js";
import { supportedLocales } from "../i18n/index.js";

/** Shared companion capability facade for settings, presets, themes, skills, and blocks. */
const basicApi = createCompanionApi({
  settings: {
    snapshot: settings.snapshot, projectId: settings.projectId, subscribe: settings.subscribe, set: (key, value, scope) => settings.setStrict(key, value, scope),
    choices: async key => key === "theme" ? (await window.latexEditor!.themes.list()).map(theme => ({ value: theme.id, label: themeName(theme) })) : key === "locale" || key === "blockNameLanguage" ? supportedLocales.map(value => ({ value, label: nativeLanguageName(value) })) : []
  },
  actions: {
    list: () => (Object.keys(commandCatalog) as CommandId[]).map(id => ({ id, label: t(commandCatalog[id].label), available: commands.canExecute(id) })),
    run: id => Object.hasOwn(commandCatalog, id) ? commands.run(id as CommandId) : Promise.resolve(false)
  },
  message: t
});

const builtInCss: Record<string, () => Promise<string>> = {
  light: async () => (await import("../themes/light.css?raw")).default,
  dark: async () => (await import("../themes/dark.css?raw")).default,
  "tech-light": async () => (await import("../themes/light.css?raw")).default + "\n" + (await import("../themes/tech-light.css?raw")).default,
  "tech-dark": async () => (await import("../themes/dark.css?raw")).default + "\n" + (await import("../themes/tech-dark.css?raw")).default,
  "pink-light": async () => (await import("../themes/light.css?raw")).default + "\n" + (await import("../themes/pink-light.css?raw")).default
};
const kinds: SettingsPresetKind[] = ["settings", "themes", "blockEnvironments", "previewCommands", "shortcuts", "dictionaries"];
const assertKind = (kind: SettingsPresetKind) => { if (!kinds.includes(kind)) throw new Error(t("settingsPresets.invalidFile")); };
const projectScope = (scope: CompanionScope) => { if (scope !== "global" && scope !== "project") throw new Error(t("companion.invalidScope")); if (scope === "project" && !settings.projectId()) throw new Error(t("companion.projectRequired")); };
const effectiveBlocks = (scope: CompanionScope) => {
  projectScope(scope);
  const configured = basicApi.settings.read("environments", scope).value as EnvironmentDefinition[];
  return configured.length ? includeNewBuiltInEnvironments(configured) : DEFAULT_ENVIRONMENTS;
};
let blockWrites = Promise.resolve();
const resources = {
  skills: {
    list: () => window.latexEditor!.companionSkills.list(),
    read: (name: string) => window.latexEditor!.companionSkills.read(name),
    prepare: (names: string[]) => window.latexEditor!.companionSkills.prepare(names)
  },
  configurations: {
    list: (kind: SettingsPresetKind = "settings") => { assertKind(kind); return window.latexEditor!.settings.listPresets(kind); },
    create: (document: SettingsPresetDocument) => window.latexEditor!.settings.createPreset(document),
    saveCurrent: (name: string, kind: SettingsPresetKind = "settings", scope: CompanionScope = "global") => { assertKind(kind); projectScope(scope); return window.latexEditor!.settings.savePreset(name, undefined, kind, scope === "project" ? settings.projectId() : undefined); },
    apply: async (id: string, scope: CompanionScope = "global") => { projectScope(scope); await settings.applyPreset(id, scope); return settings.snapshot(); },
    export: (id: string) => window.latexEditor!.settings.exportPreset(id)
  },
  themes: {
    list: async () => (await window.latexEditor!.themes.list()).map(({ id, name, source }) => ({ id, name, source })),
    read: async (id: string) => {
      const theme = (await window.latexEditor!.themes.list()).find(theme => theme.id === id);
      if (!theme) throw new Error(t("companion.unavailable"));
      return { id: theme.id, name: theme.name, source: theme.source, css: theme.css ?? await builtInCss[id]?.() ?? "" };
    },
    create: async (input: { name: string; css: string }) => {
      const theme = await window.latexEditor!.themes.create(input);
      window.dispatchEvent(new Event("texweave-themes-changed"));
      return { id: theme.id, name: theme.name, source: theme.source };
    }
  },
  blocks: {
    list: (scope: CompanionScope = "global") => effectiveBlocks(scope).map(({ id, label, family, enabled }) => ({ id, label, family, enabled })),
    read: (id: string, scope: CompanionScope = "global") => {
      const definition = effectiveBlocks(scope).find(item => item.id === id);
      if (!definition) throw new Error(t("companion.unavailable"));
      return structuredClone(definition);
    },
    upsert: (definition: EnvironmentDefinition, scope: CompanionScope = "global") => {
      const input = structuredClone(definition), projectId = settings.projectId();
      const operation = blockWrites.then(async () => {
        if (scope === "project" && projectId !== settings.projectId()) throw new Error(t("companion.projectChanged"));
        if (!input || typeof input.id !== "string") throw new Error(t("companion.invalidValue"));
        const current = effectiveBlocks(scope);
        if (input.builtIn && !current.some(item => item.id === input.id && item.builtIn)) throw new Error(t("companion.invalidValue"));
        const next = current.some(item => item.id === input.id) ? current.map(item => item.id === input.id ? input : item) : [...current, input];
        await basicApi.settings.set("environments", next, scope);
        return { id: input.id, scope, saved: true };
      });
      blockWrites = operation.then(() => undefined, () => undefined);
      return operation;
    }
  }
};

export type CompanionResourceRequest =
  | { method: "skills.list" | "themes.list" }
  | { method: "skills.read"; name: string }
  | { method: "skills.prepare"; names: string[] }
  | { method: "configurations.list"; kind?: SettingsPresetKind }
  | { method: "configurations.create"; document: SettingsPresetDocument }
  | { method: "configurations.saveCurrent"; name: string; kind?: SettingsPresetKind; scope?: CompanionScope }
  | { method: "configurations.apply"; id: string; scope?: CompanionScope }
  | { method: "configurations.export"; id: string }
  | { method: "themes.read"; id: string }
  | { method: "themes.create"; name: string; css: string }
  | { method: "blocks.list"; scope?: CompanionScope }
  | { method: "blocks.read"; id: string; scope?: CompanionScope }
  | { method: "blocks.upsert"; definition: EnvironmentDefinition; scope?: CompanionScope };

export const companionApi = {
  ...basicApi, ...resources,
  async invoke(request: CompanionRequest | CompanionResourceRequest): Promise<unknown> {
    switch (request.method) {
      case "skills.list": return resources.skills.list();
      case "skills.read": return resources.skills.read(request.name);
      case "skills.prepare": return resources.skills.prepare(request.names);
      case "themes.list": return resources.themes.list();
      case "themes.read": return resources.themes.read(request.id);
      case "themes.create": return resources.themes.create(request);
      case "configurations.list": return resources.configurations.list(request.kind);
      case "configurations.create": return resources.configurations.create(request.document);
      case "configurations.saveCurrent": return resources.configurations.saveCurrent(request.name, request.kind, request.scope);
      case "configurations.apply": return resources.configurations.apply(request.id, request.scope);
      case "configurations.export": return resources.configurations.export(request.id);
      case "blocks.list": return resources.blocks.list(request.scope);
      case "blocks.read": return resources.blocks.read(request.id, request.scope);
      case "blocks.upsert": return resources.blocks.upsert(request.definition, request.scope);
      default: return basicApi.invoke(request);
    }
  }
};
