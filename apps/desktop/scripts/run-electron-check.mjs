import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { desktopChecks, desktopCheckById } from "./electron-check-catalog.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const requested = process.argv[2];
const releaseChecks = desktopChecks.filter(check => check.release !== false);

if (requested === "--list" || requested === "--list=json") {
  if (requested.endsWith("=json")) process.stdout.write(`${JSON.stringify(desktopChecks, null, 2)}\n`);
  else for (const check of desktopChecks) console.log(`${check.id.padEnd(24)} ${check.area.padEnd(16)} ${check.release === false ? "diagnostic" : "release"} — ${check.summary}`);
  process.exit(0);
}

if (!requested) {
  console.error("Choose a desktop check id or 'release'. Use --list to show the catalog.");
  process.exit(2);
}
const selected = requested === "release" ? releaseChecks : [desktopCheckById.get(requested)].filter(Boolean);
if (!selected.length) {
  console.error(`Unknown desktop check: ${requested}. Use --list to show available checks.`);
  process.exit(2);
}

function checkEnvironment(check) {
  const env = { ...process.env, ...check.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (check.cleanCodexPath) {
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    const pathKey = Object.keys(env).find(key => key.toLowerCase() === "path");
    if (pathKey) {
      const delimiter = process.platform === "win32" ? ";" : ":";
      env.PATH = env[pathKey].split(delimiter)
        .filter(value => !/[\\/]\.(?:vscode[^\\/]*|codex)(?:[\\/]|$)/i.test(value))
        .join(delimiter);
      if (pathKey !== "PATH") delete env[pathKey];
    }
  }
  return env;
}

async function runCheck(check) {
  const startedAt = Date.now();
  const script = resolve(root, "apps/desktop/scripts", check.script);
  const command = check.engine === "node" ? process.execPath : electron.trim();
  console.log(`\n[desktop:${check.id}] START — ${check.summary}`);
  await new Promise((done, reject) => {
    const child = spawn(command, [script, ...(check.args ?? [])], {
      cwd: root,
      env: checkEnvironment(check),
      stdio: "inherit",
      windowsHide: false
    });
    child.once("error", error => reject(new Error(`[desktop:${check.id}] could not start ${command} ${script}: ${error.stack ?? error.message}`, { cause: error })));
    child.once("exit", (code, signal) => {
      const duration = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code === 0 && !signal) {
        console.log(`[desktop:${check.id}] PASS (${duration}s)`);
        done();
      } else {
        reject(new Error(`[desktop:${check.id}] FAIL after ${duration}s (exit ${code ?? "none"}, signal ${signal ?? "none"}); command: ${command} ${script} ${(check.args ?? []).join(" ")}`));
      }
    });
  });
}

let passed = 0;
const suiteStartedAt = Date.now();
for (const check of selected) {
  try {
    await runCheck(check);
    passed += 1;
  } catch (error) {
    console.error(error.stack ?? error.message);
    console.error(`[desktop suite] Stopped after ${passed}/${selected.length} checks. The failed check's output above includes its test artifacts when available.`);
    process.exit(1);
  }
}
console.log(`\n[desktop suite] ${passed}/${selected.length} checks passed in ${((Date.now() - suiteStartedAt) / 1000).toFixed(1)}s.`);
