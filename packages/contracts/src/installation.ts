import type { LatexToolchain } from "./settings.js";

export type ComponentOwnership = "external" | "installed-by-texweave" | "user-managed";
export type ComponentId = "core" | "language-packs" | "spellcheck" | "latex-runtime" | "themes" | "templates";

export interface InstalledComponent {
  id: ComponentId;
  version: string;
  ownership: ComponentOwnership;
  installedAt: string;
  path?: string;
  source?: string;
}

export interface InstallationState {
  schemaVersion: 1;
  product: "TeXWeave";
  appVersion: string;
  installMode: "recommended" | "custom";
  installDirectory?: string;
  installerLanguage?: string;
  requestedComponents: ComponentId[];
  components: InstalledComponent[];
  lastEnvironmentCheck?: string;
  environment?: LatexToolchain;
  setupCompletedAt?: string;
  setupDictionaryIds?: string[];
}

export interface RemoveUserDataOptions {
  settings: boolean;
  themes: boolean;
  languages: boolean;
  spellcheck: boolean;
  templates: boolean;
  cache: boolean;
}

