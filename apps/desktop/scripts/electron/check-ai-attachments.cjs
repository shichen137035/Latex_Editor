// Isolated UI regression; stages files but never sends a model request.
const { app, BrowserWindow, ipcMain } = require("electron");
const { desktopInvoke } = require("@latex-editor/contracts/desktop-ipc");
const { mkdtempSync, mkdirSync, readdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-ai-attachments-"));
const projects = join(root, "projects"), profile = join(root, "profile");
mkdirSync(projects); app.setPath("userData", profile);
const cache = join(profile, "ai", "attachment-cache");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let page;
const errors = [];
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
const evaluate = source => page.webContents.executeJavaScript(source, true);
async function until(check, label) {
  for (let i = 0; i < 120; i++) {
    assert.equal(errors.length, 0, errors.join("\n"));
    if (await check()) return;
    await delay(75);
  }
  throw new Error(`Timed out: ${label}`);
}
function cacheFiles(path = cache) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? cacheFiles(join(path, entry.name)) : [join(path, entry.name)]);
}
async function paste() {
  await evaluate(`(() => {
    const input = document.querySelector('.ai-composer textarea');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Attachment bytes'], 'draft.txt', {type:'text/plain'}));
    input.dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer,bubbles:true,cancelable:true}));
  })()`);
  await until(() => evaluate("document.querySelectorAll('.ai-attachment-chip').length === 1"), "pasted attachment");
  assert.equal(cacheFiles().length, 1);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until(() => evaluate("!!document.querySelector('.project-directory-v044') && !!window.latexEditor"), "home");
  const project = await evaluate(`window.latexEditor.projects.create({name:'Attachment check',parentPath:${JSON.stringify(projects)}})`);
  await evaluate(`window.latexEditor.ai.createConversation('codex',${JSON.stringify(project.id)})`);
  page.reload();
  await until(() => evaluate("!!document.querySelector('.directory-project-row')"), "project list");
  await evaluate("document.querySelector('.directory-project-row').click()");
  await until(() => evaluate("!!document.querySelector('.workbench')"), "workbench");
  // Render the composer without signing in or contacting either model provider.
  for (const endpoint of [desktopInvoke.ai.status, desktopInvoke.ai.detect, desktopInvoke.ai.copilotStatus]) {
    ipcMain.removeHandler(endpoint.channel);
    ipcMain.handle(endpoint.channel, () => ({ auth: "signed_in", process: "running", accountLabel: "Attachment regression" }));
  }
  for (const endpoint of [desktopInvoke.ai.models, desktopInvoke.ai.copilotModels]) {
    ipcMain.removeHandler(endpoint.channel); ipcMain.handle(endpoint.channel, () => []);
  }
  await evaluate("document.querySelectorAll('.activity-bar > div:first-child > button')[3].click()");
  await until(() => evaluate("!!document.querySelector('.ai-composer textarea')"), "AI composer");
  await paste();
  await evaluate("document.querySelector('.ai-attachment-chip button').click()");
  await until(() => evaluate("document.querySelectorAll('.ai-attachment-chip').length === 0"), "removed chip");
  await until(async () => cacheFiles().length === 0, "removed cache file");
  console.log("PASS remove: chip and temporary file are both released");
  await paste();
  await evaluate("document.querySelector('.logo-button').click()");
  await until(() => evaluate("!!document.querySelector('.project-directory-v044')"), "return home");
  await until(async () => cacheFiles().length === 0, "unmount cleanup");
  console.log("PASS leaving project: attachment draft releases its temporary files");
  await evaluate("document.querySelector('.directory-project-row').click()");
  await until(() => evaluate("!!document.querySelector('.activity-bar')"), "reopen project");
  await evaluate("document.querySelectorAll('.activity-bar > div:first-child > button')[3].click()");
  await until(() => evaluate("!!document.querySelector('.ai-composer textarea')"), "reopened composer");
  await paste();
  await new Promise(resolve => {
    app.once("will-quit", event => {
      try { assert.equal(cacheFiles().length, 0); console.log("PASS window destruction: backend draft cleanup completes before exit"); resolve(); }
      catch (error) { event.preventDefault(); console.error(error); app.exit(1); }
    });
    page.destroy();
  });
  console.log("Artifacts:", root);
}
require("../../dist/main/index.js");
const timeout = setTimeout(() => { console.error("Attachment check timed out"); app.exit(1); }, 45000);
app.whenReady().then(run).then(() => { clearTimeout(timeout); app.exit(0); }).catch(error => { console.error(error); console.error("Artifacts:", root); app.exit(1); });
