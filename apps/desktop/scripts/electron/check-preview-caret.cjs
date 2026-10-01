// Focused Electron regression: real clicks and typing, isolated from user data.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");

const root = mkdtempSync(resolve(tmpdir(), "texweave-preview-caret-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "profile"));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let page;
const errors = [];
const evaluate = (script) => page.webContents.executeJavaScript(script, true);
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
  throw new Error(`Timed out: ${label}\n${await evaluate('document.body.innerText.slice(0, 1000)')}`);
}
async function clickAt(point) {
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1 });
  await delay(30);
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1 });
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}

const source = String.raw`\documentclass{article}
\begin{document}
Top-level opening paragraph with ordinary words.

Inline formula $x^2+y$ between ordinary words.

\section{Section}
Nested section paragraph with ordinary words.

\subsection{Subsection}
Nested subsection with \textbf{bold words} and \emph{italic words}.

\begin{theorem}
Deep theorem paragraph with ordinary words.
\end{theorem}

\begin{quote}
Content environment with ordinary words.
\end{quote}

\begin{itemize}
\item List item with ordinary words.
\item Nested equation follows:
\begin{equation}
x + y = z
\end{equation}
\end{itemize}

\end{document}`;

async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', "dashboard");
  const project = await evaluate(`window.latexEditor.projects.create({name:"caret-regression",parentPath:${JSON.stringify(projects)}})`);
  await evaluate(`window.latexEditor.settings.set("autoSave", "off",${JSON.stringify(project.id)})`);
  await evaluate(`window.latexEditor.settings.set("layout", {mode:"single",singlePane:"preview",leftPane:"preview",rightPane:"pdf"},${JSON.stringify(project.id)})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", ${JSON.stringify(source)})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', "project list");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".structured-preview .preview-content-region")', "Visual preview");
  page.focus();

  const cases = [
    ["top-level paragraph", "Top-level", "ordinary"],
    ["paragraph inside section", "Nested section", "ordinary"],
    ["bold text inside subsection", "Nested subsection", "bold words"],
    ["italic text inside subsection", "Nested subsection", "italic words"],
    ["deeply nested theorem", "Deep theorem", "ordinary"],
    ["quote environment", "Content environment", "ordinary"],
    ["list item", "List item", "ordinary", ".preview-list li"],
    ["display math source anchor", "x + y", "x + y = z", ".preview-block[data-environment='equation']", true],
    ["inline math source anchor", "Inline formula", "x^2+y", ".preview-content-region", true]
  ];
  let expectedSource = source;
  for (const [caseIndex, [label, regionText, word, selector = ".preview-content-region", math = false]] of cases.entries()) {
    const point = await evaluate(`(() => {
      const regions = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
      const region = ${math ? `regions.find(el => el.querySelector(".katex") && (${JSON.stringify(selector)}.includes("equation") || el.textContent.includes(${JSON.stringify(regionText)})))` : `regions.find(el => el.textContent.includes(${JSON.stringify(regionText)}))`};
      if (!region) throw new Error("Missing region: " + ${JSON.stringify(label)});
      region.scrollIntoView({block:"center"});
      const raw = ${JSON.stringify(expectedSource)};
      const owner = region.closest(".preview-block") && !region.matches(".preview-content-region") ? region.closest(".preview-block") : region;
      if (${math}) {
        const rect = region.querySelector(".katex-html .mord").getBoundingClientRect();
        const absolute = raw.indexOf(${JSON.stringify(word)}, Number(owner.dataset.sourceStartOffset));
        return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2),absolute,local:absolute-Number(owner.dataset.sourceStartOffset)};
      }
      const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) if (node.textContent.includes(${JSON.stringify(word)})) break;
      if (!node) throw new Error("Missing clicked word");
      const offset = node.textContent.indexOf(${JSON.stringify(word)}) + 2;
      const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width * .2), y = Math.round(rect.top + rect.height / 2);
      const caret = document.caretRangeFromPoint(x, y);
      const hitOffset = caret.startOffset;
      const textStart = raw.indexOf(caret.startContainer.textContent, Number(region.dataset.sourceStartOffset));
      if (textStart < 0) throw new Error("Rendered text is not a contiguous source fragment");
      return {x, y, absolute: textStart + hitOffset, local: textStart + hitOffset - Number(owner.dataset.sourceStartOffset)};
    })()`);
    await clickAt({ x: point.x, y: point.y });
    await until('!!document.querySelector(".preview-local-editor .monaco-editor")', label);
    // Do not accept the initial (0) value: wait for the requested caret and focus.
    await until(`Number(document.querySelector(".preview-local-editor")?.dataset.cursorOffset) === ${point.local} && !!document.querySelector(".preview-local-editor .monaco-editor.focused")`, `${label} caret ${point.local}`);
    const marker = `CARET${caseIndex}`;
    await page.webContents.insertText(marker);
    await press("ENTER", ["control"]);
    await until('!document.querySelector(".preview-local-editor")', `${label} apply`);
    await press("S", ["control"]);
    expectedSource = expectedSource.slice(0, point.absolute) + marker + expectedSource.slice(point.absolute);
    await until('!!document.querySelector(".save-status.saved")', `${label} saved`);
    const saved = await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)}, "main.tex")`);
    assert.equal(saved.content, expectedSource, `${label}: actual typed text is at the clicked source position`);
    console.log(`PASS ${label}: caret ${point.local}, actual typing saved at source offset ${point.absolute}`);
  }
  // Memoized, unchanged siblings must still receive current selection/actions.
  for (const environment of ["section", "subsection"]) {
    await evaluate(`document.querySelector(".preview-block[data-environment='${environment}'] > .preview-block-header .preview-block-header-main").click()`);
    await until(`document.querySelectorAll(".preview-block.selected").length === 1 && !!document.querySelector(".preview-block.selected[data-environment='${environment}']")`, `select ${environment}`);
  }
  await evaluate('document.querySelector(".preview-block.selected > .preview-block-footer .preview-block-footer-actions button").click()');
  await until('!!document.querySelector(".preview-local-editor")', "memoized block boundary action");
  await evaluate('Array.from(document.querySelectorAll(".preview-local-editor-actions button")).find(button=>button.textContent==="Cancel").click()');
  await until('!document.querySelector(".preview-local-editor")', "cancel boundary editor");
  console.log("PASS current selection, footer boundary action and cancellation after memoized updates");
  console.log("Artifacts:", root);
}
require("../../dist/main/index.js");
const timeout = setTimeout(() => { console.error("Caret check timed out"); app.exit(1); }, 60000);
app.whenReady().then(run).then(() => { clearTimeout(timeout); app.exit(0); }).catch(error => { console.error(error); console.error("Artifacts:", root); app.exit(1); });
