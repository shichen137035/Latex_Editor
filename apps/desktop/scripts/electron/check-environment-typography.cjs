const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-environment-typography-"));
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
  console.error(await evaluate('document.querySelector(".environment-xml-error")?.textContent ?? document.querySelector(".settings-save-error")?.textContent'));
  throw new Error(`Timed out: ${label}`);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}
const setInput = (selector, value) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
const choose = (selector, value) => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('change', {bubbles:true})); })()`);
const titleSelector = id => `.structured-preview [data-environment="${id}"] > .preview-block-header > .preview-block-header-main > :is(strong, .preview-block-title, .preview-block-title-editor)`;
const typography = selector => evaluate(`(() => { const style = getComputedStyle(document.querySelector(${JSON.stringify(selector)})); return {size:style.fontSize,weight:style.fontWeight,family:style.fontFamily,leading:style.lineHeight,spacing:style.letterSpacing}; })()`);
async function manager() {
  await press(',', ['control']);
  await until('!!document.querySelector(".preferences-body")', "settings");
  await evaluate(`document.querySelector('[data-section="projectBuild"]').click(); document.querySelectorAll('.settings-level-switch button')[1].click()`);
  await until(`!!document.querySelector('.settings-manager-entry-open[aria-label="Block environment manager"]')`, "manager entry");
  await evaluate(`document.querySelector('.settings-manager-entry-open[aria-label="Block environment manager"]').click()`);
  await until('!!document.querySelector(".environment-manager-page")', "block manager");
  await choose('.settings-manager-header-tools > select', 'project');
  await evaluate(`document.querySelector('.environment-catalog-list [data-environment-id="section"]').click()`);
  await until('document.querySelector(".environment-editor-title h2")?.textContent === "Section"', "selected Section");
}
async function editXml(value) {
  await evaluate(`(() => { const textarea = document.querySelector('.environment-xml textarea'); const xml = new DOMParser().parseFromString(textarea.value, 'application/xml'); xml.querySelector('environment[id="section"] > style').setAttribute('titleFontSize', ${JSON.stringify(value)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, new XMLSerializer().serializeToString(xml)); textarea.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await evaluate('document.querySelector(".environment-xml button.primary").click()');
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', "directory");
  const project = await evaluate(`window.latexEditor.projects.create({name:"typography-regression",parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  await evaluate(`window.latexEditor.settings.set("autoSave", "off", ${id})`);
  await evaluate(`window.latexEditor.settings.set("layout", {mode:"single",singlePane:"preview",leftPane:"preview",rightPane:"pdf"}, ${id})`);
  // Reproduce existing saved configurations that lack the new typography properties.
  const catalog = require('../../../../resources/environments/preview-environments.json');
  const saved = catalog.previewEnvironments.map(entry => {
    const style = { ...catalog.defaultStyle, ...catalog.familyStyles[entry.family], ...entry.style };
    for (const key of Object.keys(style)) if (key.startsWith('title')) delete style[key];
    return { ...entry, style, enabled: true, builtIn: true, labelKey: `environment.${entry.id}`, behavior: { ...catalog.defaultBehavior, ...entry.behavior } };
  });
  await evaluate(`window.latexEditor.settings.set("environments", ${JSON.stringify(saved)}, ${id})`);
  const source = "\\documentclass{article}\n\\begin{document}\n\\begin{assumption}[Regularity condition]\\label{ass:one}A short condition.\\end{assumption}\n\\section{Model and Residual Structure}\\label{sec:model}\nA paragraph.\n\\subsection{Projection Pursuit Autoregressive Model}\nAnother paragraph.\n\\end{document}";
  await evaluate(`window.latexEditor.files.write(${id}, "main.tex", ${JSON.stringify(source)})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', "project list");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until(`!!document.querySelector(${JSON.stringify(titleSelector('subsection'))}) && !!document.querySelector(${JSON.stringify(titleSelector('assumption'))})`, "headings");
  page.focus();
  const section = await typography(titleSelector('section'));
  assert.equal(section.size, '24px'); assert.equal(section.weight, '600');
  assert.ok(section.family.includes('Space Grotesk')); assert.equal(section.spacing, '0.6px');
  const subsection = await typography(titleSelector('subsection')), assumption = await typography(titleSelector('assumption'));
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(titleSelector('assumption'))}).textContent`), 'Regularity condition');
  assert.equal(subsection.size, '21px'); assert.equal(subsection.weight, '600');
  assert.equal(assumption.size, '16px'); assert.equal(assumption.weight, '500');
  await delay(200);
  writeFileSync(resolve(root, 'default-headings.png'), (await page.webContents.capturePage()).toPNG());
  console.log('PASS actual title buttons retain hierarchy and weight despite workbench button resets');
  await manager();
  assert.equal(await evaluate('document.querySelectorAll(".environment-specialized-settings details").length'), 3);
  assert.ok(await evaluate('Array.from(document.querySelectorAll(".environment-specialized-settings details")).every(details => !details.open)'));
  await evaluate('document.querySelector(\'.environment-catalog-list [data-environment-id="assumption"]\').click()');
  await until('document.querySelector(".environment-editor-title h2")?.textContent === "Assumption"', 'select Assumption');
  await evaluate('Array.from(document.querySelectorAll(".behavior-grid label")).find(label => label.textContent.includes("Show argument brackets")).querySelector("input").click()');
  await until(`window.latexEditor.settings.get(${id}).then(snapshot => snapshot.project.environments.find(item => item.id === 'assumption').behavior.showOptionBrackets === true)`, 'save bracket option');
  await evaluate('document.querySelector(".environment-preview-sample-button").click()');
  await until('document.querySelector(".environment-sample-dialog .preview-block-header-main strong")?.textContent.startsWith("[")', 'sample follows bracket option');
  await evaluate('document.querySelector(".environment-sample-dialog > header button").click()');
  await evaluate('document.querySelector(\'.environment-catalog-list [data-environment-id="section"]\').click()');
  await evaluate('document.querySelector(\'.environment-specialized-settings details[data-preview-kind="advanced"] > summary\').click(); document.querySelector(\'.environment-specialized-settings details[data-preview-kind="table"] > summary\').click()');
  const previewSizeSelector = '.environment-specialized-settings input[name="tableExpandedFontSize"]';
  await evaluate(`document.querySelector(${JSON.stringify(previewSizeSelector)}).focus()`);
  await setInput(previewSizeSelector, '22');
  await press('TAB');
  await until(`window.latexEditor.settings.get(${id}).then(snapshot => snapshot.project.environments.find(item => item.id === 'section').style.tableExpandedFontSize === 22)`, 'save bottom subtype configuration');
  await delay(200);
  writeFileSync(resolve(root, 'specialized-settings.png'), (await page.webContents.capturePage()).toPNG());
  await setInput('.typography-grid input[name="titleFontSize"]', '32');
  await until(`window.latexEditor.settings.get(${id}).then(snapshot => snapshot.project.environments.find(item => item.id === 'section').style.titleFontSize === 32)`, "save title size");
  await choose('.typography-grid select[name="titleFontWeight"]', '700');
  await until(`window.latexEditor.settings.get(${id}).then(snapshot => snapshot.project.environments.find(item => item.id === 'section').style.titleFontWeight === 700)`, "save title weight");
  await evaluate('document.querySelector(".environment-preview-sample-button").click()');
  await until('!!document.querySelector(".environment-sample-dialog")', "sample");
  const sample = await typography('.environment-sample-dialog .preview-block-header-main > strong');
  assert.equal(sample.size, '32px'); assert.equal(sample.weight, '700');
  await evaluate('document.querySelector(".environment-sample-dialog > header button").click()');
  await evaluate('document.querySelectorAll(".environment-manager-mode button")[1].click()');
  await until('document.querySelector(".environment-xml textarea")?.value.includes(\'titleFontSize="32"\')', "XML includes typography");
  assert.ok(await evaluate('document.querySelector(".environment-xml textarea").value.includes(\'showOptionBrackets="true"\')'));
  assert.ok(await evaluate('document.querySelector(".environment-xml textarea").value.includes(\'tableExpandedFontSize="22"\')'));
  await editXml('30');
  await until(`window.latexEditor.settings.get(${id}).then(snapshot => snapshot.project.environments.find(item => item.id === 'section').style.titleFontSize === 30)`, "XML round trip");
  await editXml('0');
  await until('document.querySelector(".environment-xml-error")?.textContent.includes("titleFontSize")', "reject invalid XML size");
  assert.equal(await evaluate(`window.latexEditor.settings.get(${id}).then(snapshot => snapshot.project.environments.find(item => item.id === 'section').style.titleFontSize)`), 30);
  await evaluate('document.querySelector(".preferences-dialog > header .settings-close").click()');
  await until(`getComputedStyle(document.querySelector(${JSON.stringify(titleSelector('section'))})).fontSize === '30px'`, "Preview updates");
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(titleSelector('assumption'))}).textContent`), '[Regularity condition]');
  assert.equal((await typography(titleSelector('subsection'))).size, '21px');
  await evaluate(`document.querySelector(${JSON.stringify(titleSelector('section'))}).click()`);
  await until('!!document.querySelector(".preview-block-title-editor")', "title editor");
  assert.equal((await typography('.preview-block-title-editor')).size, '30px');
  assert.equal((await typography('.preview-block-title-editor')).weight, '700');
  await press('ESC');
  console.log('PASS manager size/weight edits, sample rendering, XML round trip, validation and inline editing');
  await evaluate('document.querySelector(".logo-button").click()');
  await until('!!document.querySelector(".directory-project-row")', "close project and release its document session");
  page.reload();
  await until('!!document.querySelector(".directory-project-row, .structured-preview")', "reload");
  if (await evaluate('!!document.querySelector(".directory-project-row")')) await evaluate('document.querySelector(".directory-project-row").click()');
  await until(`!!document.querySelector(${JSON.stringify(titleSelector('section'))})`, "reopened project");
  assert.equal((await typography(titleSelector('section'))).size, '30px');
  assert.equal((await typography(titleSelector('section'))).weight, '700');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(titleSelector('assumption'))}).textContent`), '[Regularity condition]');
  console.log('PASS project typography survives application reload');
  assert.deepEqual(errors, []);
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => { console.log(`Artifacts: ${root}`); app.exit(0); }).catch(error => { console.error(error); console.error(errors); console.error(`Artifacts: ${root}`); app.exit(1); });
});
