const { app, BrowserWindow, ipcMain } = require("electron");
const { desktopInvoke, desktopEvents } = require("@latex-editor/contracts/desktop-ipc");
const { mkdtempSync, mkdirSync } = require("node:fs");
const { mkdir, writeFile, readFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-pdf-preview-"));
const projects = join(root, "projects"); mkdirSync(projects);
app.setPath("userData", join(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
const errors = [];
let page;
const evaluate = script => page.webContents.executeJavaScript(script, true);
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
async function until(script, label) {
  for (let i = 0; i < 600; i++) {
    assert.equal(errors.length, 0, errors.join("\n"));
    if (await evaluate(script)) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
function source(marker, count = 6) {
  return '\\documentclass{article}\n\\begin{document}\n' + Array.from({length:count}, (_, index) => `${marker} page ${index+1}.\\par ${'Readable prose. '.repeat(40)}${index<count-1?'\\newpage':''}\n`).join('') + '\\end{document}\n';
}
async function compileUi() {
  await evaluate('document.querySelector(".compile-button").click()');
  await until('!document.querySelector(".compile-button")?.disabled', 'compile button idle');
  await delay(250);
}
async function replaceSource(text) {
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  page.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});
  page.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
  await page.webContents.insertText(text);
}
async function readingPosition() {
  return evaluate(`(() => { const root = document.querySelector('.pdf-viewer'); const y=root.getBoundingClientRect().top; const pages=Array.from(root.querySelectorAll('.pdf-page')); const page=pages.find(el=>el.getBoundingClientRect().bottom>y)||pages.at(-1); const rect=page.getBoundingClientRect(); return {page:Number(page.dataset.page),fraction:(y-rect.top)/rect.height}; })()`);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")','directory');
  const project = await evaluate(`window.latexEditor.projects.create({name:"pdf-regression",parentPath:${JSON.stringify(projects)}})`);
  const id=JSON.stringify(project.id);
  await evaluate(`window.latexEditor.settings.set("autoSave","off",${id})`);
  await evaluate(`window.latexEditor.settings.set("layout",{mode:"split",leftPane:"source",rightPane:"pdf",singlePane:"source"},${id})`);
  await evaluate(`window.latexEditor.files.write(${id},"main.tex",${JSON.stringify(source('Original'))})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")','project list');
  await evaluate('document.querySelector(".directory-project-row").click()'); page.focus();
  await until('!!document.querySelector(".editor-surface .monaco-editor textarea")','source editor');
  await compileUi();
  await until('document.querySelectorAll(".pdf-page").length===6 && !!document.querySelector(".pdf-page canvas")','six-page PDF');
  await evaluate(`(() => { const root=document.querySelector('.pdf-viewer'); const page=root.querySelector('[data-page="4"]'); root.scrollTop=page.getBoundingClientRect().top-root.getBoundingClientRect().top+root.scrollTop+page.clientHeight*.35; })()`);
  await delay(200); const before=await readingPosition(); assert.equal(before.page,4);
  await replaceSource(source('Recompiled'));
  await compileUi();
  await until(`Array.from(document.querySelectorAll('.pdf-page .textLayer span')).some(el=>el.textContent.includes('Recompiled'))`,'updated PDF text');
  const after=await readingPosition(); assert.equal(after.page,4); assert.ok(Math.abs(after.fraction-before.fraction)<.08);
  console.log('PASS recompilation preserves page and relative reading position');
  await evaluate(`(() => { const select=document.querySelector('.pdf-zoom-toolbar select'); select.value='1.25'; select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await delay(400); const zoomed=await readingPosition(); assert.equal(zoomed.page,4); assert.ok(Math.abs(zoomed.fraction-before.fraction)<.08);
  console.log('PASS zoom preserves the same reading position');

  // Exercise the same publishing helper used by the real AI compilation tool.
  const { LatexmkCompilerService } = await import('@latex-editor/compiler-latexmk');
  const { publishWorkspaceCompilation } = require('../../dist/main/compile-preview.js');
  const scratch=join(root,'ai-workspace'); await mkdir(scratch); const aiSource=source('AI proposal'); await writeFile(join(scratch,'main.tex'),aiSource);
  const compiler=new LatexmkCompilerService({projects:{},files:{},profiles:{getCompilerProfile:()=>({id:'test',executable:'latexmk',arguments:[],timeoutMs:120000})},clock:{now:()=>new Date()}});
  const result=await compiler.compileWorkspace({workspaceRoot:scratch,mainFile:'main.tex'}); assert.equal(result.status,'succeeded');
  const realPdf=await readFile(join(project.canonicalPath,'main.pdf'));
  await publishWorkspaceCompilation(project.id,result,{resolveFilePath:async(_id,path)=>join(project.canonicalPath,path)},update=>page.webContents.send(desktopEvents.toRenderer.compileUpdate.channel,update));
  await until(`document.querySelector('.pdf-origin-label')?.textContent.includes('AI') && Array.from(document.querySelectorAll('.pdf-page .textLayer span')).some(el=>el.textContent.includes('AI proposal'))`,'AI PDF preview');
  assert.deepEqual(await readFile(join(project.canonicalPath,'main.pdf')),realPdf);
  assert.equal((await readingPosition()).page,4);
  console.log('PASS AI build displays its PDF without replacing unaccepted project sources/artifacts');

  const current=source('Recompiled');
  const conversation={id:'test-chat',title:'AI compile test',mode:'codex',projectId:project.id,createdAt:Date.now(),updatedAt:Date.now(),messages:[]};
  const changes={id:'test-changes',conversationId:conversation.id,createdAt:Date.now(),status:'pending',permissionMode:'ask',files:[{path:'main.tex',type:'modify',originalContent:current,proposedContent:aiSource,status:'pending',hunks:[{id:'test-hunk',oldStart:0,oldLines:current.split('\n').length,newStart:0,newLines:aiSource.split('\n').length,oldText:current,newText:aiSource,decision:'pending'}]}]};
  // No provider/network request is needed to exercise local review and compilation.
  for (const endpoint of [desktopInvoke.ai.detect,desktopInvoke.ai.status,desktopInvoke.ai.copilotStatus]) { ipcMain.removeHandler(endpoint.channel); ipcMain.handle(endpoint.channel,()=>({auth:'signed_in',process:'running'})); }
  for (const endpoint of [desktopInvoke.ai.models,desktopInvoke.ai.copilotModels]) { ipcMain.removeHandler(endpoint.channel); ipcMain.handle(endpoint.channel,()=>[]); }
  ipcMain.removeHandler(desktopInvoke.ai.conversations.channel); ipcMain.handle(desktopInvoke.ai.conversations.channel,()=>({conversations:[conversation],changeSets:[changes]}));
  ipcMain.removeHandler(desktopInvoke.ai.markChangeSetApplied.channel); ipcMain.handle(desktopInvoke.ai.markChangeSetApplied.channel,(_event,_id,ids)=>{if(ids.length)changes.files[0].hunks[0].applied=true;return changes;});
  ipcMain.removeHandler(desktopInvoke.ai.resolveChangeSet.channel); ipcMain.handle(desktopInvoke.ai.resolveChangeSet.channel,(_event,_id,decisions)=>{if(decisions['test-hunk']){changes.files[0].hunks[0].decision=decisions['test-hunk'];changes.status='accepted';}return changes;});
  await evaluate(`document.querySelector('.activity-bar button[title="AI Editor"]').click()`);
  await until('!!document.querySelector(".ai-change-set")','AI changes card');
  await evaluate('document.querySelector(".ai-change-set header button").click()');
  await until('document.querySelector(".pdf-origin-label")?.textContent === "main.tex" && document.querySelector(".save-status")?.textContent.includes("Saved")','automatic project compile after accepting');
  assert.equal(await readFile(join(project.canonicalPath,'main.tex'),'utf8'),aiSource);
  assert.notDeepEqual(await readFile(join(project.canonicalPath,'main.pdf')),realPdf);
  assert.equal((await readingPosition()).page,4);
  console.log('PASS accepting AI source edits saves and recompiles the real project automatically');

  await replaceSource(source('Broken').replace('\\end{document}','\\notARealCommand\n\\end{document}'));
  await compileUi();
  await until('!!document.querySelector(".bottom-panel .diagnostic-group")','failure diagnostics');
  assert.equal(await evaluate('document.querySelectorAll(".pdf-page").length'),6);
  assert.equal((await readingPosition()).page,4);
  console.log('PASS compilation failures retain the previous readable PDF');
  await replaceSource(source('Short',2)); await compileUi();
  await until('document.querySelectorAll(".pdf-page").length===2','shorter PDF');
  await delay(300); assert.equal((await readingPosition()).page,2);
  console.log('PASS a shorter PDF restores near the last surviving page');
  await evaluate(`window.latexEditor.files.createDirectory(${id},"nested")`);
  await evaluate(`window.latexEditor.files.createFile(${id},"nested/alternate.tex")`);
  await evaluate(`window.latexEditor.files.write(${id},"nested/alternate.tex",${JSON.stringify(source('Alternate',1))})`);
  await evaluate(`window.latexEditor.projects.setMainFile(${id},"nested/alternate.tex")`);
  await until('!document.querySelector(".pdf-viewer")','main file change resets old PDF');
  await evaluate(`document.querySelector('.activity-bar button[title="Files"]').click()`);
  await evaluate(`document.querySelector('.sidebar-heading button[title="Refresh file tree"]').click()`);
  await until(`!!document.querySelector('.tree-row[data-path="nested"]')`,'nested directory in file tree');
  await evaluate(`document.querySelector('.tree-row[data-path="nested"]').click()`);
  await until(`!!document.querySelector('.tree-row[data-path="nested/alternate.tex"]')`,'nested main in file tree');
  await evaluate(`document.querySelector('.tree-row[data-path="nested/alternate.tex"]').click()`);
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("alternate.tex")','nested main selected');
  await compileUi();
  await until(`document.querySelectorAll('.pdf-page').length===1 && Array.from(document.querySelectorAll('.pdf-page .textLayer span')).some(el=>el.textContent.includes('Alternate'))`,'nested main PDF');
  assert.ok(await evaluate(`window.latexEditor.files.readPdf(${id},"alternate.pdf")`));
  console.log('PASS main-file changes synchronize to the UI and nested main files use the correct root output');
  assert.deepEqual(errors,[]);
}
app.whenReady().then(()=>{require('../../dist/main/index.js');run().then(()=>{console.log(`Artifacts: ${root}`);app.exit(0);}).catch(error=>{console.error(error);console.error(`Artifacts: ${root}`);app.exit(1);});});
