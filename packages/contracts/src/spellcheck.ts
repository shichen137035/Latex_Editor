export type SpellCheckMode = "auto" | "manual" | "disabled";

export interface SpellCheckStatus {
  provider: "electron" | "hunspell";
  platform: string;
  enabled: boolean;
  available: boolean;
  availableLanguages: string[];
  activeLanguages: string[];
  dictionaryPath?: string;
  error?: string;
}
