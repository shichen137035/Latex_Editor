import { spawn } from "node:child_process";
import process from "node:process";
import electron from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron.trim(), ["apps/desktop/scripts/check-table.cjs"], { env, stdio: "inherit" });
child.on("error", (error) => { process.stderr.write(String(error)); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
