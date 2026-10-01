const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const manifest = require(path.join(root, "package.json"));
const electronBuilder = path.join(root, "node_modules/electron-builder/cli.js");
const verifyScript = path.join(__dirname, "verify-package.cjs");
const output = path.posix.join("release", manifest.version);

function run(label, script, args) {
  process.stdout.write(`${label}\n`);
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, stdio: "inherit" });
  if (result.error) {
    process.stderr.write(`${label} failed to start: ${result.error.message}\n`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("Creating Windows x64 installer and portable package...", electronBuilder, [
  "--win", "nsis", "portable", "--publish", "never", `-c.directories.output=${output}`
]);
run("Checking the packaged application and release artifacts...", verifyScript, [path.join(root, output)]);
