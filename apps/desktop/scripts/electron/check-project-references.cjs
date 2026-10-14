const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-project-references-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
let page;
const errors = [];
const evaluate = script => page.webContents.executeJavaScript(script, true);
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
async function until(script, label) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    assert.equal(errors.length, 0, errors.join("\n"));
    if (await evaluate(script)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}
const setInput = (selector, value) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
const cite = key => evaluate(`Array.from(document.querySelectorAll('.project-reference-browser .reference-quick-entry')).find(entry => entry.querySelector('code')?.textContent === ${JSON.stringify(key)}).querySelector('.reference-quick-cite').click()`);

async function checkBibPaste(id) {
  await evaluate(`Array.from(document.querySelectorAll('.project-reference-source')).find(button=>button.textContent.includes('references.bib') && !button.textContent.includes('.texweave')).click()`);
  await until('!!document.querySelector(".bib-preview-pane") || !!document.querySelector(".editor-surface .monaco-editor")', 'bibliography opened');
  if (!await evaluate('!!document.querySelector(".bib-preview-pane")')) await evaluate(`Array.from(document.querySelectorAll('.view-switch button')).find(button=>button.textContent.trim()==='Visual').click()`);
  await until('!!document.querySelector(".bib-preview-pane")', 'bibliography preview');
  const original = (await evaluate(`window.latexEditor.files.read(${id},'references.bib')`)).content;
  const pasted = '@string{venue = "Example journal"}\n@article{pastedA,title={Pasted paper},journal=venue}\n@book{pastedB,title={Pasted book}}';
  // Mock clipboard in this disposable renderer; preserve the user's system clipboard.
  await evaluate(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{readText:async()=>${JSON.stringify(pasted)}}})`);
  const open = () => evaluate(`Array.from(document.querySelectorAll('.bib-preview-actions button')).find(button=>button.textContent.trim()==='Paste BibTeX').click()`);
  const setDraft = value => evaluate(`(()=>{const input=document.querySelector('.bib-paste-dialog textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await open();
  await until('document.querySelector(".bib-paste-dialog textarea")?.value.includes("pastedA")', 'clipboard prefill');
  await setDraft('@book{localKey,title={Duplicate}}');
  await evaluate('document.querySelector(".bib-paste-dialog button.primary").click()');
  await until('document.querySelector(".bib-paste-dialog [role=alert]")?.textContent.includes("localKey")', 'duplicate citation key rejected');
  await setDraft('@article{incomplete,');
  await evaluate('document.querySelector(".bib-paste-dialog button.primary").click()');
  await until('!!document.querySelector(".bib-paste-dialog [role=alert]")', 'incomplete source rejected');
  assert.equal((await evaluate(`window.latexEditor.files.read(${id},'references.bib')`)).content, original);
  await setDraft(pasted);
  await evaluate('document.querySelector(".bib-paste-dialog button.primary").click()');
  await until('!document.querySelector(".bib-paste-dialog") && document.querySelector(".bib-preview-pane")?.textContent.includes("Pasted book")', 'pasted entries appended');
  await press('S',['control']);
  await until(`window.latexEditor.files.read(${id},'references.bib').then(file=>file.content.includes('pastedB'))`, 'pasted bibliography saved');
  const saved = (await evaluate(`window.latexEditor.files.read(${id},'references.bib')`)).content;
  assert.ok(saved.startsWith(original));
  assert.ok(saved.includes(pasted));
  console.log('PASS BibTeX paste: clipboard prefill, multiple entries and string definitions appended; duplicate and malformed source rejected; original content preserved.');
}

async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', "directory");
  const project = await evaluate(`window.latexEditor.projects.create({name:"references-regression",parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  await evaluate(`window.latexEditor.settings.set("autoSave", "off", ${id})`);
  await evaluate(`window.latexEditor.settings.set("confirmPreviewEdits", false, ${id})`);
  await evaluate(`window.latexEditor.settings.set("layout", {mode:"single",singlePane:"preview",leftPane:"preview",rightPane:"pdf"}, ${id})`);
  const source = "\\documentclass{article}\n\\begin{document}\nEditable paragraph.\n\\bibliographystyle{plain}\n\\bibliography{references}\n\\end{document}";
  await evaluate(`window.latexEditor.files.write(${id}, "main.tex", ${JSON.stringify(source)})`);
  await evaluate(`window.latexEditor.files.write(${id}, "references.bib", "@book{localKey,title={Local only book},author={Alice},year={2024}}")`);
  await evaluate(`window.latexEditor.files.createDirectory(${id}, "nested")`);
  await evaluate(`window.latexEditor.files.createFile(${id}, "nested/extra.bib")`);
  await evaluate(`window.latexEditor.files.write(${id}, "nested/extra.bib", "@article{otherKey,title={Nested paper},author={Bob}}")`);
  const library = await evaluate('window.latexEditor.references.saveEntry({citationKey:"libraryKey",entryType:"article",fields:{title:"Global paper"}})');
  const aliasEntry = await evaluate('window.latexEditor.references.saveEntry({citationKey:"originalKey",entryType:"book",fields:{title:"Aliased book"}})');
  await evaluate(`window.latexEditor.references.setProjectLink({projectId:${id},libraryEntryId:${JSON.stringify(aliasEntry.id)},citationKeyInProject:"projectAlias",mode:"link",targetBibPath:".texweave/generated-references.bib"})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', "project list");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".preview-content-region")', "Visual preview");
  page.focus();
  await evaluate(`document.querySelector('.activity-bar button[title^="Library"]').click()`);
  await until('document.querySelector(".project-reference-browser")?.textContent.includes("Local only book") && document.querySelector(".project-reference-browser")?.textContent.includes("Nested paper")', "project bib entries");
  if (process.argv.includes('--bib-paste-only')) { await checkBibPaste(id); assert.deepEqual(errors, []); return; }
  await setInput('.project-reference-browser input', 'Bob');
  await until('document.querySelectorAll(".project-reference-browser .reference-quick-entry").length === 1', "search all project files");
  await setInput('.project-reference-browser input', '');
  await evaluate(`Array.from(document.querySelectorAll('.preview-content-region')).find(el => el.textContent.includes('Editable paragraph')).click()`);
  await until('!!document.querySelector(".preview-local-editor .monaco-editor.focused")', "local source editor");
  await press('END');
  await cite('localKey');
  await until('document.querySelector(".preview-local-editor")?.textContent.includes("localKey")', "Visual citation insertion");
  await press('ENTER', ['control']);
  await until('!document.querySelector(".preview-local-editor")', "apply citation draft");
  await press('S', ['control']);
  await until(`window.latexEditor.files.read(${id}, "main.tex").then(file => file.content.includes('\\\\cite{localKey}'))`, "save Visual citation");
  assert.ok((await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content.includes('\\cite{localKey}'));
  console.log('PASS project .bib browsing/search and Visual local editor citation');
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor textarea")', "Code editor");
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await press('HOME', ['control']);
  await cite('otherKey');
  await press('S', ['control']);
  await until(`window.latexEditor.files.read(${id}, "main.tex").then(file => file.content.startsWith('\\\\cite{otherKey}'))`, "save Code citation");
  assert.ok((await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content.startsWith('\\cite{otherKey}'));
  console.log('PASS Code citation uses the saved editor cursor');
  await evaluate(`Array.from(document.querySelectorAll('.project-reference-browser .reference-quick-entry')).find(entry => entry.querySelector('code')?.textContent === 'localKey').querySelector('.project-reference-source').click()`);
  await until('document.querySelectorAll(".project-reference-browser .reference-quick-cite:disabled").length === 2', "BibTeX files cannot receive citations");
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await press('END', ['control']);
  await page.webContents.insertText('\n@misc{unsavedKey,title={Unsaved reference}}');
  await until('document.querySelector(".project-reference-browser")?.textContent.includes("Unsaved reference")', "unsaved bib refresh");
  console.log('PASS source navigation, disabled non-TeX citation, and unsaved .bib indexing');
  await evaluate('Array.from(document.querySelectorAll(".reference-quick-tabs button")).find(button => button.textContent.includes("Find in library")).click()');
  await setInput('.reference-quick-filters input', 'Global paper');
  await until('!!document.querySelector(".reference-quick-add")', "global library result");
  await evaluate('document.querySelector(".reference-quick-add").click()');
  await until('document.querySelector(".reference-quick-notice")?.textContent.includes("added")', "library sync");
  const generated = (await evaluate(`window.latexEditor.files.read(${id}, ".texweave/generated-references.bib")`)).content;
  assert.ok(generated.includes('@book{projectAlias'));
  assert.ok(generated.includes('@article{libraryKey'));
  assert.equal((await evaluate(`window.latexEditor.references.snapshot(${id})`)).projectLinks.some(link => link.libraryEntryId === library.id), true);
  console.log('PASS library synchronization preserves project citation aliases');
  // A dirty generated bibliography must remain intact and a failed link must roll back.
  const protectedEntry = await evaluate('window.latexEditor.references.saveEntry({citationKey:"protectedKey",entryType:"book",fields:{title:"Protected write test"}})');
  await evaluate('document.querySelectorAll(".reference-quick-tabs button")[1].click()');
  await until(`Array.from(document.querySelectorAll('.project-reference-source')).some(button => button.textContent.includes('.texweave/generated-references.bib'))`, "generated bibliography browser entry");
  await evaluate(`Array.from(document.querySelectorAll('.project-reference-source')).find(button => button.textContent.includes('.texweave/generated-references.bib')).click()`);
  await until('document.querySelector(".editor-surface .view-lines")?.textContent.includes("projectAlias")', "generated source editor model");
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await press('END', ['control']);
  await page.webContents.insertText('\n% UNSAVED_GENERATED');
  await until('document.querySelector(".editor-surface .view-lines")?.textContent.includes("UNSAVED_GENERATED")', "dirty generated buffer");
  await evaluate(`document.querySelector('[aria-label="Refresh reference library"]').click()`);
  await evaluate('Array.from(document.querySelectorAll(".reference-quick-tabs button")).find(button => button.textContent.includes("Find in library")).click()');
  await setInput('.reference-quick-filters input', 'Protected write test');
  await until('!!document.querySelector(".reference-quick-add")', "protected global entry");
  await evaluate('document.querySelector(".reference-quick-add").click()');
  await until('document.querySelector(".reference-quick-notice")?.textContent.includes("Save or close")', "dirty bibliography write rejection");
  assert.equal((await evaluate(`window.latexEditor.references.snapshot(${id})`)).projectLinks.some(link => link.libraryEntryId === protectedEntry.id), false);
  assert.equal((await evaluate(`window.latexEditor.files.read(${id}, ".texweave/generated-references.bib")`)).content, generated);
  await evaluate('document.querySelectorAll(".reference-quick-tabs button")[1].click()');
  await press('S', ['control']);
  await until(`window.latexEditor.files.read(${id}, ".texweave/generated-references.bib").then(file => file.content.includes('UNSAVED_GENERATED'))`, "save generated bibliography");
  assert.ok((await evaluate(`window.latexEditor.files.read(${id}, ".texweave/generated-references.bib")`)).content.includes('UNSAVED_GENERATED'));
  console.log('PASS failed library writes preserve dirty buffers and roll back project links');
  await checkBibPaste(id);
  assert.deepEqual(errors, []);
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => { console.log(`Artifacts: ${root}`); app.exit(0); }).catch(error => { console.error(error); console.error(`Artifacts: ${root}`); app.exit(1); });
});
