// Navigation regressions run against a disposable project/profile.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
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
  console.error(await evaluate(`({active:document.querySelector('.editor-tabs button.active')?.textContent, text:document.body.innerText.slice(-1800), focused:document.activeElement?.outerHTML.slice(0,300)})`));
  writeFileSync(resolve(root, 'navigation-timeout.png'), (await page.webContents.capturePage()).toPNG());
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
const source = "\\documentclass{article}\n\\usepackage{xr}\n\\externaldocument[S-]{supplement}\n\\begin{document}\n" + Array.from({ length: 40 }, (_, index) =>
  `\\section{Section ${index}}\\label{sec:${index}}\nMarker ${index}. ${"Continuous readable prose. ".repeat(12)}${index === 0 ? "See \\ref{sec:39}. External \\ref{S-thm:external}." : ""}\n\n`
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
  await evaluate(`window.latexEditor.files.write(${projectId}, "supplement.tex", ${JSON.stringify("\\documentclass{article}\n\\begin{document}\n\\input{supplement-part}\n\\end{document}")})`);
  await evaluate(`window.latexEditor.files.write(${projectId}, "supplement-part.tex", ${JSON.stringify("\\section{External target}\\label {thm:external}\nExternal reference destination.")})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', "project list");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".structured-preview .preview-content-region")', "Visual preview");
  page.focus();

  // Source edits and a view switch may happen before cursor listeners have
  // persisted their state. An old Visual scroll position must not win.
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor textarea")', "Code for immediate edited-source switch");
  await delay(150);
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await press("END", ["control"]);
  await press("HOME");
  await page.webContents.insertText("\\section{Edited view switch}\nLIVE_SOURCE_SWITCH_TARGET. " + "New prose. ".repeat(25) + "\n");
  await press("UP");
  await press("END");
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Visual").click()');
  await until(`(() => { const root = document.querySelector('.structured-preview'); const target = Array.from(root?.querySelectorAll('.preview-content-region') ?? []).find(el => el.textContent.includes('LIVE_SOURCE_SWITCH_TARGET')); if (!target) return false; const a = root.getBoundingClientRect(), b = target.getBoundingClientRect(); return b.bottom > a.top && b.top < a.bottom && root.scrollTop > 2000; })()`, "edited source caret revealed in Visual");
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor textarea")', "Code for second edited-source switch");
  await delay(150);
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await press("HOME", ["control"]);
  await page.webContents.insertText("% Updated preamble before switching again\n");
  await evaluate('Array.from(document.querySelectorAll(".app-menus > .menu-anchor > button")).find(button => button.textContent === "View").click()');
  await until('!!document.querySelector(".app-menus .menu-popover")', "View menu");
  await evaluate('Array.from(document.querySelectorAll(".app-menus .menu-popover button")).find(button => button.textContent === "Preview").click()');
  await until('document.querySelector(".structured-preview")?.scrollTop < 500', "source beginning overrides remembered Visual end position");
  console.log("PASS immediate Code edits -> Visual switches follow the current cursor through toolbar and View menu in a long file");
  await press("S", ["control"]);
  await until('!document.querySelector(".editor-tabs button.active i")', "save edited source before project-reopen checks");

  // A previous search match is a highlight, not a perpetual scroll instruction.
  await press("F", ["control"]);
  await until('document.activeElement?.matches(".advanced-search-input")', "Ctrl+F opens and focuses search in Visual mode");
  await evaluate(`(() => { const input = document.querySelector('.advanced-search-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Marker 39'); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await until('document.querySelector(".search-result-list button")?.textContent.includes("Marker 39")', "search result");
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor textarea")', "Code editor");
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  page.focus();
  await delay(100);
  await press("F", ["control"]);
  await until('document.activeElement?.matches(".advanced-search-input")', "Ctrl+F refocuses search in Code mode");
  await until('document.activeElement.selectionEnd === document.activeElement.value.length && document.activeElement.selectionStart === 0', "Ctrl+F selects the existing query in Code mode");
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
  await evaluate(`document.querySelector('.activity-bar button[title^="Files"]').click()`);
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

  await evaluate('document.querySelector(".structured-preview").scrollTop = 0');
  await until('Array.from(document.querySelectorAll(".preview-reference")).some(el => el.dataset.reference === "S-thm:external")', "prefixed external reference");
  await evaluate('Array.from(document.querySelectorAll(".preview-reference")).find(el => el.dataset.reference === "S-thm:external").dispatchEvent(new MouseEvent("click", {bubbles:true, ctrlKey:true}))');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("supplement-part.tex") && document.querySelector(".structured-preview")?.textContent.includes("External reference destination")', "cross-file reference target");
  await press("B", ["control"]);
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("main.tex") && document.querySelector(".structured-preview")?.scrollTop < 500', "cross-file reference back");
  await press("R", ["control"]);
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("supplement-part.tex")', "cross-file reference forward");
  await press("B", ["control"]);
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("main.tex")', "repeat cross-file reference back");
  console.log("PASS prefixed external references open included target files and support repeated back/forward");

  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Code").click()');
  await until('document.querySelector(".editor-surface .view-lines")?.textContent.includes("S-thm:external")', "external key visible in Code");
  await until('!!document.querySelector(".editor-surface .monaco-editor.focused")', "Code navigation position restored");
  // Monaco keeps overscan lines in the DOM; textContent alone does not mean
  // the reference is visible or clickable below the sticky heading overlay.
  await press("HOME", ["control"]);
  await delay(100);
  const point = await evaluate(`(() => {
    const line = document.querySelector('.editor-surface .view-lines');
    let offset = line.textContent.indexOf('S-thm:external') + 3;
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (offset >= node.textContent.length) { offset -= node.textContent.length; continue; }
      const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect(); return {x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2)};
    }
    throw new Error('Reference character not found');
  })()`);
  assert.ok(point.x > 0 && point.y > 0, `Reference must be visible before clicking: ${JSON.stringify(point)}`);
  page.webContents.sendInputEvent({ type: "mouseMove", ...point, modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1, modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1, modifiers: ["control"] });
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("supplement-part.tex") && !!document.querySelector(".editor-surface .monaco-editor")', "Code modifier-click across files");
  await press("B", ["control"]);
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("main.tex")', "Code navigation back");
  await press("R", ["control"]);
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("supplement-part.tex")', "Code navigation forward");
  console.log("PASS Code Ctrl-click and back/forward navigate across files without changing editor mode");
  assert.equal(errors.length, 0, errors.join("\n"));
}
require("../../dist/main/index.js");
const timeout = setTimeout(() => { console.error("Preview navigation check timed out"); app.exit(1); }, 60000);
app.whenReady().then(run).then(() => { clearTimeout(timeout); console.log("Artifacts:", root); app.exit(0); }).catch(error => { console.error(error); console.error("Artifacts:", root); app.exit(1); });
