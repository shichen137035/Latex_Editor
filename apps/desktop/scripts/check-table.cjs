/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
// Isolated renderer regression: never opens or modifies a user's project.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-table-check-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "user-data"));
let page;
const delay = ms => new Promise(done => setTimeout(done, ms));
const evaluate = async source => {
  try { return await page.webContents.executeJavaScript(source, true); }
  catch (error) { console.error("Renderer operation:", source); throw error; }
};
async function until(source) {
  for (let i = 0; i < 80; i++) { if (await evaluate(source)) return; await delay(100); }
  throw new Error("Timed out: " + source);
}
async function click(selector, modifiers = []) {
  const point = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e) throw Error("Missing element"); e.scrollIntoView({block:"center"}); const r=e.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
  page.webContents.sendInputEvent({ type:"mouseDown", ...point, button:"left", clickCount:1, modifiers });
  page.webContents.sendInputEvent({ type:"mouseUp", ...point, button:"left", clickCount:1, modifiers });
  await delay(120);
}
async function key(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type:"keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type:"keyUp", keyCode, modifiers });
  await delay(100);
}
const source = String.raw`\documentclass{article}
\usepackage{booktabs}
\begin{document}
\section{Table regression}
\begin{figure}
\caption{Boundary anchor}
\end{figure}
\begin{table}
\centering
\begin{tabular}{lcc}
\toprule
A & B & C \\
\midrule
 & & \\
 & & \\
\bottomrule
\end{tabular}
\end{table}
\end{document}`;
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  await until("!!window.latexEditor");
  const project = await evaluate(`window.latexEditor.projects.create({name:"table-test",parentPath:${JSON.stringify(projects)}})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)},"main.tex",${JSON.stringify(source)})`);
  page.webContents.reload();
  await until('!!document.querySelector(".project-row")');
  await click(".project-row");
  await until('!!document.querySelector(".view-switch")');
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(b=>b.textContent==="Visual").click()');
  await until('document.querySelectorAll(".structured-table tbody tr").length===3');
  const cell = (r,c) => `.structured-table tbody tr:nth-child(${r}) td:nth-child(${c})`;
  await click(cell(2,1));
  await until('!!document.querySelector(".structured-table textarea")');
  await page.webContents.insertText("Alpha");
  await key("Tab");
  await until('document.activeElement?.getAttribute("aria-label")==="Row 2, column 2"');
  await page.webContents.insertText("Beta");
  await click(cell(3,1));
  await page.webContents.insertText("Gamma");
  await key("Tab");
  assert.ok(await evaluate('document.querySelector(".structured-table").textContent.includes("Alpha") && document.querySelector(".structured-table").textContent.includes("Beta")'), "switching cells retains drafts");
  await click(cell(2,1));
  await click(cell(3,2), ["shift"]);
  await click(".table-preview-toolbar button:nth-child(7)");
  await until('Array.from(document.querySelectorAll(".structured-table td")).some(td=>td.colSpan===2 && td.rowSpan===2)');
  await click(".table-preview-toolbar button:nth-child(2)");
  await until('document.querySelectorAll(".structured-table tbody tr").length===4');
  await click(".table-preview-toolbar button:nth-child(3)");
  await until('document.querySelectorAll(".structured-table tbody tr").length===3');
  await click(".table-preview-toolbar button:nth-child(5)");
  await until('document.querySelectorAll(".table-column-selectors th").length===4');
  await click(".table-preview-toolbar button:nth-child(6)");
  await until('document.querySelectorAll(".table-column-selectors th").length===3');
  await click(".table-preview-toolbar button:nth-child(8)");
  await until('!Array.from(document.querySelectorAll(".structured-table td")).some(td=>td.colSpan===2)');
  await key("S", ["control"]);
  await delay(400);
  const saved = await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)},"main.tex")`);
  assert.ok(saved.content.includes("Alpha") && saved.content.includes("Beta") && saved.content.includes("Gamma"), "content survives structure edits");
  assert.ok(saved.content.includes("\\usepackage{multirow}"), "multirow dependency");
  // Specialized previews consume their own click events. They must still
  // activate the surrounding block so its before/after insertion actions work.
  await click('.preview-block[data-environment="figure"] .preview-figure');
  await until('document.querySelector(\'.preview-block[data-environment="figure"]\')?.classList.contains("selected")');
  await click('.preview-block[data-environment="figure"] .preview-block-header-actions button[title="Insert before block"]');
  await until('!!document.querySelector(".preview-local-editor")');
  await click('.environment-quick-action > button');
  await click('.environment-picker [data-environment-id="remark"]');
  await until('!document.querySelector(".environment-picker")');
  await until('document.querySelectorAll(\'[data-environment="remark"]\').length === 1');

  await click('.structured-table td');
  await until('document.querySelector(\'.preview-block[data-environment="table"]\')?.classList.contains("selected")');
  await click('.preview-block[data-environment="table"] .preview-block-header-actions button[title="Insert after block"]');
  await until('!!document.querySelector(".preview-local-editor")');
  await click('.environment-quick-action > button');
  await click('.environment-picker [data-environment-id="remark"]');
  await until('!document.querySelector(".environment-picker")');
  await until('document.querySelectorAll(\'[data-environment="remark"]\').length === 2');
  console.log("PASS image and table block boundary insertion activates the correct anchor");
  console.log("PASS Preview input, Tab, click-to-commit, rectangular merge, row/column edits, split and save", root);
}
require("../dist/main/index.js");
app.whenReady().then(run).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
