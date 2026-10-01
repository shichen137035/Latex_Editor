# TeXWeave Architecture

This document describes the architecture in the current repository. The root `package.json` is the version and command source of truth; feature-specific contracts and migration notes are maintained alongside their implementation under `docs/`.

## Runtime boundaries

```text
Electron Renderer (React, Monaco, preview)
        │ window.latexEditor — preload allowlist
        ▼
Electron Main (application composition, IPC, native integrations)
        ├── application services ── editor-core / contracts / domain
        ├── filesystem, SQLite, resource-catalog and compiler adapters
        └── desktop services: AI, references, spellcheck, themes, settings

CLI ───────────────────────────── application services and adapters
```

- The renderer owns interaction and presentation. It does not access Node filesystem APIs, SQLite, or Electron directly.
- The preload exposes explicit methods; renderer features use that bridge rather than invoking arbitrary IPC channel names.
- The main process constructs application services and desktop integrations, then registers IPC handlers and creates the window.
- CLI commands call application services and adapters without going through Electron.
- `editor-core` is runtime-independent. Both the application layer and renderer can use its parsing and indexing logic. For example, the renderer's `preview/parser.ts` re-exports the shared preview parser.

## Repository map

| Path | Responsibility |
| --- | --- |
| `apps/desktop/src/main` | Electron startup, application composition, IPC, and desktop-only services such as AI, themes, spellcheck, and reference storage |
| `apps/desktop/src/preload` | Narrow, explicit renderer-to-main API bridge |
| `apps/desktop/src/renderer` | React workbench, source editor, visual preview, PDF, settings, search, AI, and reference UI |
| `apps/cli` | Scriptable project, file, resource, diagnostic, and compile commands |
| `packages/contracts` | Shared API/data contracts and error/result shapes |
| `packages/domain` | Runtime-independent values and policies, such as IDs, clocks, and path rules |
| `packages/application` | Use-case orchestration and project/document services |
| `packages/editor-core` | LaTeX/preview parsing, editor-independent transformations, block graph, source indexes, and query indexes |
| `packages/filesystem-node`, `registry-sqlite`, `resource-catalog`, `compiler-latexmk`, `diagnostics` | Node and external-process adapters; keep platform and I/O details outside core rules |
| `resources`, `themes` | Bundled catalogs, templates, skills, and theme assets |
| `tests` | Unit, integration, compiler, and CLI end-to-end tests |

## Document and block ownership

- LaTeX source files are the sole source of document text. Preview output is derived from source; it is not a second document store.
- The shared preview parser produces source ranges and document nodes. Renderer code may add interaction state, but should not create a divergent LaTeX parser.
- `ProjectBlockGraphService` owns stable block identities, structural parent/child links, semantic relations, persistence, and graph history. Project metadata is stored under `.texweave/`; source text is not copied into the graph store.
- `ProjectDocumentStructureService` builds the source-aware block index, exposes lightweight queries and revision-aware operations, and reuses the graph service's persistence and mutation coordination. Its API is the preferred surface for AI/document-structure consumers.
- Existing `block-graph` APIs remain the compatibility and relation-oriented surface. Keep graph navigation and relation operations there; use the document structure API for parsed source blocks, block content, and revision-checked document operations. Do not maintain separate persisted copies of the same block structure.
- `docs/block-structure-api.md` is the detailed contract for schema migration, block capabilities, AI tools, and structure queries.

## Data flows

### Project files and compilation

1. Application services validate the project and relative paths.
2. The filesystem adapter reads and writes project files; the SQLite registry stores project metadata, not source text.
3. The compiler adapter invokes the configured LaTeX toolchain and returns compile results and diagnostics.
4. Main-process IPC returns bounded results to the renderer; PDF bytes are provided to the PDF view through the existing application API.

### Visual preview and editing

1. The renderer reads the active source through the file API and passes it to the shared parser.
2. Parsed nodes preserve offsets/ranges back to source.
3. Preview edits are translated into source edits; successful changes update the editor buffer and its history.
4. PDF/source synchronization uses the compiler-produced SyncTeX data and the main-process integration.

### AI changes

1. `AIWorkspaceService` gathers project context and runs Codex/Copilot with the configured model and tools.
2. Editing occurs in an AI workspace copy so the original project is not silently overwritten during generation.
3. Resulting file changes are represented as reviewable hunks and applied through renderer/editor operations, preserving the user's ability to inspect and undo accepted edits.
4. TeXWeave's compile tool uses the application's compiler service rather than launching an unrelated compiler from the AI UI.

## Package and UI boundaries

- Contracts define shapes; they should not perform I/O.
- Domain and editor-core should remain independent of Electron, React, and the DOM.
- Application services coordinate use cases and depend on ports/adapters rather than concrete UI state.
- Node, SQLite, process, and desktop integrations belong in adapters or `apps/desktop/src/main`.
- Renderer components should own view state and interaction. Large components should be decomposed along behavior boundaries (for example, source editing, preview rendering, history, and selection), not split mechanically into arbitrary files.
- Internal workspace imports should be reflected consistently by TypeScript project references and package metadata so the actual dependency graph is inspectable.

## Validation commands

```powershell
npm run typecheck
npm run desktop:typecheck
npm run lint
npm run test
npm run resources:validate
```

Desktop UI regression scripts are available as `desktop:test-*` commands in the root `package.json`. Each launches the packaged development build in a controlled Electron session; run only the relevant focused checks while iterating, then use `npm run verify` for the full repository verification.
