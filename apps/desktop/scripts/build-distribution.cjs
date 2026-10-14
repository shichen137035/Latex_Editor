const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const manifest = require(path.join(root, "package.json"));
const electronBuilder = path.join(root, "node_modules/electron-builder/cli.js");
const releaseRoot = path.resolve(root, "release");
const output = path.resolve(releaseRoot, manifest.version);
if (path.dirname(output) !== releaseRoot) throw new Error("The release version must resolve directly under release/.");
fs.rmSync(output, { recursive: true, force: true });

function run(label, script, args) {
  process.stdout.write(`${label}\n`);
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`${label} failed to start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("Creating the Windows x64 portable package...", electronBuilder, [
  "--win", "portable", "--publish", "never", `-c.directories.output=${output}`
]);
