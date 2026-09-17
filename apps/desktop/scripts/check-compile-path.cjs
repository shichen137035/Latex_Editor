const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");

const root = mkdtempSync(resolve(tmpdir(), "texweave-compile-path-check-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "user-data"));

// Reproduce an app launched by Explorer before MiKTeX updated the user PATH.
const windowsRoot = process.env.SystemRoot || "C:\\Windows";
process.env.PATH = `${windowsRoot}\\System32;${windowsRoot}`;

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function run() {
  for (let attempt = 0; attempt < 100 && BrowserWindow.getAllWindows().length === 0; attempt += 1) await delay(100);
  const page = BrowserWindow.getAllWindows()[0];
  assert.ok(page, "app window");
  const evaluate = (source) => page.webContents.executeJavaScript(source, true);
  for (let attempt = 0; attempt < 100 && !(await evaluate("!!window.latexEditor")); attempt += 1) await delay(100);
  const project = await evaluate(`window.latexEditor.projects.create({name:"compile-path-test",parentPath:${JSON.stringify(projects)}})`);
  const source = String.raw`\documentclass{article}
\begin{document}
Electron GUI PATH recovery works.
\end{document}`;
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", ${JSON.stringify(source)})`);
  await evaluate(`window.latexEditor.projects.setMainFile(${JSON.stringify(project.id)}, "main.tex")`);
  const result = await evaluate(`window.latexEditor.compile.run(${JSON.stringify(project.id)}, "main.tex")`);
  assert.equal(result.status, "succeeded");
  assert.match(result.pdfDataUrl, /^data:application\/pdf;base64,/);
  console.log("PASS Electron compilation recovers MiKTeX from a stale GUI PATH and returns PDF data");
  console.log("Test artifacts:", root);
}

require("../dist/main/index.js");
app.whenReady().then(() => run()).then(() => app.exit(0)).catch((error) => { console.error(error); console.error("Test artifacts:", root); app.exit(1); });
