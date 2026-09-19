import type { SpellCheckMode, SpellCheckStatus } from "@latex-editor/contracts";
import type { editor, IDisposable } from "monaco-editor";
import { detectLanguage } from "./LanguageDetector.js";
import { extractLatexText, extractWords } from "./LatexTextExtractor.js";
import "./spellcheck.css";
import { t } from "../i18n/index.js";

type EditorApi = NonNullable<Window["latexEditor"]>;
// Shared by source and Visual editors for the lifetime of this app window.
const ignoredWords = new Set<string>();
const vocabularyChanged = "texweave:spellcheck-vocabulary-changed";

export interface SpellContextRequest {
  word: string;
  suggestions: string[];
  x: number;
  y: number;
  replace(value: string): void;
  ignore(): void;
  addToDictionary(): Promise<void>;
  hasSelection: boolean;
  copy(): void;
  cut(): void;
  pastePlain(): Promise<void>;
  deleteSelection(): void;
}

interface SpellErrorRange {
  word: string;
  start: number;
  end: number;
  suggestions?: string[];
}

interface SpellCheckControllerOptions {
  editor: editor.IStandaloneCodeEditor;
  api: EditorApi;
  getCurrentPath(): string | undefined;
  getMode(): SpellCheckMode;
  getManualLanguage(): string;
  onDetectedLanguage(language: string): void;
  onContextMenu(request: SpellContextRequest): void;
}

/** Shares LaTeX-aware dictionary and phrase-rule diagnostics between both editor modes. */
export class SpellCheckController {
  private readonly options: SpellCheckControllerOptions;
  private readonly contentListener: IDisposable;
  private readonly modelListener: IDisposable;
  private readonly contextListener: IDisposable;
  private decorationIds: string[] = [];
  private errors: SpellErrorRange[] = [];
  private readonly vocabularyListener = () => this.schedule();
  private activeLanguage = "en-US";
  private configuredKey = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private status: SpellCheckStatus | undefined;

  constructor(options: SpellCheckControllerOptions) {
    this.options = options;
    window.addEventListener(vocabularyChanged, this.vocabularyListener);
    this.contentListener = options.editor.onDidChangeModelContent(() => this.schedule());
    this.modelListener = options.editor.onDidChangeModel(() => { this.errors = []; this.decorationIds = []; this.schedule(); });
    const editorNode = options.editor.getDomNode();
    // Capture before Monaco opens its own menu; preventDefault alone in
    // onContextMenu is too late and leaves its menu covering our actions.
    const contextMenu = (event: MouseEvent) => {
      const position = options.editor.getTargetAtClientPoint(event.clientX, event.clientY)?.position;
      const model = options.editor.getModel();
      if (!position || !model) return;
      const offset = model.getOffsetAt(position);
      const error = this.errors.find((item) => offset >= item.start && offset <= item.end);
      if (!error) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const generation = this.generation;
      void (error.suggestions ? Promise.resolve(error.suggestions) : options.api.spellcheck.suggestions(error.word, this.activeLanguage)).then((suggestions) => {
        if (generation !== this.generation || model !== options.editor.getModel()) return;
        options.onContextMenu({
          word: error.word,
          suggestions,
          x: Math.min(event.clientX, window.innerWidth - 210),
          y: Math.min(event.clientY, window.innerHeight - 280),
          replace: (value) => this.replace(error, value),
          ignore: () => this.ignore(error.word),
          addToDictionary: () => this.addToDictionary(error.word),
          hasSelection: !options.editor.getSelection()?.isEmpty(),
          copy: () => options.editor.trigger("spellcheck", "editor.action.clipboardCopyAction", null),
          cut: () => options.editor.trigger("spellcheck", "editor.action.clipboardCutAction", null),
          pastePlain: async () => {
            const text = await navigator.clipboard.readText();
            options.editor.executeEdits("spellcheck-paste-plain", (options.editor.getSelections() ?? []).map((range) => ({ range, text, forceMoveMarkers: true })));
          },
          deleteSelection: () => options.editor.executeEdits("spellcheck-delete", (options.editor.getSelections() ?? []).map((range) => ({ range, text: "", forceMoveMarkers: true })))
        });
      }).catch((error: unknown) => console.error("Spelling suggestions failed", error));
    };
    editorNode?.addEventListener("contextmenu", contextMenu, true);
    this.contextListener = { dispose: () => editorNode?.removeEventListener("contextmenu", contextMenu, true) };
    this.schedule();
  }

  refresh(): void {
    this.schedule();
  }

  dispose(): void {
    this.generation++;
    window.removeEventListener(vocabularyChanged, this.vocabularyListener);
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.contentListener.dispose();
    this.modelListener.dispose();
    this.contextListener.dispose();
    this.options.editor.deltaDecorations(this.decorationIds, []);
    this.decorationIds = [];
  }

