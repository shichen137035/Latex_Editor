// Navigation regressions run against a disposable project/profile.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-preview-navigation-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
const errors = [];
let page;
const evaluate = script => page.webContents.executeJavaScript(script, true);
app.on("web-contents-created", (_event, contents) => {
  contents.on("console-message", ({ level, message }) => {
    if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
  });
});
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
async function editParagraph(marker, insertion, apply = true) {
  await evaluate(`Array.from(document.querySelectorAll('.preview-content-region')).find(el => el.textContent.includes(${JSON.stringify(marker)})).click()`);
  await until('!!document.querySelector(".preview-local-editor .monaco-editor.focused")', "local editor focus");
  await page.webContents.insertText(insertion);
  if (apply) {
    await press("ENTER", ["control"]);
    await until('!document.querySelector(".preview-local-editor")', "apply local draft");
  }
}
const source = "\\documentclass{article}\n\\begin{document}\n" + Array.from({ length: 40 }, (_, index) =>
  `\\section{Section ${index}}\\label{sec:${index}}\nMarker ${index}. ${"Continuous readable prose. ".repeat(12)}${index === 0 ? "See \\ref{sec:39}." : ""}\n\n`
).join("") + "\\end{document}";

async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', "directory");
  const project = await evaluate(`window.latexEditor.projects.create({name:"navigation-regression",parentPath:${JSON.stringify(projects)}})`);
  const projectId = JSON.stringify(project.id);
  await evaluate(`window.latexEditor.settings.set("autoSave", "off", ${projectId})`);
  await evaluate(`window.latexEditor.settings.set("confirmPreviewEdits", false, ${projectId})`);
  await evaluate(`window.latexEditor.settings.set("layout", {mode:"single",singlePane:"preview",leftPane:"preview",rightPane:"pdf"}, ${projectId})`);
  await evaluate(`window.latexEditor.files.write(${projectId}, "main.tex", ${JSON.stringify(source)})`);
  await evaluate(`window.latexEditor.files.write(${projectId}, "notes.txt", "Unsupported preview file")`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', "project list");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".structured-preview .preview-content-region")', "Visual preview");
  page.focus();

  // A previous search match is a highlight, not a perpetual scroll instruction.
  await press("F", ["control"]);
  await until('document.activeElement?.matches(".advanced-search-input")', "Ctrl+F opens and focuses search in Visual mode");
  await evaluate(`(() => { const input = document.querySelector('.advanced-search-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Marker 39'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until('document.querySelector(".search-result-list button")?.textContent.includes("Marker 39")', "search result");
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor textarea")', "Code editor");
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await press("F", ["control"]);
  await until('document.activeElement?.matches(".advanced-search-input") && document.activeElement.selectionEnd === document.activeElement.value.length && document.activeElement.selectionStart === 0', "Ctrl+F refocuses and selects the existing query in Code mode");
  await evaluate(`window.latexEditor.settings.set("keybindings", {"edit.find":"Mod+Shift+F"}, ${projectId})`);
  // Reopen the project to hydrate renderer settings after a direct IPC write.
  await evaluate('document.querySelector(".logo-button").click()');
  await until('!!document.querySelector(".directory-project-row")', "close before loading custom binding");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".structured-preview, .editor-surface .monaco-editor textarea")', "custom binding workspace");
  await press("F", ["control", "shift"]);
  await until('document.activeElement?.matches(".advanced-search-input")', "custom search shortcut");
  await evaluate(`(() => { const input = document.querySelector('.advanced-search-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Marker 39'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until('document.querySelector(".search-result-list button")?.textContent.includes("Marker 39")', "restored search result");
  await evaluate(`window.latexEditor.settings.set("keybindings", {}, ${projectId})`);
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Visual").click()');
  await until('!!document.querySelector(".structured-preview")', "return to Visual mode");
  console.log("PASS Ctrl+F opens/refocuses search in Code and Visual modes and accepts a custom binding");
  await evaluate('document.querySelector(".search-result-list button").click()');
  await until('document.querySelector(".structured-preview").scrollTop > 2000', "search navigation");
  await evaluate('document.querySelector(".structured-preview").scrollTop = 0');
  await until('Array.from(document.querySelectorAll(".preview-content-region")).some(el => el.textContent.includes("Marker 0"))', "opening paragraph");
  await editParagraph("Marker 0", "EDIT_NAV_TEST ");
  await delay(300);
  assert.ok(await evaluate('document.querySelector(".structured-preview").scrollTop < 500'), "editing must not replay the previous search jump");
  console.log("PASS editing does not replay the previous search navigation");

  // Leaving TeX for an unsupported file must not suppress the return restore.
  await evaluate('document.querySelector(".structured-preview").scrollTop = 1200');
  await delay(150);
  await evaluate(`document.querySelector('.activity-bar button[title="Files"]').click()`);
  await evaluate(`document.querySelector('.tree-row[data-path="notes.txt"]').click()`);
  await until('!!document.querySelector(".preview-empty")', "non-TeX preview");
  await evaluate(`document.querySelector('.tree-row[data-path="main.tex"]').click()`);
  await until('document.querySelector(".structured-preview")?.scrollTop > 600', "restore preview position");
  assert.ok(await evaluate('document.querySelector(".structured-preview").scrollTop < 2500'), "stale search match must not override file restoration");
  console.log("PASS TeX -> unsupported file -> TeX restores position without a stale search jump");

  await evaluate('document.querySelector(".structured-preview").scrollTop = 0');
  await until('!!document.querySelector(".preview-reference")', "reference link");
  await evaluate('document.querySelector(".preview-reference").dispatchEvent(new MouseEvent("click", {bubbles:true, ctrlKey:true}))');
  await until('document.querySelector(".structured-preview").scrollTop > 2000', "reference jump");
  await press("B", ["control"]);
  await until('document.querySelector(".structured-preview").scrollTop < 500', "navigation back");
  await press("R", ["control"]);
  await until('document.querySelector(".structured-preview").scrollTop > 2000', "navigation forward");
  console.log("PASS reference navigation supports repeated back/forward in Visual mode");

  // Keyboard navigation used to unmount the local editor and drop its draft.
  await editParagraph("Marker 39", "NAV_DRAFT_TEST ", false);
  await press("B", ["control"]);
  await until('!document.querySelector(".preview-local-editor") && document.querySelector(".structured-preview").scrollTop < 500', "back with a dirty local draft");
  await press("S", ["control"]);
  await until(`(async () => (await window.latexEditor.files.read(${projectId}, "main.tex")).content.includes("NAV_DRAFT_TEST"))()`, "draft committed before navigation");
  console.log("PASS keyboard navigation commits the local draft before changing location");
  assert.equal(errors.length, 0, errors.join("\n"));
}
require("../../dist/main/index.js");
const timeout = setTimeout(() => { console.error("Preview navigation check timed out"); app.exit(1); }, 60000);
app.whenReady().then(run).then(() => { clearTimeout(timeout); console.log("Artifacts:", root); app.exit(0); }).catch(error => { console.error(error); console.error("Artifacts:", root); app.exit(1); });
