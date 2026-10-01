import { spawn } from "node:child_process";
import console from "node:console";
import process from "node:process";
import electron from "electron";

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron.trim(), ["apps/desktop/scripts/check-unsaved-exit.cjs", process.argv[2] || "save"], { env, stdio: "inherit" });
child.on("error", error => { console.error(error); process.exit(1); });
child.on("exit", code => process.exit(code ?? 1));
