// Isolated Electron UI check: no real chats, credentials, or AI requests are used.
const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const root = mkdtempSync(join(tmpdir(), "texweave-history-"));
const profile = join(root, "profile");
const store = join(profile, "ai", "conversations.json");
const projects = join(root, "projects");
mkdirSync(join(profile, "ai"), { recursive: true });
mkdirSync(projects);
const conversations = [0, 1, 3, 12].map((days, index) => ({ id: randomUUID(), title: `History ${index + 1}`, mode: "codex", createdAt: Date.now() - days * 86400000, updatedAt: Date.now() - days * 86400000, messages: [] }));
writeFileSync(store, JSON.stringify({ version: 1, conversations, changeSets: [] }));
app.setPath("userData", profile);
let page;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = async script => {
  try { return await page.webContents.executeJavaScript(script, true); }
  catch (error) { console.error("Renderer step:", script); throw error; }
};
async function until(expression) {
  for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await delay(100); }
  throw new Error(`Timed out: ${expression}`);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  await until("!!window.latexEditor && !!document.querySelector('.directory-main')");
  for (const channel of ["ai:detect", "ai:status", "ai:copilot:status", "ai:models", "ai:copilot:models", "ai:conversations"]) {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => channel.endsWith("models") ? [] : channel === "ai:conversations" ? JSON.parse(readFileSync(store, "utf8")) : { auth: "signed_in", process: "running", accountLabel: "UI test" });
  }
  await evaluate(`window.latexEditor.projects.create({name:'History UI check',parentPath:${JSON.stringify(projects)}})`);
  page.reload();
  await until("!!document.querySelector('.directory-project-row')");
  await evaluate("document.querySelector('.directory-project-row').click()");
  await until("!!document.querySelector('.activity-bar')");
  const labels = require("../src/renderer/i18n/locales/en.json");
  await evaluate(`Array.from(document.querySelectorAll('.activity-bar button')).find(button => button.title.startsWith(${JSON.stringify(labels["activity.ai"])})).click()`);
  await until("!!document.querySelector('.ai-history-trigger')");
  await evaluate("document.querySelector('.ai-history-trigger').click()");
  await until("document.querySelectorAll('.ai-history-row').length===4");
  assert.equal(await evaluate("document.querySelectorAll('.ai-history-group').length"), 4);
  await evaluate("(()=>{const input=document.querySelector('.ai-history-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'History 2'); input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await until("document.querySelectorAll('.ai-history-row').length===1");
  await evaluate("document.querySelector('.ai-history-delete').click()");
  await until("!!document.querySelector('.ai-history-confirm')");
  await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
  await until("!document.querySelector('.ai-history-confirm') && !!document.querySelector('.ai-history-panel')");
  await evaluate("(()=>{const input=document.querySelector('.ai-history-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,''); input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await until("document.querySelectorAll('.ai-history-row').length===4");
  await evaluate("document.querySelectorAll('.ai-history-row input')[0].click(); document.querySelectorAll('.ai-history-row input')[1].click(); document.querySelector('.ai-history-panel footer button').click()");
  await until("!!document.querySelector('.ai-history-confirm .ai-history-danger')");
  await evaluate("document.querySelector('.ai-history-confirm .ai-history-danger').click()");
  await until("document.querySelectorAll('.ai-history-row').length===2 && !document.querySelector('.ai-history-confirm')");
  assert.equal(JSON.parse(readFileSync(store, "utf8")).conversations.length, 2);
  assert.match(await evaluate("document.querySelector('.ai-history-trigger').textContent"), /History 3/);
  await evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
  await until("!document.querySelector('.ai-history-panel')");
  await evaluate("document.querySelector('.ai-history-trigger').click()");
  await until("!!document.querySelector('.ai-history-delete')");
  await evaluate("document.querySelector('.ai-history-delete').click()");
  await until("!!document.querySelector('.ai-history-confirm')");
  await evaluate("document.querySelector('.ai-history-confirm .ai-history-danger').click()");
  await until("document.querySelectorAll('.ai-history-row').length===1");
  assert.equal(JSON.parse(readFileSync(store, "utf8")).conversations.length, 1);
  writeFileSync(join(root, "history.png"), (await page.webContents.capturePage()).toPNG());
  console.log("PASS history UI: grouping, search, confirmation/Escape, batch + single persistent deletion, active-chat fallback, outside dismissal");
  console.log("Screenshot:", join(root, "history.png"));
}
require("../dist/main/index.js");
const timeout = setTimeout(() => finish(1), 45000);
function finish(code) { clearTimeout(timeout); for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.exit(code); }
app.whenReady().then(run).then(() => finish(0)).catch(error => { console.error(error); finish(1); });
