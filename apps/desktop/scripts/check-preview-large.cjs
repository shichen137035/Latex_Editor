const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");

const root = mkdtempSync(resolve(tmpdir(), "texweave-preview-large-check-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "user-data"));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let page;
const evaluate = (source) => page.webContents.executeJavaScript(source, true);

async function until(source, label, attempts = 160) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(source)) return;
    await delay(100);
  }
  const state = await evaluate('({text:document.body.innerText.slice(0,1400), preview:!!document.querySelector(".structured-preview"), notice:!!document.querySelector(".preview-limit-notice")})');
  throw new Error(`Timed out: ${label}\n${JSON.stringify(state)}`);
}

async function click(selector) {
  const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Missing selector"); el.scrollIntoView({block:"center",inline:"center"}); const r = el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  await delay(60);
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  await delay(180);
}

const sections = Array.from({ length: 1400 }, (_, index) => [
  `\\section{Section ${index + 1}}`,
  `This is paragraph ${index + 1} with inline mathematics $x_${index + 1} + y_${index + 1} = z_${index + 1}$.`,
  ""
].join("\n")).join("\n");
const source = String.raw`\documentclass{article}
\begin{document}
${sections}
\begin{equation}
E = mc^2
\end{equation}
\end{document}`;

async function run() {
  for (let attempt = 0; attempt < 100 && BrowserWindow.getAllWindows().length === 0; attempt += 1) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  assert.ok(page, "app window");
  await until("!!window.latexEditor", "preload");
  assert.equal(page.isMaximized(), true, "main window opens maximized");
  const project = await evaluate(`window.latexEditor.projects.create({name:"large-preview-test",parentPath:${JSON.stringify(projects)}})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", ${JSON.stringify(source)})`);
  await page.webContents.reload();
  await until('!!document.querySelector(".project-row")', "project list");
  await click(".project-row");
  await until('!!document.querySelector(".workbench")', "workbench");
  const visualIndex = await evaluate('Array.from(document.querySelectorAll(".view-switch button")).findIndex(button => button.textContent === "Visual")');
  assert.ok(visualIndex >= 0, "Visual switch is available");
  await click(`.view-switch button:nth-child(${visualIndex + 1})`);
  await until('!!document.querySelector(".structured-preview")', "structured preview");
  await until('!!document.querySelector(".preview-limit-notice")', "large document notice");
  const first = await evaluate('({notice:document.querySelector(".preview-limit-notice").textContent, rendered:document.querySelectorAll(".preview-block, .preview-content-region").length})');
  assert.match(first.notice, /Large document preview|大きな文書のプレビュー/);
  assert.ok(first.rendered <= 905, `initial preview stays bounded (${first.rendered})`);
  console.log(`PASS large document enters Visual without over-rendering (${first.rendered} initial nodes)`);
  await click(".preview-limit-notice button");
  await until('document.querySelector(".preview-limit-notice").textContent.includes("1800") || document.querySelector(".preview-limit-notice").textContent.includes("1,800")', "load more");
  const second = await evaluate('document.querySelectorAll(".preview-block, .preview-content-region").length');
  assert.ok(second > first.rendered, `load more increases rendered nodes (${second})`);
  console.log(`PASS large document preview loads more incrementally (${second} nodes)`);
  console.log("Test artifacts:", root);
}

require("../dist/main/index.js");
app.whenReady().then(() => run()).then(() => app.exit(0)).catch((error) => { console.error(error); console.error("Test artifacts:", root); app.exit(1); });
