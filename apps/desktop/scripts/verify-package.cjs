const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const root = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const outputDirectory = path.resolve(process.argv[2] ?? path.join(root, "release", manifest.version));
const appDirectory = path.join(outputDirectory, "win-unpacked");
const archivePath = path.join(appDirectory, "resources", "app.asar");

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) {
    throw new Error(`Missing or empty ${label}: ${path.relative(root, filePath)}`);
  }
}

function requireArchiveEntry(entries, entryPath, label) {
  const normalized = entryPath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!entries.has(normalized)) throw new Error(`Missing ${label} in app.asar: ${normalized}`);
}

function verify() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  if (lock.packages?.[""]?.version !== manifest.version) {
    throw new Error(`package-lock version (${lock.packages?.[""]?.version ?? "missing"}) does not match package.json (${manifest.version}).`);
  }

  requireFile(archivePath, "application archive");
  const entries = new Set(asar.listPackage(archivePath).map((entry) => entry.replaceAll("\\", "/").replace(/^\/+/, "")));
  const packagedManifest = JSON.parse(asar.extractFile(archivePath, "package.json").toString("utf8"));
  if (packagedManifest.version !== manifest.version) {
    throw new Error(`Packaged version (${packagedManifest.version}) does not match source version (${manifest.version}).`);
  }
  if (packagedManifest.main !== manifest.main) throw new Error("Packaged Electron entry does not match the source manifest.");

  for (const [entryPath, label] of [
    [manifest.main, "Electron main process"],
    ["apps/desktop/dist/renderer/index.html", "renderer entry point"],
    ["apps/desktop/dist/preload/index.cjs", "bundled sandbox preload"],
    ["apps/desktop/src/preload/index.cjs", "isolated preload script"],
    ["packages/contracts/dist/desktop-ipc.cjs", "shared desktop IPC contract"]
  ]) requireArchiveEntry(entries, entryPath, label);

  for (const dependency of Object.keys(manifest.dependencies ?? {})) {
    requireArchiveEntry(entries, `node_modules/${dependency}/package.json`, `runtime dependency ${dependency}`);
  }
  for (const directory of fs.readdirSync(path.join(root, "packages"), { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const packageRoot = path.join(root, "packages", directory.name);
    const packageManifestPath = path.join(packageRoot, "package.json");
    if (!fs.existsSync(packageManifestPath)) continue;
    const packageManifest = JSON.parse(fs.readFileSync(packageManifestPath, "utf8"));
    if (packageManifest.name === "@latex-editor/test-support") continue;
    requireArchiveEntry(entries, `packages/${directory.name}/package.json`, `${packageManifest.name} workspace manifest`);
    requireArchiveEntry(entries, `packages/${directory.name}/dist/index.js`, `${packageManifest.name} runtime entry`);
  }
  if ([...entries].some((entry) => entry.startsWith("packages/test-support/"))) {
    throw new Error("Development-only test support was included in the runtime package.");
  }

  for (const relativePath of [
    "resources/resources/commands/latex-commands.json",
    "resources/resources/environments/preview-environments.json",
    "resources/resources/ai/skills/latex-project/SKILL.md"
  ]) requireFile(path.join(appDirectory, relativePath), `runtime resource ${relativePath}`);

  const themeDirectory = path.join(appDirectory, "resources", "themes");
  if (!fs.existsSync(themeDirectory) || !fs.readdirSync(themeDirectory).some((entry) => entry.toLowerCase().endsWith(".css"))) {
    throw new Error("No built-in theme CSS files were copied to the packaged resources.");
  }

  const artifacts = [`TeXWeave-${manifest.version}-x64-portable.exe`];
  for (const artifact of artifacts) requireFile(path.join(outputDirectory, artifact), `release artifact ${artifact}`);
  process.stdout.write(`Package verified: TeXWeave ${manifest.version} (Windows x64 portable).\n`);
}

try {
  verify();
} catch (error) {
  process.stderr.write(`Distribution verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
