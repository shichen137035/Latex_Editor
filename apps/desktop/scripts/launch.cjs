const { spawn } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const electronExecutable = require("electron").trim();
const environment = { ...process.env };
// Some managed shells set this globally; it would make Electron behave as plain Node.js.
delete environment.ELECTRON_RUN_AS_NODE;
// MiKTeX's latexmk is a Perl script. Strawberry Perl is installed locally on
// Windows, but managed shells may not have refreshed PATH yet.
const perlPaths = ["C:\\Strawberry\\perl\\bin", "C:\\Strawberry\\c\\bin"];
environment.PATH = [...perlPaths, environment.PATH ?? ""].join(path.delimiter);

const child = spawn(electronExecutable, [path.resolve(root, "apps/desktop")], {
  cwd: root,
  env: environment,
  stdio: "inherit",
  windowsHide: false
});

child.once("error", (error) => {
  process.stderr.write(`Unable to launch Electron: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal === null ? 1 : 0);
});
