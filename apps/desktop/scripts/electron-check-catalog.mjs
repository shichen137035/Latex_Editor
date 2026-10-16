/** One maintained index for desktop regression coverage and the release suite. */
export const desktopChecks = [
  { id: "codex-environment", area: "settings", script: "electron/check-codex-environment.cjs", summary: "Codex environment settings, install retry and missing-CLI action" },
  { id: "ai-connection", area: "ai", script: "electron/check-ai-connection.cjs", summary: "Provider discovery, fresh-profile initialization and signed-out UI", cleanCodexPath: true },
  { id: "ai-attachments", area: "ai", script: "electron/check-ai-attachments.cjs", summary: "Long-history composer, queued sending/priority controls and attachment cleanup" },
  { id: "ai-review", area: "ai", script: "check-ai-review.cjs", summary: "Permissions, review, undo and long-history input performance", env: { TEXWEAVE_UI_TEST_OFFSCREEN: "1" } },
  { id: "ai-history", area: "ai", script: "check-ai-history.cjs", summary: "Conversation grouping, search, delete confirmation and persistence" },
  { id: "source-editor", area: "editor", script: "electron/check-source-editor.cjs", summary: "Source editing, undo, cursor restoration and navigation history" },
  { id: "source-performance", area: "editor", script: "electron/check-source-performance.cjs", summary: "Long-file scrolling cost and continued editability" },
  { id: "document-title", area: "editor", script: "electron/check-document-title.cjs", summary: "Document title source editing, save and cancel boundaries" },
  { id: "edit-history", area: "editor", script: "check-edit-history.cjs", summary: "Shared undo and redo across Visual, Code, blocks and tables" },
  { id: "auto-save", area: "editor", script: "electron/check-auto-save.cjs", summary: "Idle timer, reset, custom interval and disabled state" },
  { id: "unsaved-exit-save", area: "editor", script: "check-unsaved-exit.cjs", args: ["save"], summary: "Cancel then save all dirty tabs and an unapplied Preview draft" },
  { id: "unsaved-exit-clean", area: "editor", script: "check-unsaved-exit.cjs", args: ["clean"], summary: "Clean exit does not show a save prompt" },
  { id: "unsaved-exit-failure", area: "editor", script: "check-unsaved-exit.cjs", args: ["failure"], summary: "Save failure keeps the window open and preserves files" },
  { id: "file-menu", area: "files", script: "check-file-menu.cjs", summary: "Create, rename, select main file, copy path and delete" },
  { id: "file-tree-state", area: "files", script: "electron/check-file-tree-state.cjs", summary: "First-open, persisted expansion, search and project isolation" },
  { id: "project-directory", area: "projects", script: "electron/check-project-directory.cjs", summary: "Project size, pagination, scrolling, filtering and sorting" },
  { id: "project-history", area: "projects", script: "check-history.cjs", summary: "Create, compare, restore, promote and remove snapshots in UI" },
  { id: "foundations", area: "settings", script: "check-foundations.cjs", summary: "Cross-manager persistence for locale, themes, resources, toolchain, snapshots and shortcuts" },
  { id: "multi-compile", area: "compiler", script: "electron/check-multi-compile.cjs", summary: "Multiple PDFs, output isolation, document following, reading positions and cross-document links" },
  { id: "compile-path", area: "compiler", script: "check-compile-path.cjs", summary: "Compiler discovery with a stale GUI PATH and real PDF result" },
  { id: "pdf-preview", area: "pdf", script: "electron/check-pdf-preview.cjs", summary: "Recompile position, AI compilation, failures and secondary targets" },
  { id: "pdf-viewer", area: "pdf", script: "check-pdf.cjs", summary: "Fit, zoom, resize and SyncTeX marker interaction" },
  { id: "preview-caret", area: "preview", script: "electron/check-preview-caret.cjs", summary: "Visual text-to-source caret mapping and pending edit boundaries" },
  { id: "preview-navigation", area: "preview", script: "electron/check-preview-navigation.cjs", summary: "Search, reference navigation and position restoration" },
  { id: "preview-scroll", area: "preview", script: "electron/check-preview-scroll.cjs", summary: "Stable scroll anchoring around delayed figures and tables" },
  { id: "preview-startup", area: "preview", script: "electron/check-preview-startup.cjs", summary: "Asynchronous project startup and TeX/non-TeX switching" },
  { id: "preview-large", area: "preview", script: "check-preview-large.cjs", summary: "Virtualized long documents, distant jumps and nested lists" },
  { id: "preview-labels", area: "preview", script: "check-preview-labels.cjs", summary: "Label editing, commit/cancel/save behavior and descendant label preservation" },
  { id: "environment-typography", area: "preview", script: "electron/check-environment-typography.cjs", summary: "Environment labels, title typography and configuration round trips" },
  { id: "semantic-colors", area: "themes", script: "electron/check-semantic-colors.cjs", summary: "Adaptive light/dark colors, fixed overrides and live theme changes" },
  { id: "image-completion", area: "figures", script: "electron/check-image-completion.cjs", summary: "Image replacement, captions, labels and project-wide completion" },
  { id: "table-editor", area: "tables", script: "electron/check-table-editor.cjs", summary: "Table scrolling, toolbar placement, expanded editing and configuration" },
  { id: "table-boundaries", area: "tables", script: "check-table.cjs", summary: "Figure/table block insertion boundaries and table operation persistence" },
  { id: "search-filter", area: "search", script: "electron/check-search-filter.cjs", summary: "Search, filter semantics, replace-all and narrow sidebar behavior" },
  { id: "project-references", area: "references", script: "electron/check-project-references.cjs", summary: "Project BibTeX discovery, citation insertion and library synchronization" },
  { id: "first-run-setup", area: "settings", script: "electron/check-first-run-setup.cjs", summary: "Initial setup, dictionary failure/retry, toolchain progress/cancel, durable completion and bundled styles" },
  { id: "settings-presets", area: "settings", script: "electron/check-settings-presets.cjs", summary: "Preset import/export dialogs and manager header layout" },
  { id: "settings-maintenance", area: "settings", script: "electron/check-settings-maintenance.cjs", summary: "Project/environment settings split, confirmed cache and registry cleanup, source preservation and restart" },
  { id: "i18n", area: "settings", script: "electron/check-i18n.cjs", summary: "Locale switching and native/renderer language synchronization" },
  { id: "spellcheck", area: "settings", script: "run-spellcheck-check-launch.cjs", engine: "node", summary: "Dictionary results, editor decorations, actions and persistence" },
  { id: "structure-api", area: "document-api", script: "check-structure-api.cjs", summary: "Real IPC read/write, stale revision rejection and Preview compatibility" },
  { id: "preview-diagnostics", area: "diagnostics", script: "diagnostics/preview-performance.cjs", summary: "Interactive timing and render-count measurements; diagnostic only", release: false }
];

/** Legacy checks intentionally kept out of the repeatable release run. */
export const excludedDesktopChecks = [
  { script: "check-preview.cjs", reason: "Legacy all-in-one interaction suite overlaps the focused caret, navigation, label, citation, environment and figure checks." },
  { script: "check-preview-project.cjs", reason: "Requires a separately supplied real PPAR project path and is not an isolated, repeatable release fixture." }
];

export const desktopCheckById = new Map(desktopChecks.map(check => [check.id, check]));
