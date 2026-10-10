function validSkillContent(content: string): boolean {
  const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
  return new TextEncoder().encode(content).byteLength <= 128 * 1024 && !!header && /^name:\s*.+$/m.test(header) && /^description:\s*.+$/m.test(header);
}

import { preferenceDefaults, validPreference, type PreferenceKey, type PreferenceValues, type LatexToolchain } from "./settings.js";

export const managerPresetKeys = {
  settings: (Object.keys(preferenceDefaults) as PreferenceKey[]).filter(key => key !== "lastProject"),
  themes: ["theme", "themeColorProfiles"],
  shortcuts: ["keybindings", "referenceLinkModifier"],
  blockEnvironments: ["environments"],
  previewCommands: ["previewDirectives"],
  dictionaries: ["spellCheckMode", "spellCheckLanguage", "spellCheckActiveLanguages"],
  toolchain: ["engine"], styleResources: [], aiSkills: []
} satisfies Record<string, PreferenceKey[]>;
export type SettingsPresetKind = keyof typeof managerPresetKeys;
export interface SettingsPresetDocument {
  format: "texweave-settings-preset";
  version: 1;
  kind: SettingsPresetKind;
  name: string;
  preferences: Partial<PreferenceValues>;
  toolchain?: LatexToolchain;
  theme?: { id: string; css: string; name?: string };
  skills?: Array<{ name: string; content: string; enabled: boolean }>;
  resources?: Array<{ name: string; files: Array<{ targetPath: string; content: string }> }>;
}
export function validPresetDocument(value: unknown): value is SettingsPresetDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as SettingsPresetDocument;
  if (doc.format !== "texweave-settings-preset" || doc.version !== 1 || !Object.hasOwn(managerPresetKeys, doc.kind) || typeof doc.name !== "string" || !doc.name.trim() || doc.name.length > 80 || !doc.preferences || typeof doc.preferences !== "object" || Array.isArray(doc.preferences)) return false;
  if (!Object.entries(doc.preferences).every(([key, entry]) => (managerPresetKeys[doc.kind] as string[]).includes(key) && validPreference(key, entry))) return false;
  if (doc.theme !== undefined && (!["themes", "settings"].includes(doc.kind) || !doc.theme || typeof doc.theme.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(doc.theme.id) || typeof doc.theme.css !== "string" || doc.theme.css.length > 2_000_000 || doc.theme.name !== undefined && (typeof doc.theme.name !== "string" || doc.theme.name.length > 200))) return false;
  if (doc.toolchain !== undefined && (doc.kind !== "toolchain" || !doc.toolchain || !["miktex", "texlive", "unknown"].includes(doc.toolchain.distribution) || typeof doc.toolchain.available !== "boolean" || typeof doc.toolchain.detectedAt !== "string" || !["latexmk", "pdflatex", "xelatex", "lualatex", "binDirectory", "rootPath", "bibtex", "biber", "makeindex"].every(key => { const path = (doc.toolchain as unknown as Record<string, unknown>)[key]; return path === undefined || typeof path === "string" && !path.includes("\0"); }))) return false;
  if (doc.skills !== undefined && (doc.kind !== "aiSkills" || !Array.isArray(doc.skills) || doc.skills.length > 100 || !doc.skills.every(item => item && typeof item.name === "string" && /^[a-z0-9][a-z0-9-]{0,47}$/.test(item.name) && typeof item.content === "string" && validSkillContent(item.content) && typeof item.enabled === "boolean"))) return false;
  if (doc.resources !== undefined && (doc.kind !== "styleResources" || !Array.isArray(doc.resources) || doc.resources.length > 100 || !doc.resources.every(item => item && typeof item.name === "string" && item.name.trim() && item.name.length <= 200 && Array.isArray(item.files) && item.files.length <= 500 && item.files.every(file => file && typeof file.targetPath === "string" && !/^[\\/]|^[A-Za-z]:|(?:^|[\\/])\.\.(?:[\\/]|$)|\0/.test(file.targetPath) && !file.targetPath.includes(":") && /\.(sty|cls|bst|bib|tex|cfg|def|ltx)$/i.test(file.targetPath) && typeof file.content === "string" && file.content.length <= 2_000_000)))) return false;
  return JSON.stringify(doc).length <= 8_000_000;
}
