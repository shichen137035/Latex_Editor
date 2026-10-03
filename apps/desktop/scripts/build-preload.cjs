const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const root = path.resolve(__dirname, "../../..");
const outfile = path.join(root, "apps/desktop/dist/preload/index.cjs");
fs.mkdirSync(path.dirname(outfile), { recursive: true });

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
