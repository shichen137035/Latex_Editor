const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const assert = require("node:assert/strict");

const root = mkdtempSync(resolve(tmpdir(), "texweave-file-tree-"));
const projects = join(root, "projects"); mkdirSync(projects);
app.setPath("userData", join(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
const errors = [];
let page;
const evaluate = async script => {
  try { return await page.webContents.executeJavaScript(script, true); }
  catch (error) { throw new Error(`${error.message}\nScript: ${script}\n${errors.join('\n')}`); }
};
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
async function until(script, label) {
  for (let i = 0; i < 300; i++) {
    assert.deepEqual(errors, []);
    if (await evaluate(script)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
const row = path => `.tree-row[data-path=${JSON.stringify(path)}]`;
async function expanded(path, expected) {
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(row(path))})?.getAttribute('aria-expanded')`), String(expected), path);
}
async function toggle(path) {
  await evaluate(`document.querySelector(${JSON.stringify(row(path))}).click()`);
  await delay(50);
}
async function openProject(name) {
  await until('!!document.querySelector(".directory-project-row")', 'project list');
  await evaluate(`Array.from(document.querySelectorAll('.directory-project-row')).find(row => row.textContent.includes(${JSON.stringify(name)})).click()`);
  await until(`!!document.querySelector(${JSON.stringify(row('chapters'))})`, 'project tree');
}
async function home() {
  await evaluate('document.querySelector(".logo-button").click()');
  await until('!!document.querySelector(".directory-project-row")', 'home');
}
async function filter(value) {
  // Native input exercises React's controlled filter instead of mutating its DOM value.
  await evaluate(`document.querySelector('.sidebar-input').focus()`);
  page.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
  page.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
  page.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'BACKSPACE' });
  page.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'BACKSPACE' });
  if (value) await page.webContents.insertText(value);
  await until(`document.querySelector('.sidebar-input').value === ${JSON.stringify(value)}`, 'filter input');
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', 'directory');
  const created = [];
  for (const name of ['tree-first', 'tree-second']) {
    const project = await evaluate(`window.latexEditor.projects.create({name:${JSON.stringify(name)},parentPath:${JSON.stringify(projects)}})`);
    mkdirSync(join(project.canonicalPath, 'chapters/nested'), { recursive: true });
    mkdirSync(join(project.canonicalPath, 'assets'));
    writeFileSync(join(project.canonicalPath, 'chapters/nested/needle.tex'), 'Searchable nested content.');
    writeFileSync(join(project.canonicalPath, 'chapters/notes.txt'), 'Notes');
    created.push(project);
  }
  page.reload(); await openProject('tree-first'); page.focus();
  await expanded('chapters', false); await expanded('assets', false);
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(row('chapters/notes.txt'))})`), false);
  console.log('PASS first visit starts all folders closed');
  await toggle('chapters'); await expanded('chapters/nested', false);
  await toggle('chapters/nested'); await expanded('chapters/nested', true);
  await toggle('chapters'); await expanded('chapters', false);
  await home(); await openProject('tree-first'); await expanded('chapters', false);
  await toggle('chapters'); await expanded('chapters/nested', true);
  console.log('PASS reopening restores parent and nested folder states independently');

  await evaluate(`document.querySelector('.activity-bar button[title="Search"]').click()`);
  await evaluate(`document.querySelector('.activity-bar button[title="Files"]').click()`);
  await until(`!!document.querySelector(${JSON.stringify(row('chapters/nested'))})`, 'remounted tree');
  await expanded('chapters/nested', true);
  mkdirSync(join(created[0].canonicalPath, 'new-folder'));
  await evaluate(`document.querySelector('.sidebar-heading button[title="Refresh file tree"]').click()`);
  await until(`!!document.querySelector(${JSON.stringify(row('new-folder'))})`, 'refreshed tree');
  await expanded('new-folder', false); await expanded('chapters/nested', true);
  console.log('PASS sidebar remount and refresh retain states; newly added folders start closed');

  await home(); await openProject('tree-second'); await expanded('chapters', false);
  await filter('needle');
  await until(`!!document.querySelector(${JSON.stringify(row('chapters/nested/needle.tex'))})`, 'search reaches closed descendants');
  await toggle('chapters'); await expanded('chapters', false);
  await toggle('chapters'); await expanded('chapters', true);
  await filter(''); await expanded('chapters', false);
  await home(); page.reload(); await openProject('tree-second'); await expanded('chapters', false);
  await home(); await openProject('tree-first'); await expanded('chapters', true); await expanded('chapters/nested', true);
  console.log('PASS search does not overwrite states; projects remain isolated after a full renderer reload');
  assert.deepEqual(errors, []);
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => { console.log(`Artifacts: ${root}`); app.exit(0); }).catch(error => { console.error(error); console.error(`Artifacts: ${root}`); app.exit(1); });
});
