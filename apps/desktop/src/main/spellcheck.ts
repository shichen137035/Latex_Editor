import { app } from "electron";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import nspell from "nspell";
import type { SpellCheckMode, SpellCheckStatus } from "@latex-editor/contracts" with { "resolution-mode": "import" };

/** Offline dictionaries ship with the app. Advertise only loaded, self-tested languages. */
export class OfflineSpellCheckService {
  private engines = new Map<string, ReturnType<typeof nspell>>();
  private personal = new Set<string>();
  private cache = new Map<string, boolean>();
  private language = "en-US";
  private enabled = true;
  private error: string | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly dictionaryPath = resolve(app.getPath("userData"), "spellcheck", "personal.json");

  async initialize(): Promise<void> {
    try {
      const words: unknown = JSON.parse(await readFile(this.dictionaryPath, "utf8"));
      if (!Array.isArray(words) || !words.every((word) => typeof word === "string")) throw new Error("Invalid personal dictionary");
      this.personal = new Set(words);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.error = String(error);
    }
    const dictionaries = [
      ["en-US", () => import("dictionary-en")],
      ["en-GB", () => import("dictionary-en-gb")]
    ] as const;
    for (const [language, load] of dictionaries) {
      try {
        const { default: dictionary } = await load();
        const engine = nspell({ aff: Buffer.from(dictionary.aff), dic: Buffer.from(dictionary.dic) });
        if (engine.correct("recieve") || !engine.correct("receive")) throw new Error(`${language}: dictionary self-test failed`);
        for (const word of this.personal) engine.add(word);
        this.engines.set(language, engine);
      } catch (error) { this.error = String(error); }
    }
  }

  status(): SpellCheckStatus {
    return {
      provider: "hunspell", platform: process.platform, enabled: this.enabled,
      available: this.engines.has(this.language), availableLanguages: [...this.engines.keys()],
      activeLanguages: this.enabled ? [this.language] : [], dictionaryPath: this.dictionaryPath,
      ...(this.error ? { error: this.error } : {})
    };
  }

  configure(mode: SpellCheckMode, language: string): SpellCheckStatus {
    this.enabled = mode !== "disabled";
    this.language = language || "en-US";
    return this.status();
  }

  checkWords(words: string[], language: string): string[] {
    if (!this.enabled) return [];
    const engine = this.engines.get(language);
    if (!engine) throw new Error(`Spell-check dictionary unavailable: ${language}`);
    return [...new Set(words)].filter((word) => {
      if (typeof word !== "string" || word.length > 100 || !word.length) return false;
      const key = `${language}:${word}`;
      let correct = this.cache.get(key);
      if (correct === undefined) {
        correct = engine.correct(word);
        if (this.cache.size >= 10000) this.cache.clear();
        this.cache.set(key, correct);
      }
      return !correct;
    });
  }

  suggestions(word: string, language: string): string[] {
    if (!this.enabled || typeof word !== "string" || word.length > 100) return [];
    return this.engines.get(language)?.suggest(word).slice(0, 6) ?? [];
  }

  addToDictionary(word: string): Promise<boolean> {
    if (typeof word !== "string" || !/^[\p{L}\p{M}'’-]{1,100}$/u.test(word)) return Promise.resolve(false);
    // Serialize writes; a failed save must not silently become a session-only ignore.
    const operation = this.writes.then(async () => {
      const words = [...new Set([...this.personal, word])].sort();
      await mkdir(dirname(this.dictionaryPath), { recursive: true });
      await writeFile(`${this.dictionaryPath}.tmp`, JSON.stringify(words, null, 2), "utf8");
      await rename(`${this.dictionaryPath}.tmp`, this.dictionaryPath);
      this.personal.add(word);
      for (const engine of this.engines.values()) engine.add(word);
      this.cache.clear();
      return true;
    });
    this.writes = operation.catch(() => undefined);
    return operation;
  }

  async dictionaryWords(): Promise<string[]> { return [...this.personal]; }
}
