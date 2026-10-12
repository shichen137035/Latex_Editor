# Memory lifecycle checks

This audit covers resource retention during repeated PDF viewing, compilation,
project navigation and AI requests. It does not establish a fixed total process
memory ceiling or replace a multi-hour heap-profile run.

## Ownership rules

- PDF page geometry remains available for navigation. Offscreen render tasks
  are cancelled, text nodes detached and native canvas bitmaps released after
  drawing settles. PDF.js document resources are released on replacement or exit.
- PDF figures keep a bounded thumbnail cache. Their loading tasks and workers
  are destroyed after thumbnail rendering, including errors and cancellation.
- Compilation diagnostics keep metadata, paths and log tails. Full base64 PDF
  data is retained by the active viewer, not by every target's diagnostic entry.
- Copilot detaches completed sessions, preserving resumable history on disk.
  Workspace tool/permission closures are released. A new request waits for any
  pending detach before resuming the same session. Changing projects does not
  detach or interrupt an active request.
- Codex releases routing/tool closures after completion, failed turn startup,
  process failure and shutdown. A failed transport also terminates its process.
- Fold-state caches use at most 128 file entries and two million serialized
  characters. Project exit releases cached copies without deleting persisted
  choices.

## Repeatable regression checks

Run the targeted unit checks:

```powershell
npx vitest run --project unit tests/unit/codex-runtime-lifecycle.test.ts tests/unit/copilot-reasoning-effort.test.ts tests/unit/ai-lifecycle.test.ts tests/unit/collapse-state.test.ts tests/unit/pdf-render-resources.test.ts tests/unit/compile-targets.test.ts
```

These cover repeated failed Codex starts, twenty completed Copilot sessions,
resuming saved history, bounded fold-state caching across 500 files, rendering
cancellation and keeping PDF payloads out of diagnostic storage.

For the built desktop UI, run `npm run desktop:test-pdf-preview`. Its fixture
also verifies that a distant offscreen PDF page loses its canvas while the
visible page remains rendered, along with scroll, zoom and compile navigation.

For a longer investigation, warm up the application first, then repeat the
same project/viewing workflow and capture renderer heap snapshots and Electron
process memory. Compare retained objects and live canvas/worker/model counts;
operating-system working-set growth alone does not prove an unreachable-object
leak. Saved conversation history and the currently open documents are deliberate
retained data. Do not introduce periodic forced garbage collection as a fix.
