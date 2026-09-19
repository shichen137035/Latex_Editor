export type SpellCheckMode = "auto" | "manual" | "disabled";

export interface DictionaryLicense {
  name: string;
  source?: string;
}

export interface DictionaryPackage {
  id: string;
  languageCode: string;
  displayName: string;
  region?: string;
  installed: boolean;
  version?: string;
  affUrl?: string;
  dicUrl?: string;
  license: DictionaryLicense;
}

export interface SpellCheckStatus {
  provider: "electron" | "hunspell";
  platform: string;
  enabled: boolean;
  available: boolean;
  availableLanguages: string[];
  activeLanguages: string[];
  dictionaryPath?: string;
  dictionariesPath?: string;
  error?: string;
}
