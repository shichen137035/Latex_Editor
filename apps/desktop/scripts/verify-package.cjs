const { spawn, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const asar = require("@electron/asar");
const { runtimeWorkspaces } = require("./distribution-config.cjs");

const root = path.resolve(__dirname, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseRoot = path.join(root, "release");
const latestFile = path.join(releaseRoot, "latest.json");
const defaultOutput = fs.existsSync(latestFile) ? path.join(releaseRoot, JSON.parse(fs.readFileSync(latestFile, "utf8")).directory) : path.join(releaseRoot, manifest.version);
const outputDirectory = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith("--")) ?? defaultOutput);
const appDirectory = path.join(outputDirectory, "win-unpacked");
const archivePath = path.join(appDirectory, "resources", "app.asar");

function requireFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile() || fs.statSync(filePath).size === 0) throw new Error(`Missing or empty ${label}: ${filePath}`);
}

function requireEntry(entries, entryPath, label) {
  if (!entries.has(entryPath)) throw new Error(`Missing ${label} in app.asar: ${entryPath}`);
}

function exportTargets(value) {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, target]) => key === "types" ? [] : exportTargets(target));
}

async function checkStartup(archiveHash, portable = false) {
  // Launch outside the checkout to prevent fallback to development node_modules.
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "texweave-package-check-"));
  const resolved = path.resolve(temporaryRoot);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("texweave-package-check-")) throw new Error("Unsafe startup-check cleanup path.");
  const isolatedApp = path.join(temporaryRoot, "app");
  const reportDirectory = path.join(temporaryRoot, "check");
  const checkName = portable ? "portable-startup" : "startup";
  const executable = portable ? path.join(temporaryRoot, "TeXWeave-portable.exe") : path.join(isolatedApp, "TeXWeave.exe");
  fs.mkdirSync(reportDirectory);
  try {
    if (portable) fs.copyFileSync(path.join(outputDirectory, `TeXWeave-${manifest.version}-x64-portable.exe`), executable);
    else fs.cpSync(appDirectory, isolatedApp, { recursive: true });
    const environment = { ...process.env, TEXWEAVE_PACKAGE_SMOKE_DIR: reportDirectory };
    for (const key of ["ELECTRON_RUN_AS_NODE", "NODE_PATH", "NODE_OPTIONS", "TEXWEAVE_RENDERER_URL"]) delete environment[key];
    let logs = "";
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [], { cwd: temporaryRoot, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const capture = data => { logs = (logs + data.toString()).slice(-1_000_000); };
      child.stdout.on("data", capture);
      child.stderr.on("data", capture);
      const timer = setTimeout(() => {
        if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        else child.kill();
        reject(new Error("Packaged application startup timed out after 55 seconds."));
      }, 55_000);
      child.once("error", error => { clearTimeout(timer); reject(error); });
      child.once("exit", code => {
        clearTimeout(timer);
        try {
          const reportFile = path.join(reportDirectory, "startup.json");
          const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, "utf8")) : undefined;
          if (code !== 0 || !report?.ok || !report.packaged || report.version !== manifest.version) throw new Error(report?.error ?? `Packaged startup failed (exit ${code}); report missing or invalid.\n${logs}`);
          fs.writeFileSync(path.join(outputDirectory, `${checkName}-check.json`), JSON.stringify({ ...report, archiveHash, checkedAt: new Date().toISOString() }, null, 2));
          resolve();
        } catch (error) { reject(error); }
      });
    }).finally(() => fs.writeFileSync(path.join(outputDirectory, `${checkName}.log`), logs));
  } finally {
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

async function verify() {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  if (lock.packages?.[""]?.version !== manifest.version) throw new Error("package-lock version does not match package.json.");
  requireFile(archivePath, "application archive");
  requireFile(path.join(appDirectory, "TeXWeave.exe"), "unpacked executable");
  const entries = new Set(asar.listPackage(archivePath).map(entry => entry.replaceAll("\\", "/").replace(/^\/+/, "")));
  const metadata = JSON.parse(asar.extractFile(archivePath, "package.json").toString("utf8"));
  if (metadata.version !== manifest.version || metadata.main !== manifest.main) throw new Error("Packaged version or entry point does not match source.");
  for (const entry of [manifest.main, "apps/desktop/dist/renderer/index.html", "apps/desktop/dist/preload/index.cjs"]) requireEntry(entries, entry, "application entry");
  for (const dependency of Object.keys(manifest.dependencies ?? {})) requireEntry(entries, `node_modules/${dependency}/package.json`, "production dependency");
  for (const workspace of runtimeWorkspaces()) {
    const prefix = `node_modules/${workspace.name}/`;
    requireEntry(entries, `${prefix}package.json`, "runtime workspace manifest");
    const packaged = JSON.parse(asar.extractFile(archivePath, path.normalize(`${prefix}package.json`)).toString("utf8"));
    if (packaged.name !== workspace.name) throw new Error(`Incorrect workspace alias: ${workspace.name}`);
    for (const target of exportTargets(packaged.exports)) {
      const entry = prefix + target.replace(/^\.\//, "");
      if (entry.includes("*")) {
        const [start, end] = entry.split("*");
        if (![...entries].some(candidate => candidate.startsWith(start) && candidate.endsWith(end))) throw new Error(`Missing workspace export: ${entry}`);
      } else requireEntry(entries, entry, "workspace export");
    }
  }
  if ([...entries].some(entry => entry.includes("test-support/"))) throw new Error("Development test support was included in the package.");
  for (const relativePath of ["resources/resources/commands/latex-commands.json", "resources/resources/environments/preview-environments.json", "resources/resources/ai/skills/latex-project/SKILL.md"]) requireFile(path.join(appDirectory, relativePath), "runtime resource");
  const themeDirectory = path.join(appDirectory, "resources/themes");
  if (!fs.existsSync(themeDirectory) || !fs.readdirSync(themeDirectory).some(entry => entry.endsWith(".css"))) throw new Error("Built-in themes are missing.");
  const hash = createHash("sha256").update(fs.readFileSync(archivePath)).digest("hex");
  if (process.argv.includes("--no-smoke")) {
    const report = JSON.parse(fs.readFileSync(path.join(outputDirectory, "startup-check.json"), "utf8"));
    if (!report.ok || !report.packaged || report.archiveHash !== hash) throw new Error("Startup check is absent or does not match this archive.");
  } else await checkStartup(hash);
  if (!process.argv.includes("--unpacked")) {
    requireFile(path.join(outputDirectory, `TeXWeave-${manifest.version}-x64-portable.exe`), "portable executable");
    await checkStartup(hash, true);
  }
  process.stdout.write(`Package verified: TeXWeave ${manifest.version}; workspace exports, backend, preload, IPC and home page startup passed.\n`);
}

verify().catch(error => {
  process.stderr.write(`Distribution verification failed: ${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
