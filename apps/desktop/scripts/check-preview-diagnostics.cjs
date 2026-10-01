// Diagnostic only: uses an isolated profile/project; does not modify app code.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-preview-diagnostic-"));
mkdirSync(resolve(root, "projects"));
app.setPath("userData", resolve(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
let page;
const evaluate = script => page.webContents.executeJavaScript(script, true);
async function until(script, label) {
  for (let i = 0; i < 240; i++) { if (await evaluate(script)) return; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
async function click(point) {
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
}
const probes = String.raw`Before \textrm{middle} after ordinary words.

Alpha % hidden comment
Beta ordinary words.

Prefix \textbf{bf} suffix.

\begin{verbatim}
Code ordinary words.
\end{verbatim}

`;
const source = String.raw`\documentclass{article}
\begin{document}
${probes}${Array.from({ length: 800 }, (_, i) => String.raw`\section{Section ${i}}
Paragraph ${i} with ordinary words and $x_${i}+y_${i}$.

\begin{equation}
\label{equation:${i + 1}}
x_${i}=y_${i}
\end{equation}

`).join("")}\end{document}`;

async function probe(label, text, word, selector = ".preview-content-region") {
  const point = await evaluate(`(() => {
    const region = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.textContent.includes(${JSON.stringify(text)}));
    region.scrollIntoView({block:"center"});
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) if (node.textContent.includes(${JSON.stringify(word)})) break;
    const range = document.createRange(), offset = node.textContent.indexOf(${JSON.stringify(word)}) + 1;
    range.setStart(node, offset); range.setEnd(node, offset + 1);
    const rect = range.getBoundingClientRect(), x = Math.round(rect.left + rect.width * .2), y = Math.round(rect.top + rect.height / 2);
    const hit = document.caretRangeFromPoint(x, y);
    const delta = hit.startOffset - hit.startContainer.textContent.indexOf(${JSON.stringify(word)});
    const span = region.closest("[data-source-start-offset]");
    const raw = ${JSON.stringify(source)};
    const sourceWord = ${JSON.stringify(word)} === "bf" ? raw.indexOf("{bf}", Number(span.dataset.sourceStartOffset)) + 1 : raw.indexOf(${JSON.stringify(word)}, Number(span.dataset.sourceStartOffset));
    const expected = sourceWord + delta - Number(span.dataset.sourceStartOffset);
    window.__previewDiagnostic = {start:0,longTasks:[]};
    const observer = new PerformanceObserver(list => window.__previewDiagnostic.longTasks.push(...list.getEntries().map(e => ({start:e.startTime,ms:e.duration}))));
    observer.observe({type:"longtask",buffered:false}); window.__previewDiagnostic.observer=observer;
    document.querySelector(".structured-preview").addEventListener("click", () => {window.__previewDiagnostic.start=performance.now()}, {capture:true,once:true});
    const focused = event => { if (!event.target.closest(".preview-local-editor")) return; window.__previewDiagnostic.focusMs=performance.now()-window.__previewDiagnostic.start; document.removeEventListener("focusin",focused,true); };
    document.addEventListener("focusin",focused,true);
    return {x,y,expected};
  })()`);
  await click({ x: point.x, y: point.y });
  await until('!!document.querySelector(".preview-local-editor .monaco-editor.focused")', label);
  const result = await evaluate(`new Promise(done => requestAnimationFrame(() => requestAnimationFrame(() => {
    const measure = window.__previewDiagnostic;
    measure.observer.disconnect();
    done({label:${JSON.stringify(label)},expected:${point.expected},actual:Number(document.querySelector(".preview-local-editor").dataset.cursorOffset),clickToFocusEventMs:Math.round(measure.focusMs),observationCompleteMs:Math.round(performance.now()-measure.start),longTasks:measure.longTasks.filter(e=>e.start>=measure.start).map(e=>e.ms),previewDom:document.querySelector(".structured-preview").querySelectorAll("*").length,visibleNodes:document.querySelectorAll(".preview-block,.preview-content-region").length});
  })))`);
  console.log(JSON.stringify(result));
  assert.equal(result.actual, result.expected, `${label}: exact block-local caret`);
  await evaluate('Array.from(document.querySelectorAll(".preview-local-editor-actions button")).find(b=>b.textContent==="Cancel").click()');
  await until('!document.querySelector(".preview-local-editor")', "cancel");
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', "directory");
  const project = await evaluate(`window.latexEditor.projects.create({name:"preview-diagnostic",parentPath:${JSON.stringify(resolve(root, "projects"))}})`);
  await evaluate(`window.latexEditor.settings.set("layout",{mode:"single",singlePane:"preview",leftPane:"preview",rightPane:"pdf"},${JSON.stringify(project.id)})`);
  await evaluate('window.latexEditor.settings.set("spellCheckMode","disabled")');
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)},"main.tex",${JSON.stringify(source)})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', "project");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".preview-limit-notice")', "preview");
  page.focus();
  await delay(700); // let initial reconciliation finish before interaction measurement
  await probe("textrm transformation", "Before middle", "after");
  await probe("removed comment", "Alpha", "Beta");
  await probe("argument occurs in command name", "Prefix", "bf");
  await probe("unmapped verbatim", "Code ordinary", "ordinary", ".preview-code");
  await probe("900 nodes warm click", "Paragraph 2 with", "ordinary");
  await evaluate('document.querySelector(".preview-limit-notice button").click()');
  await until('document.querySelectorAll(".preview-block,.preview-content-region").length>1000', "expanded preview");
  await delay(300);
  await probe("1800 nodes warm click", "Paragraph 2 with", "ordinary");
  console.log("Artifacts:", root);
}
require("../dist/main/index.js");
const timeout = setTimeout(() => { console.error("Diagnostic timed out"); app.exit(1); }, 55000);
app.whenReady().then(run).then(() => {clearTimeout(timeout);app.exit(0)}).catch(error=>{console.error(error);console.error("Artifacts:",root);app.exit(1)});
