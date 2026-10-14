const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const manifest = require(path.join(root, "package.json"));
const electronBuilder = path.join(root, "node_modules/electron-builder/cli.js");
const releaseRoot = path.join(root, "release");
const args = process.argv.slice(2);
const requestedName = args.find(arg => !arg.startsWith("--"));
if (args.some(arg => arg.startsWith("--") && arg !== "--skip-build")) throw new Error("Unknown distribution option.");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");
const outputName = requestedName ?? (fs.existsSync(path.join(releaseRoot, manifest.version)) ? `${manifest.version}-${stamp}` : manifest.version);
const output = path.resolve(releaseRoot, outputName);
if (path.dirname(output) !== releaseRoot) throw new Error("The release output must resolve directly under release/.");
if (fs.existsSync(output)) throw new Error(`Release output already exists; choose a new folder: ${output}`);

function run(label, script, scriptArgs) {
  process.stdout.write(`${label}\n`);
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.execPath, [script, ...scriptArgs], { cwd: root, env: environment, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status ?? "unknown"}).`);
}

try {
  if (!args.includes("--skip-build")) {
    const npm = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    if (!fs.existsSync(npm)) throw new Error("Run packaging through npm run desktop:package:win so the npm CLI can be located.");
    run("Rebuilding the desktop application from current source...", npm, ["run", "desktop:build"]);
  }
  const config = path.join(__dirname, "distribution-config.cjs");
  const common = ["--x64", "--publish", "never", "--config", config, `-c.directories.output=${output}`];
  run("Creating the unpacked Windows application...", electronBuilder, ["--win", ...common, "--dir"]);
  run("Checking packaged modules and isolated application startup...", path.join(__dirname, "verify-package.cjs"), [output, "--unpacked"]);
  run("Creating the Windows x64 portable executable (compression may take a few minutes)...", electronBuilder, ["--win", "portable", ...common, "--prepackaged", path.join(output, "win-unpacked")]);
  run("Verifying the final distribution...", path.join(__dirname, "verify-package.cjs"), [output, "--no-smoke"]);
  const artifact = `TeXWeave-${manifest.version}-x64-portable.exe`;
  const sha256 = createHash("sha256").update(fs.readFileSync(path.join(output, artifact))).digest("hex");
  fs.writeFileSync(path.join(output, `${artifact}.sha256`), `${sha256}  ${artifact}\n`);
  fs.writeFileSync(path.join(releaseRoot, "latest.json"), JSON.stringify({ version: manifest.version, directory: outputName, artifact, sha256 }, null, 2));
  process.stdout.write(`Distribution ready: ${path.join(output, artifact)}\n`);
} catch (error) {
  process.stderr.write(`Distribution failed: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
}
