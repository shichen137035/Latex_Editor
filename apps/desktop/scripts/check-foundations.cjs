const { app, BrowserWindow, dialog } = require("electron");
const { mkdtempSync, mkdirSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-foundations-"));
mkdirSync(resolve(root, "projects"));
app.setPath("userData", resolve(root, "user"));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let page;
const js = (code) => page.webContents.executeJavaScript(code, true);
async function until(code, label) {
  for (let i = 0; i < 150; i++) { if (await js(code)) return; await delay(100); }
  throw new Error(`Timeout: ${label}\n${await js('document.body.innerText.slice(0,1500)')}`);
}
const click = (selector) => js(`document.querySelector(${JSON.stringify(selector)}).click()`);
const select = (selector, value) => js(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
function key(keyCode, modifiers) { page.webContents.sendInputEvent({type:"keyDown",keyCode,modifiers}); page.webContents.sendInputEvent({type:"keyUp",keyCode,modifiers}); }
async function run() {
  for (let i = 0; i < 150 && !BrowserWindow.getAllWindows().length; i++) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  assert.ok(page);
  await until('!!document.querySelector(".topbar")', "directory");
  await click('.topbar .icon-button');
  await click('[data-section="language"]');
  await select('[data-setting="locale"]', 'ja');
  await until('document.querySelector(".preferences-dialog h1").textContent === "設定"', 'live Japanese');
  await click('[data-section="appearance"]');
  await select('[data-setting="theme"]', 'dark');
  await until('document.documentElement.dataset.theme === "dark"', 'dark theme');
  page.reload();
  await until('!!document.querySelector(".topbar") && document.documentElement.lang === "ja" && document.documentElement.dataset.theme === "dark"', 'persisted locale/theme');
  console.log('PASS live Japanese, dark theme and persistence across renderer reload');
  const project = await js(`window.latexEditor.projects.create({name:'foundation-a',parentPath:${JSON.stringify(resolve(root,"projects"))}})`);
  const other = await js(`window.latexEditor.projects.create({name:'foundation-b',parentPath:${JSON.stringify(resolve(root,"projects"))}})`);
  await js(`window.latexEditor.settings.set('fontSize',22,${JSON.stringify(project.id)})`);
  const isolated = await js(`window.latexEditor.settings.get(${JSON.stringify(other.id)})`);
  assert.equal(isolated.project.fontSize, undefined);
  const toolchain = (await js('window.latexEditor.settings.get()')).toolchain;
  assert.equal(toolchain.available, true);
  assert.ok(toolchain.latexmk);
  const globalFile = JSON.parse(readFileSync(resolve(root,"user/settings.json"),'utf8'));
  assert.equal(globalFile.preferences.locale, 'ja');
  assert.ok(globalFile.toolchain.latexmk);
  const projectFile = JSON.parse(readFileSync(resolve(project.canonicalPath,'.texweave/settings.json'),'utf8'));
  assert.equal(projectFile.toolchain, undefined);
  console.log('PASS global toolchain persistence and project isolation');
  // Exercise the same manual selection handler without requiring an OS dialog.
  const originalDialog = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled:false, filePaths:[toolchain.binDirectory] });
  const manual = await js('window.latexEditor.settings.detectToolchain("directory")');
  dialog.showOpenDialog = originalDialog;
  assert.equal(manual.available,true);
  await js("window.latexEditor.settings.set('locale','en')");
  page.reload();
  await until('document.querySelectorAll(".project-row").length === 2','projects');
  await click('.project-row');
  await until('!!document.querySelector(".editor-surface .monaco-editor")','editor');
  key(',', ['control']);
  await until('!!document.querySelector(".preferences-dialog")','shortcut settings open');
  await click('[data-section="shortcuts"]');
  await click('[data-command="latex.compile"]');
  key('S',['control']);
  await until('!!document.querySelector(".shortcut-capture [role=alert]")','conflict');
  key('Escape',[]);
  await click('[data-command="latex.compile"]');
  key('L',['control','shift']);
  await until('!document.querySelector(".shortcut-capture")','rebind');
  assert.equal((await js('window.latexEditor.settings.get()')).global.keybindings['latex.compile'],'Mod+Shift+L');
  await click('.preferences-dialog > header > button');
  key('L',['control','shift']);
  await until('document.querySelector(".status-bar").textContent.includes("Last compile succeeded")','rebound compilation');
  console.log('PASS shortcut conflict, live rebinding and actual compilation');
  console.log('Artifacts:', root);
}
require('../dist/main/index.js');
app.whenReady().then(run).then(()=>app.exit(0)).catch((error)=>{console.error(error); console.error(root); app.exit(1);});
