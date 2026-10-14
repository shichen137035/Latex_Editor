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

Performance regressions use separate evidence: `source-performance` checks
long-file scrolling and full-document reads; `ai-review` checks history render
counts and input timing; AI lifecycle unit tests check that bursts of streamed
text/reasoning produce bounded history snapshots for both providers, preserve
all text and flush completion without delayed stale updates. Queue shutdown
tests hold context preparation open while closing and verify that final history
retains the interrupted request. File integration tests inject temporary and
persistent replacement locks, checking successful recovery or preservation of
the original source and cleanup of temporary files. `ai-attachments`
checks the actual composer dimensions and scroll overflow rather than assuming
JavaScript sets an inline height.

Keep each desktop check's catalog environment when running it. Do not force
`TEXWEAVE_UI_TEST_OFFSCREEN=1` across the whole suite: maximization assertions
and PDF reading-position checks depend on the real viewport. A small hidden
window can clamp scrolling before the last page reaches the top. Reproduce
such failures in the normal window before diagnosing an application defect.

性能回归分别检查：`source-performance` 的长文件滚动和全文读取次数、
`ai-review` 的历史消息渲染次数及输入耗时，以及 AI 生命周期单元测试中
两种接口的流式更新合并、完整文字保留和结束通知。`ai-attachments` 检查
输入框实际尺寸及内部滚动，不依赖某一种高度实现。队列退出测试模拟准备上下文时
关闭程序，验证最终历史仍保留被中断的请求；文件集成测试模拟临时和持续的替换锁，
验证恢复保存，或在失败时保留原文并清理临时文件。

桌面检查应使用目录中各自的运行环境，不要统一强制
`TEXWEAVE_UI_TEST_OFFSCREEN=1`。最大化状态与 PDF 阅读位置依赖实际窗口尺寸；
较小的隐藏窗口可能让最后一页无法滚动到顶部。此类失败应先在正常窗口中复现，
再判断是否属于软件问题。

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
