// Standalone cleanup runtime: launched by NSIS using Electron's Node mode.
// No app startup, IPC, project writes, or third-party modules are involved.
const fs = require("node:fs/promises");
const path = require("node:path");

const directories = [
  "config", "languages", "spellcheck", "templates", "style-resources", "themes", "ai", "cache",
  "Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache",
  "blob_storage", "Local Storage", "Session Storage", "Shared Dictionary", "Network", "Crashpad",
  "Crash Reports", "IndexedDB", "Service Worker", "databases", "logs", "WebStorage", "Dictionaries",
  "BrowserMetrics", "Safe Browsing"
];
const files = [
  "settings.json", "registry.sqlite", "registry.sqlite-wal", "registry.sqlite-shm",
  "references.sqlite", "references.sqlite-wal", "references.sqlite-shm", "Preferences", "Secure Preferences",
  "Local State", "DIPS", "DIPS-wal", "DIPS-shm", "Network Persistent State", "SharedStorage",
  "SharedStorage-wal", "QuotaManager", "QuotaManager-journal", "TransportSecurity", "Trust Tokens",
  "Trust Tokens-journal", "Cookies", "Cookies-journal", "LOCK", "SingletonCookie", "SingletonLock",
  "SingletonSocket", "window-state.json", "debug.log", "chrome_debug.log"
];
const normalize = value => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
function inside(parent, child) {
  const relative = path.relative(normalize(parent), normalize(child));
  return !relative || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}
async function info(file) {
  try { return await fs.lstat(file); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
async function assertRoot(root, expected) {
  if (!path.isAbsolute(root) || normalize(root) !== normalize(expected)) throw new Error("Cleanup is restricted to the current user's TeXWeave profile.");
  const stat = await info(root);
  if (stat?.isSymbolicLink() || (stat && !stat.isDirectory())) throw new Error("The TeXWeave data root must be a normal directory.");
  if (stat && !inside(await fs.realpath(path.dirname(expected)), await fs.realpath(root))) throw new Error("The TeXWeave data root resolves outside its expected location.");
}
async function projectPaths(root) {
  const database = path.join(root, "registry.sqlite");
  if (!await info(database)) return [];
  // Refuse a corrupt registry before removing anything. Unknown projects must
  // not be lost merely because their registration could not be read.
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return db.prepare("SELECT canonical_path FROM projects").all().map(row => {
      if (typeof row.canonical_path !== "string" || !path.isAbsolute(row.canonical_path)) throw new Error("The project registry contains an invalid path.");
      return path.resolve(row.canonical_path);
    });
  } finally { db.close(); }
}

async function cleanupUserData(profile, mode, options = {}) {
  if (!["keep", "purge"].includes(mode)) throw new Error("Unknown uninstall mode.");
  const appData = options.appData ?? process.env.APPDATA;
  const localData = options.localAppData ?? process.env.LOCALAPPDATA;
  if (!appData || !path.isAbsolute(appData) || !localData || !path.isAbsolute(localData)) throw new Error("Windows user-data directories are unavailable.");
  const root = path.resolve(profile);
  await assertRoot(root, path.join(appData, "TeXWeave"));
  const result = { mode, profile: root, dryRun: Boolean(options.dryRun), removed: [], retained: [] };
  if (mode === "keep") return result;
  const protectedPaths = await projectPaths(root);
  const updater = path.join(localData, "latex-editor-updater");
  const preserveRegistry = protectedPaths.some(project => inside(root, project) || inside(project, root) || inside(updater, project) || inside(project, updater));
  const targets = [];
  const add = async (base, relative) => {
    const target = path.resolve(base, relative);
    if (target === path.resolve(base) || !inside(base, target)) throw new Error("Unsafe cleanup target.");
    if (targets.some(item => normalize(item.target) === normalize(target))) return;
    const stat = await info(target);
    if (!stat) return;
    if (stat.isSymbolicLink()) { result.retained.push(target); return; }
    const realBase = await fs.realpath(base);
    const realTarget = await fs.realpath(target);
    if (stat.isSymbolicLink() || !inside(realBase, realTarget) || protectedPaths.some(project => inside(target, project) || inside(project, target))) {
      result.retained.push(target); return;
    }
    targets.push({ target, base: realBase });
  };
  if (await info(root)) {
    for (const name of new Set([...directories, ...files])) {
      // Retain registrations that protect in-profile projects, including on a
      // later retry. Deleting their registry would remove that protection.
      if (preserveRegistry && name.startsWith("registry.sqlite")) {
        if (await info(path.join(root, name))) result.retained.push(path.join(root, name));
      } else await add(root, name);
    }
    // Tools outside the default data directory always remain user-managed.
    // Even within it, delete a tool only when its ownership marker matches.
    const tools = path.join(root, "tools");
    if ((await info(tools))?.isSymbolicLink()) result.retained.push(tools);
    else {
      for (const [name, marker, field, value] of [
        ["TinyTeX", ".texweave-toolchain.json", "distribution", "tinytex"],
        ["MiKTeX", ".texweave-toolchain.json", "distribution", "miktex"],
        ["codex-cli", "node_modules/@openai/codex/package.json", "name", "@openai/codex"],
        ["copilot-cli", "node_modules/@github/copilot/package.json", "name", "@github/copilot"]
      ]) {
        const folder = path.join(tools, name);
        if (!await info(folder)) continue;
        let owned = false;
        try {
          const data = JSON.parse(await fs.readFile(path.join(folder, marker), "utf8"));
          owned = data[field] === value && (!["TinyTeX", "MiKTeX"].includes(name) || data.schemaVersion === 1);
        } catch { /* An unmarked or incomplete tool folder is not removed. */ }
        if (name === "codex-cli" && !owned) {
          try { const data = JSON.parse(await fs.readFile(path.join(folder, ".texweave-codex.json"), "utf8")); owned = data.schemaVersion === 1 && data.package === "@openai/codex"; } catch { /* Keep unowned folders. */ }
        }
        if (owned) await add(root, `tools/${name}`); else result.retained.push(folder);
      }
    }
  }
  // electron-builder caches the setup executable independently of userData.
  await assertRoot(updater, path.join(localData, "latex-editor-updater"));
  if (await info(updater)) {
    if (protectedPaths.some(project => inside(updater, project) || inside(project, updater))) result.retained.push(updater);
    else targets.push({ target: updater, base: await fs.realpath(localData) });
  }
  for (const { target, base } of targets) {
    // Recheck every resolved absolute path just before recursive removal.
    if (!inside(base, await fs.realpath(target)) || (await fs.lstat(target)).isSymbolicLink()) throw new Error("A cleanup path changed during uninstall.");
    if (!options.dryRun) await fs.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
    result.removed.push(target);
  }
  if (!options.dryRun) {
    // Remove only empty containers. Never recursively remove the profile root
    // or tools root: unknown/user-created files are intentionally retained.
    for (const folder of [path.join(root, "tools"), root]) {
      if ((await info(folder))?.isSymbolicLink()) continue;
      try { await fs.rmdir(folder); } catch (error) { if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error; }
    }
  }
  return result;
}

module.exports = { cleanupUserData };
if (require.main === module) {
  const args = process.argv.slice(2);
  const index = args.indexOf("--profile");
  const mode = args.find(arg => arg.startsWith("--mode="))?.slice(7);
  if (index < 0 || !args[index + 1] || !mode) { console.error("A cleanup mode and profile path are required."); process.exitCode = 1; }
  else cleanupUserData(args[index + 1], mode, { dryRun: args.includes("--dry-run") }).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
