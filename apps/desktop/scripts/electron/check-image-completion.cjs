const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-image-completion-"));
const projects = resolve(root, "projects"); mkdirSync(projects);
app.setPath("userData", resolve(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
let page;
const errors = [];
const evaluate = script => page.webContents.executeJavaScript(script, true);
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
async function until(script, label) {
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.deepEqual(errors, []);
    if (await evaluate(script)) return;
    await delay(50);
  }
  console.error(await evaluate('document.querySelector(".block-notice")?.textContent'));
  throw new Error(`Timed out: ${label}`);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}
async function reloadProject() {
  await evaluate('document.querySelector(".save-status").click()');
  await until('!!document.querySelector(".save-status.saved")', 'finish saving before project close');
  await evaluate('document.querySelector(".logo-button").click()');
  await until('!!document.querySelector(".directory-project-row")', 'release document session');
  page.reload();
  await until('!!document.querySelector(".directory-project-row, .structured-preview")', 'reload settings');
  if (await evaluate('!!document.querySelector(".directory-project-row")')) await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".preview-figure img")', 'reopen configured figure');
  page.focus();
}
async function suggest(selector, text, expected) {
  // Visual editors restore their initial caret over two animation frames.
  // Wait for that restoration before moving the caret and entering a test command.
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
  await press('END', ['control']); await page.webContents.insertText('\n' + text);
  await press('SPACE', ['control']);
  for (const value of expected) await until(`Array.from(document.querySelectorAll('.suggest-widget.visible .label-name')).some(el => el.textContent === ${JSON.stringify(value)})`, `completion ${value}`);
  await press('ESC');
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', "directory");
  const project = await evaluate(`window.latexEditor.projects.create({name:"image-completion-regression",parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  await evaluate(`window.latexEditor.settings.set("autoSave", "off", ${id})`);
  await evaluate(`window.latexEditor.settings.set("confirmPreviewEdits", false, ${id})`);
  await evaluate(`window.latexEditor.settings.set("layout", {mode:"single",singlePane:"preview",leftPane:"preview",rightPane:"pdf"}, ${id})`);
  await evaluate(`window.latexEditor.files.createDirectory(${id}, "figures")`);
  for (const [name, color] of [['old', '#1379bc'], ['second', '#328576'], ['new', '#e3b431']]) {
    await evaluate(`window.latexEditor.files.createFile(${id}, ${JSON.stringify(`figures/${name}.svg`)})`);
    await evaluate(`window.latexEditor.files.write(${id}, ${JSON.stringify(`figures/${name}.svg`)}, ${JSON.stringify(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="60"><rect width="160" height="60" fill="${color}"/></svg>`)})`);
  }
  writeFileSync(resolve(project.canonicalPath, 'figures/unused.webp'), Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'));
  await evaluate(`window.latexEditor.files.write(${id}, "references.bib", '@book(first,title="First") @article{second,title={Second}}')`);
  await evaluate(`window.latexEditor.files.createFile(${id}, "unused.tex")`);
  await evaluate(`window.latexEditor.files.write(${id}, "unused.tex", "Unreferenced file.\\\\label{fig:unused}")`);
  const source = "\\documentclass{article}\n\\begin{document}\n\\begin{figure}\n\\includegraphics[width=.25\\textwidth]{figures/old.svg}\n\\includegraphics[width=.3\\textwidth]{figures/second.svg}\n\\caption{Keep caption}\\label{fig:keep}\n\\end{figure}\nEditor anchor.\n\\includegraphics{figures/missing.svg}\n\\end{document}";
  const initialSource = source.replace('\\begin{figure}', '\\begin{figure}[htbp]').replace('Editor anchor.', '\\begin{table}[t]\n\\begin{tabular}{cc}\nA & B \\\\\n1 & 2\n\\end{tabular}\n\\caption{Table \\textbf{caption}}\\label{tab:keep}\n\\end{table}\nEditor anchor.');
  await evaluate(`window.latexEditor.files.write(${id}, "main.tex", ${JSON.stringify(initialSource)})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', "project list");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('document.querySelectorAll(".preview-figure img").length === 2', "figure images");
  page.focus();
  await evaluate('document.querySelectorAll(".preview-figure img")[1].click()');
  await until('!!document.querySelector(".image-insert-dialog")', "image click opens the existing picker");
  assert.equal(await evaluate('!!document.querySelector(".preview-local-editor")'), false);
  await evaluate('Array.from(document.querySelectorAll(".image-insert-choices button")).find(button => button.textContent.includes("Project image")).click()');
  await until('!!document.querySelector(".image-project-list")', "project images");
  await evaluate('Array.from(document.querySelectorAll(".image-project-list button")).find(button => button.textContent.includes("figures/new.svg")).click()');
  await evaluate('document.querySelector(".image-project-picker footer .primary").click()');
  await until('!document.querySelector(".image-insert-dialog") && Array.from(document.querySelectorAll(".preview-figure img")).some(img => img.alt === "figures/new.svg")', "replace second image");
  await press('S', ['control']);
  await until(`window.latexEditor.files.read(${id}, "main.tex").then(file => file.content.includes('figures/new.svg'))`, "save replacement");
  assert.equal((await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content, initialSource.replace('figures/second.svg', 'figures/new.svg'));
  console.log('PASS click-to-replace preserves other images, image options, caption and label');
  await evaluate('Array.from(document.querySelectorAll(".figure-preview-placeholder")).find(el => el.textContent.includes("figures/missing.svg")).click()');
  await until('!!document.querySelector(".image-insert-dialog")', "missing image can also be replaced");
  await evaluate('document.querySelector(".image-insert-dialog header button").click()');
  console.log('PASS unresolved image placeholders open the same replacement picker');

  let expectedSource = initialSource.replace('figures/second.svg', 'figures/new.svg');
  for (const [environment, oldOption, newOption, oldCaption] of [['figure', 'htbp', 'H', '\\caption{Keep caption}'], ['table', 't', 'bp', '\\caption{Table \\textbf{caption}}']]) {
    const block = `.preview-block[data-environment="${environment}"]`;
    await evaluate(`document.querySelector(${JSON.stringify(block + ' .preview-block-options')}).click()`);
    await until(`!!document.querySelector(${JSON.stringify(block + ' .preview-block-title-editor')})`, 'option editor');
    await press('A', ['control']); await page.webContents.insertText(newOption); await press('ENTER');
    await press('S', ['control']);
    expectedSource = expectedSource.replace(`\\begin{${environment}}[${oldOption}]`, `\\begin{${environment}}[${newOption}]`);
    await until(`window.latexEditor.files.read(${id}, "main.tex").then(file => file.content === ${JSON.stringify(expectedSource)})`, 'save only float option');
    await evaluate(`document.querySelector(${JSON.stringify(block + ' .preview-caption-text')}).click()`);
    await until(`!!document.querySelector(${JSON.stringify(block + ' .preview-caption-field .monaco-editor textarea')})`, 'caption source editor');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await evaluate(`document.querySelector(${JSON.stringify(block + ' .preview-caption-field .monaco-editor textarea')}).focus()`);
    const editedCaption = `\\caption[Short]{Edited ${environment} \\textbf{caption} $x$}`;
    await press('A', ['control']); await page.webContents.insertText(editedCaption);
    await until(`document.querySelector(${JSON.stringify(block + ' .preview-caption-field .view-lines')})?.textContent.includes("Edited")`, 'typed caption visible');
    await evaluate(`document.querySelector(${JSON.stringify(block + ' .preview-caption-field .preview-local-editor-actions .primary')}).click()`);
    await until(`document.querySelector(${JSON.stringify(block + ' .preview-caption-text')})?.textContent.includes(${JSON.stringify('Edited ' + environment)})`, 'caption commit rendered');
    await press('S', ['control']);
    expectedSource = expectedSource.replace(oldCaption, editedCaption);
    await until(`window.latexEditor.files.read(${id}, "main.tex").then(file => file.content === ${JSON.stringify(expectedSource)})`, 'save only caption command');
    await evaluate(`document.querySelector(${JSON.stringify(block + ' .preview-caption-text')}).click()`);
    await until(`!!document.querySelector(${JSON.stringify(block + ' .preview-caption-field .monaco-editor textarea')})`, 'caption cancel editor');
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await evaluate(`document.querySelector(${JSON.stringify(block + ' .preview-caption-field .monaco-editor textarea')}).focus()`);
    await press('A', ['control']); await page.webContents.insertText('discarded caption'); await press('ESC');
    await until('!document.querySelector(".preview-local-editor")', 'cancel caption edit');
    assert.equal((await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content, expectedSource);
  }
  console.log('PASS figure/table float options and caption source edits preserve other content; Escape cancels');

  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor textarea")', "Code editor");
  await suggest('.editor-surface .monaco-editor textarea', '\\cite{', ['first', 'second']);
  await suggest('.editor-surface .monaco-editor textarea', '\\includegraphics{figures/', ['figures/new.svg', 'figures/unused.webp']);
  await suggest('.editor-surface .monaco-editor textarea', '\\ref{fig:', ['fig:unused', 'fig:keep']);
  console.log('PASS Code completion lists unreferenced BibTeX keys, labels and all project images including WebP');
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Visual").click()');
  await until('Array.from(document.querySelectorAll(".preview-content-region")).some(el => el.textContent.includes("Editor anchor"))', "Visual paragraph");
  await evaluate('Array.from(document.querySelectorAll(".preview-content-region")).find(el => el.textContent.includes("Editor anchor")).click()');
  await until('!!document.querySelector(".preview-local-editor .monaco-editor textarea")', "local editor");
  await suggest('.preview-local-editor .monaco-editor textarea', '\\cite{', ['first', 'second']);
  assert.ok(await evaluate('!!document.querySelector(".preview-local-editor .monaco-editor textarea")'), 'Esc closes completion without discarding the Visual draft');
  await evaluate(`window.latexEditor.files.createFile(${id}, "late.bib");`);
  await evaluate(`window.latexEditor.files.write(${id}, "late.bib", "@book{lateKey,title={Added while editing}}")`);
  await evaluate(`document.querySelector('.sidebar-heading button[title="Refresh file tree"]').click()`);
  await until('!!document.querySelector(\'.tree-row[data-path="late.bib"]\')', "new bibliography in tree");
  await suggest('.preview-local-editor .monaco-editor textarea', '\\cite{late', ['lateKey']);
  console.log('PASS Visual source completion refreshes resource snapshots while its editor stays open');
  await evaluate('Array.from(document.querySelectorAll(".preview-local-editor-actions button")).find(button => button.textContent === "Cancel").click()');
  await until('!document.querySelector(".preview-local-editor")', 'close test paragraph draft');
  const catalog = require('../../../../resources/environments/preview-environments.json');
  const definitions = catalog.previewEnvironments.map(entry => ({ ...entry, enabled:true, builtIn:true, labelKey:entry.labelKey ?? `environment.${entry.id}`, style:{...catalog.defaultStyle,...catalog.familyStyles[entry.family],...entry.style}, behavior:{...catalog.defaultBehavior,...entry.behavior} }));
  const configuredFigure = definitions.find(entry => entry.id === 'figure');
  Object.assign(configuredFigure.behavior, {showCaption:false, showLabel:false, imageClickAction:'inspect'});
  configuredFigure.style.imageMaxHeightVh = 45;
  await evaluate(`window.latexEditor.settings.set("environments", ${JSON.stringify(definitions)}, ${id})`);
  await reloadProject();
  await until('!document.querySelector(".preview-figure figcaption, .preview-figure > small")', 'image caption/label settings');
  await evaluate('document.querySelector(".preview-figure img").click()');
  assert.equal(await evaluate('!!document.querySelector(".image-insert-dialog, .preview-local-editor")'), false);
  assert.ok(await evaluate('Math.abs(parseFloat(getComputedStyle(document.querySelector(".preview-figure img")).maxHeight) - innerHeight * .45) < 1'));
  await evaluate('document.querySelectorAll(".preview-figure img")[1].click()');
  await until('document.querySelector(".figure-inspector-fields input")?.value === "figures/new.svg"', 'select the second image in inspector');
  await evaluate('document.querySelectorAll(".figure-inspector-tabs button")[1].click()');
  const figureDraft = await evaluate('document.querySelector(".figure-inspector > textarea").value');
  const singleImage = figureDraft.split('\n').filter(line => !line.includes('figures/new.svg')).join('\n');
  await evaluate(`(() => { const input = document.querySelector('.figure-inspector > textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(singleImage)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until('document.querySelectorAll(".preview-figure img").length === 1', 'remove the selected image in advanced source');
  await evaluate('document.querySelector(".figure-inspector-tabs button").click()');
  await until('document.querySelector(".figure-inspector-fields input")?.value === "figures/old.svg"', 'inspector clamps selection to the remaining image');
  await evaluate(`(() => { const input = document.querySelector('.figure-inspector-fields input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'figures/new.svg'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until('document.querySelector(".preview-figure img")?.alt === "figures/new.svg"', 'property edit uses the clamped image index');
  console.log('PASS inspector remains editable after removing the previously selected image');
  configuredFigure.behavior.imageClickAction = 'source';
  await evaluate(`window.latexEditor.settings.set("environments", ${JSON.stringify(definitions)}, ${id})`);
  await reloadProject();
  await evaluate('document.querySelector(".preview-figure img").click()');
  await until('!!document.querySelector(".preview-local-editor") && !document.querySelector(".image-insert-dialog")', 'image click follows source policy');
  await evaluate('Array.from(document.querySelectorAll(".preview-local-editor-actions button")).find(button => button.textContent === "Cancel").click()');
  Object.assign(configuredFigure.behavior, {showCaption:true, captionEditable:false, imageClickAction:'replace', inlineEditable:false});
  await evaluate(`window.latexEditor.settings.set("environments", ${JSON.stringify(definitions)}, ${id})`);
  await reloadProject();
  await until('!!document.querySelector(".preview-figure figcaption") && !document.querySelector(".preview-figure .preview-caption-text")', 'caption read-only policy');
  await evaluate('document.querySelector(".preview-figure img").click()');
  assert.equal(await evaluate('!!document.querySelector(".image-insert-dialog, .preview-local-editor")'), false);
  console.log('PASS image policy, caption editing, label visibility and image dimensions follow configuration');
  assert.deepEqual(errors, []);
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => { console.log(`Artifacts: ${root}`); app.exit(0); }).catch(error => { console.error(error); console.error(errors); console.error(`Artifacts: ${root}`); app.exit(1); });
});
