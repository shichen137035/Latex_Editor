// Real Electron IPC + renderer + Codex handshake; never opens an authentication flow.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const labels = require("../src/renderer/i18n/locales/en.json");
const root = mkdtempSync(join(tmpdir(), "texweave-ai-connection-"));
const projects = join(root, "projects");
mkdirSync(projects);
app.setPath("userData", join(root, "profile"));
let page;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = script => page.webContents.executeJavaScript(script, true);
async function until(expression, label) {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  await until("!!window.latexEditor && !!document.querySelector('.directory-main')", "project directory");
  const detected = await evaluate("window.latexEditor.ai.detect()");
  assert.ok(detected.executablePath, detected.error);
  assert.notEqual(detected.process, "not_detected");
  console.log("PASS renderer IPC: discovers Codex without the IDE's private PATH");
  await evaluate(`window.latexEditor.projects.create({name:'AI connection check',parentPath:${JSON.stringify(projects)}})`);
  page.reload();
  await until("!!document.querySelector('.directory-project-row')", "test project list");
  await evaluate("document.querySelector('.directory-project-row').click()");
  await until("!!document.querySelector('.activity-bar')", "workbench");
  await evaluate(`Array.from(document.querySelectorAll('.activity-bar button')).find(button => button.title === ${JSON.stringify(labels["activity.ai"])}).click()`);
  await until("!!document.querySelector('.ai-cli-path') && !!document.querySelector('.ai-connect-card .primary-button:not(:disabled)')", "AI sign-in button");
  let connected = await evaluate("window.latexEditor.ai.status()");
  assert.equal(connected.process, "running");
  assert.equal(connected.auth, "signed_out");
  assert.equal(await evaluate("document.querySelector('.ai-error')?.textContent ?? ''"), "");
  console.log("PASS fresh profile: App Server initialize + account/read returns running / signed_out");
  await evaluate("document.querySelector('.ai-recheck').click()");
  await until("!document.querySelector('.ai-recheck').disabled", "retry completed");
  connected = await evaluate("window.latexEditor.ai.status()");
  assert.equal(connected.process, "running");
  assert.equal(await evaluate("document.querySelector('.ai-connect-card > strong').textContent"), labels["ai.connectTitle"]);
  assert.equal(await evaluate("document.querySelector('.ai-error')?.textContent ?? ''"), "");
  console.log("PASS Check again: stays connected and shows the ChatGPT sign-in card");
  const bounds = await evaluate("(() => { const r=document.querySelector('.ai-sidebar').getBoundingClientRect(); return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}; })()");
  writeFileSync(join(root, "ai-connected.png"), (await page.webContents.capturePage(bounds)).toPNG());
  console.log("Screenshot:", join(root, "ai-connected.png"));
}
require("../dist/main/index.js");
const timeout = setTimeout(() => { console.error("AI connection check timed out"); finish(1); }, 60000);
function finish(code) {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(code);
}
app.whenReady().then(run).then(() => finish(0)).catch(error => { console.error(error); console.error("Test profile:", root); finish(1); });
