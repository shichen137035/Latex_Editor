const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-source-editor-"));
const projects = resolve(root, "projects");
mkdirSync(projects);
app.setPath("userData", resolve(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
const errors = [];
let page;
const evaluate = async script => {
  try { return await page.webContents.executeJavaScript(script, true); }
  catch (error) { throw new Error(`Evaluation failed: ${script.slice(0, 180)}`, { cause: error }); }
};
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
async function until(script, label) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    assert.equal(errors.length, 0, errors.join("\n"));
    if (await evaluate(script)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}
async function focusEditor() {
  await until('!!document.querySelector(".editor-surface .monaco-editor textarea")', 'editor input');
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
}
async function save() { await press('S', ['control']); await delay(200); }
async function openFile(path, marker) {
  await evaluate(`document.querySelector('.tree-row[data-path=${JSON.stringify(path)}]').click()`);
  await until(`document.querySelector('.editor-surface .view-lines')?.textContent.includes(${JSON.stringify(marker)})`, path);
  await delay(50);
  await focusEditor();
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', 'directory');
  const project = await evaluate(`window.latexEditor.projects.create({name:"source-regression",parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  await evaluate(`window.latexEditor.settings.set("autoSave", "off", ${id})`);
  await evaluate(`window.latexEditor.settings.set("layout", {mode:"single",singlePane:"source",leftPane:"source",rightPane:"pdf"}, ${id})`);
  const source = '$x+y$ rest \\ref{outside}\nalpha\nalpha\n\\begin{document}\nBody.\\label{outside}\n\\end{document}';
  await evaluate(`window.latexEditor.files.write(${id}, "main.tex", ${JSON.stringify(source)})`);
  await evaluate(`window.latexEditor.files.createFile(${id}, "other.tex")`);
  await evaluate(`window.latexEditor.files.write(${id}, "other.tex", ${JSON.stringify("Other document.\nSecond line.")})`);
  await evaluate(`window.latexEditor.files.createFile(${id}, "notes.txt")`);
  await evaluate(`window.latexEditor.files.write(${id}, "notes.txt", "Plain notes")`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', 'project list');
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('document.querySelector(".editor-surface .view-lines")?.textContent.includes("alpha")', 'source editor');
  page.focus();
  await focusEditor();
  if (process.argv.includes('--latex-boundaries-only')) {
    await evaluate(`(() => {
      const surface = document.querySelector('.editor-surface');
      let fiber = surface[Object.keys(surface).find(key => key.startsWith('__reactFiber$'))];
      for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const value = hook.memoizedState?.current;
        if (value && typeof value.getModel === 'function' && typeof value.setScrollTop === 'function') { window.sourceTestEditor = value; return; }
      }
      throw new Error('Source editor not found');
    })()`);
    await evaluate(`window.sourceTestEditor.getModel().setValue(''); window.sourceTestEditor.setPosition({lineNumber:1,column:1}); window.sourceTestEditor.focus()`);
    await delay(200);
    await press('$');
    await delay(100);
    assert.deepEqual(await evaluate(`({text:window.sourceTestEditor.getValue(),column:window.sourceTestEditor.getPosition().column})`), { text:'$$', column:2 });
    await press('$');
    await delay(100);
    assert.deepEqual(await evaluate(`({text:window.sourceTestEditor.getValue(),column:window.sourceTestEditor.getPosition().column})`), { text:'$$$$', column:3 });
    await press('ENTER');
    await delay(100);
    assert.deepEqual(await evaluate(`({text:window.sourceTestEditor.getValue().replace(/\\r\\n/g,'\\n'),position:window.sourceTestEditor.getPosition()})`), { text:'$$\n\n$$', position:{lineNumber:2,column:1} });
    console.log('PASS actual dollar key presses produce paired display math with a blank content line');
    for (const opener of ['{', '(', '[']) {
      await evaluate(`window.sourceTestEditor.getModel().setValue(''); window.sourceTestEditor.setPosition({lineNumber:1,column:1}); window.sourceTestEditor.focus()`);
      await delay(100);
      await press(opener);
      await press('BACKSPACE');
      await delay(100);
      assert.equal(await evaluate('window.sourceTestEditor.getValue()'), '');
      await evaluate(`window.sourceTestEditor.trigger('regression', 'undo', null)`);
      await delay(100);
      assert.equal((await evaluate('window.sourceTestEditor.getValue()')).length, 2);
    }
    console.log('PASS Backspace removes both empty brackets and Undo restores the pair');
    await evaluate(`window.sourceTestEditor.updateOptions({tabSize:2,insertSpaces:true,detectIndentation:false}); window.sourceTestEditor.getModel().setValue(''); window.sourceTestEditor.setPosition({lineNumber:1,column:1}); window.sourceTestEditor.focus()`);
    await delay(100);
    await press('{');
    await press('ESC');
    await delay(100);
    await evaluate('window.sourceTestEditor.focus()');
    await press('ENTER');
    page.webContents.sendInputEvent({type:'char',keyCode:'\r'});
    await delay(100);
    assert.deepEqual(await evaluate(`({text:window.sourceTestEditor.getValue().replace(/\\r\\n/g,'\\n'),position:window.sourceTestEditor.getPosition()})`), { text:'{\n  \n}', position:{lineNumber:2,column:3} });
    const environmentPair = '\\begin{align}\\end{align}';
    await evaluate(`window.sourceTestEditor.getModel().setValue(${JSON.stringify(environmentPair)}); window.sourceTestEditor.setPosition({lineNumber:1,column:14}); window.sourceTestEditor.focus()`);
    await delay(100);
    await press('ENTER');
    page.webContents.sendInputEvent({type:'char',keyCode:'\r'});
    await delay(100);
    assert.deepEqual(await evaluate(`({text:window.sourceTestEditor.getValue().replace(/\\r\\n/g,'\\n'),position:window.sourceTestEditor.getPosition()})`), { text:'\\begin{align}\n  \n\\end{align}', position:{lineNumber:2,column:3} });
    console.log('PASS bracket and LaTeX environment Enter indent the body and align the closing line');
    const foldingSource = '\\begin{custom}\nUNINDENTED_BODY\n\\end{custom}\nOUTSIDE_ENVIRONMENT';
    await evaluate(`window.sourceTestEditor.getModel().setValue(${JSON.stringify(foldingSource)}); window.sourceTestEditor.setPosition({lineNumber:1,column:1})`);
    await delay(700);
    await evaluate(`window.sourceTestEditor.getAction('editor.foldAll').run()`);
    await until(`document.querySelector('.editor-surface .view-lines')?.textContent.includes('OUTSIDE_ENVIRONMENT') && !document.querySelector('.editor-surface .view-lines')?.textContent.includes('UNINDENTED_BODY')`, 'syntax folding without indentation');
    await evaluate(`window.sourceTestEditor.getAction('editor.unfoldAll').run()`);
    await until(`document.querySelector('.editor-surface .view-lines')?.textContent.includes('UNINDENTED_BODY')`, 'unfold environment');
    console.log('PASS actual source folding uses matched environment boundaries and unfolds normally');
    assert.deepEqual(errors, []);
    return;
  }
  await press('HOME', ['control']);
  await press('RIGHT');
  await press('END');
  await delay(160);
  assert.equal(await evaluate('!!document.querySelector(".math-preview-popover")'), false);
  console.log('PASS leaving math before its timer fires does not reopen a stale preview');
  await press('HOME', ['control']);
  await press('DOWN');
  await press('HOME');
  await press('D', ['control']);
  await press('D', ['control']);
  await press('{');
  await save();
  assert.ok((await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content.includes('{alpha}\n{alpha}'));
  console.log('PASS symbol pairing wraps both Monaco cursors');
  await press('Z', ['control']);
  await save();
  assert.equal((await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content, source);
  await press('Y', ['control']);
  await save();
  assert.ok((await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content.includes('{alpha}\n{alpha}'));
  console.log('PASS multi-cursor changes support undo/redo');
  await press('ESC');
  await press('HOME', ['control']);
  await press('END');
  await openFile('other.tex', 'Other');
  await press('END', ['control']);
  await page.webContents.insertText(' OTHER_EDIT');
  await save();
  await openFile('main.tex', 'alpha');
  await page.webContents.insertText(' MAIN_EDIT');
  await save();
  const main = (await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content;
  assert.ok(main.split('\n')[0].endsWith(' MAIN_EDIT'));
  assert.ok((await evaluate(`window.latexEditor.files.read(${id}, "other.tex")`)).content.endsWith(' OTHER_EDIT'));
  console.log('PASS switching source files restores cursor and keeps edits isolated');
  const point = await evaluate(`(() => { const span = Array.from(document.querySelectorAll('.editor-surface .view-line span')).find(el => !el.childElementCount && el.firstChild?.nodeType === 3 && el.textContent.includes('outside')); const range = document.createRange(); const index = span.textContent.indexOf('outside'); range.setStart(span.firstChild,index+1); range.setEnd(span.firstChild,index+3); const rect = range.getBoundingClientRect(); return {x:rect.x+rect.width/2,y:rect.y+rect.height/2}; })()`);
  page.webContents.sendInputEvent({ type:'mouseMove', x:Math.round(point.x), y:Math.round(point.y), modifiers:['control'] });
  await until('!!document.querySelector(".texweave-reference-cursor")', 'valid source reference cursor');
  page.webContents.sendInputEvent({ type:'mouseDown', x:Math.round(point.x), y:Math.round(point.y), button:'left', clickCount:1, modifiers:['control'] });
  page.webContents.sendInputEvent({ type:'mouseUp', x:Math.round(point.x), y:Math.round(point.y), button:'left', clickCount:1, modifiers:['control'] });
  await delay(100);
  await press('B', ['control']);
  await delay(100);
  await page.webContents.insertText('BACK_CHECK');
  await save();
  assert.ok((await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content.split('\n')[0].includes('BACK_CHECK\\ref{outside}'));
  await press('R', ['control']);
  await delay(100);
  await page.webContents.insertText('FORWARD_CHECK');
  await save();
  assert.ok((await evaluate(`window.latexEditor.files.read(${id}, "main.tex")`)).content.includes('FORWARD_CHECK\\label{outside}'));
  console.log('PASS Code reference jumps join the shared back/forward navigation stack');
  await openFile('notes.txt', 'Plain');
  await evaluate(`Array.from(document.querySelectorAll('.app-menus > .menu-anchor > button')).find(button => button.textContent === 'Edit').click()`);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.menu-popover button')).find(button => button.textContent.includes('Format source'))?.disabled`), true);
  console.log('PASS LaTeX formatting is disabled for plain text');
  assert.deepEqual(errors, []);
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => { console.log(`Artifacts: ${root}`); app.exit(0); }).catch(error => { console.error(error); console.error(`Artifacts: ${root}`); app.exit(1); });
});
