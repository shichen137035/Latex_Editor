// Run against the production build. Real mouse events exercise React, preload,
// IPC and the file service; disk assertions are independent of the rendered tree.
const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdtempSync, mkdirSync, existsSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-menu-check-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "user-data"));
const calls = [];
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, async (...args) => {
  calls.push(channel);
  return handler(...args);
});
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let page;
const evaluate = (source) => page.webContents.executeJavaScript(source, true);
async function until(source, label) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(source)) return;
    await delay(100);
  }
  throw new Error("Timed out: " + label + "; IPC: " + calls.join(", "));
}
async function click(selector, button = "left") {
  const point = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error("Missing: " + ${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + Math.min(30, r.width / 2)), y: Math.round(r.y + r.height / 2) };
  })()`);
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button, clickCount: 1 });
  await delay(60); // Let mousedown state changes render before the click.
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button, clickCount: 1 });
  await delay(150);
}
async function menu(selector, label) {
  await click(selector, "right");
  await until('!!document.querySelector(".context-menu")', "context menu");
  const index = await evaluate(`Array.from(document.querySelectorAll(".context-menu button")).findIndex(b => b.textContent === ${JSON.stringify(label)})`);
  assert.ok(index >= 0, "menu item: " + label);
  await click(".context-menu button:nth-child(" + (index + 1) + ")");
}
async function name(value) {
  await until('!!document.querySelector(".entry-name-form input")', "inline naming");
  await click(".entry-name-form input");
  await evaluate('document.querySelector(".entry-name-form input").select()');
  await page.webContents.insertText(value);
  await click('.entry-name-form button[type="submit"]');
}
async function run() {
  for (let i = 0; i < 100 && !BrowserWindow.getAllWindows().length; i++) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  assert.ok(page, "app window");
  page.webContents.on("console-message", ({ message }) => {
    if (/error|not supported/i.test(message)) console.log("renderer:", message);
  });
  await until("!!window.latexEditor", "preload");
  const project = await evaluate(`window.latexEditor.projects.create({name:"menu-test",parentPath:${JSON.stringify(projects)}})`);
  await page.webContents.reload();
  await until('!!document.querySelector(".project-row")', "project list");
  await click(".project-row");
  await until('!!document.querySelector(".file-tree")', "workbench");
  // A dedicated empty target avoids depending on how many tree rows exist.
  await evaluate('document.querySelector(".file-tree").insertAdjacentHTML("beforeend", \'<div id="test-empty" style="height:30px"></div>\')');
  await menu("#test-empty", "New folder");
  await name("chapters");
  await until('!!document.querySelector(\'[data-path="chapters"]\')', "created folder");
  assert.ok(existsSync(resolve(project.canonicalPath, "chapters")));
  console.log("PASS blank-area menu -> create folder -> disk");
  await menu('[data-path="chapters"]', "New file");
  await name("draft.tex");
  await until('!!document.querySelector(\'[data-path="chapters/draft.tex"]\')', "created nested file");
  assert.ok(existsSync(resolve(project.canonicalPath, "chapters/draft.tex")));
  console.log("PASS folder menu -> create nested file -> disk");
  await menu('[data-path="chapters/draft.tex"]', "Rename");
  await name("renamed.tex");
  await until('!!document.querySelector(\'[data-path="chapters/renamed.tex"]\')', "renamed file");
  assert.ok(!existsSync(resolve(project.canonicalPath, "chapters/draft.tex")));
  await menu('[data-path="chapters/renamed.tex"]', "Copy");
  await name("copy.tex");
  await until('!!document.querySelector(\'[data-path="chapters/copy.tex"]\')', "copied file");
  assert.equal(readFileSync(resolve(project.canonicalPath, "chapters/copy.tex"), "utf8"), "");
  await menu('[data-path="chapters/copy.tex"]', "Set as main file");
  await until('!!document.querySelector(\'[data-path="chapters/copy.tex"] .main-file-star\')', "main file star");
  const saved = await evaluate("window.latexEditor.projects.list()");
  assert.equal(saved.find(p => p.id === project.id).mainFile, "chapters/copy.tex");
  console.log("PASS rename/copy/main-file -> disk and registry");
  await menu('[data-path="chapters/renamed.tex"]', "Delete");
  await until('!!document.querySelector(\'[aria-label="Delete file"]\')', "delete confirmation");
  await click('[aria-label="Delete file"] button:last-child');
  await until('!document.querySelector(\'[data-path="chapters/renamed.tex"]\')', "deleted file");
  assert.ok(!existsSync(resolve(project.canonicalPath, "chapters/renamed.tex")));
  console.log("PASS delete menu -> confirm -> file removed from disk");
  await click('[data-path="chapters/copy.tex"]', "right");
  await click(".workbench-topbar");
  await until('!document.querySelector(".context-menu")', "outside dismissal");
  console.log("PASS outside click closes menu");
  console.log("IPC trace:", calls.filter(c => /files:|set-main/.test(c)).join(" -> "));
  console.log("Test artifacts:", root);
}
require("../dist/main/index.js");
app.whenReady().then(() => run()).then(() => app.exit(0)).catch((error) => {
  console.error(error);
  console.error("Test artifacts:", root);
  app.exit(1);
});
