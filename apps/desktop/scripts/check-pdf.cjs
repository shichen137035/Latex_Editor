const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-pdf-check-"));
mkdirSync(resolve(root, "projects"));
app.setPath("userData", resolve(root, "user-data"));
const delay = ms => new Promise(done => setTimeout(done, ms));
let window;
const evaluate = code => window.webContents.executeJavaScript(code, true);
async function until(code) {
  for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await delay(100); }
  throw new Error("Timeout: " + code + "\n" + await evaluate("document.body.innerText.slice(-2000)"));
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(100);
  window = BrowserWindow.getAllWindows()[0];
  window.webContents.on("console-message", (...args) => console.log("RENDERER", ...args.map(value => typeof value === "object" ? JSON.stringify(value) : value)));
  window.webContents.on("render-process-gone", (_, details) => console.log("PROCESS GONE", details));
  await until("!!window.latexEditor && !!document.querySelector('.project-directory-v044')");
  const project = await evaluate('window.latexEditor.projects.create({name:"PDF regression",parentPath:' + JSON.stringify(resolve(root,"projects")) + '})');
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", ${JSON.stringify(String.raw`\documentclass{article}
\begin{document}
\section{PDF rendering regression}
Visible text at normal scale.
\begin{equation}x=1\end{equation}
\end{document}`)})`);
  const compile = await evaluate(`window.latexEditor.compile.run(${JSON.stringify(project.id)}, "main.tex")`);
  assert.equal(compile.status, "succeeded", compile.stderrTail);
  window.webContents.reload();
  await until("!!document.querySelector('.directory-project-row')");
  await evaluate("window.addEventListener('error', e=>console.error('CAPTURE',e.message,e.error?.stack));window.addEventListener('unhandledrejection',e=>console.error('REJECTION',String(e.reason),e.reason?.stack));");
  await evaluate("document.querySelector('.directory-project-row').click()");
  await until("!!document.querySelector('.pdf-page canvas') && !!document.querySelector('.pdf-page .textLayer span')");
  const textLayer = await evaluate(`(() => { const span=document.querySelector('.textLayer span'); const range=document.createRange(); range.selectNodeContents(span); const selection=getSelection(); selection.removeAllRanges(); selection.addRange(range); return {text:selection.toString(),cursor:getComputedStyle(span).cursor}; })()`);
  assert.ok(textLayer.text.length > 0, "PDF text can be selected");
  assert.equal(textLayer.cursor, "text", "PDF text uses a text cursor");
  const editorPoint = await evaluate(`(() => { const editor=document.querySelector('.editor-surface .monaco-editor'); const bounds=editor.getBoundingClientRect(); return {x:Math.round(bounds.left+180),y:Math.round(bounds.top+72)}; })()`);
  window.webContents.sendInputEvent({ type:"mouseDown", ...editorPoint, button:"left", clickCount:1 });
  window.webContents.sendInputEvent({ type:"mouseUp", ...editorPoint, button:"left", clickCount:1 });
  window.webContents.sendInputEvent({ type:"mouseDown", ...editorPoint, button:"left", clickCount:2 });
  window.webContents.sendInputEvent({ type:"mouseUp", ...editorPoint, button:"left", clickCount:2 });
  await until("!!document.querySelector('.pdf-sync-marker')");
  const pdfPoint = await evaluate(`(() => { const page=document.querySelector('.pdf-page'); const bounds=page.getBoundingClientRect(); return {x:Math.round(bounds.left+220),y:Math.round(bounds.top+180)}; })()`);
  window.webContents.sendInputEvent({ type:"mouseDown", ...pdfPoint, button:"left", clickCount:1 });
  window.webContents.sendInputEvent({ type:"mouseUp", ...pdfPoint, button:"left", clickCount:1 });
  await until("!document.querySelector('.pdf-sync-marker')");
  await evaluate(`window.alert=()=>{}; const page=document.querySelector('.pdf-page'); const bounds=page.getBoundingClientRect(); page.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:bounds.left+120,clientY:bounds.top+90}));`);
  await until("!!document.querySelector('.pdf-click-marker')");
  await delay(1100);
  assert.equal(await evaluate("!!document.querySelector('.pdf-click-marker')"), false, "double-click marker is transient");
  await evaluate(`Array.from(document.querySelectorAll('.view-switch button')).find(button => button.textContent === 'Visual').click()`);
  await until("!!document.querySelector('.preview-block[data-environment=\"section\"]')");
  const blockPoint = await evaluate(`(() => { const block=document.querySelector('.preview-block[data-environment="section"]'); const bounds=block.getBoundingClientRect(); return {x:Math.round(bounds.left+8),y:Math.round(bounds.top+8)}; })()`);
  window.webContents.sendInputEvent({ type:"mouseDown", ...blockPoint, button:"left", clickCount:1 });
  window.webContents.sendInputEvent({ type:"mouseUp", ...blockPoint, button:"left", clickCount:1 });
  window.webContents.sendInputEvent({ type:"mouseDown", ...blockPoint, button:"left", clickCount:2 });
  window.webContents.sendInputEvent({ type:"mouseUp", ...blockPoint, button:"left", clickCount:2 });
  await until("!!document.querySelector('.pdf-sync-marker')");
  console.log("PASS source and Visual block forward SyncTeX markers clear on PDF interaction");
  const metrics = () => evaluate("(() => { const p=document.querySelector('.pdf-page'); const v=document.querySelector('.pdf-viewer');const c=p.querySelector('canvas'); return {width:p.getBoundingClientRect().width,available:v.clientWidth-32,canvas:c.width,height:c.height}; })()");
  console.log("FIT", await metrics());
  assert.ok(Math.abs((await metrics()).width-(await metrics()).available)<2);
  await evaluate("const s=document.querySelector('.pdf-zoom-toolbar select'); s.value='1.5'; s.dispatchEvent(new Event('change',{bubbles:true}));");
  await delay(800);
  console.log("ZOOM", await metrics());
  assert.ok((await metrics()).width > 1100);
  await evaluate("document.querySelector('.pdf-zoom-toolbar select').value='width';document.querySelector('.pdf-zoom-toolbar select').dispatchEvent(new Event('change',{bubbles:true}));");
  await delay(500);
  window.setSize(1100,800);
  await delay(600);
  assert.ok(Math.abs((await metrics()).width-(await metrics()).available)<2);
  writeFileSync(resolve(root,"pdf.png"), (await window.webContents.capturePage()).toPNG());
  console.log("PASS PDF rendered, fit width, 150% and resize", root);
}
require("../dist/main/index.js");
app.whenReady().then(run).then(()=>app.exit(0)).catch(error=>{console.error(error);app.exit(1);});
