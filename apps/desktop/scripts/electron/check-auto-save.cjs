const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(join(tmpdir(), "texweave-auto-save-"));
const projects = join(root, "projects");
mkdirSync(projects);
app.setPath("userData", join(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
const errors = [];
let page;
const evaluate = async script => {
  try { return await page.webContents.executeJavaScript(script, true); }
  catch (error) { throw new Error(`Evaluation failed: ${script}\n${errors.join("\n")}`, { cause: error }); }
};
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
async function until(script, label) {
  for (let attempt = 0; attempt < 160; attempt++) {
    assert.deepEqual(errors, []);
    if (await evaluate(script)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  await delay(80);
}
async function settings() {
  await press(",", ["control"]);
  await until('!!document.querySelector("[data-setting=autoSaveDelaySeconds] input")', 'auto-save preference');
}
async function mode(value) {
  await evaluate(`(() => { const input = document.querySelector('[data-setting=autoSave] select'); input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await until(`document.querySelector('[data-setting=autoSave] select').value === ${JSON.stringify(value)}`, 'save mode');
}
async function edit(text) {
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await delay(120);
  await press("END", ["control"]);
  await page.webContents.insertText(text);
  await until(`document.querySelector('.editor-surface .view-lines').textContent.includes(${JSON.stringify(text.trim())})`, 'source edit');
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', 'directory');
  const project = await evaluate(`window.latexEditor.projects.create({name:'auto-save',parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  await evaluate(`window.latexEditor.settings.set('layout',{mode:'single',singlePane:'source',leftPane:'source',rightPane:'pdf'},${id})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', 'created project');
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor textarea")', 'editor');
  page.focus();
  await settings();
  assert.equal(await evaluate('document.querySelector("[data-setting=autoSaveDelaySeconds] input").value'), '3');
  await mode('afterDelay');
  await evaluate('document.querySelector(".settings-close").click()');
  await edit(' AUTO_ONE');
  await delay(1600);
  assert.ok(!(await evaluate(`window.latexEditor.files.read(${id},'main.tex')`)).content.includes('AUTO_ONE'));
  await edit(' AUTO_TWO');
  await delay(1700);
  assert.ok(!(await evaluate(`window.latexEditor.files.read(${id},'main.tex')`)).content.includes('AUTO_TWO'));
  await until(`window.latexEditor.files.read(${id},'main.tex').then(file => file.content.includes('AUTO_TWO'))`, 'three-second idle save');
  await until('!!document.querySelector(".save-status.saved")', 'save acknowledgement');
  await settings();
  await evaluate(`(() => { const input = document.querySelector('[data-setting=autoSaveDelaySeconds] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'1'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await until(`window.latexEditor.settings.get().then(value => value.global.autoSaveDelaySeconds === 1)`, 'persisted custom interval');
  await evaluate('document.querySelector(".settings-close").click()');
  await edit(' AUTO_FAST');
  await delay(400);
  assert.ok(!(await evaluate(`window.latexEditor.files.read(${id},'main.tex')`)).content.includes('AUTO_FAST'));
  await until(`window.latexEditor.files.read(${id},'main.tex').then(file => file.content.includes('AUTO_FAST'))`, 'custom one-second save');
  await until('!!document.querySelector(".save-status.saved")', 'custom save acknowledgement');
  await edit(' AUTO_DISABLED');
  await settings();
  await mode('off');
  await evaluate('document.querySelector(".settings-close").click()');
  await delay(1300);
  assert.ok(!(await evaluate(`window.latexEditor.files.read(${id},'main.tex')`)).content.includes('AUTO_DISABLED'));
  assert.deepEqual(errors, []);
  console.log('PASS default three-second idle save, typing resets timer, custom interval and disabling cancels pending save');
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => app.exit(0)).catch(error => { console.error(error); console.error(`Artifacts: ${root}`); app.exit(1); });
});
