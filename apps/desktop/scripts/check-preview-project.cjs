const { app, BrowserWindow } = require("electron");
const { mkdtempSync, statSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");

const projectPath = process.env.TEXWEAVE_TEST_PROJECT ?? "D:\\Documentspace\\Research\\Latex\\PPAR";
assert.equal(statSync(projectPath).isDirectory(), true, `test project exists: ${projectPath}`);
const root = mkdtempSync(resolve(tmpdir(), "texweave-preview-project-check-"));
app.setPath("userData", resolve(root, "user-data"));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let page;
const evaluate = (source) => page.webContents.executeJavaScript(source, true);

async function until(source, label, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(source)) return;
    await delay(100);
  }
  const state = await evaluate('({text:document.body.innerText.slice(0,1400), preview:!!document.querySelector(".structured-preview")})');
  throw new Error(`Timed out: ${label}\n${JSON.stringify(state)}`);
}

async function click(selector) {
  const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Missing selector"); el.scrollIntoView({block:"center",inline:"center"}); const r = el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  await delay(60);
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  await delay(220);
}

async function run() {
  for (let attempt = 0; attempt < 100 && BrowserWindow.getAllWindows().length === 0; attempt += 1) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  assert.ok(page, "app window");
  page.webContents.on("console-message", ({ level, message, lineNumber, sourceId }) => console.log(`renderer[${level}] ${sourceId}:${lineNumber} ${message}`));
  page.webContents.on("render-process-gone", (_event, details) => console.log(`renderer-gone ${JSON.stringify(details)}`));
  page.on("unresponsive", () => console.log("window-unresponsive"));
  await until("!!window.latexEditor", "preload");
  await page.webContents.executeJavaScript('window.addEventListener("error", (event) => console.log("window-error", event.error?.stack || event.message)); window.addEventListener("unhandledrejection", (event) => console.log("window-rejection", event.reason?.stack || String(event.reason)));', true);
  const registered = await evaluate(`window.latexEditor.projects.register(${JSON.stringify(projectPath)})`);
  const project = await evaluate(`window.latexEditor.projects.setMainFile(${JSON.stringify(registered.id)}, "main.tex")`);
  assert.equal(project.mainFile, "main.tex", "PPAR main file is detected");
  await page.webContents.reload();
  await until('!!document.querySelector(".project-row")', "project list");
  await click(".project-row");
  await until('!!document.querySelector(".workbench")', "workbench");
  const visualIndex = await evaluate('Array.from(document.querySelectorAll(".view-switch button")).findIndex(button => button.textContent === "Visual")');
  assert.ok(visualIndex >= 0, "Visual switch is available");
  await click(`.view-switch button:nth-child(${visualIndex + 1})`);
  await until('!!document.querySelector(".structured-preview")', "PPAR structured preview");
  const result = await evaluate('({katex:document.querySelectorAll(".katex").length, fallback:document.querySelectorAll(".preview-math-fallback").length, errors:document.querySelectorAll(".katex-error").length, nodes:document.querySelectorAll(".preview-block, .preview-content-region").length, text:document.querySelector(".structured-preview")?.textContent ?? ""})');
  assert.ok(result.katex > 0, `PPAR formulas rendered (${result.katex} KaTeX nodes)`);
  assert.equal(result.fallback, 0, "PPAR preview did not fall back to raw formula text");
  assert.ok(result.text.includes("Introduction"), "PPAR preview remains readable");
  console.log(`PASS actual PPAR project enters Visual (${result.katex} formulas, ${result.nodes} preview nodes, ${result.errors} unsupported-command markers)`);
  console.log("Test artifacts:", root);
}

require("../dist/main/index.js");
app.whenReady().then(() => run()).then(() => app.exit(0)).catch((error) => { console.error(error); console.error("Test artifacts:", root); app.exit(1); });
