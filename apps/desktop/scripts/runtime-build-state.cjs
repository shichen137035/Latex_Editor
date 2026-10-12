const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

/** Compare runnable output, not TypeScript's successful-build notifications. */
function runtimeBuildFingerprint(root, mainConfig) {
  const directories = new Set();
  const visited = new Set();
  function visit(configPath) {
    if (visited.has(configPath)) return;
    visited.add(configPath);
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const directory = path.dirname(configPath);
    if (config.compilerOptions?.outDir) directories.add(path.resolve(directory, config.compilerOptions.outDir));
    for (const reference of config.references ?? []) {
      const target = path.resolve(directory, reference.path);
      visit(fs.statSync(target).isDirectory() ? path.join(target, "tsconfig.json") : target);
    }
  }
  visit(mainConfig);
  const files = [];
  function collect(directory) {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(file);
      else if (entry.isFile() && /\.(?:js|cjs|mjs|json)$/.test(entry.name)) files.push(file);
    }
  }
  for (const directory of directories) collect(directory);
  const hash = createHash("sha256");
  for (const file of files.sort()) hash.update(path.relative(root, file)).update("\0").update(fs.readFileSync(file)).update("\0");
  return hash.digest("hex");
}

module.exports = { runtimeBuildFingerprint };
