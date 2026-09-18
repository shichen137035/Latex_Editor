# Spell checking architecture

TeXWeave uses `nspell`, a mature Hunspell-compatible engine, with the installed `dictionary-en` (US) and `dictionary-en-gb` (UK) packages. Their `.aff` rules and `.dic` dictionaries ship as runtime dependencies. Checking is offline; user text is never sent to a service. Run `npm install` on a new development machine; no Windows proofing pack, Chrome profile, or separate executable is required.

The previous Electron implementation advertised languages before verifying an actual dictionary. In the failing runtime, `webFrame.isWordMisspelled("recieve")` returned false even after waiting for initialization. A separate Windows COM experiment returned `E_ACCESSDENIED`. These results do not establish that all Windows installations are broken; they establish that those providers could not be relied on in this environment. The offline provider replaces that failing path without changing the editor-facing API.

## Runtime flow

1. The main-process `OfflineSpellCheckService` loads each dictionary once and tests `receive` and `recieve` before advertising its language. Status includes load failures and the personal dictionary path.
2. The preload bridge exposes status, per-word checks, suggestions, and dictionary operations to the renderer. Renderer code never receives unrestricted Electron APIs.
3. `LatexTextExtractor` masks comments, math, command names, references, citations, URLs, paths, and code-like environments while preserving source offsets.
4. `SpellCheckController` debounces changes for 400 ms, checks unique words via IPC, and maps misspellings to Monaco decorations. A bounded 10,000-word language-aware cache avoids repeated dictionary lookups. Text extraction still scans the model; this is not yet paragraph-level incremental parsing. Model switches, edits, and disposal invalidate pending responses.
5. A DOM capture listener intercepts right-clicks on misspellings before Monaco opens its default menu. Suggestions replace only the error range; other positions retain Monaco's menu. Source and Visual inline editors share the controller.
6. Ignore is shared across editors for the app-window session. Add to Dictionary writes to `<userData>/spellcheck/personal.json` using serialized temporary-file/rename writes, then updates loaded engines and invalidates the cache. Failed saves are reported rather than silently ignored. This is TeXWeave's personal dictionary, not the Windows system dictionary.

## Settings

`spellCheckMode` and `spellCheckLanguage` are global preferences. Auto mode may update the detected display language without changing the manual preference. Manual mode fixes the selected provider language. Disabled mode clears spell decorations and disables provider checks.

Settings > Spell checking reports the actual provider, platform, installed dictionaries, availability, personal dictionary path, and load errors. The language menu lists the two successfully loaded English dictionaries. Unsupported automatically detected languages fall back to US English; an unavailable manually selected language is not silently changed. Other languages require additional dictionary packages and explicit provider registration; they are not currently claimed as supported.

## Verification

Run `npm run desktop:test-spellcheck`. It builds the app and launches an isolated Electron session with a temporary project and user-data directory. The test checks real word results and suggestions, computed red wavy underline styles, actual right-click Ignore/Add actions, personal dictionary persistence after service reload, and Visual inline correction. It saves source and Visual screenshots in the printed temporary artifact directory. It never writes to the user's real project or personal dictionary.

This feature intentionally does not implement grammar checking, AI rewriting, or a separate custom dictionary engine.
