const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");

const root = mkdtempSync(resolve(tmpdir(), "texweave-preview-check-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "user-data"));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let page;
const evaluate = (source) => page.webContents.executeJavaScript(source, true);

async function until(source, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await evaluate(source)) return;
    await delay(100);
  }
  const state = await evaluate('({text:document.body.innerText.slice(0,1200), switches:Array.from(document.querySelectorAll(".view-switch button")).map(b=>({text:b.textContent,class:b.className})), preview:!!document.querySelector(".structured-preview")})');
  throw new Error(`Timed out: ${label}\n${JSON.stringify(state)}`);
}

async function click(selector) {
  const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Missing selector"); el.scrollIntoView({block:"center",inline:"center"}); const r = el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  await delay(60);
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  await delay(150);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  await delay(100);
}

const source = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}

First paragraph with inline math $x_t$.

\begin{equation}
\begin{aligned}
x_t &= \alpha x_{t-1} \\
y_t &= \beta y_{t-1}
\end{aligned}
\end{equation}

\begin{theorem}
\label{thm:test}
Suppose $X$ is compact.

\begin{equation}
f(x)=x^2
\end{equation}

Then the conclusion holds.
\end{theorem}

% tw:block-begin type=intuition title="Main intuition"
This is the intuition.
% tw:block-end

