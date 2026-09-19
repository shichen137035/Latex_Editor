import { app } from "electron";
import { readFile, mkdir, writeFile, rename, readdir, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import nspell from "nspell";
import { checkChineseText, chineseRulesUrl, chineseRulesVersion, parseChineseRules } from "./chinese-rules.js";
import { checkJapaneseText, japaneseRulesLicenseUrl, japaneseRulesUrl, japaneseRulesVersion, parseJapaneseRules } from "./japanese-rules.js";
import type { DictionaryPackage, SpellCheckMode, SpellCheckStatus } from "@latex-editor/contracts" with { "resolution-mode": "import" };

const fallbackDictionaryCatalog: DictionaryPackage[] = [
  { id: "en-US", languageCode: "en-US", displayName: "English", region: "United States", installed: true, version: "bundled", license: { name: "MIT AND BSD", source: "https://github.com/wooorm/dictionaries/tree/main/dictionaries/en" } },
  { id: "en-GB", languageCode: "en-GB", displayName: "English", region: "United Kingdom", installed: true, version: "bundled", license: { name: "MIT AND BSD", source: "https://github.com/wooorm/dictionaries/tree/main/dictionaries/en-GB" } },
  ...[
    ["de", "German"], ["es", "Spanish"], ["fr", "French"], ["it", "Italian"], ["nl", "Dutch"], ["pl", "Polish"], ["pt", "Portuguese"], ["ru", "Russian"]
  ].map(([id, displayName]) => ({
    id, languageCode: id, displayName, installed: false,
    affUrl: `https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/${id}/index.aff`,
    dicUrl: `https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/${id}/index.dic`,
    license: { name: "MIT AND BSD", source: "https://github.com/wooorm/dictionaries" }
  } as DictionaryPackage))
];

const dictionaryCatalogApi = "https://api.github.com/repos/wooorm/dictionaries/contents/dictionaries?ref=main";
const dictionaryReadmeUrl = "https://raw.githubusercontent.com/wooorm/dictionaries/main/readme.md";
const dictionaryRawRoot = "https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries";

/** Offline dictionaries ship with the app. Advertise only loaded, self-tested languages. */
export class OfflineSpellCheckService {
  private chineseRules: Record<string, string> | undefined;
  private japaneseRules: Record<string, string> | undefined;
  private readonly chinesePath = resolve(app.getPath("userData"), "spellcheck", "chinese-rules.txt");
  private readonly japanesePath = resolve(app.getPath("userData"), "spellcheck", "japanese-rules.txt");
  private readonly chinesePackage: DictionaryPackage = {
    id: "zh-CN", languageCode: "zh-CN", displayName: "中文 / Chinese (basic rules)", installed: false,
    version: chineseRulesVersion,
    license: { name: "Apache-2.0", source: "https://github.com/shibing624/pycorrector/blob/master/LICENSE" }
  };
  private readonly japanesePackage: DictionaryPackage = {
    id: "ja-JP", languageCode: "ja-JP", displayName: "日本語 / Japanese (basic rules)", installed: false,
    version: japaneseRulesVersion,
    license: { name: "MIT", source: "https://github.com/textlint-ja/textlint-rule-ja-no-abusage/blob/master/LICENSE" }
  };
  private engines = new Map<string, ReturnType<typeof nspell>>();
  private personal = new Set<string>();
  private cache = new Map<string, boolean>();
  private language = "en-US";
  private enabled = true;
  private error: string | undefined;
  private writes: Promise<unknown> = Promise.resolve();
  private readonly dictionaryPath = resolve(app.getPath("userData"), "spellcheck", "personal.json");
  private readonly dictionariesPath = resolve(app.getPath("userData"), "spellcheck", "dictionaries");
  private readonly dictionaryCatalogPath = resolve(app.getPath("userData"), "spellcheck", "catalog.json");
  private catalog = fallbackDictionaryCatalog;
  private catalogReady = false;
  private catalogLoading: Promise<void> | undefined;

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
    await this.loadInstalledDictionaries();
    try { this.chineseRules = parseChineseRules(await readFile(this.chinesePath, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.error = String(error); }
    try { this.japaneseRules = parseJapaneseRules(await readFile(this.japanesePath, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.error = String(error); }
  }

  private async loadInstalledDictionaries(): Promise<void> {
    try {
      const entries = await readdir(this.dictionariesPath, { withFileTypes: true });
      for (const entry of entries.filter((item) => item.isDirectory())) {
        const affPath = resolve(this.dictionariesPath, entry.name, "index.aff");
        const dicPath = resolve(this.dictionariesPath, entry.name, "index.dic");
        try {
          const [aff, dic] = await Promise.all([readFile(affPath), readFile(dicPath)]);
          const engine = nspell({ aff, dic });
          for (const word of this.personal) engine.add(word);
          this.engines.set(entry.name, engine);
        } catch (error) { this.error = String(error); }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.error = String(error);
    }
  }

  private async loadDictionaryCatalog(): Promise<void> {
    if (this.catalogReady) return;
    if (this.catalogLoading) return this.catalogLoading;
    this.catalogLoading = (async () => {
      try {
        const cached = JSON.parse(await readFile(this.dictionaryCatalogPath, "utf8")) as unknown;
        if (Array.isArray(cached) && cached.every((item) => item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")) {
          this.catalog = cached as DictionaryPackage[];
        }
      } catch { /* A missing or stale catalog is replaced by the online registry when available. */ }
      try {
        const [directoryResponse, readmeResponse] = await Promise.all([
          fetch(dictionaryCatalogApi, { headers: { accept: "application/vnd.github+json", "user-agent": "TeXWeave" } }),
          fetch(dictionaryReadmeUrl, { headers: { "user-agent": "TeXWeave" } })
        ]);
        if (!directoryResponse.ok || !readmeResponse.ok) throw new Error("Hunspell dictionary registry is unavailable");
        const directories = await directoryResponse.json() as Array<{ name?: string; type?: string }>;
        const readme = await readmeResponse.text();
        const metadata = new Map<string, { name: string; license: string }>();
        const rowPattern = /^\s*\|\s*\[`(dictionary-[^`]+)`\]\([^)]*\)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/gm;
        for (const match of readme.matchAll(rowPattern)) {
          const packageId = match[1]; const name = match[2]; const license = match[3];
          if (packageId === undefined || name === undefined || license === undefined) continue;
          metadata.set(packageId.toLocaleLowerCase(), { name: name.trim(), license: license.replaceAll(/[`*_]/g, "").trim() });
        }
        const remote = directories
          .filter((entry) => entry.type === "dir" && typeof entry.name === "string")
          .map((entry) => {
            const directory = entry.name!;
            const packageName = `dictionary-${directory}`.toLocaleLowerCase();
            const details = metadata.get(packageName);
            const displayName = details?.name ?? directory.replaceAll(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
            return {
              id: directory,
              languageCode: directory,
              displayName,
              ...(displayName.includes("(") ? { region: displayName.slice(displayName.indexOf("(") + 1, displayName.lastIndexOf(")")) } : {}),
              installed: false,
              affUrl: `${dictionaryRawRoot}/${encodeURIComponent(directory)}/index.aff`,
              dicUrl: `${dictionaryRawRoot}/${encodeURIComponent(directory)}/index.dic`,
              license: { name: details?.license || "See dictionary license", source: `https://github.com/wooorm/dictionaries/tree/main/dictionaries/${encodeURIComponent(directory)}` }
            } satisfies DictionaryPackage;
          })
          .filter((item) => !["en", "en-gb"].includes(item.id.toLocaleLowerCase()));
        this.catalog = [...fallbackDictionaryCatalog.filter((item) => item.id === "en-US" || item.id === "en-GB"), ...remote];
        await mkdir(dirname(this.dictionaryCatalogPath), { recursive: true });
        await writeFile(`${this.dictionaryCatalogPath}.tmp`, JSON.stringify(this.catalog, null, 2), "utf8");
        await rename(`${this.dictionaryCatalogPath}.tmp`, this.dictionaryCatalogPath);
      } catch { /* Keep the last cached or bundled catalog when the registry cannot be reached. */ }
      this.catalogReady = true;
      this.catalogLoading = undefined;
    })();
    return this.catalogLoading;
  }

  status(): SpellCheckStatus {
    const phraseAvailable = this.language === "zh-CN" ? Boolean(this.chineseRules) : this.language === "ja-JP" ? Boolean(this.japaneseRules) : undefined;
    return {
      provider: "hunspell", platform: process.platform, enabled: this.enabled,
      available: phraseAvailable ?? this.engines.has(this.language),
      availableLanguages: [...this.engines.keys(), ...(this.chineseRules ? ["zh-CN"] : []), ...(this.japaneseRules ? ["ja-JP"] : [])],
      activeLanguages: this.enabled ? [this.language] : [], dictionaryPath: this.dictionaryPath, dictionariesPath: this.dictionariesPath,
      ...(this.error ? { error: this.error } : {})
    };
  }

  configure(mode: SpellCheckMode, language: string): SpellCheckStatus {
    this.enabled = mode !== "disabled";
    this.language = language || "en-US";
    return this.status();
  }

  async listDictionaries(query = ""): Promise<DictionaryPackage[]> {
    await this.loadDictionaryCatalog();
    const needle = query.trim().toLocaleLowerCase();
    return [this.chinesePackage, this.japanesePackage, ...this.catalog.filter((item) => !["zh-CN", "ja-JP"].includes(item.id))]
      .map((item) => ({ ...item, installed: item.id === "zh-CN" ? Boolean(this.chineseRules) : item.id === "ja-JP" ? Boolean(this.japaneseRules) : this.engines.has(item.id) }))
      .filter((item) => !needle || [item.id, item.languageCode, item.displayName, item.region ?? ""].some((value) => value.toLocaleLowerCase().includes(needle)));
  }

  async refreshDictionaries(): Promise<DictionaryPackage[]> {
    this.catalogReady = false;
    this.catalogLoading = undefined;
    return this.listDictionaries();
  }

  async installDictionary(id: string): Promise<DictionaryPackage> {
    if (id === "zh-CN") {
      const response = await fetch(chineseRulesUrl, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Chinese rules download failed: HTTP ${response.status}`);
      const content = await response.text();
      if (content.length > 1000000) throw new Error("Chinese rules package is too large");
      const rules = parseChineseRules(content);
      const licenseResponse = await fetch(`https://raw.githubusercontent.com/shibing624/pycorrector/${chineseRulesVersion}/LICENSE`, { signal: AbortSignal.timeout(30000) });
      if (!licenseResponse.ok) throw new Error("Chinese rules license download failed");
      const license = await licenseResponse.text();
      if (!license.includes("Apache License")) throw new Error("Invalid Chinese rules license");
      await mkdir(dirname(this.chinesePath), { recursive: true });
      await writeFile(resolve(dirname(this.chinesePath), "chinese-rules-LICENSE.txt"), license, "utf8");
      await writeFile(`${this.chinesePath}.tmp`, Object.entries(rules).map(([a, b]) => `${a}\t${b}`).join("\n"), "utf8");
      await rename(`${this.chinesePath}.tmp`, this.chinesePath);
      this.chineseRules = rules;
      return { ...this.chinesePackage, installed: true };
    }
    if (id === "ja-JP") {
      const response = await fetch(japaneseRulesUrl, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Japanese rules download failed: HTTP ${response.status}`);
      const content = await response.text();
      if (content.length > 1000000) throw new Error("Japanese rules package is too large");
      const rules = parseJapaneseRules(content);
      const licenseResponse = await fetch(japaneseRulesLicenseUrl, { signal: AbortSignal.timeout(30000) });
      if (!licenseResponse.ok) throw new Error("Japanese rules license download failed");
      const license = await licenseResponse.text();
      if (!license.includes("Permission is hereby granted")) throw new Error("Invalid Japanese rules license");
      await mkdir(dirname(this.japanesePath), { recursive: true });
      await writeFile(resolve(dirname(this.japanesePath), "japanese-rules-LICENSE.txt"), license, "utf8");
      await writeFile(`${this.japanesePath}.tmp`, Object.entries(rules).map(([a, b]) => `${a}\t${b}`).join("\n"), "utf8");
      await rename(`${this.japanesePath}.tmp`, this.japanesePath);
      this.japaneseRules = rules;
      return { ...this.japanesePackage, installed: true };
    }
    await this.loadDictionaryCatalog();
    const item = this.catalog.find((candidate) => candidate.id === id);
    if (!item || !item.affUrl || !item.dicUrl) throw new Error("Dictionary is not available for download");
    const [affResponse, dicResponse] = await Promise.all([fetch(item.affUrl), fetch(item.dicUrl)]);
    if (!affResponse.ok || !dicResponse.ok) throw new Error(`Dictionary download failed: ${id}`);
    const [aff, dic] = await Promise.all([affResponse.arrayBuffer(), dicResponse.arrayBuffer()]);
    if (aff.byteLength < 10 || dic.byteLength < 10) throw new Error(`Dictionary files are invalid: ${id}`);
    const directory = resolve(this.dictionariesPath, id);
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "index.aff.tmp"), Buffer.from(aff));
    await writeFile(resolve(directory, "index.dic.tmp"), Buffer.from(dic));
    await rename(resolve(directory, "index.aff.tmp"), resolve(directory, "index.aff"));
    await rename(resolve(directory, "index.dic.tmp"), resolve(directory, "index.dic"));
    await this.loadInstalledDictionaries();
    if (!this.engines.has(id)) throw new Error(`Dictionary failed self-test: ${id}`);
    return { ...item, installed: true };
  }

  async removeDictionary(id: string): Promise<void> {
    if (id === "zh-CN") {
      const { unlink } = await import("node:fs/promises");
      await unlink(this.chinesePath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      this.chineseRules = undefined;
      return;
    }
    if (id === "ja-JP") {
      const { unlink } = await import("node:fs/promises");
      await unlink(this.japanesePath).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
      this.japaneseRules = undefined;
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid dictionary identifier");
    if (id === "en-US" || id === "en-GB") throw new Error("Bundled English dictionaries cannot be removed");
    this.engines.delete(id);
    const directory = resolve(this.dictionariesPath, id);
    try { await access(directory); } catch { return; }
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
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
    if (language === "zh-CN") return this.chineseRules?.[word] ? [this.chineseRules[word]!] : [];
    if (language === "ja-JP") return this.japaneseRules?.[word] ? [this.japaneseRules[word]!] : [];
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

  checkText(text: string, language: string) {
    if (!this.enabled) return [];
    if (typeof text !== "string" || text.length > 2000000) throw new Error("Invalid spell-check text");
    if (language === "zh-CN" && this.chineseRules) return checkChineseText(text, this.chineseRules, this.personal);
    if (language === "ja-JP" && this.japaneseRules) return checkJapaneseText(text, this.japaneseRules, this.personal);
    return [];
  }
}
