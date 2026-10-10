import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { app, BrowserWindow } = require("electron");

const root = mkdtempSync(resolve(tmpdir(), "texweave-spellcheck-check-"));
const projects = resolve(root, "projects");
app.setPath("userData", resolve(root, "user-data"));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let page;
const evaluate = async (source) => {
  try { return await page.webContents.executeJavaScript(source, true); }
  catch (error) { console.error("Renderer operation:", source); throw error; }
};

async function until(source, label, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(source)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

async function click(selector, button = "left") {
  const point = await evaluate(`(() => { const selector = ${JSON.stringify(selector)}; const el = document.querySelector(selector); if (!el) throw new Error("Missing selector: " + selector); el.scrollIntoView({block:"center"}); const rect = el.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; })()`);
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button, clickCount: 1 });
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button, clickCount: 1 });
  await delay(150);
}

async function run() {
  await mkdir(projects, { recursive: true });
  for (let attempt = 0; attempt < 100 && BrowserWindow.getAllWindows().length === 0; attempt += 1) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  assert.ok(page, "app window");
  await until("!!window.latexEditor", "preload bridge");

  const status = await evaluate("window.latexEditor.spellcheck.status()");
  console.log("Spell provider:", JSON.stringify(status));
  await evaluate("window.latexEditor.spellcheck.configure('manual', 'en-US')");
  await until("window.latexEditor.spellcheck.checkWords(['recieve'], 'en-US').then(words => words.includes('recieve'))", "dictionary ready");
  const directResult = await evaluate("window.latexEditor.spellcheck.checkWords(['recieve'], 'en-US')");
  console.log("Direct provider result:", JSON.stringify(directResult));
  assert.ok(status?.available, "spell-check provider is unavailable");
  assert.ok(directResult.includes("recieve"), "provider did not mark recieve as misspelled");
  assert.deepEqual(await evaluate("window.latexEditor.spellcheck.checkWords(['receive', 'common', 'theorem'], 'en-US')"), []);
  assert.ok((await evaluate("window.latexEditor.spellcheck.suggestions('recieve', 'en-US')")).includes("receive"));
  assert.deepEqual(await evaluate("window.latexEditor.spellcheck.checkWords(['colour'], 'en-GB')"), []);

  const project = await evaluate(`window.latexEditor.projects.create({name:"spellcheck-test",parentPath:${JSON.stringify(projects)}})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", ${JSON.stringify("\\documentclass{article}\n\\begin{document}\nThis is a recieve test.\n\\end{document}\n")})`);
  await page.webContents.reload();
  await until("!!document.querySelector('.directory-project-row')", "project directory");
  await click(".directory-project-row");
  await until("!!document.querySelector('.editor-surface .monaco-editor')", "source editor");
  await click(".editor-surface .monaco-editor");
  page.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
  await page.webContents.insertText("This is a recieve test.");
  await until("document.querySelectorAll('.spell-error').length > 0", "source spell decoration", 40);
  console.log("PASS source editor shows a spell-error decoration");

  const point = await evaluate("(() => { const el = document.querySelector('.spell-error'); const rect = el.getBoundingClientRect(); return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) }; })()");
  page.webContents.sendInputEvent({ type: "mouseDown", ...point, button: "right", clickCount: 1 });
  page.webContents.sendInputEvent({ type: "mouseUp", ...point, button: "right", clickCount: 1 });
  await until("!!document.querySelector('.spell-context-menu')", "spell context menu");
  const menuText = await evaluate("document.querySelector('.spell-context-menu').textContent");
  assert.match(menuText, /Ignore/);
  assert.match(menuText, /Add to dictionary/);
  console.log("PASS spell context menu offers Ignore and Add to Dictionary");

  const style = await evaluate("(() => { const s = getComputedStyle(document.querySelector('.spell-error')); return { line:s.textDecorationLine, style:s.textDecorationStyle, color:s.textDecorationColor }; })()");
  assert.equal(style.style, "wavy");
  assert.match(style.line, /underline/);
  assert.equal(style.color, "rgb(212, 76, 85)");
  console.log("Underline style:", style);
  await writeFile(resolve(root, "source-spelling.png"), (await page.webContents.capturePage()).toPNG());
  await evaluate('Array.from(document.querySelectorAll(".spell-context-menu button")).find(button => button.textContent === "Ignore").click()');
  await until("!document.querySelector('.spell-error')", "Ignore removes underline");
  console.log("PASS Ignore removes the underline");

  await click(".editor-surface .monaco-editor");
  page.webContents.sendInputEvent({type:"keyDown",keyCode:"A",modifiers:["control"]});
  page.webContents.sendInputEvent({type:"keyUp",keyCode:"A",modifiers:["control"]});
  await page.webContents.insertText("This is a texweavescientificword test.");
  await until("!!document.querySelector('.spell-error')", "custom word underline");
  await click(".spell-error", "right");
  await until("!!document.querySelector('.spell-context-menu')", "custom word menu");
  await evaluate('Array.from(document.querySelectorAll(".spell-context-menu button")).find(button => button.textContent === "Add to dictionary").click()');
  await until("!document.querySelector('.spell-error')", "dictionary removes underline");
  assert.ok((await evaluate("window.latexEditor.spellcheck.dictionaryWords()")).includes("texweavescientificword"));
  const { OfflineSpellCheckService } = require("../dist/main/spellcheck.js");
  const reloaded = new OfflineSpellCheckService();
  await reloaded.initialize();
  assert.deepEqual(reloaded.checkWords(["texweavescientificword"], "en-US"), []);
  for (const englishId of ["en-US", "en-GB", "en-AU"]) {
    await assert.rejects(reloaded.removeDictionary(englishId), /English dictionaries cannot be removed/);
  }
  assert.ok(reloaded.status().availableLanguages.includes("en-US"), "English should remain installed after rejected removal");
  console.log("PASS Add to dictionary persists across service reload");

  const visualIndex = await evaluate("Array.from(document.querySelectorAll('.view-switch button')).findIndex(button => button.textContent === 'Visual')");
  await click(`.view-switch button:nth-child(${visualIndex + 1})`);
  await until("!!document.querySelector('.preview-content-region')", "Visual preview");
  await click(".preview-content-region");
  await until("!!document.querySelector('.preview-local-editor .monaco-editor')", "inline source editor");
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await evaluate('document.querySelector(".preview-local-editor .monaco-editor textarea").focus()');
  page.webContents.sendInputEvent({type:"keyDown",keyCode:"A",modifiers:["control"]});
  page.webContents.sendInputEvent({type:"keyUp",keyCode:"A",modifiers:["control"]});
  await delay(100);
  await page.webContents.insertText("This is a recieve and mispelled test.");
  await until("!!document.querySelector('.preview-local-editor .spell-error')", "Visual inline underline");
  assert.equal(await evaluate("document.querySelector('.preview-local-editor .spell-error').textContent"), "mispelled", "Ignore persists when switching to Visual");
  await click(".preview-local-editor .spell-error", "right");
  await until("!!document.querySelector('.spell-context-menu')", "Visual spelling menu");
  await writeFile(resolve(root, "visual-spelling.png"), (await page.webContents.capturePage()).toPNG());
  const suggestionIndex = await evaluate("Array.from(document.querySelectorAll('.spell-context-menu button')).findIndex(button => button.textContent === 'misspelled')");
  assert.ok(suggestionIndex >= 0);
  await click(`.spell-context-menu button:nth-child(${suggestionIndex + 1})`);
  await until("!document.querySelector('.preview-local-editor .spell-error')", "suggestion removes underline");
  assert.ok(await evaluate("document.querySelector('.preview-local-editor .view-lines').textContent.includes('misspelled')"));
  console.log("PASS Visual inline editing shows underline and applies correction");

  page.webContents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["control"] });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["control"] });
  await delay(100);
  await until("!!document.querySelector('.preferences-dialog')", "settings");
  await click('[data-section="editor"]');
  await click('.settings-manager-entry-open[aria-label="Dictionary manager"]');
  await until("document.querySelector('.spellcheck-settings')?.textContent.includes('Hunspell (nspell)')", "provider settings");
  assert.ok(await evaluate("document.querySelector('.spellcheck-settings').textContent.includes('en-GB')"));
  await click('.settings-manager-return');
  await until('!!document.querySelector(".settings-dialog-header")', "settings home");
  await click('.settings-close');
  await evaluate('document.querySelector(".spell-status-control > button").click()');
  await until('!!document.querySelector(".spell-status-menu")', "spell mode menu");
  await evaluate('document.querySelector(".spell-status-menu button:last-child").click()');
  await until("document.querySelector('.spell-status-control > button').textContent.includes('Off')", "disable control");
  assert.deepEqual(await evaluate("window.latexEditor.spellcheck.checkWords(['recieve'], 'en-US')"), []);
  assert.equal(await evaluate("document.querySelectorAll('.spell-error').length"), 0);
  console.log("PASS settings reports installed dictionaries; disabling stops checks");

  console.log("Spell-check artifacts:", root);
}

require("../dist/main/index.js");
app.whenReady().then(run).then(() => app.exit(0)).catch((error) => { console.error(error); app.exit(1); });
