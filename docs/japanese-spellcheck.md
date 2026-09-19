# Japanese spell checking

TeXWeave treats Japanese separately from Hunspell dictionaries. The optional
`ja-JP` package contains a small, reviewed set of literal typo corrections from
[`textlint-rule-ja-no-abusage`](https://github.com/textlint-ja/textlint-rule-ja-no-abusage),
which is distributed under the MIT license.

## Installation and offline use

Open **Settings → Spell checking** and choose **Download / repair Japanese
rules**. TeXWeave downloads a pinned upstream revision, validates the expected
rules and license, and stores only the reviewed subset in the application data
directory. After that, checking works offline. Removing the Japanese package
disables only Japanese checking.

The source revision is pinned in `apps/desktop/src/main/japanese-rules.ts`, so a
future upstream edit cannot silently change the enabled rules.

## Scope

- Auto mode runs Japanese rules when a natural-language segment contains kana;
  English words in the same document continue to use Hunspell.
- Manual `ja-JP` mode enables the same Japanese rules explicitly.
- LaTeX commands, labels, references, citations, math, URLs, and comments are
  excluded by the existing LaTeX text extractor.
- Suggestions use the same red underline, replacement, ignore, and personal
  dictionary workflow as other languages.

This intentionally is not a Japanese grammar or style checker. It does not
bundle a tokenizer, morphological analyzer, language model, or a general
unknown-word dictionary. Avoiding those components keeps the package small and
prevents formal or technical Japanese from being flagged merely because it is
uncommon.
