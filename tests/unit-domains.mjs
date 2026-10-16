import { readdirSync } from "node:fs";
import { resolve } from "node:path";

/** Assign every unit spec to one functional area so targeted runs stay complete. */
export const unitDomains = [
  { id: "ai", title: "AI conversations, providers, edits, permissions, attachments and workspace context", prefixes: ["ai-", "codex-", "copilot-"] },
  { id: "editor", title: "Source editing, document structure, blocks, navigation, completion and edit history", prefixes: ["block-", "completion", "custom-block-selection", "document-", "edit-history", "editor-", "latex-folding", "latex-formatter", "navigation-", "outline", "source-model-content-guard", "symbol-pairing", "toolbar-insertion", "working-documents", "workspace-position", "unsaved-changes"] },
  { id: "preview", title: "Visual preview, environments, images, tables, math, PDF position and SyncTeX", prefixes: ["collapse-state", "environment-", "image-", "list-block-handlers", "math-", "pdf-position", "pdf-render", "preview-", "semantic-colors", "synctex", "table-system", "wheel-acceleration"], files: ["environment.test.ts"] },
  { id: "projects", title: "Project registration, files, metadata, size, navigation and snapshot timing", prefixes: ["directory-", "project-", "snapshot-timer"], exclude: ["project-references.test.ts", "project-reference-navigation.test.ts"] },
  { id: "references", title: "Citation library, project references, relations and search/filter behavior", prefixes: ["reference-library", "project-references", "project-reference-navigation", "relations", "relation-workflow", "search-", "source-references"] },
  { id: "compiler", title: "Compile targets, scheduling, artifacts, PDF diagnostics and compiler messages", prefixes: ["automatic-compile", "compile-", "compiler-artifacts", "diagnostics"] },
  { id: "settings", title: "Settings, shortcuts, localization, spell-check and desktop lifecycle/IPC/security", prefixes: ["first-run-setup", "uninstall-cleanup", "app-info", "desktop-dev", "desktop-ipc", "i18n", "keyboard-shortcuts", "renderer-security", "settings", "spellcheck"] }
];

export const testLayers = [
  { id: "unit", title: "Fast isolated behavior", directory: "tests/unit", files: null },
  { id: "integration", title: "Services connected to temporary project files and registries", directory: "tests/integration", files: ["document-service.test.ts", "image-import.test.ts", "project-export.test.ts", "project-files.test.ts", "project-history.test.ts"] },
  { id: "compiler", title: "Real latexmk and SyncTeX process integration", directory: "tests/compiler", files: ["latexmk.test.ts"] },
  { id: "cli-e2e", title: "End-to-end CLI workflows and machine-readable errors", directory: "tests/e2e-cli", files: ["workflow.test.ts"] }
];

export function unitFilesByDomain(root = process.cwd()) {
  const directory = resolve(root, "tests/unit");
  const files = readdirSync(directory).filter(name => name.endsWith(".test.ts")).sort();
  return Object.fromEntries(unitDomains.map(domain => [
    domain.id,
    files.filter(name => (domain.files?.includes(name) || domain.prefixes.some(prefix => name.startsWith(prefix))) && !domain.exclude?.includes(name))
  ]));
}
