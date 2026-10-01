const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const electronExecutable = require("electron").trim();
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electronExecutable, [path.resolve(__dirname, "run-spellcheck-check.mjs")], { cwd: root, env: environment, stdio: "inherit", windowsHide: true });
child.once("error", (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
child.once("exit", (code, signal) => { process.exitCode = code ?? (signal === null ? 1 : 0); });
