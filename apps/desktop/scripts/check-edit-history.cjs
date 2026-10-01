// Real editor input/shortcuts in an isolated profile and temporary project.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-history-"));
mkdirSync(resolve(root, "projects"));
app.setPath("userData", resolve(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
let page, project;
const evaluate = script => page.webContents.executeJavaScript(script, true);
async function until(script, label) {
  for (let i = 0; i < 180; i++) { if (await evaluate(script)) return; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  await delay(80);
}
async function saveAndRead() {
  await press("S", ["control"]);
  await until('!!document.querySelector(".save-status.saved")', "save");
  return (await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)},"main.tex")`)).content;
}
async function blur() { await evaluate('document.activeElement?.blur()'); }
const source = String.raw`\documentclass{article}
\begin{document}
Original paragraph.

\begin{theorem}
Theorem body.
\end{theorem}

\begin{equation}
x+y=z
\end{equation}

\begin{table}
\begin{tabular}{cc}
A & B \\
C & D \\
\end{tabular}
\end{table}
\end{document}`;
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!document.querySelector(".project-directory-v044")', "dashboard");
  project = await evaluate(`window.latexEditor.projects.create({name:"history-test",parentPath:${JSON.stringify(resolve(root, "projects"))}})`);
  await evaluate(`window.latexEditor.settings.set("autoSave","off",${JSON.stringify(project.id)})`);
  await evaluate(`window.latexEditor.settings.set("layout",{mode:"single",singlePane:"preview",leftPane:"preview",rightPane:"pdf"},${JSON.stringify(project.id)})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)},"main.tex",${JSON.stringify(source)})`);
  page.reload(); await until('!!document.querySelector(".directory-project-row")', "project");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".preview-block[data-environment=equation]")', "Preview"); page.focus();
  await evaluate('document.querySelector(".preview-block[data-environment=equation] > .preview-block-header .preview-block-header-main").click()');
  await until('!!document.querySelector(".preview-block[data-environment=equation] > .preview-block-header .preview-block-delete")', "delete action");
  await evaluate('document.querySelector(".preview-block[data-environment=equation] > .preview-block-header .preview-block-delete").click()');
  await until('!document.querySelector(".preview-block[data-environment=equation]")', "deleted equation");
  await evaluate('document.querySelector(".preview-block[data-environment=theorem] .preview-block-label").click()');
  await until('!!document.querySelector(".preview-block-label-editor:focus")', "label input");
  await evaluate('document.querySelector(".preview-block-label-editor").select()');
  await page.webContents.insertText("thm:history"); await press("ENTER");
  await until('document.querySelector(".preview-block[data-environment=theorem] .preview-block-label")?.textContent.includes("thm:history")', "changed label");
  await evaluate('Array.from(document.querySelectorAll(".preview-content-region")).find(el=>el.textContent.includes("Original paragraph")).click()');
  await until('!!document.querySelector(".preview-local-editor .monaco-editor.focused")', "paragraph editor");
  await page.webContents.insertText("DRAFTCHANGE");
  await press("Z", ["control"]);
  await until('!document.querySelector(".preview-local-editor")?.textContent.includes("DRAFTCHANGE")', "local draft undo");
  assert.equal(await evaluate('!!document.querySelector(".preview-block[data-environment=equation]")'), false, "Draft undo must not undo committed operations");
  await press("Y", ["control"]);
  await until('document.querySelector(".preview-local-editor")?.textContent.includes("DRAFTCHANGE")', "local draft redo");
  await press("ENTER", ["control"]);
  await until('!document.querySelector(".preview-local-editor")', "apply paragraph");
  await blur();
  const modified = await saveAndRead();
  assert.ok(modified.includes("DRAFTCHANGE") && modified.includes("thm:history") && !modified.includes("\\begin{equation}"));
  for (let i = 0; i < 3; i++) { await blur(); await press("Z", ["control"]); }
  assert.equal(await saveAndRead(), source, "Three Preview operations undo exactly, even across saves");
  for (let i = 0; i < 3; i++) { await blur(); await press("Y", ["control"]); }
  assert.equal(await saveAndRead(), modified, "Three Preview operations redo exactly");
  console.log("PASS Preview deletion, label and paragraph: three undo/redo steps; local draft uses its own undo");
  await evaluate('document.querySelector(".environment-quick-action > button").click()');
  await until('!!document.querySelector(".environment-picker [data-environment-id=theorem]")', "environment picker");
  await evaluate('document.querySelector(".environment-picker [data-environment-id=theorem]").click()');
  const inserted = await saveAndRead();
  assert.ok(inserted.length > modified.length);
  await blur(); await press("Z", ["control"]);
  assert.equal(await saveAndRead(), modified, "Undo environment creation");
  await blur(); await press("Z", ["control", "shift"]);
  assert.equal(await saveAndRead(), inserted, "Ctrl+Shift+Z redoes environment creation");
  console.log("PASS Environment creation and Ctrl+Shift+Z redo");
  // Cell draft commits as one document operation, not a per-keystroke edit.
  await evaluate('document.querySelector(".structured-table td").click()');
  await until('!!document.querySelector(".structured-table textarea")', "table cell input");
  await evaluate('document.querySelector(".structured-table textarea").select()');
  await page.webContents.insertText("CELLCHANGE"); await press("ENTER"); await blur();
  const cellEdited = await saveAndRead(); assert.ok(cellEdited.includes("CELLCHANGE"));
  await blur(); await press("Z", ["control"]);
  assert.equal(await saveAndRead(), inserted, "Undo table cell edit");
  console.log("PASS Table cell edit undo");
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(el=>el.textContent==="Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor")', "Code");
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await press("HOME", ["control"]);
  for (const letter of "CODE") { await page.webContents.insertText(letter); await delay(20); }
  const codeEdited = await saveAndRead(); assert.ok(codeEdited.startsWith("CODE"));
  await press("Z", ["control"]); assert.equal(await saveAndRead(), inserted, "Main Code editor shares grouped history");
  await press("Y", ["control"]); assert.equal(await saveAndRead(), codeEdited);
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(el=>el.textContent==="Visual").click()');
  await until('!!document.querySelector(".structured-preview")', "Visual again");
  await blur(); await press("Z", ["control"]); assert.equal(await saveAndRead(), inserted, "Mode switch retains Code operation");
  console.log("PASS Code typing grouped; history retained across Code/Visual switches");
  await blur(); await press("Z", ["control"]); assert.equal(await saveAndRead(), modified, "New Code edits invalidate the old table redo branch");
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(el=>el.textContent==="Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor")', "Code for custom block");
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await press("A", ["control"]);
  await press("B", ["control", "alt"]);
  await until('!!document.querySelector(".custom-block-inspector")', "custom block created");
  const countUsers = () => evaluate(`window.latexEditor.blockGraph.snapshot(${JSON.stringify(project.id)}).then(snapshot=>snapshot.blocks.filter(block=>block.origin==="user").length)`);
  assert.equal(await countUsers(), 1);
  await press("HOME", ["control"]); await page.webContents.insertText("AFTERBLOCK");
  const afterBlock = await saveAndRead(); assert.ok(afterBlock.startsWith("AFTERBLOCK"));
  await press("Z", ["control"]); assert.equal(await saveAndRead(), modified); assert.equal(await countUsers(), 1);
  await press("Z", ["control"]); await until(`window.latexEditor.blockGraph.snapshot(${JSON.stringify(project.id)}).then(snapshot=>snapshot.blocks.every(block=>block.origin!=="user"))`, "custom creation undo");
  await press("Y", ["control"]); await until(`window.latexEditor.blockGraph.snapshot(${JSON.stringify(project.id)}).then(snapshot=>snapshot.blocks.filter(block=>block.origin==="user").length===1)`, "custom creation redo");
  await press("Y", ["control"]); assert.equal(await saveAndRead(), afterBlock);
  console.log("PASS Custom block creation and subsequent Code edit share chronological undo/redo");
}
require("../dist/main/index.js");
const timeout = setTimeout(() => { console.error("History check timed out", root); app.exit(1); }, 60000);
app.whenReady().then(run).then(() => { clearTimeout(timeout); app.exit(0); }).catch(error => { console.error(error, root); app.exit(1); });