  private schedule(): void {
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.check().catch((error: unknown) => console.error("Spell check failed", error)); }, 400);
  }

  private async check(): Promise<void> {
    const requestGeneration = ++this.generation;
    const model = this.options.editor.getModel();
    const path = this.options.getCurrentPath();
    const mode = this.options.getMode();
    if (!model || !path || !/\.tex$/i.test(path) || mode === "disabled") {
      this.errors = [];
      this.options.editor.deltaDecorations(this.decorationIds, []);
      this.decorationIds = [];
      if (mode === "disabled") await this.configure(mode, "en-US");
      return;
    }
    const extracted = extractLatexText(model.getValue());
    const cjkScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    const japaneseScript = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
    const words = extractWords(extracted).filter((item) => !cjkScript.test(item.word) && !ignoredWords.has(item.word.toLocaleLowerCase()));
    if (!words.length && !extracted.segments.some((segment) => cjkScript.test(segment.text))) {
      this.errors = [];
      this.options.editor.deltaDecorations(this.decorationIds, []);
      this.decorationIds = [];
      return;
    }
    this.status = await this.options.api.spellcheck.status();
    const requested = mode === "manual" ? this.options.getManualLanguage() : detectLanguage(extracted.sample).language ?? "en-US";
    const language = mode === "manual" || this.status?.availableLanguages.includes(requested) ? requested : "en-US";
    this.activeLanguage = language;
    this.options.onDetectedLanguage(language);
    await this.configure(mode, language);
    if (!this.status?.availableLanguages.includes(language)) {
      this.errors = [];
      this.decorationIds = this.options.editor.deltaDecorations(this.decorationIds, []);
      return;
    }
    // Preserve UTF-16 offsets by checking each original text segment independently.
    const phraseErrors: SpellErrorRange[] = [];
    if ((mode === "auto" || language === "zh-CN") && this.status.availableLanguages.includes("zh-CN")) {
      for (const segment of extracted.segments) {
        if (!/\p{Script=Han}/u.test(segment.text)) continue;
        const matches = await this.options.api.spellcheck.checkText(segment.text, "zh-CN");
        if (requestGeneration !== this.generation) return;
        phraseErrors.push(...matches.filter((item) => !ignoredWords.has(item.word.toLocaleLowerCase())).map((item) => ({ ...item, start: segment.sourceStart + item.start, end: segment.sourceStart + item.end })));
      }
    }
    if ((mode === "auto" || language === "ja-JP") && this.status.availableLanguages.includes("ja-JP")) {
      for (const segment of extracted.segments) {
        // Kana is a reliable Japanese signal; requiring it avoids applying Japanese
        // rules to Chinese prose that happens to share Han characters.
        if (!japaneseScript.test(segment.text)) continue;
        const matches = await this.options.api.spellcheck.checkText(segment.text, "ja-JP");
        if (requestGeneration !== this.generation) return;
        phraseErrors.push(...matches.filter((item) => !ignoredWords.has(item.word.toLocaleLowerCase())).map((item) => ({ ...item, start: segment.sourceStart + item.start, end: segment.sourceStart + item.end })));
      }
    }
    const wordLanguage = language === "zh-CN" || language === "ja-JP" ? "en-US" : language;
    this.activeLanguage = wordLanguage;
    const misspelled = new Set((await this.options.api.spellcheck.checkWords([...new Set(words.map((item) => item.word))], wordLanguage)).map((word) => word.toLocaleLowerCase()));
    if (requestGeneration !== this.generation || model !== this.options.editor.getModel()) return;
    this.errors = [...phraseErrors, ...words.filter((item) => misspelled.has(item.word.toLocaleLowerCase())).map((item) => ({ word: item.word, start: item.sourceStart, end: item.sourceEnd }))];
    const decorations = this.errors.map((error) => ({
      range: { startLineNumber: model.getPositionAt(error.start).lineNumber, startColumn: model.getPositionAt(error.start).column, endLineNumber: model.getPositionAt(error.end).lineNumber, endColumn: model.getPositionAt(error.end).column },
      options: { inlineClassName: "spell-error", hoverMessage: { value: `Spelling: **${error.word}**` } }
    }));
    this.decorationIds = this.options.editor.deltaDecorations(this.decorationIds, decorations);
  }

  private async configure(mode: SpellCheckMode, language: string): Promise<void> {
    const key = `${mode}:${language}`;
    if (key === this.configuredKey) return;
    await this.options.api.spellcheck.configure(mode, language);
    this.configuredKey = key;
  }

  private replace(error: SpellErrorRange, value: string): void {
    const model = this.options.editor.getModel();
    if (!model) return;
    this.options.editor.executeEdits("spellcheck", [{ range: { startLineNumber: model.getPositionAt(error.start).lineNumber, startColumn: model.getPositionAt(error.start).column, endLineNumber: model.getPositionAt(error.end).lineNumber, endColumn: model.getPositionAt(error.end).column }, text: value, forceMoveMarkers: true }]);
    this.options.editor.focus();
  }

  private ignore(word: string): void {
    ignoredWords.add(word.toLocaleLowerCase());
    window.dispatchEvent(new Event(vocabularyChanged));
  }

  private async addToDictionary(word: string): Promise<void> {
    try {
      if (!await this.options.api.spellcheck.addToDictionary(word)) throw new Error("Dictionary rejected the word");
      window.dispatchEvent(new Event(vocabularyChanged));
    } catch (error) { window.alert(`${t("settings.saveFailed")} ${String(error)}`); }
  }
}
