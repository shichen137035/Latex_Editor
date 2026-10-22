// Regression: a persisted Visual layout mounts PreviewPane before source loads.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
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
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', 'project directory');
  for (const mode of ['split', 'single']) {
    const project = await evaluate(`window.latexEditor.projects.create({name:${JSON.stringify(mode)},parentPath:${JSON.stringify(projects)}})`);
    await evaluate(`window.latexEditor.settings.set('layout', {mode:${JSON.stringify(mode)},leftPane:'preview',singlePane:'preview',rightPane:'pdf'},${JSON.stringify(project.id)})`);
    await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, 'main.tex', ${JSON.stringify('\\documentclass{article}\n\\begin{document}\n\\section{Startup}\nA paragraph.\n\\end{document}')})`);
    await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, 'notes.txt', 'Non-TeX file')`);
    page.reload();
    await until(`Array.from(document.querySelectorAll('.directory-project-row')).some(row => row.querySelector('.directory-name-text strong')?.textContent === ${JSON.stringify(mode)})`, 'project list');
    await evaluate(`Array.from(document.querySelectorAll('.directory-project-row')).find(row => row.querySelector('.directory-name-text strong')?.textContent === ${JSON.stringify(mode)}).click()`);
    await until('!!document.querySelector(".structured-preview .preview-block")', `${mode} saved Visual startup`);
    await delay(300);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(`PASS ${mode}: saved Visual layout opens project after asynchronous source load`);
    const diskSource = '\\documentclass{article}\n\\begin{document}\n\\section{External update}\nEXTERNAL_AUTO_SYNC_MARKER\n\\end{document}';
    writeFileSync(resolve(project.canonicalPath, 'main.tex'), diskSource);
    await until('document.querySelector(".structured-preview")?.textContent.includes("EXTERNAL_AUTO_SYNC_MARKER")', `${mode} automatic external source synchronization`);
    writeFileSync(resolve(project.canonicalPath, 'main.tex'), diskSource.replace('EXTERNAL_AUTO_SYNC_MARKER', 'EXTERNAL_REFRESH_MARKER'));
    await evaluate(`document.querySelector('button[data-action="refresh-files"]').click()`);
    await until('document.querySelector(".structured-preview")?.textContent.includes("EXTERNAL_REFRESH_MARKER")', `${mode} manual external source refresh`);
    console.log(`PASS ${mode}: automatic external source synchronization and manual refresh`);
    if (mode === 'split') {
      await evaluate(`Array.from(document.querySelectorAll('.view-switch button')).find(button => button.textContent.trim() === 'Code').click()`);
      await until('document.querySelector(".monaco-editor .view-lines")?.textContent.includes("EXTERNAL_REFRESH_MARKER")', 'source view after external refresh');
      writeFileSync(resolve(project.canonicalPath, 'main.tex'), diskSource.replace('EXTERNAL_AUTO_SYNC_MARKER', 'EXTERNAL_CODE_MARKER'));
      await until('document.querySelector(".monaco-editor .view-lines")?.textContent.includes("EXTERNAL_CODE_MARKER")', 'automatic external synchronization in source editor');
      assert.equal(await evaluate('!!document.querySelector(".editor-tabs button.active i")'), false, 'external reload must remain saved');
      await evaluate(`Array.from(document.querySelectorAll('.view-switch button')).find(button => button.textContent.trim() === 'Visual').click()`);
      await until('document.querySelector(".structured-preview")?.textContent.includes("EXTERNAL_CODE_MARKER")', 'source and preview stay synchronized');
      console.log('PASS source editor: external content updates without becoming dirty, then matches Visual');
    }
    const crossingSource = '\\documentclass{article}\n\\begin{document}\n\\begin{quote}\n  \\begin{samepage}\nCrossing diagnostic\n\\end{quote}\n\\end{samepage}\n\\end{document}';
    writeFileSync(resolve(project.canonicalPath, 'main.tex'), crossingSource);
    await until('document.querySelector(".preview-diagnostic-link")?.textContent.includes("main.tex:4:3")', `${mode} crossing diagnostic location`);
    await evaluate('document.querySelector(".preview-diagnostic-link").click()');
    await until('!!document.querySelector(".monaco-editor .view-lines")', `${mode} diagnostic opens source`);
    await until('!!document.querySelector(".status-bar")?.textContent.match(/Ln\\s*4.*Col\\s*3/)', `${mode} diagnostic source cursor`);
    console.log(`PASS ${mode}: crossing warning opens source at line 4, column 3`);
    await evaluate(`Array.from(document.querySelectorAll('.view-switch button')).find(button => button.textContent.trim() === 'Visual').click()`);
    await until('!!document.querySelector(".structured-preview")', `${mode} return from diagnostic source`);
    await evaluate(`document.querySelector('.tree-row[data-path="notes.txt"]').click()`);
    await until('document.querySelector(".preview-empty p")?.innerText.includes(".tex")', 'unsupported file');
    await evaluate(`document.querySelector('.tree-row[data-path="main.tex"]').click()`);
    await until('!!document.querySelector(".structured-preview .preview-block")', 'return to TeX');
    console.log(`PASS ${mode}: unsupported file -> TeX preserves hook order`);
    await evaluate('document.querySelector(".logo-button").click()');
    await until('!!document.querySelector(".project-directory-v044")', 'return to project directory');
  }
}
require('../../dist/main/index.js');
const timeout = setTimeout(() => { console.error('Startup check timed out'); app.exit(1); }, 45000);
app.whenReady().then(run).then(() => { clearTimeout(timeout); console.log('Artifacts:', root); app.exit(0); }).catch(error => { console.error(error); console.error('Artifacts:', root); app.exit(1); });

