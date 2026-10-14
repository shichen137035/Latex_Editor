const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { runtimeBuildFingerprint } = require("./runtime-build-state.cjs");

const root = path.resolve(__dirname, "../../..");
const mainConfig = path.join(root, "apps/desktop/tsconfig.main.json");
const preloadBuildScript = path.join(root, "apps/desktop/scripts/build-preload.cjs");
const tsc = path.join(root, "node_modules/typescript/bin/tsc");
const vite = path.join(root, "node_modules/vite/bin/vite.js");
let rendererUrl;

if (!fs.existsSync(tsc) || !fs.existsSync(vite)) {
  process.stderr.write("Desktop dependencies are missing. Run npm install first.\n");
  process.exit(1);
}

process.stdout.write("Building the desktop main process and runtime packages...\n");
const initialBuild = spawnSync(process.execPath, [tsc, "-b", mainConfig, "--pretty", "false"], {
  cwd: root,
  stdio: "inherit"
});
if (initialBuild.error) {
  process.stderr.write(`Unable to run TypeScript: ${initialBuild.error.message}\n`);
  process.exit(1);
}
if (initialBuild.status !== 0) process.exit(initialBuild.status ?? 1);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const perlPaths = ["C:\\Strawberry\\perl\\bin", "C:\\Strawberry\\c\\bin"];
const pathKeys = Object.keys(environment).filter((key) => key.toLowerCase() === "path");
const inheritedPaths = pathKeys.map((key) => environment[key]).filter(Boolean);
for (const key of pathKeys) delete environment[key];
environment.PATH = [...perlPaths, ...inheritedPaths].join(path.delimiter);

let viteServer;
let preloadWatcher;
let watcherProcess;
let electronProcess;
let stopping = false;
let restartingElectron = false;
let watcherInitialized = false;
let restartTimer;
let runningFingerprint;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearTimeout(restartTimer);
  preloadWatcher?.close();
  void viteServer?.close();
  for (const child of [electronProcess, watcherProcess]) {
    if (child && child.exitCode === null) child.kill();
  }
  process.exitCode = code;
}

function failChild(name, child, code, signal) {
  if (stopping) return;
  if (child === electronProcess && restartingElectron) {
    restartingElectron = false;
    launchElectron();
    return;
  }
  const exitCode = code ?? (signal ? 1 : 0);
  if (child === electronProcess) {
    stop(exitCode);
    return;
  }
  process.stderr.write(`${name} exited unexpectedly${signal ? ` (${signal})` : ` with code ${exitCode}`}.\n`);
  stop(exitCode || 1);
}

function launchElectron() {
  if (stopping) return;
  const preloadBuild = spawnSync(process.execPath, [preloadBuildScript], { cwd: root, env: environment, stdio: "inherit" });
  if (preloadBuild.error || preloadBuild.status !== 0) {
    process.stderr.write(`Unable to build the sandboxed preload${preloadBuild.error ? `: ${preloadBuild.error.message}` : "."}\n`);
    stop(preloadBuild.status ?? 1);
    return;
  }
  const electronExecutable = require("electron").trim();
  const electronEnvironment = { ...environment, TEXWEAVE_RENDERER_URL: rendererUrl };
  try { runningFingerprint = runtimeBuildFingerprint(root, mainConfig); }
  catch (error) {
    process.stderr.write(`Unable to inspect the runtime build: ${error.message}\n`);
    stop(1);
    return;
  }
  const launched = spawn(electronExecutable, [path.join(root, "apps/desktop")], {
    cwd: root,
    env: electronEnvironment,
    stdio: "inherit",
    windowsHide: false
  });
  electronProcess = launched;
  launched.once("error", (error) => {
    process.stderr.write(`Unable to launch Electron: ${error.message}\n`);
    stop(1);
  });
  launched.once("exit", (code, signal) => failChild("Electron", launched, code, signal));
}

function scheduleElectronRestart(force = false) {
  if (stopping || !watcherInitialized) return;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (stopping || restartingElectron || !electronProcess || electronProcess.exitCode !== null) return;
    let nextFingerprint;
    try { nextFingerprint = runtimeBuildFingerprint(root, mainConfig); }
    catch (error) {
      process.stderr.write(`Unable to inspect the runtime build; keeping Electron running: ${error.message}\n`);
      return;
    }
    if (force || nextFingerprint !== runningFingerprint) {
      process.stdout.write("Main-process runtime files changed. Restarting Electron in development mode...\n");
      restartingElectron = true;
      electronProcess.kill();
    }
  }, 450);
}

function watchMainProcess() {
  watcherProcess = spawn(process.execPath, [
    tsc,
    "-b",
    mainConfig,
    "--watch",
    "--pretty",
    "false",
    "--preserveWatchOutput"
  ], { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });

  let output = "";
  const consume = (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    output = (output + text).slice(-12000);
    if (/error TS\d+|Found [1-9]\d* errors?\./.test(output)) {
      clearTimeout(restartTimer);
      output = "";
      return;
    }
    if (/Found 0 errors?\. Watching for file changes\./.test(output)) {
      if (watcherInitialized) scheduleElectronRestart();
      else watcherInitialized = true;
      output = "";
    }
  };
  watcherProcess.stdout.on("data", consume);
  watcherProcess.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    output = (output + text).slice(-12000);
    if (/error TS\d+|Found [1-9]\d* errors?\./.test(output)) {
      clearTimeout(restartTimer);
      output = "";
    }
  });
  watcherProcess.once("error", (error) => {
    process.stderr.write(`Unable to start the TypeScript watcher: ${error.message}\n`);
    stop(1);
  });
  watcherProcess.once("exit", (code, signal) => failChild("TypeScript watcher", watcherProcess, code, signal));
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

// Own the server instead of polling a fixed port that may belong to another run.
async function start() {
  const { createServer } = await import("vite");
  viteServer = await createServer({
    configFile: path.join(root, "apps/desktop/vite.config.ts"),
    server: { host: "127.0.0.1", port: 5173, strictPort: false },
    optimizeDeps: { force: true }
  });
  await viteServer.listen();
  if (stopping) { await viteServer.close(); return; }
  rendererUrl = viteServer.resolvedUrls.local[0];
  if (!rendererUrl) throw new Error("Vite did not provide a local renderer URL");
  viteServer.printUrls();
  watchMainProcess();
  preloadWatcher = fs.watch(path.join(root, "apps/desktop/src/preload"), { recursive: true }, () => scheduleElectronRestart(true));
  process.stdout.write("Renderer ready. Starting TeXWeave with hot reload.\n");
  launchElectron();
}
start().catch(error => {
  console.error("Unable to start Debug:", error);
  stop(1);
});
