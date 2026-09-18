declare module "nspell" {
  interface SpellChecker {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string): SpellChecker;
  }
  function nspell(dictionary: { aff: Buffer; dic: Buffer }): SpellChecker;
  export = nspell;
}
