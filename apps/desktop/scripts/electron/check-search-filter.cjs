// Exercise real search workers and Visual/Code navigation in a disposable project.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-search-filter-"));
const projects = resolve(root, "projects"); mkdirSync(projects);
app.setPath("userData", resolve(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
let page;
const errors = [];
const evaluate = script => page.webContents.executeJavaScript(script, true);
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
async function until(script, label) {
  for (let attempt = 0; attempt < 150; attempt++) {
    assert.deepEqual(errors, []);
    if (await evaluate(script)) return;
    await delay(50);
  }
  console.error(await evaluate('document.querySelector(".advanced-search-panel")?.textContent'));
  throw new Error(`Timed out: ${label}`);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}
const setInput = (selector, value) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
const query = value => setInput('.advanced-search-input', value);
const choose = (selector, value) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
const group = name => `Array.from(document.querySelectorAll('.filter-group')).find(group => group.querySelector('strong').textContent === ${JSON.stringify(name)})`;
const clickChoice = (name, label) => evaluate(`(() => { const group = ${group(name)}; if (!group) throw new Error('Missing group: ' + ${JSON.stringify(name)}); group.open = true; const choices = Array.from(group.querySelectorAll('.filter-choice')); const choice = choices.find(choice => choice.textContent.trim() === ${JSON.stringify(label)}); if (!choice) throw new Error('Missing choice ' + ${JSON.stringify(label)} + ': ' + choices.map(item => item.textContent.trim()).join(' | ')); choice.querySelector('input').click(); })()`);
const count = amount => until(`document.querySelectorAll('.search-result-list > button strong').length === ${amount} && !Array.from(document.querySelectorAll('[role="status"]')).some(el => el.textContent.includes('Searching'))`, `${amount} results`);
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', "directory");
  const project = await evaluate(`window.latexEditor.projects.create({name:"search-regression",parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  await evaluate(`window.latexEditor.settings.set("autoSave", "off", ${id})`);
  await evaluate(`window.latexEditor.settings.set("confirmPreviewEdits", false, ${id})`);
  await evaluate(`window.latexEditor.settings.set("layout", {mode:"single",singlePane:"preview",leftPane:"preview",rightPane:"pdf"}, ${id})`);
  const source = "\\documentclass{article}\n\\begin{document}\n\\section{One}\\label{sec:one}\nneedle first.\n\\begin{equation}needle=1\\end{equation}\nneedle tail.\n\\section*{Two}\nneedle second.\n\\end{document}";
  await evaluate(`window.latexEditor.files.write(${id}, "main.tex", ${JSON.stringify(source)})`);
  await evaluate(`window.latexEditor.files.write(${id}, "references.bib", "@book{needle,title={Bibliography needle}}")`);
  await evaluate(`window.latexEditor.files.createFile(${id}, "notes.txt")`);
  await evaluate(`window.latexEditor.files.write(${id}, "notes.txt", "original note")`);
  await evaluate(`window.latexEditor.files.createFile(${id}, "slow.tex")`);
  await evaluate(`window.latexEditor.files.write(${id}, "slow.tex", ${JSON.stringify("a".repeat(5000) + "!")})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', "project list");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".structured-preview")', "Visual preview");
  page.focus(); await press('F', ['control']);
  await until('!!document.querySelector(".advanced-search-input")', "search panel");
  await query('needle'); await count(4);
  await press('ENTER');
  await until('document.querySelector(".search-result-list > button.active small")?.textContent === "4:1"', "first Enter selects first occurrence");
  assert.ok(await evaluate('!!document.querySelector(".structured-preview")'));
  console.log('PASS real worker search and first-result navigation in Visual mode');

  assert.ok(await evaluate('!document.querySelector(".filter-switch input").checked'));
  await evaluate('document.querySelector(".sidebar-heading .search-section-collapse").click()');
  assert.ok(await evaluate('document.querySelector(".advanced-search-main").dataset.sectionCollapsed === "true" && document.querySelector(".advanced-search-input").offsetHeight === 0'));
  await press('F', ['control']);
  await until('document.querySelector(".advanced-search-input").offsetHeight > 0', 'search shortcut expands collapsed search');
  assert.equal(await evaluate('document.querySelector(".advanced-search-input").value'), 'needle');
  await evaluate('document.querySelector(".filter-panel .search-section-collapse").click()');
  assert.ok(await evaluate('document.querySelector(".filter-groups").offsetHeight === 0 && !document.querySelector(".filter-switch input").checked'));
  const filterAtBottom = `(() => { const panel = document.querySelector('.advanced-search-panel').getBoundingClientRect(); const header = document.querySelector('.filter-panel > header').getBoundingClientRect(); return header.height >= 38 && Math.abs(header.bottom - panel.bottom) < 2; })()`;
  assert.ok(await evaluate(filterAtBottom), 'collapsed filter header stays visible at the bottom');
  await evaluate('document.querySelector(".sidebar-heading .search-section-collapse").click()');
  assert.ok(await evaluate(filterAtBottom), 'filter can be expanded even when both sections are collapsed');
  await evaluate('document.querySelector(".sidebar-heading .search-section-collapse").click()');
  await evaluate('document.querySelector(".filter-panel .search-section-collapse").click()');
  assert.ok(await evaluate('document.querySelector(".filter-groups").offsetHeight > 0'), 'filter expands again');
  console.log('PASS disabled filter default and independent search/filter collapse without losing state');

  const narrowLayout = await evaluate(`(async () => {
    const sidebar = document.querySelector('.sidebar'), width = sidebar.style.width;
    const title = document.querySelector('.filter-panel > header > strong'), text = title.textContent;
    sidebar.style.width = '210px'; title.textContent = 'A deliberately long translated filter title';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const headers = Array.from(sidebar.querySelectorAll('.sidebar-heading'));
    const controlsFit = headers.every(header => {
      const box = header.getBoundingClientRect();
      return Array.from(header.querySelectorAll('button, .filter-switch')).every(control => {
        const rect = control.getBoundingClientRect();
        return rect.width > 0 && rect.left >= box.left && rect.right <= box.right;
      });
    });
    const groupControlsFit = Array.from(sidebar.querySelectorAll('.filter-group-mode')).every(control => control.getBoundingClientRect().right <= sidebar.getBoundingClientRect().right);
    const search = document.querySelector('.advanced-search-main').getBoundingClientRect();
    const filter = document.querySelector('.filter-panel').getBoundingClientRect();
    const result = { controlsFit, groupControlsFit, titleTruncated: title.scrollWidth > title.clientWidth, seam: filter.top - search.bottom };
    sidebar.style.width = width; title.textContent = text;
    return result;
  })()`);
  assert.ok(narrowLayout.controlsFit, 'heading controls stay within a narrow sidebar');
  assert.ok(narrowLayout.groupControlsFit, 'filter mode buttons stay attached to the right edge');
  assert.ok(narrowLayout.titleTruncated, 'long titles yield to controls');
  assert.ok(narrowLayout.seam <= 1.5, 'search and filter share a single thin seam');
  console.log('PASS narrow sidebar controls, title priority and compact search/filter seam');

  assert.equal(await evaluate('document.querySelectorAll(".filter-group-search input").length'), 4);
  await setInput('.filter-group-search input', 'EQUATION');
  await until(`${group('Block Type')}.open && ${group('Block Type')}.querySelectorAll('.filter-choice').length === 1`, 'case-insensitive candidate search opens choices');
  await clickChoice('Block Type', 'Equation');
  await setInput('.filter-group-search input', 'section');
  assert.ok(await evaluate(`${group('Block Type')}.querySelector('summary small').textContent.includes('Equation')`));
  await setInput('.filter-group-search input', '');
  await until(`${group('Block Type')}.querySelector('.filter-choice input:checked') !== null`, 'search keeps selected conditions');
  await clickChoice('Block Type', 'Equation');
  await setInput('.filter-group-search input', 'EQUATION');
  await evaluate(`${group('Block Type')}.querySelector('summary strong').click()`);
  await until(`${group('Block Type')}.open && ${group('Block Type')}.querySelectorAll('.filter-choice').length > 1 && ${group('Block Type')}.querySelector('.filter-group-search input').value === ''`, 'header click reveals all options');
  await count(4);
  console.log('PASS default filter search, case-insensitive candidates, selection retention and full option disclosure');

  await evaluate('document.querySelector(".filter-switch input").click()'); await count(4);
  await clickChoice('Document Location', 'Two · main.tex'); await count(1);
  await until('Array.from(document.querySelectorAll(".structured-preview .preview-block")).some(el => el.classList.contains("filter-unmatched"))', "Visual location filter matches renderer nodes");
  await query('Two'); await count(1);
  await evaluate('document.querySelector(".replace-disclosure").click()');
  await setInput('.replace-panel input', 'Renamed');
  await evaluate('document.querySelectorAll(".replace-panel button")[1].click()');
  await until('document.querySelector(".search-query-error")?.textContent.includes("Some selected filters") && document.querySelectorAll(".replace-panel button")[1].disabled', "renamed location does not silently broaden replacement scope");
  console.log('PASS renamed/deleted filter selections fail closed and require explicit reselection');
  await evaluate(`document.querySelector('[aria-label="Clear filters"]').click()`);
  await query('needle'); await count(4);
  await clickChoice('Block Type', 'Equation');
  await evaluate(`${group('Block Type')}.querySelector('.filter-group-mode').click()`); await count(3);
  await setInput('.replace-panel input', 'changed');
  await evaluate('document.querySelectorAll(".replace-panel button")[1].click()');
  await until('document.querySelector(".search-result-heading")?.textContent.includes("0 matches")', "filtered replacement");
  await press('S', ['control']);
  await until(`window.latexEditor.files.read(${id}, "main.tex").then(file => file.content.includes('changed first'))`, "save replacement");
  const replaced = (await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content;
  assert.equal(replaced, source.replace('\\section*{Two}', '\\section*{Renamed}').replace('needle first', 'changed first').replace('needle tail', 'changed tail').replace('needle second', 'changed second'));
  console.log('PASS stable Visual location filters and excluded equations survive Replace All');

  await evaluate(`document.querySelector('[aria-label="Clear filters"]').click()`);
  await choose('.search-option-row select', 'entire-project');
  await query('needle'); await count(3);
  await clickChoice('File', 'references.bib'); await count(2);
  await evaluate('document.querySelector(".search-result-list > button").click()');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("references.bib")', "BibTeX navigation");
  console.log('PASS file-only filtering includes bibliography files and preserves navigation');

  await evaluate(`document.querySelector('[aria-label="Clear filters"]').click()`);
  await query('original note'); await count(1);
  await evaluate('document.querySelector(".search-result-list > button").click()');
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("notes.txt")', "notes navigation");
  await evaluate('Array.from(document.querySelectorAll(".view-switch button")).find(button => button.textContent === "Code").click()');
  await until('!!document.querySelector(".editor-surface .monaco-editor textarea")', "notes editor");
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await press('END', ['control']); await page.webContents.insertText(' SAVED_SEARCH_MARKER');
  await press('S', ['control']);
  await until(`window.latexEditor.files.read(${id}, "notes.txt").then(file => file.content.includes('SAVED_SEARCH_MARKER'))`, "save notes");
  await evaluate('document.querySelector(".editor-tabs button.active .tab-close").click()');
  await query('SAVED_SEARCH_MARKER'); await count(1);
  console.log('PASS saved and closed documents retain their latest searchable content');

  await query('(a+)+$');
  await evaluate(`document.querySelector('.search-option-row button[title="Regular expression"]').click()`);
  await until('document.querySelector(".search-query-error")?.textContent.includes("timed out")', "pathological regex terminates");
  assert.equal(await evaluate('1+1'), 2);
  await evaluate(`document.querySelector('.search-option-row button[title="Regular expression"]').click()`);
  await query('Bibliography'); await count(1);
  console.log('PASS regex timeout leaves the UI responsive and the next search succeeds');
  assert.deepEqual(errors, []);
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => { console.log(`Artifacts: ${root}`); app.exit(0); }).catch(error => { console.error(error); console.error(errors); console.error(`Artifacts: ${root}`); app.exit(1); });
});
