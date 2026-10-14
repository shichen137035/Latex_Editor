const { app, BrowserWindow, ipcMain } = require("electron");
const { desktopInvoke } = require("@latex-editor/contracts/desktop-ipc");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { readFile, readdir, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const assert = require("node:assert/strict");

const root = mkdtempSync(resolve(tmpdir(), "texweave-multi-compile-"));
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
  for (let i = 0; i < 600; i++) {
    assert.equal(errors.length, 0, errors.join("\n"));
    if (await evaluate(script)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
function source(marker, count) {
  return '\\documentclass{article}\n\\begin{document}\n' + Array.from({ length: count }, (_, i) => `${marker} page ${i + 1}.\\par ${'Readable prose. '.repeat(40)}${i < count - 1 ? '\\newpage' : ''}\n`).join('') + '\\end{document}\n';
}
async function compileUi(marker) {
  await evaluate('document.querySelector(".compile-button").click()');
  await until('!document.querySelector(".compile-button")?.disabled', 'compile idle');
  await until(`Array.from(document.querySelectorAll('.pdf-page .textLayer span')).some(el => el.textContent.includes(${JSON.stringify(marker)}))`, 'PDF ' + marker);
}
async function openFile(path) {
  await evaluate(`document.querySelector('.tree-row[data-path=${JSON.stringify(path)}]').click()`);
  await until(`!!document.querySelector('.tree-row.active[data-path=${JSON.stringify(path)}]')`, 'selected file ' + path);
}
async function selectPdf(id) {
  await evaluate('document.querySelector(".pdf-document-select").click()');
  await until(`!!document.querySelector('.pdf-document-option[data-document-id=${JSON.stringify(id)}]')`, 'PDF option ' + id);
  await evaluate(`document.querySelector('.pdf-document-option[data-document-id=${JSON.stringify(id)}]').click()`);
  await until(`document.querySelector('.pdf-document-select')?.dataset.selectedId === ${JSON.stringify(id)} && !!document.querySelector('.pdf-page .textLayer span')`, 'preview selection ' + id);
}
async function setFollowing(enabled) {
  page.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['control'] });
  page.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: ['control'] });
  await until('!!document.querySelector(".settings-dialog-header")', 'settings');
  await evaluate('document.querySelector(\'[data-section="projectBuild"]\').click()');
  await until('!!document.querySelector(\'[data-setting="pdfFollowActiveTex"] input\')', 'PDF following preference');
  await evaluate(`(() => { const input = document.querySelector('[data-setting="pdfFollowActiveTex"] input'); if(input.checked !== ${enabled}) input.click(); })()`);
  await until(`document.querySelector('[data-setting="pdfFollowActiveTex"] input').checked === ${enabled}`, 'PDF following state');
  await evaluate('document.querySelector(".settings-close").click()');
}
async function readingPage() {
  return evaluate(`(() => { const root = document.querySelector('.pdf-viewer'), y = root.getBoundingClientRect().top; return Number(Array.from(root.querySelectorAll('.pdf-page')).find(el => el.getBoundingClientRect().bottom > y)?.dataset.page); })()`);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', 'directory');
  const project = await evaluate(`window.latexEditor.projects.create({name:"multi-documents",parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  mkdirSync(join(project.canonicalPath, 'supplement'));
  mkdirSync(join(project.canonicalPath, 'parts'));
  await writeFile(join(project.canonicalPath, 'parts/shared.tex'), 'Included chapter fragment.\\label{sec:shared}\n');
  await writeFile(join(project.canonicalPath, 'main.tex'), source('Primary', 1)
    .replace('\\begin{document}', '\\usepackage{hyperref}\n\\begin{document}')
    .replace('\\end{document}', '\\input{parts/shared}\n\\href{supplement/main.pdf#page=3}{Read supplement}\n\\end{document}'));
  await writeFile(join(project.canonicalPath, 'supplement/main.tex'), source('Secondary', 3));
  await writeFile(join(project.canonicalPath, 'references.bib'), '@book{test,title={Example},author={Author},year={2026}}');
  await evaluate(`window.latexEditor.settings.set("autoSave","off",${id})`);
  await evaluate(`window.latexEditor.settings.set("layout",{mode:"split",leftPane:"source",rightPane:"pdf",singlePane:"source"},${id})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', 'project list');
  await evaluate('document.querySelector(".directory-project-row").click()'); page.focus();
  await until(`!!document.querySelector('.tree-row[data-path="supplement"]')`, 'file tree');
  await evaluate(`document.querySelector('.tree-row[data-path="supplement"]').click()`);
  await until(`!!document.querySelector('.tree-row[data-path="supplement/main.tex"]')`, 'expanded directory');
  await until('!!document.querySelector(".pdf-document-select") && !document.querySelector(".pdf-document-select").disabled', 'PDF picker');
  await evaluate('document.querySelector(".pdf-document-select").click()');
  await until('document.querySelectorAll(".pdf-document-option").length === 2', 'document roots, excluding include fragment');
  await evaluate('document.querySelector(".pdf-document-select").click()');
  await openFile('supplement/main.tex');
  await compileUi('Secondary');
  assert.equal(await evaluate('document.querySelector(".pdf-origin-label").textContent'), 'supplement/main.tex');
  assert.equal(await evaluate('document.querySelectorAll(".pdf-page").length'), 3);
  const primaryPdf = await readFile(join(project.canonicalPath, 'main.pdf'));
  const targetsRoot = join(project.canonicalPath, '.texweave/build/targets');
  const [target] = await readdir(targetsRoot);
  const secondaryPdf = join(targetsRoot, target, 'main.pdf');
  assert.notDeepEqual(await readFile(secondaryPdf), primaryPdf);
  assert.deepEqual(await readFile(join(project.canonicalPath, 'supplement/main.pdf')), await readFile(secondaryPdf));
  assert.equal((await evaluate(`window.latexEditor.projects.list()`)).find(item => item.id === project.id).mainFile, 'main.tex');
  console.log('PASS primary and selected TeX both compile; same-named outputs stay separate');

  await evaluate(`Array.from(document.querySelectorAll('.split-toolbar-row button')).find(button => button.textContent.trim() === 'Log').click()`);
  await until('!!document.querySelector(".compile-result-picker")', 'two compilation logs');
  assert.deepEqual(await evaluate('Array.from(document.querySelector(".compile-result-picker").options).map(option => option.value)'), ['main.tex', 'supplement/main.tex']);
  await evaluate(`(() => { const select = document.querySelector('.compile-result-picker'); select.value = 'main.tex'; select.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await until('document.querySelector(".compile-result-picker").value === "main.tex"', 'primary log selected');
  assert.equal(await evaluate('document.querySelector(".pdf-origin-label").textContent'), 'supplement/main.tex');
  await evaluate('document.querySelector(".panel-close").click()');
  console.log('PASS both document logs are accessible without switching the displayed PDF');

  let reversePdf;
  ipcMain.removeHandler(desktopInvoke.synctex.reverse.channel);
  ipcMain.handle(desktopInvoke.synctex.reverse.channel, (_event, _projectId, pdf) => {
    reversePdf = pdf; return { file: 'supplement/main.tex', line: 3, column: 1 };
  });
  await evaluate(`(() => { const page = document.querySelector('.pdf-page'), rect = page.getBoundingClientRect(); page.dispatchEvent(new MouseEvent('dblclick', {bubbles:true,clientX:rect.left+150,clientY:rect.top+150})); })()`);
  for (let i = 0; i < 100 && !reversePdf; i++) await delay(50);
  assert.equal(reversePdf, '.texweave/build/targets/' + target + '/main.pdf');
  console.log('PASS PDF reverse navigation addresses the displayed secondary output');

  await evaluate(`(() => { const root = document.querySelector('.pdf-viewer'), page = root.querySelector('[data-page="3"]'); root.scrollTop += page.getBoundingClientRect().top - root.getBoundingClientRect().top + page.clientHeight * .2; })()`);
  await delay(300); assert.equal(await readingPage(), 3);
  await openFile('references.bib'); await compileUi('Primary');
  assert.equal(await evaluate('document.querySelector(".pdf-origin-label").textContent'), 'main.tex');
  assert.equal(await evaluate('document.querySelectorAll(".pdf-page").length'), 1);
  await openFile('supplement/main.tex'); await compileUi('Secondary');
  await delay(300); assert.equal(await readingPage(), 3);
  assert.deepEqual(await readFile(join(project.canonicalPath, 'main.pdf')), primaryPdf);
  console.log('PASS non-TeX selection displays main; returning to a secondary restores its own reading position');

  await selectPdf('main.tex');
  await until('document.querySelector(".pdf-origin-label")?.textContent === "main.tex"', 'manual primary preview without compiling');
  await selectPdf('supplement/main.tex');
  await delay(300); assert.equal(await readingPage(), 3);
  console.log('PASS preview picker switches existing PDFs and retains independent reading positions');

  await evaluate('document.querySelector(\'.tree-row[data-path="parts"]\').click()');
  await until('!!document.querySelector(\'.tree-row[data-path="parts/shared.tex"]\')', 'included source');
  await openFile('parts/shared.tex');
  await until('document.querySelector(".pdf-document-select")?.dataset.selectedId === "main.tex" && !!document.querySelector(".pdf-link")', 'include owner preview and PDF reference link');
  await compileUi('Primary');
  assert.equal((await evaluate(`window.latexEditor.compile.outputs(${id})`)).some(item => item.sourceFile === 'parts/shared.tex'), false);
  await evaluate('Array.from(document.querySelectorAll(".pdf-link")).find(link => link.dataset.pdfLink.includes("supplement/main.pdf")).click()');
  await until('document.querySelector(".pdf-document-select")?.dataset.selectedId === "supplement/main.tex" && document.querySelectorAll(".pdf-page").length === 3', 'PDF cross-document reference');
  await until(`(() => { const root=document.querySelector('.pdf-viewer'), y=root?.getBoundingClientRect().top; return root && Number(Array.from(root.querySelectorAll('.pdf-page')).find(el=>el.getBoundingClientRect().bottom>y)?.dataset.page)===3; })()`, 'linked page destination');
  console.log('PASS input fragments follow their owning PDF; PDF cross-references switch document and page');

  await setFollowing(false);
  await openFile('main.tex'); await openFile('references.bib');
  assert.equal(await evaluate('document.querySelector(".pdf-document-select").dataset.selectedId'), 'supplement/main.tex');
  await evaluate('document.querySelector(".compile-button").click()');
  await until('!document.querySelector(".compile-button")?.disabled', 'compile without changing pinned preview');
  assert.equal(await evaluate('document.querySelector(".pdf-document-select").dataset.selectedId'), 'supplement/main.tex');
  await setFollowing(true);
  await until('document.querySelector(".pdf-document-select")?.dataset.selectedId === "main.tex"', 'reenable following');
  await openFile('supplement/main.tex');
  await until('document.querySelector(".pdf-document-select")?.dataset.selectedId === "supplement/main.tex"', 'automatic secondary preview without compiling');
  console.log('PASS following is configurable and manual preview remains selected while disabled, including during compilation');
  assert.deepEqual(errors, []);
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => { console.log(`Artifacts: ${root}`); app.exit(0); }).catch(error => { console.error(error); console.error(`Artifacts: ${root}`); app.exit(1); });
});