\begin{mystery}
Unknown content remains visible.
\end{mystery}
\end{document}`;

async function run() {
  for (let attempt = 0; attempt < 100 && BrowserWindow.getAllWindows().length === 0; attempt += 1) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  assert.ok(page, "app window");
  page.webContents.on("console-message", ({ level, message }) => { if (level >= 2) console.log("renderer:", message); });
  await until("!!window.latexEditor", "preload");
  for (let attempt = 0; attempt < 30 && !page.isMaximized(); attempt += 1) await delay(100);
  assert.equal(page.isMaximized(), true, "main window opens maximized");
  console.log("PASS main window opens maximized");
  page.focus();
  const project = await evaluate(`window.latexEditor.projects.create({name:"preview-test",parentPath:${JSON.stringify(projects)}})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", ${JSON.stringify(source)})`);
  await page.webContents.reload();
  await until('!!document.querySelector(".project-row")', "project list");
  await click('.topbar .icon-button[title="Settings"]');
  await until('!!document.querySelector(".preferences-dialog")', "workspace settings");
  await click('[data-section="environments"]');
  await until('!!document.querySelector(".environment-manager-page")', "workspace environment manager");
  await click(".environment-manager-header .primary");
  await until('document.querySelectorAll(".environment-catalog section:last-child button").length === 1', "custom environment creation");
  await click('.environment-form-section:first-of-type .environment-form-grid label:nth-child(2) input');
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
  await page.webContents.insertText("Review note");
  await until('document.querySelector(".environment-catalog section:last-child").textContent.includes("Review note")', "custom environment editing");
  console.log("PASS dashboard Settings opens the full manager and edits a custom environment");
  await click(".preferences-dialog > header > button");
  await click(".project-row");
  await until('!!document.querySelector(".workbench")', "workbench");
  await click(".environment-quick-action > button");
  await until('!!document.querySelector(".environment-picker")', "environment picker");
  assert.ok(await evaluate('!!document.querySelector(\'.environment-picker [data-environment-id="theorem"]\')'));
  // The fixed split toolbar can place the picker above the editor tabs;
  // use an unoccluded workbench area to verify outside-click dismissal.
  await click(".sidebar-heading");
  await until('!document.querySelector(".environment-picker")', "environment picker outside dismissal");
  await click(".environment-quick-action > button");
  await click('.environment-picker [data-environment-id="remark"]');
  await until('!document.querySelector(".environment-picker")', "environment insertion");
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "S", modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "S", modifiers: ["control"] });
  await delay(250);
  const inserted = await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)}, "main.tex")`);
  assert.ok(inserted.content.includes("\\begin{remark}"));
  assert.ok(inserted.content.includes("\\end{remark}"));
  assert.ok(inserted.content.includes("\\label{remark:1}"));
  console.log("PASS Environment picker lists active definitions, dismisses outside, and inserts source");
  const visualIndex = await evaluate('Array.from(document.querySelectorAll(".view-switch button")).findIndex(button => button.textContent === "Visual")');
  assert.ok(visualIndex >= 0);
  await click(`.view-switch button:nth-child(${visualIndex + 1})`);
  await until('!!document.querySelector(".structured-preview")', "structured preview");
  assert.equal(await evaluate('document.querySelectorAll(\'[data-environment="section"]\').length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(\'[data-environment="theorem"]\').length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(\'[data-environment="equation"]\').length'), 2);
  assert.equal(await evaluate('document.querySelectorAll(\'[data-environment="virtual:intuition"]\').length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(\'[data-environment="custom:mystery"]\').length'), 1);
  await click('.preview-block[data-environment="theorem"] .preview-block-label');
  await until('!!document.querySelector(".preview-block-label-editor")', "label editor");
  await page.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
  await page.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
  await page.webContents.insertText("thm:edited");
  await press("ENTER");
  await until('document.querySelector(".preview-block-label")?.textContent === "thm:edited"', "label edit");
  console.log("PASS Preview labels are editable and generated labels are visually distinguished");
  assert.ok(await evaluate('document.querySelectorAll(".katex").length >= 3'), "inline and display formulas are rendered by KaTeX");
  assert.equal(await evaluate('document.querySelectorAll(".katex-error").length'), 0, "nested aligned math is accepted by KaTeX");
  assert.equal(await evaluate('document.querySelectorAll(".preview-math-fallback").length'), 0);
  console.log("PASS inline and display math render through KaTeX");
  console.log("PASS Preview renders nested, virtual, and unknown blocks");

  await click('[data-environment="theorem"] > .preview-block-header');
  assert.equal(await evaluate('document.querySelector(\'[data-environment="theorem"]\').classList.contains("selected")'), true);
  assert.equal(await evaluate('document.querySelectorAll(".preview-local-editor").length'), 0);
  console.log("PASS block header selects without editing");

  const paragraphSelector = '.preview-content-region[data-node-id*="content"]';
  await click(paragraphSelector);
  await until('!!document.querySelector(".preview-local-editor .monaco-editor")', "local source editor");
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
  await page.webContents.insertText("Edited paragraph with $z$. ");
  await click(".preview-local-editor button.primary");
  await until('document.querySelector(".structured-preview").textContent.includes("Edited paragraph")', "preview reparse");
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "S", modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "S", modifiers: ["control"] });
  await delay(300);
  const saved = await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)}, "main.tex")`);
  assert.ok(saved.content.includes("Edited paragraph with $z$."));
  assert.ok(saved.content.includes("\\begin{equation}"));
  console.log("PASS paragraph click edits only its source span and saves through IPC");

  await click('.activity-bar button[title="Settings"]');
  await until('!!document.querySelector(".preferences-dialog")', "settings dialog");
  await click('[data-section="environments"]');
  await until('!!document.querySelector(".environment-manager-page")', "environment manager");
  await click('.environment-catalog [data-environment-id="theorem"]');
  await click('.environment-editor-title .environment-toggle');
  await until('!document.querySelector(\'[data-environment="theorem"]\')', "disabled theorem fallback");
  assert.equal(await evaluate('document.querySelector(".structured-preview").textContent.includes("Suppose") && document.querySelector(".structured-preview").textContent.includes("compact")'), true);
  console.log("PASS disabling an environment removes block chrome and preserves readable content");
  assert.ok(await evaluate('!!Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Add environment"))'));
  assert.ok(await evaluate('!!Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Advanced XML"))'));
  console.log("PASS full environment manager is reachable through the Settings submenu");
  console.log("Test artifacts:", root);
}

require("../dist/main/index.js");
app.whenReady().then(() => run()).then(() => app.exit(0)).catch((error) => { console.error(error); console.error("Test artifacts:", root); app.exit(1); });
