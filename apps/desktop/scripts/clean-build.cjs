const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const generatedDirectories = [path.join(root, "dist")];
const buildInfoFiles = [];

for (const workspaceGroup of ["apps", "packages"]) {
  const groupPath = path.join(root, workspaceGroup);
  if (!fs.existsSync(groupPath)) continue;
  for (const entry of fs.readdirSync(groupPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const workspacePath = path.join(groupPath, entry.name);
    generatedDirectories.push(path.join(workspacePath, "dist"));
    for (const child of fs.readdirSync(workspacePath, { withFileTypes: true })) {
      if (child.isFile() && child.name.endsWith(".tsbuildinfo")) buildInfoFiles.push(path.join(workspacePath, child.name));
    }
  }
}

let removed = 0;
for (const directory of generatedDirectories) {
  if (!fs.existsSync(directory)) continue;
  fs.rmSync(directory, { recursive: true, force: true });
  removed++;
}
for (const file of buildInfoFiles) {
  if (!fs.existsSync(file)) continue;
  fs.rmSync(file, { force: true });
  removed++;
}

process.stdout.write(`Cleaned ${removed} generated build entr${removed === 1 ? "y" : "ies"}.\n`);
