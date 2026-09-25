const { spawn } = require("node:child_process");
const { delimiter } = require("node:path");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.OPENAI_API_KEY;
delete env.CODEX_API_KEY;
const pathKeys = Object.keys(env).filter(key => key.toLowerCase() === "path");
const paths = pathKeys.flatMap(key => (env[key] ?? "").split(delimiter));
for (const key of pathKeys) delete env[key];
// Reproduce Explorer/Start.bat, which cannot see the agent/IDE-injected Codex PATH.
env.PATH = paths.filter(value => !/[\\/]\.(?:vscode[^\\/]*|codex)(?:[\\/]|$)/i.test(value)).join(delimiter);
const child = spawn(require("electron").trim(), ["apps/desktop/scripts/check-ai-connection.cjs"], { env, stdio: "inherit", windowsHide: true });
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
