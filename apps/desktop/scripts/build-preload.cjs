const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "../../..");
const outfile = path.join(root, "apps/desktop/dist/preload/index.cjs");
fs.mkdirSync(path.dirname(outfile), { recursive: true });
// Native dialogs consume the same catalogs as the renderer, including packaged builds.
fs.cpSync(path.join(root, "apps/desktop/src/renderer/i18n/locales"), path.join(root, "apps/desktop/dist/main/locales"), { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(root, "apps/desktop/src/preload/index.cjs")],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
  legalComments: "none"
});

// The same build step serves normal starts, hot reload, packaging and desktop checks.
const result = require("node:child_process").spawnSync(process.execPath, [path.join(__dirname, "build-capabilities.cjs")], { cwd: root, stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
if (result.error || result.status !== 0) throw result.error ?? new Error("Capability registry generation failed");
