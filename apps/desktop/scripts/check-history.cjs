const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");

const root = mkdtempSync(resolve(tmpdir(), "texweave-history-check-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "user-data"));
let page;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const evaluate = (source) => page.webContents.executeJavaScript(source, true);
async function until(source, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if (await evaluate(source)) return; } catch { /* The project may be loading. */ }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}\n${await evaluate('document.body.innerText.slice(0,1600)')}`);
}
async function click(selector) {
  const point = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) throw new Error("Missing selector"); element.scrollIntoView({block:"center"}); const rect = element.getBoundingClientRect(); return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2)}; })()`);
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  await delay(60);
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
  await delay(120);
}
async function run() {
  for (let attempt = 0; attempt < 100 && !BrowserWindow.getAllWindows().length; attempt++) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  assert.ok(page);
  await until('!!window.latexEditor', "preload");
  const project = await evaluate(`window.latexEditor.projects.create({name:"history-test",parentPath:${JSON.stringify(projects)}})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", "first\\n")`);
  await page.webContents.reload();
  await until('!!document.querySelector(".directory-project-row")', "project directory");
  await click(".directory-project-row");
  await until('!!document.querySelector(".workbench")', "workbench");
  await click('.activity-bar button[title="History"]');
  await until('!!document.querySelector(".project-history-panel")', "history sidebar");
  await click(".history-create button:first-child");
  await until('!!document.querySelector(".history-modal")', "version editor");
  assert.equal(await evaluate('document.querySelector(".history-modal input")?.value'), "1.0", "first version number is suggested");
  await click('.history-modal label:nth-of-type(2) input');
  await page.webContents.insertText("First draft");
  await click(".history-dialog-actions .primary");
  await until('document.querySelector(".history-entry")?.textContent.includes("Version 1.0")', "created version");
  let entries = await evaluate(`window.latexEditor.history.list(${JSON.stringify(project.id)})`);
  assert.equal(entries.filter((entry) => entry.type === "version").length, 1);
  console.log("PASS version creation through History sidebar");

  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", "second\\n")`);
  await click('.history-heading button[title="Create snapshot"]');
  await until('document.querySelectorAll(".history-entry").length >= 2', "manual snapshot");
  await click('.history-entry .history-dot.version');
  await until('!!document.querySelector(".history-details .history-file")', "version comparison");
  assert.ok(await evaluate('document.querySelector(".history-file")?.textContent.includes("main.tex")'));
  await click(".history-actions button:first-child");
  await until('!!document.querySelector(".history-modal .history-restore-files")', "restore dialog");
  await click('.history-dialog-actions .primary');
  await until(`window.latexEditor.files.read(${JSON.stringify(project.id)}, "main.tex").then(file => file.content === "first\\n")`, "restored project");
  entries = await evaluate(`window.latexEditor.history.list(${JSON.stringify(project.id)})`);
  const safety = entries.find((entry) => entry.reason === "pre-restore");
  assert.ok(safety, "restore creates a safety snapshot");
  assert.equal(readFileSync(resolve(project.canonicalPath, "main.tex"), "utf8"), "first\n");
  console.log("PASS comparison, whole-project restore, and safety snapshot");

  await click(`.history-entry[data-history-id="${safety.id}"]`);
  await until('document.querySelector(".history-details")?.textContent.includes("main.tex")', "safety snapshot details");
  await click('.history-actions button:nth-child(2)');
  await until('!!document.querySelector(".history-modal")', "promotion dialog");
  assert.equal(await evaluate('document.querySelector(".history-modal input")?.value'), "1.1");
  await click('.history-dialog-actions .primary');
  await until('Array.from(document.querySelectorAll(".history-entry")).some(entry => entry.textContent.includes("Version 1.1"))', "promoted version");
  entries = await evaluate(`window.latexEditor.history.list(${JSON.stringify(project.id)})`);
  assert.equal(entries.find((entry) => entry.versionNumber === "1.1")?.manifestId, safety.manifestId, "promotion reuses the manifest");
  await click(`.history-entry[data-history-id="${safety.id}"]`);
  await until('!!document.querySelector(".history-details .history-file")', "safety snapshot difference");
  await click('.history-actions button:first-child');
  await until('!!document.querySelector(".history-restore-files input:checked")', "selected file for restore");
  await click('.history-dialog-actions button:nth-child(2)');
  await until(`window.latexEditor.files.read(${JSON.stringify(project.id)}, "main.tex").then(file => file.content === "second\\n")`, "selected-file restore");
  console.log("PASS metadata-only promotion and selected-file restore");

  await click('.history-heading button[title="Snapshot settings"]');
  await until('Array.from(document.querySelectorAll(".preferences-dialog [data-setting]")).some(element => element.dataset.setting === "history.autoSnapshot")', "snapshot settings");
  await evaluate('document.querySelectorAll(".settings-level-switch button")[1].click()');
  await until('Array.from(document.querySelectorAll("[data-setting]")).some(element => element.dataset.setting === "history.intervalMinutes")', "advanced snapshot interval");
  assert.equal(await evaluate('Array.from(document.querySelectorAll("[data-setting]")).find(element => element.dataset.setting === "history.intervalMinutes")?.value'), "10");
  console.log("PASS snapshot settings are available");
  console.log("Test artifacts:", root);
}

require("../dist/main/index.js");
app.whenReady().then(run).then(() => app.exit(0)).catch((error) => { console.error(error); console.error("Test artifacts:", root); app.exit(1); });
