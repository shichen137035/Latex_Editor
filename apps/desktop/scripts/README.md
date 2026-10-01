# Desktop checks and probes

Interactive regressions live in `electron/`; the preview timing diagnostic lives
in `diagnostics/`. Run either through `run-electron-check.mjs`; it owns Electron
startup, exit status, and any per-check environment setup.

```powershell
npm run desktop:test-ai
npm run desktop:test-preview-caret
npm run desktop:test-preview-startup
npm run desktop:diagnose-preview
```

The AI connection check uses an isolated profile and removes IDE-only Codex paths
and API-key variables to reproduce a normal Windows launch. It checks executable
discovery and the signed-out connection screen. It does not start a model turn.

`diagnostics/preview-performance.cjs`, run by `desktop:diagnose-preview`, is a
performance measurement tool. It prints click to
focus time, source caret offsets, long tasks, and rendered node counts for several
documents. Use its measurements when investigating regressions; it does not use a
pass/fail latency threshold.

`ai/probe.cjs` runs one optional, live Codex request against the production App
Server bridge. It needs an existing signed-in TeXWeave profile and the Codex
executable path. It can inspect a supplied workspace or edit a generated temporary
paper:

```powershell
npm run desktop:ai-probe -- read <workspace> <user-data-directory> <codex-executable>
npm run desktop:ai-probe -- edit <user-data-directory> <codex-executable>
```

The `read` probe asks the model to list filenames only. The `edit` probe only
changes a temporary paper and removes that paper after the run. Both probes send a
live model request and may use the account's available service quota.
