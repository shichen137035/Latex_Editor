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
  const state = await evaluate('({text:document.body.innerText.slice(0,1400), preview:!!document.querySelector(".structured-preview"), rows:document.querySelectorAll(".preview-virtual-row").length})');
  throw new Error(`Timed out: ${label}\n${JSON.stringify(state)}`);
}

async function click(selector, modifiers = []) {
  const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Missing selector"); el.scrollIntoView({block:"center",inline:"center"}); const r = el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1, modifiers });
  await delay(60);
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1, modifiers });
  await delay(180);
}

const sections = Array.from({ length: 1400 }, (_, index) => [
  `\\section{Section ${index + 1}}${index === 1399 ? "\\label{sec:last}" : ""}`,
  `This is paragraph ${index + 1} with inline mathematics $x_${index + 1} + y_${index + 1} = z_${index + 1}$.${index === 0 ? " See \\ref{sec:last}." : ""}`,
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
  await until('!!document.querySelector(".directory-project-row")', "project list");
  await click(".directory-project-row .directory-name-text");
  await until('!!document.querySelector(".workbench")', "workbench");
  const visualIndex = await evaluate('Array.from(document.querySelectorAll(".view-switch button")).findIndex(button => button.textContent === "Visual")');
  assert.ok(visualIndex >= 0, "Visual switch is available");
  await click(`.view-switch button:nth-child(${visualIndex + 1})`);
  await until('!!document.querySelector(".structured-preview")', "structured preview");
  await until('document.querySelectorAll(".preview-block").length > 0', "first visible blocks");
  const first = await evaluate('({rendered:document.querySelectorAll(".preview-block, .preview-content-region").length, height:document.querySelector(".structured-preview").scrollHeight})');
  assert.ok(first.rendered < 100, `initial preview stays bounded (${first.rendered})`);
  assert.equal(await evaluate('!!document.querySelector(".preview-limit-notice")'), false, "no load-more gate remains");
  console.log(`PASS large document opens with ${first.rendered} mounted nodes`);
  await click('.preview-reference[data-reference="sec:last"]', ["control"]);
  await until('!!document.querySelector(".reference-target") && Array.from(document.querySelectorAll("[data-environment=section] .preview-block-header-main :is(strong, .preview-block-title)")).some(item => item.textContent.includes("Section 1400"))', "jump to an unmounted target");
  assert.ok(await evaluate('document.querySelector(".structured-preview").scrollTop > 10000'), "reference jump reaches the distant block");
  console.log("PASS reference jump mounts a distant block on demand");
  await evaluate('document.querySelector(".structured-preview").scrollTop = document.querySelector(".structured-preview").scrollHeight / 2');
  await until('document.querySelector(".structured-preview").scrollTop > 10000', "middle scroll");
  const middle = await evaluate('document.querySelectorAll(".preview-block, .preview-content-region").length');
  assert.ok(middle < 100, `middle viewport remains bounded (${middle})`);
  await evaluate('document.querySelector(".structured-preview").scrollTop = document.querySelector(".structured-preview").scrollHeight');
  await until('document.querySelector(".structured-preview")?.innerText.includes("Section 1400")', "last section mounts");
  const last = await evaluate('document.querySelectorAll(".preview-block, .preview-content-region").length');
  assert.ok(last < 100, `end viewport remains bounded (${last})`);
  await evaluate('document.querySelector(".structured-preview").scrollTop = 0');
  await until('document.querySelector(".structured-preview")?.innerText.includes("Section 1")', "first section remounts");
  const returned = await evaluate('document.querySelectorAll(".preview-block, .preview-content-region").length');
  assert.ok(returned < 100, `returning to the start releases distant DOM (${returned})`);
  console.log(`PASS large document stays virtualized while scrolling (${middle}/${last}/${returned} mounted nodes)`);
  const nestedSource = String.raw`\documentclass{article}
\begin{document}
\section{One long section}
${Array.from({ length: 700 }, (_, index) => `Paragraph ${index + 1} in the long section.\n\n`).join("")}
\begin{itemize}
${Array.from({ length: 700 }, (_, index) => `\\item Item ${index + 1} in the long list.\n`).join("")}
\end{itemize}
\end{document}`;
  await click('.logo-button');
  await until('!!document.querySelector(".directory-project-row")', 'release document session before changing the fixture');
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", ${JSON.stringify(nestedSource)})`);
  await page.webContents.reload();
  await until('!!document.querySelector(".directory-project-row")', "nested project list");
  await click(".directory-project-row .directory-name-text");
  await until('!!document.querySelector(".workbench")', "nested workbench");
  if (!await evaluate('!!document.querySelector(".structured-preview")')) await click(`.view-switch button:nth-child(${visualIndex + 1})`);
  await until('!!document.querySelector("[data-environment=section]")', "nested section");
  await evaluate('document.querySelector(".structured-preview").scrollTop = document.querySelector(".structured-preview").scrollHeight');
  await until('document.querySelector(".structured-preview")?.innerText.includes("Item 700 in the long list")', "last virtual list item");
  const nested = await evaluate('({blocks:document.querySelectorAll(".preview-block,.preview-content-region").length,rows:document.querySelectorAll(".preview-virtual-row").length})');
  assert.ok(nested.rows < 100, `nested section/list remains windowed (${nested.rows} rows)`);
  console.log(`PASS nested section and long list remain virtualized (${nested.blocks} blocks, ${nested.rows} rows)`);
  console.log("Test artifacts:", root);
}

require("../dist/main/index.js");
app.whenReady().then(() => run()).then(() => app.exit(0)).catch((error) => { console.error(error); console.error("Test artifacts:", root); app.exit(1); });
