# Chinese basic spell checking

Settings → Spell checking → Chinese — basic typo checking provides a Download / repair button.
The installer fetches a pinned pycorrector rule resource and its Apache-2.0 license. It only
enables the 21 phrase pairs reviewed in `apps/desktop/src/main/chinese-rules.ts`.
The unfiltered upstream corpus contains valid variants and incorrect replacements and must
not be enabled as a whole. This is a limited typo checker, not contextual grammar checking.

Download is user-initiated; subsequent checking is offline. No Python, model, native addon,
or segmentation package is required. Failed downloads/validation preserve the existing
rules. Download / repair reinstalls the version approved by this application release;
new rule versions are approved through application updates, not blindly fetched from HEAD.
The package can be removed from Installed languages. Global spell-check Disabled disables it.

The main-process `checkText` IPC returns UTF-16 ranges and suggestions for Chinese phrases.
The shared source/Visual editor controller checks extracted natural-language segments and
maps results to source offsets. Auto mode can check English words and Chinese phrases in the
same file; Manual Chinese also checks embedded English words. It never marks unknown Chinese
words as incorrect. Right-click offers replacement, session ignore and persistent personal
dictionary protection. Personal entries protect contained error matches inside those entries.

Rules are bounded to 21 short phrases, each using substring search. This avoids a new indexing
dependency; it is not Aho–Corasick. Checking is debounced and stale diagnostics are discarded.
For a substantially larger reviewed package, introduce a multi-pattern index and incremental
paragraph checking before increasing the package size.

Data source: https://github.com/shibing624/pycorrector/blob/fc8aa56c336276fbd8cdd3a49eef505dc67b8a6e/tests/custom_confusion.txt

The installer saves the filtered rules and upstream license under the existing spellcheck
user-data directory. Rule removal removes the active rule file; the license is retained.
