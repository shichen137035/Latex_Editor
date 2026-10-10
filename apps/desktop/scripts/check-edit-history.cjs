// Real editor input/shortcuts in an isolated profile and temporary project.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { resolve } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
const labels = require("../src/renderer/i18n/locales/en.json");
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
  await evaluate('document.querySelector(".save-status")?.click()');
  await until('!!document.querySelector(".save-status.saved")', "save");
  return (await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)},"main.tex")`)).content;
}
async function blur() { await evaluate('document.activeElement?.blur()'); }
async function runHistoryCommand(direction, step) {
  const command = direction === "undo" ? labels["menu.undo"] : labels["menu.redo"];
  const previous = await evaluate("window.__historyReplayCount ?? 0");
  await evaluate(`Array.from(document.querySelectorAll(".app-menus .menu-anchor > button")).find(button => button.textContent.trim() === ${JSON.stringify(labels["menu.edit"])}).click()`);
  await until('!!document.querySelector(".app-menus .menu-anchor .menu-popover")', "Edit menu");
  await evaluate(`Array.from(document.querySelectorAll(".app-menus .menu-anchor .menu-popover button")).find(button => button.textContent.trim() === ${JSON.stringify(command)}).click()`);
  await until(`(window.__historyReplayCount ?? 0) > ${previous}`, `${direction} ${step}`);
  await evaluate('document.querySelector(".save-status")?.click()');
  await until('!!document.querySelector(".save-status.saved")', `${direction} ${step} saved`);
}
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
  await evaluate("window.__historyReplayCount = 0; window.addEventListener('texweave:history-replayed', () => { window.__historyReplayCount += 1; });");
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
  for (let i = 0; i < 3; i++) await runHistoryCommand("undo", i + 1);
  assert.equal(await saveAndRead(), source, "Three Preview operations undo exactly, even across saves");
  for (let i = 0; i < 3; i++) await runHistoryCommand("redo", i + 1);
  assert.equal(await saveAndRead(), modified, "Three Preview operations redo exactly");
  console.log("PASS Preview deletion, label and paragraph: three undo/redo steps; local draft uses its own undo");
  await evaluate('document.querySelector(".environment-quick-action > button").click()');
  await until('!!document.querySelector(".environment-picker [data-environment-id=theorem]")', "environment picker");
  await evaluate('document.querySelector(".environment-picker [data-environment-id=theorem]").click()');
  const inserted = await saveAndRead();
  assert.ok(inserted.length > modified.length);
  await runHistoryCommand("undo", "environment creation");
  assert.equal(await saveAndRead(), modified, "Undo environment creation");
  await runHistoryCommand("redo", "environment creation");
  assert.equal(await saveAndRead(), inserted, "Ctrl+Shift+Z redoes environment creation");
  console.log("PASS Environment creation and Ctrl+Shift+Z redo");
  // Cell draft commits as one document operation, not a per-keystroke edit.
  await evaluate('document.querySelector(".structured-table td").click()');
  await until('!!document.querySelector(".structured-table textarea")', "table cell input");
  await evaluate('document.querySelector(".structured-table textarea").select()');
  await page.webContents.insertText("CELLCHANGE"); await press("ENTER"); await blur();
  const cellEdited = await saveAndRead(); assert.ok(cellEdited.includes("CELLCHANGE"));
  await runHistoryCommand("undo", "table cell edit");
  assert.equal(await saveAndRead(), inserted, "Undo table cell edit");
  console.log("PASS Table cell edit undo");
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(el=>el.textContent==="Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor")', "Code");
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await until('document.activeElement === document.querySelector(".editor-surface .monaco-editor textarea") && !!document.querySelector(".editor-surface .monaco-editor.focused")', "focused Code editor");
  page.focus();
  await delay(150);
  // Replace the source using real editor input. Ctrl+Home can be swallowed when
  // Monaco is restoring its view state after a Visual/Code switch, making the
  // test depend on a stale caret position instead of the history behavior.
  await press("A", ["control"]);
  // wait for the queued keyboard event to reach Monaco before inserting;
  // otherwise insertText can land at the old caret in a large document.
  await delay(100);
  await page.webContents.insertText("CODE");
  const codeEdited = await saveAndRead();
  assert.equal(codeEdited, "CODE", `Code editor input should replace the selected document; got ${JSON.stringify(codeEdited.slice(0, 80))}`);
  await runHistoryCommand("undo", "Code edit"); assert.equal(await saveAndRead(), inserted, "Main Code editor shares grouped history");
  await runHistoryCommand("redo", "Code edit"); assert.equal(await saveAndRead(), codeEdited);
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(el=>el.textContent==="Visual").click()');
  await until('!!document.querySelector(".structured-preview")', "Visual again");
  await runHistoryCommand("undo", "Code edit after mode switch"); assert.equal(await saveAndRead(), inserted, "Mode switch retains Code operation");
  console.log("PASS Code editor edit history retained across Code/Visual switches");
  await runHistoryCommand("undo", "table cell edit after mode switch"); assert.equal(await saveAndRead(), modified, "New Code edits invalidate the old table redo branch");
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(el=>el.textContent==="Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor")', "Code for custom block");
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await until('!!document.querySelector(".editor-surface .monaco-editor.focused")', "focused Code editor for custom block");
  await press("A", ["control"]);
  await until('!!document.querySelector(".custom-block-button") && !document.querySelector(".custom-block-button").disabled', "Code selection ready for custom block");
  await delay(80);
  await press("B", ["control", "alt"]);
  await until('!!document.querySelector(".custom-block-inspector")', "custom block created");
  const countUsers = () => evaluate(`window.latexEditor.blockGraph.snapshot(${JSON.stringify(project.id)}).then(snapshot=>snapshot.blocks.filter(block=>block.origin==="user").length)`);
  assert.equal(await countUsers(), 1);
  await press("HOME", ["control"]); await page.webContents.insertText("AFTERBLOCK");
  const afterBlock = await saveAndRead(); assert.ok(afterBlock.startsWith("AFTERBLOCK"));
  await runHistoryCommand("undo", "custom block follow-up edit"); assert.equal(await saveAndRead(), modified); assert.equal(await countUsers(), 1);
  await runHistoryCommand("undo", "custom block creation"); await until(`window.latexEditor.blockGraph.snapshot(${JSON.stringify(project.id)}).then(snapshot=>snapshot.blocks.every(block=>block.origin!=="user"))`, "custom creation undo");
  await runHistoryCommand("redo", "custom block creation"); await until(`window.latexEditor.blockGraph.snapshot(${JSON.stringify(project.id)}).then(snapshot=>snapshot.blocks.filter(block=>block.origin==="user").length===1)`, "custom creation redo");
  await runHistoryCommand("redo", "custom block follow-up edit"); assert.equal(await saveAndRead(), afterBlock);
  console.log("PASS Custom block creation and subsequent Code edit share chronological undo/redo");
}
require("../dist/main/index.js");
const timeout = setTimeout(() => { console.error("History check timed out", root); app.exit(1); }, 60000);
app.whenReady().then(run).then(() => { clearTimeout(timeout); app.exit(0); }).catch(error => { console.error(error, root); app.exit(1); });
