# Test strategy

The test suite is divided by what it proves. A scenario should live at the
lowest layer that can prove its behavior; higher layers cover real boundaries
and user-visible flows instead of repeating every unit assertion.

## Test layers

| Layer | Command | What it verifies |
| --- | --- | --- |
| Unit | `npm run test:unit` | Parsers, state transitions, validation, algorithms, renderer controllers and service policies in isolation. |
| Service integration | `npm run test:integration` | Project files, registry, document services, images and history connected through temporary project folders. |
| Real compiler | `npm run test:compiler` | `latexmk`, actual PDF output, structured diagnostics and forward/reverse SyncTeX. Requires a local TeX installation. |
| CLI workflow | `npm run test:cli` | Multi-process project operations, machine-readable responses and end-to-end CLI exit behavior. |
| Desktop regression | `npm run desktop:test-regression` | Built Electron application, user-visible interactions, IPC boundaries and filesystem effects in isolated test profiles. |
| Release gate | `npm run verify:release` | Static checks, resource validation, all test layers, desktop build and the release desktop regression suite. |

`npm test` runs all Vitest layers. `npm run test:catalog` checks that every
Vitest spec and every packaged Electron check has exactly one maintained
catalog entry. A newly added or renamed test cannot silently disappear from
the documented functional areas or desktop release suite.

`npm run i18n:check` is a separate strict language-completeness report. It also
lists incomplete locale catalogs that currently fall back to English; unit
tests still fail on unknown UI keys, hardcoded UI candidates and the complete
Simplified Chinese catalog.

## Unit test areas

Run one area with `npm run test:unit:<area>`:

| Area | Coverage |
| --- | --- |
| `ai` | Provider discovery and lifecycle, local conversation state, context and resource access, permissions, edits, attachments and message rendering. |
| `editor` | LaTeX document structure, blocks and operations, source editing, completion, navigation, selection, history, formatting and unsaved changes. |
| `preview` | Preview parsing and incremental updates, environment and directive behavior, math, images, tables, semantic colors, scroll state and SyncTeX data. |
| `projects` | Project metadata, directory paging and size, project sessions, block services and snapshot timing. |
| `references` | Citation and library models, relations, document search and filter safety. |
| `compiler` | Compile scheduling/targets/artifacts and diagnostic parsing. Actual tool execution belongs to the compiler integration layer. |
| `settings` | Settings and presets, shortcuts, localization, desktop IPC/security and spell-check rules. |

The unit catalog is in `tests/unit-domains.mjs`. It deliberately assigns each
spec to one area. Grouped runs use the same spec files as `npm run test:unit`;
they do not maintain parallel copies of behavior tests.

## Desktop regression coverage

`apps/desktop/scripts/electron-check-catalog.mjs` is the single desktop test
index. It groups application-level regressions for AI, editing, files,
projects, compiling, PDF, Visual Preview, figures, tables, search, references,
settings and the document-structure API. The release command runs every
deterministic check in that index once. Two legacy scripts are explicitly kept
out: the broad Preview script repeats focused cases, and the PPAR check requires
a separately supplied real project. The preview timing diagnostic is listed
separately and is excluded from pass/fail release checks because it reports
measurements instead of a stable correctness threshold.

Each Electron check creates its own temporary project and user-data folder.
Failing checks stop the release run at the first error and preserve their
printed artifact path. The runner reports the check ID, elapsed time, command
and process exit status. Screenshots and renderer logs are produced by the
checks that need them.

Most AI behavior is verified with local/mock providers so the suite is
repeatable and never consumes account quota. `npm run desktop:ai-probe` remains
an optional live-service check; it requires an authenticated local profile and
may use service quota, so it is not part of automated release verification.

`multi-compile` covers independent PDF targets, the preview document selector,
per-document reading positions, automatic following and its settings toggle,
included-file ownership, and local PDF links. The real compiler suite separately
verifies mutual `xr-hyper` dependencies and changed external label numbers,
without duplicating the UI assertions.

## Debugging a failure

```powershell
npm run test:debug
npm run test:unit:domain -- preview --debug
npm run desktop:test-check-list
npm run desktop:test-check -- search-filter
```

The verbose Vitest run is serial and includes source locations and slow-test
timings. To rerun one desktop check, use its ID from the catalog. `desktop:test-check`
builds first; the regression suite also builds once before starting its checks.

## Maintenance rules

- Add a focused unit test for a pure rule or state transition.
- Add an integration test when correctness depends on a service boundary,
  persistence, a real project tree, or process output.
- Add a desktop regression when correctness depends on actual Electron input,
  layout, window lifecycle, IPC wiring, or a user-visible end-to-end workflow.
- Do not duplicate the same assertion at every layer. Keep different-layer
  checks for distinct risks, such as a parser unit test and a real compiler
  diagnostic test.
- Keep test data in temporary folders and avoid user projects, global settings,
  network services and authenticated AI accounts.
- Register each new Vitest spec in `tests/unit-domains.mjs` or the corresponding
  test-layer file list. Add each Electron script to
  `apps/desktop/scripts/electron-check-catalog.mjs`.
