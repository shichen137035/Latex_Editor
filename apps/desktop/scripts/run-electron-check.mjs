import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const checks = new Map([
  ["ai-attachments", { script: "electron/check-ai-attachments.cjs" }],
  ["ai-connection", { script: "electron/check-ai-connection.cjs", cleanCodexPath: true }],
  ["preview-caret", { script: "electron/check-preview-caret.cjs" }],
  ["preview-navigation", { script: "electron/check-preview-navigation.cjs" }],
  ["preview-scroll", { script: "electron/check-preview-scroll.cjs" }],
  ["project-references", { script: "electron/check-project-references.cjs" }],
  ["source-editor", { script: "electron/check-source-editor.cjs" }],
  ["auto-save", { script: "electron/check-auto-save.cjs" }],
  ["search-filter", { script: "electron/check-search-filter.cjs" }],
  ["environment-typography", { script: "electron/check-environment-typography.cjs" }],
  ["image-completion", { script: "electron/check-image-completion.cjs" }],
  ["table-editor", { script: "electron/check-table-editor.cjs" }],
  ["pdf-preview", { script: "electron/check-pdf-preview.cjs" }],
  ["multi-compile", { script: "electron/check-multi-compile.cjs" }],
  ["file-tree-state", { script: "electron/check-file-tree-state.cjs" }],
  ["i18n", { script: "electron/check-i18n.cjs" }],
  ["preview-startup", { script: "electron/check-preview-startup.cjs" }],
  ["preview-diagnostics", { script: "diagnostics/preview-performance.cjs" }]
]);
const name = process.argv[2];
const check = checks.get(name);
if (!check) {
  process.stderr.write(`Choose a check: ${[...checks.keys()].join(", ")}\n`);
  process.exit(2);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (check.cleanCodexPath) {
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path");
  if (pathKey) {
    const delimiter = process.platform === "win32" ? ";" : ":";
    env.PATH = env[pathKey].split(delimiter)
      .filter(value => !/[\\/]\.(?:vscode[^\\/]*|codex)(?:[\\/]|$)/i.test(value))
      .join(delimiter);
    if (pathKey !== "PATH") delete env[pathKey];
  }
}

const child = spawn(electron.trim(), [resolve(root, "apps/desktop/scripts", check.script)], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: false
});
child.once("error", error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
