// Real Electron window-close flow, isolated from user profiles and projects.
// Native dialog responses are scripted; editor input and disk writes are real.
const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { mkdtempSync, mkdirSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const mode = process.argv[2] || "save";
const root = mkdtempSync(resolve(tmpdir(), "texweave-exit-"));
mkdirSync(resolve(root, "projects"));
app.setPath("userData", resolve(root, "profile"));
const source = "\\documentclass{article}\n\\begin{document}\nOriginal paragraph.\n\\end{document}";
const delay = ms => new Promise(done => setTimeout(done, ms));
let page, project, response = 2, warnings = 0, errors = 0;
dialog.showMessageBox = async (_window, options) => {
  if (options.type === "error") { errors++; console.log("Save error:", options.message); return { response: 0 }; }
  assert.equal(options.buttons.length, 3);
  assert.equal(options.cancelId, 2);
  warnings++;
  return { response };
};
const evaluate = async script => {
  try { return await page.webContents.executeJavaScript(script, true); }
  catch (error) { console.error("Failed UI operation:", script); throw error; }
};
async function until(predicate, label) {
  for (let i = 0; i < 180; i++) { if (await predicate()) return; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
const ui = (script, label) => until(() => evaluate(script), label);
async function draft(marker) {
  await evaluate('document.querySelector(".preview-content-region").click()');
  await ui('!!document.querySelector(".preview-local-editor .monaco-editor.focused")', "local editor focus");
  await page.webContents.insertText(marker);
  await ui(`document.querySelector(".preview-local-editor")?.textContent.includes(${JSON.stringify(marker)})`, "draft input");
}
async function run() {
  await until(() => BrowserWindow.getAllWindows().length, "window");
  page = BrowserWindow.getAllWindows()[0];
  page.webContents.on("console-message", ({ level, message }) => {
    if (level === "error" || level === 3) console.error("Renderer:", message);
  });
  await ui('!!document.querySelector(".project-directory-v044")', "dashboard");
  project = await evaluate(`window.latexEditor.projects.create({name:"exit-test",parentPath:${JSON.stringify(resolve(root, "projects"))}})`);
  await evaluate(`window.latexEditor.settings.set("autoSave","off",${JSON.stringify(project.id)})`);
  await evaluate(`window.latexEditor.settings.set("layout",{mode:"single",singlePane:"preview",leftPane:"preview",rightPane:"pdf"},${JSON.stringify(project.id)})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)},"main.tex",${JSON.stringify(source)})`);
  await evaluate(`window.latexEditor.files.createFile(${JSON.stringify(project.id)},"notes.tex")`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)},"notes.tex",${JSON.stringify(source)})`);
  page.reload();
  await ui('!!document.querySelector(".directory-project-row")', "project list");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await ui('!!document.querySelector(".preview-content-region")', "Preview");
  page.focus();
  if (mode !== "clean") {
    // A dirty inactive tab plus an unapplied draft in the active file.
    await ui("!!document.querySelector('.tree-row[data-path=\"notes.tex\"]')", "notes tree row");
    await evaluate("document.querySelector('.tree-row[data-path=\"notes.tex\"]').click()");
    await ui("!!document.querySelector('.tree-row.active[data-path=\"notes.tex\"]')", "notes tab");
    await ui('!!document.querySelector(".preview-content-region")', "notes Preview");
    await draft("NOTESCHANGE");
    page.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER", modifiers: ["control"] });
    page.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER", modifiers: ["control"] });
    await ui('!document.querySelector(".preview-local-editor")', "apply notes draft");
    await evaluate("document.querySelector('.tree-row[data-path=\"main.tex\"]').click()");
    await ui("!!document.querySelector('.tree-row.active[data-path=\"main.tex\"]')", "main tab");
    await ui('!!document.querySelector(".preview-content-region")', "main Preview");
    await draft("MAINCHANGE");
    page.close();
    await until(() => warnings === 1, "cancel prompt");
    await delay(150);
    assert.ok(!page.isDestroyed(), "Cancel must keep the window open");
    assert.equal(readFileSync(resolve(project.canonicalPath, "main.tex"), "utf8"), source);
    await ui('!!document.querySelector(".preview-local-editor")', "Cancel preserves draft");
    console.log("PASS Cancel preserves files and Preview draft");
  }
  if (mode === "failure") {
    ipcMain.removeHandler("files:write");
    ipcMain.handle("files:write", () => { throw new Error("Simulated disk write failure"); });
    response = 0;
    // Also exercise app.quit rather than only the window close button.
    app.quit();
    await until(() => errors === 1, "save failure dialog");
    await delay(150);
    assert.ok(!page.isDestroyed(), "Failed save must keep the window open");
    assert.equal(readFileSync(resolve(project.canonicalPath, "main.tex"), "utf8"), source);
    console.log("PASS Save failure cancels app quit");
  }
  response = mode === "save" ? 0 : 1;
  page.once("closed", () => {
    try {
      const main = readFileSync(resolve(project.canonicalPath, "main.tex"), "utf8");
      const notes = readFileSync(resolve(project.canonicalPath, "notes.tex"), "utf8");
      if (mode === "save") {
        assert.ok(main.includes("MAINCHANGE"), "Save must include unapplied Preview draft");
        assert.ok(notes.includes("NOTESCHANGE"), "Save must include dirty inactive tabs");
      } else { assert.equal(main, source); assert.equal(notes, source); }
      if (mode === "clean") assert.equal(warnings, 0, "Clean close must not prompt");
      console.log(`PASS ${mode}: window closed, expected disk content verified`);
      clearTimeout(timeout);
      app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
  });
  page.close();
}
require("../dist/main/index.js");
const timeout = setTimeout(() => { console.error("Exit test timed out", root); page?.removeAllListeners("closed"); app.exit(1); }, 45000);
app.whenReady().then(run).catch(error => { console.error(error, root); app.exit(1); });
