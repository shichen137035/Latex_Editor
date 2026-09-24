// Regression: a persisted Visual layout mounts PreviewPane before source loads.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const root = mkdtempSync(resolve(tmpdir(), 'texweave-preview-startup-'));
const projects = resolve(root, 'projects');
mkdirSync(projects);
app.setPath('userData', resolve(root, 'profile'));
const delay = ms => new Promise(done => setTimeout(done, ms));
const errors = [];
let page;
const evaluate = source => page.webContents.executeJavaScript(source, true);
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', ({ level, message }) => {
    if (level === 'error' || level === 3) { errors.push(message); console.error('RENDERER:', message); }
  });
  contents.on('render-process-gone', (_event, detail) => errors.push(JSON.stringify(detail)));
});
async function until(expression, label) {
  for (let i = 0; i < 100; i++) {
    assert.equal(errors.length, 0, `${label}: ${errors.join('\n')}`);
    if (await evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".dashboard")', 'dashboard');
  for (const mode of ['split', 'single']) {
    const project = await evaluate(`window.latexEditor.projects.create({name:${JSON.stringify(mode)},parentPath:${JSON.stringify(projects)}})`);
    await evaluate(`window.latexEditor.settings.set('layout', {mode:${JSON.stringify(mode)},leftPane:'preview',singlePane:'preview',rightPane:'pdf'},${JSON.stringify(project.id)})`);
    await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, 'main.tex', ${JSON.stringify('\\documentclass{article}\n\\begin{document}\n\\section{Startup}\nA paragraph.\n\\end{document}')})`);
    await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, 'notes.txt', 'Non-TeX file')`);
    page.reload();
    await until(`Array.from(document.querySelectorAll('.project-row')).some(row => row.querySelector('strong')?.textContent === ${JSON.stringify(mode)})`, 'project list');
    await evaluate(`Array.from(document.querySelectorAll('.project-row')).find(row => row.querySelector('strong')?.textContent === ${JSON.stringify(mode)}).click()`);
    await until('!!document.querySelector(".structured-preview .preview-block")', `${mode} saved Visual startup`);
    await delay(300);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(`PASS ${mode}: saved Visual layout opens project after asynchronous source load`);
    await evaluate(`document.querySelector('.tree-row[data-path="notes.txt"]').click()`);
    await until('!!document.querySelector(".preview-empty")', 'unsupported file');
    await evaluate(`document.querySelector('.tree-row[data-path="main.tex"]').click()`);
    await until('!!document.querySelector(".structured-preview .preview-block")', 'return to TeX');
    console.log(`PASS ${mode}: unsupported file -> TeX preserves hook order`);
    await evaluate('document.querySelector(".logo-button").click()');
    await until('!!document.querySelector(".dashboard")', 'return to directory');
  }
}
require('../dist/main/index.js');
const timeout = setTimeout(() => { console.error('Startup check timed out'); app.exit(1); }, 45000);
app.whenReady().then(run).then(() => { clearTimeout(timeout); console.log('Artifacts:', root); app.exit(0); }).catch(error => { console.error(error); console.error('Artifacts:', root); app.exit(1); });
