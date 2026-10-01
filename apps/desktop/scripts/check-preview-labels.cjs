// Actual keyboard regression in an isolated profile; never touches user projects.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const { clearTimeout } = require("node:timers");
const root = mkdtempSync(resolve(tmpdir(), "texweave-preview-labels-"));
mkdirSync(resolve(root, "projects"));
app.setPath("userData", resolve(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
let page;
const evaluate = script => page.webContents.executeJavaScript(script, true);
async function until(script, label) {
  for (let i = 0; i < 160; i++) { if (await evaluate(script)) return; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}
const source = String.raw`\documentclass{article}
\begin{document}
\section{Label tests}
\begin{theorem}
Ordinary multiline environment.
\end{theorem}

\begin{equation}x=y\end{equation}

\[x+y=z\]

\begin{equation*}
\label{old:star}
a=b
\end{equation*}
\end{document}`;
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', "dashboard");
  const project = await evaluate(`window.latexEditor.projects.create({name:"label-regression",parentPath:${JSON.stringify(resolve(root, "projects"))}})`);
  await evaluate(`window.latexEditor.settings.set("autoSave","off",${JSON.stringify(project.id)})`);
  await evaluate(`window.latexEditor.settings.set("layout",{mode:"single",singlePane:"preview",leftPane:"preview",rightPane:"pdf"},${JSON.stringify(project.id)})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)},"main.tex",${JSON.stringify(source)})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', "project");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".preview-block")', "Preview");
  page.focus();
  let current = source;
  const failures = [];
  const cases = [
    ["heading", "\\section{", "sec:edited", "enter"],
    ["multiline environment", "\\begin{theorem}", "thm:edited", "enter"],
    ["one-line environment", "\\begin{equation}", "eq:edited", "enter"],
    ["bracketed display math", "\\[", "eq:display", "enter"],
    ["overwrite existing label", "\\begin{equation*}", "eq:star", "enter"],
    ["blur commit", "\\begin{theorem}", "thm:blur", "blur"],
    ["Escape cancellation", "\\begin{theorem}", "thm:cancelled", "escape"],
    ["Ctrl+S commits and saves", "\\begin{theorem}", "thm:saved", "save"],
    ["IME Enter does not commit prematurely", "\\begin{theorem}", "thm:composed", "composition"],
    ["Ctrl+Enter commit", "\\begin{theorem}", "thm:control-enter", "control-enter"]
  ];
  for (const [name, anchor, label, action] of cases) {
    const start = current.indexOf(anchor);
    const selector = `.preview-block[data-source-start-offset="${start}"]`;
    await evaluate(`(() => { const block=document.querySelector(${JSON.stringify(selector)}); block.scrollIntoView({block:"center"}); block.querySelector(":scope > .preview-block-header .preview-block-header-main").click(); block.querySelector(":scope > .preview-block-header .preview-block-label").click(); })()`);
    await until('!!document.querySelector(".preview-block-label-editor:focus")', `${name} input`);
    // Select the input's value explicitly so native focus/IME timing cannot
    // accidentally append to the previous label during rapid test iterations.
    await evaluate('document.querySelector(".preview-block-label-editor").select()');
    await page.webContents.insertText(label);
    await until(`document.querySelector(".preview-block-label-editor")?.value === ${JSON.stringify(label)}`, `${name} draft`);
    if (action === "composition") {
      await evaluate('document.querySelector(".preview-block-label-editor").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,isComposing:true}))');
      assert.equal(await evaluate('!!document.querySelector(".preview-block-label-editor")'), true, "IME Enter should keep editing");
    }
    if (action === "blur") await evaluate('document.querySelector(".preview-block-label-editor").blur()');
    else if (action === "save") await press("S", ["control"]);
    else if (action === "control-enter") await press("ENTER", ["control"]);
    else await press(action === "escape" ? "ESCAPE" : "ENTER");
    await until('!document.querySelector(".preview-block-label-editor")', `${name} close`);
    if (action !== "save") await press("S", ["control"]);
    await until('!!document.querySelector(".save-status.saved")', `${name} file save`);
    const saved = await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)},"main.tex")`);
    const shouldExist = action !== "escape";
    const written = saved.content.includes(`\\label{${label}}`) === shouldExist;
    const displayed = await evaluate(`document.querySelector(${JSON.stringify(selector)})?.querySelector(":scope > .preview-block-header .preview-block-label")?.textContent.trim() === ${JSON.stringify(shouldExist ? label : "thm:blur")}`);
    console.log(JSON.stringify({name,written,displayed}));
    if (name === "heading") assert.ok(saved.content.includes(String.raw`\label{old:star}`), "Editing a heading label must preserve descendant labels");
    if (!written || !displayed) failures.push(name);
    if (action === "escape") assert.equal(saved.content, current, "Escape must not change source");
    current = saved.content;
  }
  console.log("Artifacts:", root);
  assert.deepEqual(failures, [], "Label commits must survive parse/render and file saving");
}
require("../dist/main/index.js");
const timeout = setTimeout(() => { console.error("Label check timed out"); app.exit(1); }, 60000);
app.whenReady().then(run).then(() => {clearTimeout(timeout);app.exit(0)}).catch(error=>{console.error(error);console.error("Artifacts:",root);app.exit(1)});
