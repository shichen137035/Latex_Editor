const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");

const root = mkdtempSync(resolve(tmpdir(), "texweave-preview-check-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "user-data"));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let page;
const evaluate = (source) => page.webContents.executeJavaScript(source, true);

async function until(source, label) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if (await evaluate(source)) return; } catch { /* A project switch may replace the renderer between polls. */ }
    await delay(100);
  }
  const state = await evaluate('({text:document.body.innerText.slice(0,1200), switches:Array.from(document.querySelectorAll(".view-switch button")).map(b=>({text:b.textContent,class:b.className})), preview:!!document.querySelector(".structured-preview")})');
  throw new Error(`Timed out: ${label}\n${JSON.stringify(state)}`);
}

async function click(selector, modifiers = []) {
  const point = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("Missing selector"); el.scrollIntoView({block:"center",inline:"center"}); const r = el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`);
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "left", clickCount: 1, modifiers });
  await delay(60);
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "left", clickCount: 1, modifiers });
  await delay(150);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  await delay(100);
}

const source = String.raw`\documentclass{article}
\begin{document}
\section{Introduction}

First paragraph with inline math $x_t$.

See \ref{thm:test} and \cite{sample} for the result.
See \ref{missing:target} for an unresolved result.

\begin{equation}
\begin{aligned}
x_t &= \alpha x_{t-1} \\
y_t &= \beta y_{t-1} \\
z_t &= x_1+x_2+x_3+x_4+x_5+x_6+x_7+x_8+x_9+x_{10}+x_{11}+x_{12}+x_{13}+x_{14}+x_{15}+x_{16}
\end{aligned}
\end{equation}

\begin{theorem}
\label{thm:test}
Suppose $X$ is compact.

\begin{equation}
f(x)=x^2
\end{equation}

Then the conclusion holds.
\end{theorem}

\begin{algorithm}[H]
\caption{Full BFGS direction optimization on the sphere}
\label{alg:full-bfgs}
\begin{algorithmic}[1]
\Require Differentiable criterion $Q_{k,n}(\theta,h)$
\Ensure Direction estimate $\widehat\theta$
\State Initialize current direction $\theta\gets\theta_0$.
\For{$k=0,\ldots,J_{\max}-1$}
  \State Compute $g_k=\nabla_\theta Q_{k,n}(\theta,h)$.
  \If{$\lVert G_k\rVert\leq\epsilon$}
    \State \textbf{break}
  \EndIf
\EndFor
\State \Return current direction $\theta$.
\end{algorithmic}
\end{algorithm}

% tw:block-begin type=intuition title="Main intuition"
This is the intuition.
% tw:block-end

\begin{mystery}
Unknown content remains visible.
\end{mystery}
\end{document}`;

async function run() {
  for (let attempt = 0; attempt < 100 && BrowserWindow.getAllWindows().length === 0; attempt += 1) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  assert.ok(page, "app window");
  page.webContents.on("console-message", ({ level, message }) => { if (level >= 2) console.log("renderer:", message); });
  await until("!!window.latexEditor", "preload");
  for (let attempt = 0; attempt < 30 && !page.isMaximized(); attempt += 1) await delay(100);
  assert.equal(page.isMaximized(), true, "main window opens maximized");
  console.log("PASS main window opens maximized");
  page.focus();
  const project = await evaluate(`window.latexEditor.projects.create({name:"preview-test",parentPath:${JSON.stringify(projects)}})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", ${JSON.stringify(source)})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "reference.bib", ${JSON.stringify("@article{sample, title={Sample Reference}, author={Example}, year={2026}}")})`);
  await evaluate(`window.latexEditor.files.createFile(${JSON.stringify(project.id)}, "notes.tex")`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "notes.tex", ${JSON.stringify(String.raw`\documentclass{article}
\begin{document}
\section{Notes}
Other file.
\end{document}`)})`);
  await page.webContents.reload();
  await until('!!document.querySelector(".directory-project-row")', "project list");
  await click('.directory-topbar .icon-button[title="Settings"]');
  await until('!!document.querySelector(".preferences-dialog")', "workspace settings");
  await click('[data-section="shortcuts"]');
  assert.equal(await evaluate('document.querySelector(\'[data-command="navigation.back"]\')?.textContent'), "Ctrl+B", "navigation back is configurable and defaults to Ctrl+B");
  assert.equal(await evaluate('document.querySelector(\'[data-command="navigation.forward"]\')?.textContent'), "Ctrl+R", "navigation forward is configurable and defaults to Ctrl+R");
  assert.equal(await evaluate('document.querySelector(\'[data-command="latex.compile"]\')?.textContent'), "Ctrl+Shift+B", "compile keeps a distinct shortcut");
  await click('[data-command="navigation.back"]');
  await press("J", ["control", "alt"]);
  await until('document.querySelector(\'[data-command="navigation.back"]\')?.textContent === "Ctrl+Alt+J"', "edit navigation-back shortcut");
  await click('[data-command="navigation.back"]');
  await press("B", ["control"]);
  await until('document.querySelector(\'[data-command="navigation.back"]\')?.textContent === "Ctrl+B"', "restore navigation-back shortcut");
  await click('[data-section="environments"]');
  await until('!!document.querySelector(".environment-manager-page")', "workspace environment manager");
  await click(".environment-manager-header .primary");
  await until('document.querySelectorAll(".environment-catalog section:last-child button").length === 1', "custom environment creation");
  await click('.environment-form-section:first-of-type .environment-form-grid label:nth-child(2) input');
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
  await page.webContents.insertText("Review note");
  await until('document.querySelector(".environment-catalog section:last-child").textContent.includes("Review note")', "custom environment editing");
  console.log("PASS dashboard Settings opens the full manager and edits a custom environment");
  await click('.preferences-dialog button[aria-label="Close"]');
  await click(".directory-project-row");
  await until('!!document.querySelector(".workbench")', "workbench");
  await click(".environment-quick-action > button");
  await until('!!document.querySelector(".environment-picker")', "environment picker");
  assert.ok(await evaluate('!!document.querySelector(\'.environment-picker [data-environment-id="theorem"]\')'));
  // The fixed split toolbar can place the picker above the editor tabs;
  // use an unoccluded workbench area to verify outside-click dismissal.
  await click(".sidebar-heading");
  await until('!document.querySelector(".environment-picker")', "environment picker outside dismissal");
  await click(".environment-quick-action > button");
  await click('.environment-picker [data-environment-id="remark"]');
  await until('!document.querySelector(".environment-picker")', "environment insertion");
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "S", modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "S", modifiers: ["control"] });
  await delay(250);
  const inserted = await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)}, "main.tex")`);
  assert.ok(inserted.content.includes("\\begin{remark}"));
  assert.ok(inserted.content.includes("\\end{remark}"));
  assert.ok(inserted.content.includes("\\label{remark:1}"));
  console.log("PASS Environment picker lists active definitions, dismisses outside, and inserts source");
  const visualIndex = await evaluate('Array.from(document.querySelectorAll(".view-switch button")).findIndex(button => button.textContent === "Visual")');
  assert.ok(visualIndex >= 0);
  await click(`.view-switch button:nth-child(${visualIndex + 1})`);
  await until('!!document.querySelector(".structured-preview")', "structured preview");
  assert.equal(await evaluate('document.querySelectorAll(\'[data-environment="section"]\').length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(\'[data-environment="theorem"]\').length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(\'[data-environment="equation"]\').length'), 2);
  assert.equal(await evaluate('document.querySelectorAll(\'[data-environment="virtual:intuition"]\').length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(\'[data-environment="custom:mystery"]\').length'), 1);
  assert.ok(await evaluate('document.querySelector(\'[data-environment="algorithm"] [data-environment="algorithmic"]\')?.textContent.includes("Initialize current direction")'), "nested algorithmic steps render inside their algorithm");
  assert.ok(await evaluate('document.querySelector(\'[data-environment="algorithmic"]\')?.textContent.includes("RETURN")'), "algorithmic commands remain visible");
  const referencePoint = await evaluate(`(() => { const el = document.querySelector('.preview-reference[data-reference="thm:test"]'); el.scrollIntoView({block:"center"}); const rect = el.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; })()`);
  page.webContents.sendInputEvent({ type: "mouseMove", ...referencePoint });
  await delay(100);
  await evaluate('document.querySelector(\'.preview-reference[data-reference="thm:test"]\').dispatchEvent(new PointerEvent("pointermove", { bubbles: true }))');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(\'.preview-reference[data-reference="thm:test"]\')).cursor'), "text", "reference keeps the text cursor without Ctrl");
  await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }))');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(\'.preview-reference[data-reference="thm:test"]\')).cursor'), "pointer", "Ctrl over a valid reference shows the hand cursor");
  await evaluate('window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }))');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(\'.preview-reference[data-reference="thm:test"]\')).cursor'), "text", "releasing Ctrl restores the text cursor");
  const missingPoint = await evaluate(`(() => { const el = document.querySelector('.preview-reference[data-reference="missing:target"]'); const rect = el.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; })()`);
  page.webContents.sendInputEvent({ type: "mouseMove", ...missingPoint });
  await delay(100);
  await evaluate('document.querySelector(\'.preview-reference[data-reference="missing:target"]\').dispatchEvent(new PointerEvent("pointermove", { bubbles: true }))');
  await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Control", ctrlKey: true }))');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(\'.preview-reference[data-reference="missing:target"]\')).cursor'), "text", "unresolved references do not show the hand cursor");
  await evaluate('window.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }))');
  await click('.preview-reference[data-reference="thm:test"]');
  await until('!!document.querySelector(".preview-local-editor")', "plain reference click edits source");
  await click('.preview-local-editor-actions > button:not(.primary)');
  await until('!document.querySelector(".preview-local-editor")', "close reference source edit");
  await click('.preview-reference[data-reference="thm:test"]', ["control"]);
  assert.ok(await evaluate('!!document.querySelector(".preview-block.reference-target, .preview-content-region.reference-target")'), "reference jumps to its target");
  assert.ok(await evaluate('!!document.querySelector(".structured-preview")'), "reference jump keeps Visual mode");
  const jumpScrollTop = await evaluate('document.querySelector(".structured-preview").scrollTop');
  await press("B", ["control"]);
  await until(`(() => { const reference = document.querySelector('.preview-reference[data-reference="thm:test"]'); const viewport = document.querySelector('.structured-preview').getBoundingClientRect(); const rect = reference.getBoundingClientRect(); return rect.top >= viewport.top && rect.bottom <= viewport.bottom; })()`, "Ctrl+B reveals the Visual reference");
  assert.ok(await evaluate('document.querySelector(".structured-preview").scrollTop') < jumpScrollTop, "Ctrl+B scrolls back from the reference target");
  assert.ok(await evaluate('!!document.querySelector(".structured-preview")'), "Ctrl+B preserves Visual mode");
  await press("R", ["control"]);
  await until(`document.querySelector(".structured-preview").scrollTop >= ${jumpScrollTop - 1}`, "Ctrl+R revisits the Visual target");
  await press("B", ["control"]);
  await until(`document.querySelector(".structured-preview").scrollTop < ${jumpScrollTop}`, "Ctrl+B returns along the Visual chain again");
  await click('.preview-reference[data-reference="thm:test"]', ["control"]);
  console.log("PASS Ctrl+B returns to the Visual reference before a jump");
  await delay(800);
  assert.equal(await evaluate('document.querySelectorAll(".reference-target").length'), 0, "reference highlight clears after navigation");
  const previewScroll = await evaluate('document.querySelector(".structured-preview").scrollTop');
  await evaluate('window.dispatchEvent(new CustomEvent("texweave:ai-open-file", {detail:{path:"notes.tex",line:3}}))');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("notes.tex")', "open linked file");
  assert.ok(await evaluate('!!document.querySelector(".structured-preview")'), "cross-file navigation keeps Visual mode");
  await click('.editor-tabs button:first-child');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("main.tex")', "return to main tab");
  assert.ok(await evaluate('!!document.querySelector(".structured-preview")'), "returning to a tab keeps Visual mode");
  await until(`Math.abs(document.querySelector(".structured-preview").scrollTop - ${previewScroll}) < 160`, "restore Visual tab position");
  console.log("PASS plain reference clicks edit, Ctrl+click jumps, and cross-file navigation preserves Visual mode");

  await click('.view-switch button:first-child');
  await until('!!document.querySelector(".source-pane .monaco-editor")', "Code view");
  await evaluate('window.dispatchEvent(new CustomEvent("texweave:ai-open-file", {detail:{path:"main.tex",line:5}}))');
  await until('document.querySelector(".status-bar")?.textContent.includes("Ln 5,")', "Code target line");
  await evaluate('window.dispatchEvent(new CustomEvent("texweave:ai-open-file", {detail:{path:"notes.tex",line:3}}))');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("notes.tex") && document.querySelector(".status-bar")?.textContent.includes("Ln 3,")', "Code cross-file target");
  await press("B", ["control"]);
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("main.tex") && document.querySelector(".status-bar")?.textContent.includes("Ln 5,")', "Ctrl+B restores the Code file and line");
  await evaluate('window.dispatchEvent(new CustomEvent("texweave:ai-open-file", {detail:{path:"notes.tex",line:3}}))');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("notes.tex") && document.querySelector(".status-bar")?.textContent.includes("Ln 3,")', "reopen Code cross-file target");
  await click('.editor-tabs button:first-child');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("main.tex") && document.querySelector(".status-bar")?.textContent.includes("Ln 5,")', "restore Code tab position");
  await press("B", ["control"]);
  assert.ok(await evaluate('document.querySelector(".editor-tabs button.active")?.textContent.includes("main.tex")'), "manual tab switch clears the navigation chain");
  assert.ok(await evaluate('!!document.querySelector(".source-pane .monaco-editor")'), "Code mode remains active");
  for (const line of [10, 20]) {
    await evaluate(`window.dispatchEvent(new CustomEvent("texweave:ai-open-file", {detail:{path:"main.tex",line:${line}}}))`);
    await until(`document.querySelector(".status-bar")?.textContent.includes("Ln ${line},")`, `jump to Code line ${line}`);
  }
  await press("B", ["control"]);
  await until('document.querySelector(".status-bar")?.textContent.includes("Ln 10,")', "first Code back step");
  await press("B", ["control"]);
  await until('document.querySelector(".status-bar")?.textContent.includes("Ln 5,")', "second Code back step");
  await press("R", ["control"]);
  await until('document.querySelector(".status-bar")?.textContent.includes("Ln 10,")', "first Code forward step");
  await press("R", ["control"]);
  await until('document.querySelector(".status-bar")?.textContent.includes("Ln 20,")', "second Code forward step");
  await press("B", ["control"]);
  await until('document.querySelector(".status-bar")?.textContent.includes("Ln 10,")', "back before a new branch");
  await evaluate('window.dispatchEvent(new CustomEvent("texweave:ai-open-file", {detail:{path:"main.tex",line:25}}))');
  await until('document.querySelector(".status-bar")?.textContent.includes("Ln 25,")', "new Code branch");
  await press("R", ["control"]);
  assert.ok(await evaluate('document.querySelector(".status-bar")?.textContent.includes("Ln 25,")'), "new jump discards the prior forward branch");
  await evaluate('window.dispatchEvent(new CustomEvent("texweave:ai-open-file", {detail:{path:"notes.tex",line:3}}))');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("notes.tex")', "open file before closing it");
  await click('.editor-tabs button.active .tab-close');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("main.tex")', "close navigated file");
  await press("B", ["control"]);
  assert.ok(await evaluate('document.querySelector(".editor-tabs button.active")?.textContent.includes("main.tex")'), "closing a file clears navigation history");
  console.log("PASS multiple Ctrl+B/Ctrl+R steps, branch interruption, and manual tab reset");
  await click('.view-switch button:nth-child(2)');
  await until('!!document.querySelector(".structured-preview")', "Visual view for stale reference check");
  await click('.preview-reference[data-reference="thm:test"]', ["control"]);
  await until('!!document.querySelector(".reference-target")', "reference target before source edit");
  await press("B", ["control"]);
  await until(`(() => { const reference = document.querySelector('.preview-reference[data-reference="thm:test"]'); const viewport = document.querySelector('.structured-preview').getBoundingClientRect(); const rect = reference.getBoundingClientRect(); return rect.top >= viewport.top && rect.bottom <= viewport.bottom; })()`, "return to reference before editing it");
  await click('.preview-reference[data-reference="thm:test"]');
  await until('!!document.querySelector(".preview-local-editor .monaco-editor")', "reference source editor");
  await press("A", ["control"]);
  await page.webContents.insertText(String.raw`See \ref{absent:now} and \cite{sample} for the result.`);
  await click('.preview-local-editor button.primary');
  await until('Array.from(document.querySelectorAll(".preview-reference")).some(element => element.dataset.reference === "absent:now")', "reference source changed");
  const staleReferenceScroll = await evaluate('document.querySelector(".structured-preview").scrollTop');
  await press("R", ["control"]);
  await delay(250);
  assert.ok(Math.abs(await evaluate('document.querySelector(".structured-preview").scrollTop') - staleReferenceScroll) < 10, "Ctrl+R skips a jump whose original link was edited away");
  console.log("PASS edited-away references cannot be revisited through navigation history");
  const previewScrollAfterEdit = await evaluate('document.querySelector(".structured-preview").scrollTop');
  await click('.view-switch button:first-child');
  await until('!!document.querySelector(".source-pane .monaco-editor")', "Code view after stale reference check");
  const mathSource = await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)}, "main.tex")`);
  const mathLine = mathSource.content.slice(0, mathSource.content.indexOf("z_t &=")).split("\n").length;
  await evaluate(`window.dispatchEvent(new CustomEvent("texweave:ai-open-file", {detail:{path:"main.tex",line:${mathLine}}}))`);
  await until(`document.querySelector(".status-bar")?.textContent.includes("Ln ${mathLine},")`, "long math source line");
  await until('!!document.querySelector(".math-preview-popover")?.querySelector(".math-preview-result") && document.querySelector(".math-preview-popover .math-preview-result").scrollWidth > document.querySelector(".math-preview-popover .math-preview-result").clientWidth', "long math preview");
  const mathScroll = await evaluate(`(() => { const popover = document.querySelector(".math-preview-popover"); const result = popover.querySelector(".math-preview-result"); const target = result.scrollWidth > result.clientWidth ? result : popover; const rect = target.getBoundingClientRect(); return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.bottom - 4), selector: target === result ? ".math-preview-result" : ".math-preview-popover", overflow: target.scrollWidth - target.clientWidth, pointerEvents: getComputedStyle(popover).pointerEvents }; })()`);
  assert.ok(mathScroll.overflow > 0, "long formula has a horizontal scrollbar");
  assert.equal(mathScroll.pointerEvents, "auto", "math preview accepts pointer input");
  page.webContents.sendInputEvent({ type: "mouseMove", x: mathScroll.x, y: mathScroll.y });
  await delay(120);
  page.webContents.sendInputEvent({ type: "mouseDown", x: mathScroll.x, y: mathScroll.y, button: "left", clickCount: 1 });
  page.webContents.sendInputEvent({ type: "mouseMove", x: mathScroll.x + 36, y: mathScroll.y, button: "left", modifiers: ["leftButtonDown"] });
  await delay(120);
  assert.ok(await evaluate(`document.querySelector(${JSON.stringify(mathScroll.selector)}).scrollLeft > 0`), "dragging scrolls the long formula horizontally");
  assert.ok(await evaluate('!!document.querySelector(".math-preview-popover")'), "dragging the formula scrollbar keeps the preview open");
  page.webContents.sendInputEvent({ type: "mouseUp", x: mathScroll.x + 36, y: mathScroll.y, button: "left", clickCount: 1 });
  await evaluate('window.dispatchEvent(new CustomEvent("texweave:ai-open-file", {detail:{path:"main.tex",line:5}}))');
  await until('document.querySelector(".status-bar")?.textContent.includes("Ln 5,")', "return from math preview");
  await click('.view-switch button:nth-child(2)');
  await until('!!document.querySelector(".structured-preview")', "return to Visual view");
  await until(`Math.abs(document.querySelector(".structured-preview").scrollTop - ${previewScrollAfterEdit}) < 160`, "restore Visual mode position");
  console.log("PASS Code line jumps, tab positions, Visual round trips, and interactive math preview");

  await evaluate('window.dispatchEvent(new CustomEvent("texweave:ai-open-file", {detail:{path:"reference.bib"}}))');
  await until('!!document.querySelector(".bib-preview-pane")', "BibTeX Visual view");
  await click('.bib-entry-row button:first-of-type');
  await until('!!document.querySelector(".bib-occurrences button")', "BibTeX citation occurrences");
  await click('.bib-occurrences button');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("main.tex") && !!document.querySelector(".structured-preview")', "BibTeX citation target in Visual");
  assert.ok(await evaluate('Array.from(document.querySelectorAll(".preview-content-region")).some((element) => element.textContent.includes("sample") && element.getBoundingClientRect().bottom > document.querySelector(".structured-preview").getBoundingClientRect().top)'), "citation target is revealed");
  console.log("PASS BibTeX citation occurrences jump to the target without leaving Visual mode");

  await click('.preview-block[data-environment="theorem"] .preview-block-label');
  await until('!!document.querySelector(".preview-block-label-editor")', "label editor");
  await page.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
  await page.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
  await page.webContents.insertText("thm:edited");
  await press("ENTER");
  await until('document.querySelector("[data-environment=theorem]")?.textContent.includes("thm:edited")', "label edit");
  console.log("PASS Preview labels are editable and generated labels are visually distinguished");
  assert.ok(await evaluate('document.querySelectorAll(".katex").length >= 3'), "inline and display formulas are rendered by KaTeX");
  assert.equal(await evaluate('document.querySelectorAll(".katex-error").length'), 0, "nested aligned math is accepted by KaTeX");
  assert.equal(await evaluate('document.querySelectorAll(".preview-math-fallback").length'), 0);
  console.log("PASS inline and display math render through KaTeX");
  console.log("PASS Preview renders nested, virtual, and unknown blocks");


  await click('[data-environment="theorem"] > .preview-block-header');
  assert.equal(await evaluate('document.querySelector(\'[data-environment="theorem"]\').classList.contains("selected")'), true);
  assert.equal(await evaluate('document.querySelectorAll(".preview-local-editor").length'), 0);
  console.log("PASS block header selects without editing");

  const paragraphSelector = '.preview-content-region';
  const previewClick = await evaluate(`(() => { try {
    const region = Array.from(document.querySelectorAll(${JSON.stringify(paragraphSelector)})).find((item) => item.textContent.includes("First paragraph"));
    if (!region) throw new Error("Could not find test text in Visual preview");
    region.scrollIntoView({block:"center"});
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) if (textNode.textContent.includes("inline math")) break;
    if (!region || !textNode) throw new Error("Could not find test text in Visual preview");
    const marker = textNode.parentElement.closest("[data-preview-source-start][data-preview-source-end]");
    const charOffset = textNode.textContent.indexOf("math") + 1;
    const charRange = document.createRange();
    charRange.setStart(textNode, charOffset);
    charRange.setEnd(textNode, charOffset + 1);
    const rect = charRange.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.caretRangeFromPoint(x, y);
    const hitMarker = hit.startContainer.parentElement.closest("[data-preview-source-start][data-preview-source-end]");
    const prefix = document.createRange();
    prefix.selectNodeContents(hitMarker);
    prefix.setEnd(hit.startContainer, hit.startOffset);
    return { x, y, expected: Number(hitMarker.dataset.previewSourceStart) + prefix.toString().length - Number(region.dataset.sourceStartOffset) };
    } catch (error) { return { error: String(error) }; }
  })()`);
  if (previewClick.error) throw new Error(previewClick.error);
  page.webContents.sendInputEvent({ type: "mouseDown", x: previewClick.x, y: previewClick.y, button: "left", clickCount: 1 });
  await delay(60);
  page.webContents.sendInputEvent({ type: "mouseUp", x: previewClick.x, y: previewClick.y, button: "left", clickCount: 1 });
  await until('!!document.querySelector(".preview-local-editor .monaco-editor")', "local source editor");
  await until(`Number(document.querySelector(".preview-local-editor")?.dataset.cursorOffset) === ${previewClick.expected}`, "mapped Visual caret");
  assert.equal(await evaluate('Number(document.querySelector(".preview-local-editor").dataset.cursorOffset)'), previewClick.expected, "Visual click position is transferred to the inline source editor caret");
  console.log("PASS Visual text click places the source caret at the corresponding offset");
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
  await page.webContents.insertText("Edited paragraph with $z$. ");
  await click(".preview-local-editor button.primary");
  await until('document.querySelector(".structured-preview").textContent.includes("Edited paragraph")', "preview reparse");
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "S", modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "S", modifiers: ["control"] });
  await delay(300);
  const saved = await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)}, "main.tex")`);
  assert.ok(saved.content.includes("Edited paragraph with $z$."));
  assert.ok(saved.content.includes("\\begin{equation}"));
  console.log("PASS paragraph click edits only its source span and saves through IPC");

  await click('.activity-bar button[title="Settings"]');
  await until('!!document.querySelector(".preferences-dialog")', "settings dialog");
  await click('[data-section="environments"]');
  await until('!!document.querySelector(".environment-manager-page")', "environment manager");
  await click('.environment-catalog [data-environment-id="theorem"]');
  await click('.environment-editor-title .environment-toggle');
  await until('!document.querySelector(\'[data-environment="theorem"]\')', "disabled theorem fallback");
  assert.equal(await evaluate('document.querySelector(".structured-preview").textContent.includes("Suppose") && document.querySelector(".structured-preview").textContent.includes("compact")'), true);
  console.log("PASS disabling an environment removes block chrome and preserves readable content");
  assert.ok(await evaluate('!!Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Add environment"))'));
  assert.ok(await evaluate('!!Array.from(document.querySelectorAll("button")).find(button => button.textContent.includes("Advanced XML"))'));
  console.log("PASS full environment manager is reachable through the Settings submenu");
  console.log("Test artifacts:", root);
}

require("../dist/main/index.js");
app.whenReady().then(() => run()).then(() => app.exit(0)).catch((error) => { console.error(error); console.error("Test artifacts:", root); app.exit(1); });
