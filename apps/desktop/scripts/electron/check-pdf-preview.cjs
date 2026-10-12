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
  console.error('PDF failure state:', await evaluate(`JSON.stringify({ label: document.querySelector('.pdf-origin-label')?.textContent, errors: Array.from(document.querySelectorAll('.pdf-viewer-error')).map(node=>node.textContent), pages: Array.from(document.querySelectorAll('.pdf-page')).map(node=>({page:node.dataset.page,top:node.getBoundingClientRect().top,canvas:!!node.querySelector('canvas'),text:node.querySelector('.textLayer')?.textContent?.slice(0,90)})) })`));
  await writeFile(join(root, 'failure.png'), (await page.webContents.capturePage()).toPNG());
  throw new Error(`Timed out: ${label}`);
}
function source(marker, count = 6) {
  return '\\documentclass{article}\n\\begin{document}\n' + Array.from({length:count}, (_, index) => `${marker} page ${index+1}.\\par ${'Readable prose. '.repeat(40)}${index<count-1?'\\newpage':''}\n`).join('') + '\\end{document}\n';
}
async function compileUi(expectedSource, projectId) {
  await evaluate('document.querySelector(".compile-button").click()');
  await until('!document.querySelector(".compile-button")?.disabled', 'compile button idle');
  if (expectedSource !== undefined) {
    const saved = `await window.latexEditor.files.read(${projectId},"main.tex")`;
    try {
      await until(`(async()=> (${saved}).content===${JSON.stringify(expectedSource)})()`, 'expected source saved before compile completes');
    } catch (error) {
      const state = await evaluate(`(async()=>{const file=${saved};return {expectedLength:${JSON.stringify(expectedSource)}.length,actualLength:file.content.length,expectedMarker:${JSON.stringify(expectedSource.split(/\\r?\\n/)[2]?.split(' ')[0] ?? '')},actualStart:file.content.slice(0,180),actualEnd:file.content.slice(-180)}})()`);
      throw new Error(`${error instanceof Error ? error.message : String(error)}\\nCompile source diagnostics: ${JSON.stringify(state)}`);
    }
  }
  await delay(250);
}
async function replaceSource(text) {
  await evaluate('document.querySelector(".editor-surface .monaco-editor textarea").focus()');
  await until('!!document.querySelector(".editor-surface .monaco-editor.focused")', 'focused source editor before replace');
  await delay(80);
  page.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});
  page.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
  // Electron queues input events to Chromium. Let Monaco process Ctrl+A before
  // insertText, especially after a compiler diagnostic has taken focus.
  await delay(100);
  await page.webContents.insertText(text);
  const marker=text.split(/\r?\n/)[2]?.split(' ')[0];
  if(marker) await until(`document.querySelector(".editor-surface .monaco-editor .view-lines")?.innerText.includes(${JSON.stringify(marker)})`, `source editor contains ${marker}`);
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
  await compileUi(undefined,id);
  await until('document.querySelectorAll(".pdf-page").length===6 && !!document.querySelector(".pdf-page canvas")','six-page PDF');
  await evaluate(`(() => { const root=document.querySelector('.pdf-viewer'); const page=root.querySelector('[data-page="4"]'); root.scrollTop=page.getBoundingClientRect().top-root.getBoundingClientRect().top+root.scrollTop+page.clientHeight*.35; })()`);
  await delay(200); const before=await readingPosition(); assert.equal(before.page,4);
  await until(`!document.querySelector('.pdf-page[data-page="1"] canvas') && !!document.querySelector('.pdf-page[data-page="4"] canvas')`, 'offscreen PDF bitmap released while the visible page remains rendered');
  const recompiledSource=source('Recompiled');
  await replaceSource(recompiledSource);
  await compileUi(recompiledSource,id);
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

  // Build the proposal from the exact persisted file after prior compile/save
  // interactions; a stale fixture here should be rejected by the real guard.
  const current=await readFile(join(project.canonicalPath,'main.tex'),'utf8');
  const conversation={id:'test-chat',title:'AI compile test',mode:'codex',projectId:project.id,createdAt:Date.now(),updatedAt:Date.now(),messages:[]};
  const changes={id:'test-changes',conversationId:conversation.id,createdAt:Date.now(),status:'pending',permissionMode:'ask',files:[{path:'main.tex',type:'modify',originalContent:current,proposedContent:aiSource,status:'pending',hunks:[{id:'test-hunk',oldStart:0,oldLines:current.split('\n').length,newStart:0,newLines:aiSource.split('\n').length,oldText:current,newText:aiSource,decision:'pending'}]}]};
  // No provider/network request is needed to exercise local review and compilation.
  for (const endpoint of [desktopInvoke.ai.detect,desktopInvoke.ai.status,desktopInvoke.ai.copilotStatus]) { ipcMain.removeHandler(endpoint.channel); ipcMain.handle(endpoint.channel,()=>({auth:'signed_in',process:'running'})); }
  for (const endpoint of [desktopInvoke.ai.models,desktopInvoke.ai.copilotModels]) { ipcMain.removeHandler(endpoint.channel); ipcMain.handle(endpoint.channel,()=>[]); }
  ipcMain.removeHandler(desktopInvoke.ai.conversations.channel); ipcMain.handle(desktopInvoke.ai.conversations.channel,()=>({conversations:[conversation],changeSets:[changes]}));
  ipcMain.removeHandler(desktopInvoke.ai.markChangeSetApplied.channel); ipcMain.handle(desktopInvoke.ai.markChangeSetApplied.channel,(_event,_id,ids,error)=>{if(ids.length)changes.files[0].hunks[0].applied=true;if(error)changes.autoApplyError=error;return changes;});
  ipcMain.removeHandler(desktopInvoke.ai.resolveChangeSet.channel); ipcMain.handle(desktopInvoke.ai.resolveChangeSet.channel,(_event,_id,decisions)=>{for(const hunk of changes.files[0].hunks)if(decisions[hunk.id])hunk.decision=decisions[hunk.id];if(Object.keys(decisions).length)changes.status=Object.values(decisions).every(value=>value==='accepted')?'accepted':'partially_accepted';return changes;});
  await evaluate(`document.querySelector('.activity-bar button[title^="AI Editor"]').click()`);
  await until('!!document.querySelector(".ai-change-set")','AI changes card');
  await evaluate('document.querySelector(".ai-change-set header button").click()');
  await until(`(async()=>{const file=await window.latexEditor.files.read(${id},"main.tex");return file.content===${JSON.stringify(aiSource)}||!!document.querySelector(".ai-change-set .ai-change-error")||!!document.querySelector(".block-notice")})()`, 'AI source accepted or visible error');
  const acceptedSource=await readFile(join(project.canonicalPath,'main.tex'),'utf8');
  if(acceptedSource!==aiSource){
    const state=await evaluate(`({changeCard:document.querySelector(".ai-change-set")?.innerText,aiErrors:Array.from(document.querySelectorAll(".ai-change-error,.ai-error,[role=alert]")).map(el=>el.innerText),notice:document.querySelector(".block-notice")?.innerText})`);
    throw new Error(`AI acceptance did not apply its proposal. Source matched original fixture: ${acceptedSource===current}. UI diagnostics: ${JSON.stringify(state)}`);
  }
  try {
    await until('document.querySelector(".pdf-origin-label")?.textContent === "main.tex" && document.querySelector(".save-status")?.textContent.includes("Saved")','automatic project compile after accepting');
  } catch (error) {
    const state = await evaluate(`(async () => ({
      diskSource:(await window.latexEditor.files.read(${id},"main.tex")).content.slice(0,90),
      diskMatchesProposalBase:(await window.latexEditor.files.read(${id},"main.tex")).content===${JSON.stringify(current)},
      bufferSource:document.querySelector(".editor-surface .monaco-editor .view-lines")?.innerText.slice(0,90),
      saveStatus:document.querySelector(".save-status")?.innerText,
      pdfOrigin:document.querySelector(".pdf-origin-label")?.innerText,
      compileButton:{disabled:document.querySelector(".compile-button")?.disabled,title:document.querySelector(".compile-button")?.title},
      changeCard:document.querySelector(".ai-change-set")?.innerText,
      aiErrors:Array.from(document.querySelectorAll(".ai-change-error,.ai-error,[role=alert]")).map(el=>el.innerText),
      notice:document.querySelector(".block-notice")?.innerText,
      diagnostics:document.querySelector(".bottom-panel")?.innerText.slice(0,500)
    }))()`);
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nAI apply/compile diagnostics: ${JSON.stringify(state)}`);
  }
  assert.equal(await readFile(join(project.canonicalPath,'main.tex'),'utf8'),aiSource);
  assert.notDeepEqual(await readFile(join(project.canonicalPath,'main.pdf')),realPdf);
  assert.equal((await readingPosition()).page,4);
  console.log('PASS accepting AI source edits saves and recompiles the real project automatically');

  const brokenSource=source('Broken').replace('\\end{document}','\\notARealCommand\n\\end{document}');
  await replaceSource(brokenSource);
  await compileUi(brokenSource,id);
  await until('!!document.querySelector(".bottom-panel .diagnostic-group")','failure diagnostics');
  assert.equal(await evaluate('document.querySelectorAll(".pdf-page").length'),6);
  assert.equal((await readingPosition()).page,4);
  console.log('PASS compilation failures retain the previous readable PDF');
  const shortSource=source('Short',2);
  await replaceSource(shortSource); await compileUi(shortSource,id);
  await until('document.querySelectorAll(".pdf-page").length===2','shorter PDF');
  await delay(300); assert.equal((await readingPosition()).page,2);
  console.log('PASS a shorter PDF restores near the last surviving page');
  await evaluate(`window.latexEditor.files.createDirectory(${id},"nested")`);
  await evaluate(`window.latexEditor.files.createFile(${id},"nested/alternate.tex")`);
  await evaluate(`window.latexEditor.files.write(${id},"nested/alternate.tex",${JSON.stringify(source('Alternate',1))})`);
  await evaluate(`window.latexEditor.projects.setMainFile(${id},"nested/alternate.tex")`);
  await until(`(() => { const trigger=document.querySelector('.pdf-document-select'); if (!trigger) return false; if (trigger.getAttribute('aria-expanded') !== 'true') { trigger.click(); return false; } return Array.from(document.querySelectorAll('.pdf-document-option')).some(option=>option.title.startsWith('nested/alternate.pdf')); })()`, 'main file change refreshes the PDF catalog');
  await evaluate(`document.querySelector('.pdf-document-select').click()`);
  await evaluate(`document.querySelector('.activity-bar button[title^="Files"]').click()`);
  await evaluate(`document.querySelector('.sidebar-heading button[title="Refresh file tree"]').click()`);
  await until(`!!document.querySelector('.tree-row[data-path="nested"]')`,'nested directory in file tree');
  await evaluate(`document.querySelector('.tree-row[data-path="nested"]').click()`);
  await until(`!!document.querySelector('.tree-row[data-path="nested/alternate.tex"]')`,'nested main in file tree');
  await evaluate(`document.querySelector('.tree-row[data-path="nested/alternate.tex"]').click()`);
  await until('document.querySelector(".editor-tabs button.active")?.textContent.includes("alternate.tex")','nested main selected');
  await until('!document.querySelector(".pdf-viewer")','selecting an uncompiled document clears the previous PDF');
  await compileUi(undefined,id);
  await until(`document.querySelectorAll('.pdf-page').length===1 && Array.from(document.querySelectorAll('.pdf-page .textLayer span')).some(el=>el.textContent.includes('Alternate'))`,'nested main PDF');
  assert.ok(await evaluate(`window.latexEditor.files.readPdf(${id},"alternate.pdf")`));
  console.log('PASS main-file changes synchronize to the UI and nested main files use the correct root output');
  assert.deepEqual(errors,[]);
}
app.whenReady().then(()=>{require('../../dist/main/index.js');run().then(()=>{console.log(`Artifacts: ${root}`);app.exit(0);}).catch(error=>{console.error(error);console.error(`Artifacts: ${root}`);app.exit(1);});});
