const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const root = mkdtempSync(resolve(tmpdir(), 'texweave-source-performance-'));
const projects = resolve(root, 'projects'); mkdirSync(projects);
app.setPath('userData', resolve(root, 'profile'));
const delay = ms => new Promise(done => setTimeout(done, ms));
let page;
const evaluate = script => page.webContents.executeJavaScript(script, true);
async function until(script) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await evaluate(script)) return;
    await delay(50);
  }
  throw new Error('Timed out: ' + script);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")');
  const project = await evaluate(`window.latexEditor.projects.create({name:'source-performance',parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  const source = '\\documentclass{article}\n\\begin{document}\n' + Array.from({length:18000}, (_, index) => `Article line ${index}: prose for a long article, with $x_${index}+y$ and more text.\n`).join('') + '\\end{document}';
  await evaluate(`window.latexEditor.settings.set('autoSave','off',${id})`);
  await evaluate(`window.latexEditor.settings.set('layout',{mode:'single',singlePane:'source',leftPane:'source',rightPane:'pdf'},${id})`);
  await evaluate(`window.latexEditor.files.write(${id},'main.tex',${JSON.stringify(source)})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")');
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".editor-surface .view-line")');
  // Access the existing Monaco ref from React only inside this disposable test;
  // no application debug endpoint or exposed editor object is needed.
  await evaluate(`(() => {
    const element=document.querySelector('.editor-surface');
    let fiber=element[Object.keys(element).find(key=>key.startsWith('__reactFiber$'))];
    for (;fiber;fiber=fiber.return) for (let hook=fiber.memoizedState;hook;hook=hook.next) {
      const value=hook.memoizedState?.current;
      if (value && typeof value.getModel==='function' && typeof value.setScrollTop==='function') { window.sourceTestEditor=value; return; }
    }
    throw new Error('Missing source editor ref');
  })()`);
  await delay(1500);
  const profile = await evaluate(`(async () => {
    const editor=window.sourceTestEditor, model=editor.getModel();
    const getValue=model.getValue;
    let reads=0;
    model.getValue=function(...args) { reads++; return getValue.apply(this,args); };
    const frames=[]; let previous=performance.now();
    try {
      for (let step=1;step<=45;step++) {
        await new Promise(done=>requestAnimationFrame(now=>{frames.push(now-previous);previous=now;editor.setScrollTop(step*300);done();}));
      }
      await new Promise(done=>requestAnimationFrame(done));
      const sorted=frames.slice(2).sort((a,b)=>a-b);
      return {wholeDocumentReads:reads,scrollTop:editor.getScrollTop(),lineCount:model.getLineCount(),renderedLines:document.querySelectorAll('.editor-surface .view-line').length,medianFrameMs:sorted[Math.floor(sorted.length/2)],p95FrameMs:sorted[Math.floor(sorted.length*.95)]};
    } finally { model.getValue=getValue; }
  })()`);
  console.log('Long source scroll profile: ' + JSON.stringify(profile));
  assert.ok(profile.lineCount >= 18000);
  assert.ok(profile.scrollTop >= 13000);
  assert.ok(profile.renderedLines < 300);
  assert.ok(profile.wholeDocumentReads <= 2, 'scrolling must not repeatedly read the entire source');
  await evaluate(`(() => { const editor=window.sourceTestEditor,model=editor.getModel(),line=model.getLineCount(),column=model.getLineMaxColumn(line); editor.executeEdits('performance-test',[{range:{startLineNumber:line,startColumn:column,endLineNumber:line,endColumn:column},text:'\\nLONG_EDIT'}]); })()`);
  await delay(250);
  assert.ok(await evaluate(`window.sourceTestEditor.getModel().getValue().endsWith('\\nLONG_EDIT')`));
  console.log('PASS 18,000-line source scrolls without repeated full reads and remains editable');
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(()=>{console.log('Artifacts: '+root);app.exit(0);}).catch(error=>{console.error(error);console.error('Artifacts: '+root);app.exit(1);});
});
