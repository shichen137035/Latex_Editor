import { spawn } from "node:child_process";
import process from "node:process";
import electron from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron.trim(), ["apps/desktop/scripts/check-preview-caret.cjs"], { env, stdio: "inherit" });
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
