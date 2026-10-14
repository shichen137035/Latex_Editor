const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");

function runtimeWorkspaces() {
  return fs.readdirSync(path.join(root, "packages"), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const directory = `packages/${entry.name}`;
      const manifest = JSON.parse(fs.readFileSync(path.join(root, directory, "package.json"), "utf8"));
      return { directory, name: manifest.name, manifest };
    })
    .filter(workspace => workspace.name !== "@latex-editor/test-support");
}

function distributionConfig() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return {
    ...manifest.build,
    files: [
      ...manifest.build.files,
      ...runtimeWorkspaces().map(workspace => ({
        from: workspace.directory,
        to: `node_modules/${workspace.name}`,
        filter: ["package.json", "dist/**/*", "!**/*.map", "!**/*.d.ts", "!**/*.d.cts"]
      }))
    ]
  };
}

module.exports = distributionConfig;
module.exports.runtimeWorkspaces = runtimeWorkspaces;
