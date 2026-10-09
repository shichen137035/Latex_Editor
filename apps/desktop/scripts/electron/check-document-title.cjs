const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(join(tmpdir(), "texweave-title-"));
const projects = join(root, "projects"); mkdirSync(projects);
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
  throw new Error(`Timed out: ${label}\n${await evaluate('JSON.stringify({title:document.querySelector(".preview-title-object")?.textContent,status:document.querySelector(".save-status")?.className,focus:document.activeElement?.outerHTML?.slice(0,180)})')}`);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}
async function openTitle() {
  await evaluate('document.querySelector(".preview-document-title h1").click()');
  await until('!!document.querySelector(".preview-title-object .monaco-editor textarea")', 'title source editor');
  await delay(150);
  await evaluate('document.querySelector(".preview-title-object .monaco-editor textarea").focus()');
}
async function replaceTitle(value) {
  await press("A", ["control"]);
  await page.webContents.insertText(value);
  await delay(80);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', 'directory');
  const project = await evaluate(`window.latexEditor.projects.create({name:'title-source',parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  const prefix = '\\documentclass{article}\n\\usepackage{amsmath}\n';
  const titleSource = '\\title{A \\textbf{complex} title}\n% Preserve author layout\n\\author{Alice\\thanks{Nested {note}} \\and Bob}\n\\affil{University \\textit{Lab}}\n\\date{}\n\\begin{document}\n\\maketitle';
  const suffix = '\n\\section{Introduction}\nUntouched body.\n\\end{document}\n';
  await evaluate(`window.latexEditor.files.write(${id},'main.tex',${JSON.stringify(prefix + titleSource + suffix)})`);
  await evaluate(`window.latexEditor.settings.set('layout',{mode:'single',singlePane:'preview',leftPane:'preview',rightPane:'pdf'},${id})`);
  page.reload(); await until('!!document.querySelector(".directory-project-row")', 'created project');
  await evaluate('document.querySelector(".directory-project-row").click()'); page.focus();
  await until('document.querySelector(".preview-document-title h1")?.textContent.includes("complex")', 'title preview');
  await openTitle();
  await until('document.querySelector(".preview-title-object .view-lines")?.textContent.includes("affil")', 'complete title source');
  assert.equal(await evaluate('!!document.querySelector(".preview-title-object .preview-block-header-actions")'), false);
  const replacement = titleSource.replace('complex', 'updated').replace('Bob', 'Charlie');
  await replaceTitle(replacement);
  await evaluate('document.querySelector(".preview-title-object .preview-local-editor-actions .primary").click()');
  await until('document.querySelector(".preview-document-title h1")?.textContent.includes("updated")', 'updated preview');
  await press('S', ['control']);
  await until(`window.latexEditor.files.read(${id},'main.tex').then(file => file.content === ${JSON.stringify(prefix + replacement + suffix)})`, 'exact source save');
  await until('!!document.querySelector(".save-status.saved")', 'save acknowledgement');
  await openTitle();
  await replaceTitle(replacement.replace('updated', 'discarded'));
  await evaluate('document.querySelector(".preview-title-object .preview-local-editor-actions button:not(.primary)").click()');
  await until('!document.querySelector(".preview-title-object .monaco-editor")', 'cancel title edit');
  assert.ok(await evaluate('document.querySelector(".preview-document-title h1").textContent.includes("updated")'));
  await openTitle();
  const finalSource = replacement.replace('updated', 'saved draft');
  await replaceTitle(finalSource);
  await press('S', ['control']);
  await until(`window.latexEditor.files.read(${id},'main.tex').then(file => file.content === ${JSON.stringify(prefix + finalSource + suffix)})`, 'save commits title draft');
  await until('!!document.querySelector(".save-status.saved")', 'final save acknowledgement');
  assert.deepEqual(errors, []);
  console.log('PASS title source editing, complex metadata preserved, exact save boundaries, cancel and Ctrl+S draft commit');
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => app.exit(0)).catch(error => { console.error(error); console.error(`Artifacts: ${root}`); app.exit(1); });
});
