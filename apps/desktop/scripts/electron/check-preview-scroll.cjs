const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const root = mkdtempSync(resolve(tmpdir(), 'texweave-preview-scroll-'));
mkdirSync(resolve(root, 'projects'));
app.setPath('userData', resolve(root, 'profile'));
const delay = ms => new Promise(done => setTimeout(done, ms));
const errors = [];
let page;
const evaluate = code => page.webContents.executeJavaScript(code, true);
app.on('web-contents-created', (_event, contents) => contents.on('console-message', ({ level, message }) => {
  if ((level === 'error' || level === 3) && !message.includes('Canceled: Canceled')) errors.push(message);
}));
async function until(code, label) {
  for (let i = 0; i < 240; i++) { assert.deepEqual(errors, []); if (await evaluate(code)) return; await delay(50); }
  throw new Error('Timed out: ' + label);
}
// Reproduce disk/PDF decoding latency on each virtual remount, without touching user projects.
const { ProjectImageService } = require('../../dist/main/images.js');
const originalResolve = ProjectImageService.prototype.resolve;
ProjectImageService.prototype.resolve = async function (...args) { await delay(180); return originalResolve.apply(this, args); };

async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".directory-project-row, .directory-new-main")', 'directory');
  const project = await evaluate(`window.latexEditor.projects.create({name:'scroll-regression',parentPath:${JSON.stringify(resolve(root, 'projects'))}})`);
  const id = JSON.stringify(project.id);
  await evaluate(`window.latexEditor.settings.set('layout',{mode:'single',singlePane:'preview',leftPane:'preview',rightPane:'pdf'},${id})`);
  await evaluate(`window.latexEditor.settings.set('wheelAcceleration',{enabled:false,strength:4,maxMultiplier:6,decayMs:250})`);
  await evaluate(`window.latexEditor.files.createDirectory(${id},'figures')`);
  writeFileSync(resolve(project.canonicalPath, 'figures/tall.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="450" height="440"><rect width="450" height="440" fill="#277db0"/></svg>');
  const sections = Array.from({length:160}, (_, index) => `\\section{Scroll section ${index}}\nAnchor ${index}. ${'Readable prose. '.repeat(30)}\n\n\\begin{figure}\\includegraphics{figures/tall.svg}\\caption{Image ${index}}\\end{figure}\n\\begin{table}\\begin{tabular}{cc}${Array.from({length:8}, (_, row) => `R${row} & Value ${row} \\\\`).join('\n')}\\end{tabular}\\caption{Table ${index}}\\end{table}\nTrailing anchor ${index}.\n\n`).join('');
  await evaluate(`window.latexEditor.files.write(${id},'main.tex',${JSON.stringify('\\documentclass{article}\n\\begin{document}\n' + sections + '\\end{document}')})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', 'project');
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".structured-preview img")', 'initial images');
  await evaluate(`document.querySelector('.structured-preview').scrollTop = document.querySelector('.structured-preview').scrollHeight * .75`);
  await delay(700);
  const samples = [];
  for (let step = 0; step < 36; step++) {
    const before = await evaluate(`(() => { const root = document.querySelector('.structured-preview'), bounds = root.getBoundingClientRect(); const rows = Array.from(root.querySelectorAll('.preview-virtual-row')).filter(row => { const box = row.getBoundingClientRect(); return !row.querySelector("[data-virtual-node-id]") && box.height > 0 && box.top >= bounds.top && box.top < bounds.bottom; }).sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); const row = rows[0]; return row ? {id:row.dataset.virtualNodeId, top:row.getBoundingClientRect().top, scroll:root.scrollTop} : null; })()`);
    await evaluate(`document.querySelector('.structured-preview').scrollTop -= 170`);
    await delay(45);
    if (before) {
      const after = await evaluate(`(() => { const root = document.querySelector('.structured-preview'), row = Array.from(root.querySelectorAll('.preview-virtual-row')).find(row => row.dataset.virtualNodeId === ${JSON.stringify(before.id)}); return row ? {top:row.getBoundingClientRect().top,scroll:root.scrollTop} : null; })()`);
      if (after) samples.push({step, id:before.id, drift: after.top - before.top - 170, scrollDelta:after.scroll - before.scroll});
    }
  }
  await delay(600);
  const maxDrift = Math.max(0, ...samples.map(sample => Math.abs(sample.drift)));
  assert.ok(samples.length >= 24, 'The scroll probe must compare enough mounted content rows');
  console.log(JSON.stringify({maxDrift, worst:samples.filter(sample => Math.abs(sample.drift) > 4)}));
  writeFileSync(resolve(root, 'scroll-samples.json'), JSON.stringify(samples, null, 2));
  assert.ok(maxDrift <= 4, `Visible anchor must move with upward scrolling, without layout-induced jumps (${maxDrift}px)`);
  page.focus();
  let nativeReversal = 0;
  for (let step = 0; step < 10; step++) {
    const before = await evaluate(`(() => { const root = document.querySelector('.structured-preview'), bounds = root.getBoundingClientRect(); const rows = Array.from(root.querySelectorAll('[data-virtual-node-id]')).filter(row => !row.querySelector('[data-virtual-node-id]') && row.getBoundingClientRect().top >= bounds.top && row.getBoundingClientRect().top < bounds.bottom).sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top); const row = rows[0]; return row ? {id:row.dataset.virtualNodeId,top:row.getBoundingClientRect().top,x:Math.round(bounds.left+40),y:Math.round(bounds.top+30)} : null; })()`);
    if (!before) continue;
    page.webContents.sendInputEvent({type:'mouseMove',x:before.x,y:before.y});
    page.webContents.sendInputEvent({type:'mouseWheel',x:before.x,y:before.y,deltaX:0,deltaY:110});
    await delay(180);
    const after = await evaluate(`Array.from(document.querySelectorAll('[data-virtual-node-id]')).find(row => row.dataset.virtualNodeId === ${JSON.stringify(before.id)})?.getBoundingClientRect().top`);
    if (typeof after === 'number') nativeReversal = Math.max(nativeReversal, before.top - after);
  }
  assert.ok(nativeReversal <= 4, `Native upward wheel gestures must not visibly reverse (${nativeReversal}px)`);
  console.log(JSON.stringify({nativeReversal}));
  page.webContents.sendInputEvent({type:'keyDown',keyCode:',',modifiers:['control']});
  page.webContents.sendInputEvent({type:'keyUp',keyCode:',',modifiers:['control']});
  await until('!!document.querySelector(".preferences-body")', 'settings for accelerated wheel probe');
  await evaluate(`document.querySelector('[data-section="general"]').click(); document.querySelectorAll('.settings-level-switch button')[0].click()`);
  await until('!!document.querySelector(".wheel-acceleration-settings input[type=checkbox]:not(:disabled)")', 'wheel acceleration preference');
  await evaluate(`const checkbox = document.querySelector('.wheel-acceleration-settings input[type=checkbox]'); if (!checkbox.checked) checkbox.click();`);
  await until(`window.latexEditor.settings.get().then(snapshot => snapshot.global.wheelAcceleration.enabled)`, 'persist accelerated wheel preference');
  await evaluate('document.querySelector(".settings-close").click()');
  await evaluate(`window.__acceleratedWheelEvents = 0; window.addEventListener('wheel', event => { if (event.defaultPrevented) window.__acceleratedWheelEvents++; });`);
  let acceleratedReversal = 0;
  for (let step = 0; step < 22; step++) {
    const before = await evaluate(`(() => { const root = document.querySelector('.structured-preview'), bounds = root.getBoundingClientRect(); const row = Array.from(root.querySelectorAll('[data-virtual-node-id]')).filter(row => !row.querySelector('[data-virtual-node-id]') && row.getBoundingClientRect().top >= bounds.top && row.getBoundingClientRect().top < bounds.bottom).sort((a,b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0]; return row ? {id:row.dataset.virtualNodeId,top:row.getBoundingClientRect().top,x:Math.round(bounds.left+40),y:Math.round(bounds.top+30)} : null; })()`);
    if (!before) continue;
    page.webContents.sendInputEvent({type:'mouseMove',x:before.x,y:before.y});
    page.webContents.sendInputEvent({type:'mouseWheel',x:before.x,y:before.y,deltaX:0,deltaY:180});
    await delay(45);
    const after = await evaluate(`Array.from(document.querySelectorAll('[data-virtual-node-id]')).find(row => row.dataset.virtualNodeId === ${JSON.stringify(before.id)})?.getBoundingClientRect().top`);
    if (typeof after === 'number') acceleratedReversal = Math.max(acceleratedReversal, before.top - after);
  }
  assert.ok(acceleratedReversal <= 4, `Accelerated upward wheel gestures must not visibly reverse (${acceleratedReversal}px)`);
  const acceleratedEvents = await evaluate('window.__acceleratedWheelEvents');
  assert.ok(acceleratedEvents > 0, 'The rapid wheel probe must actually trigger acceleration');
  console.log(JSON.stringify({acceleratedReversal, acceleratedEvents}));
  assert.ok(await evaluate('document.querySelectorAll(".preview-block").length < 100'));
  assert.deepEqual(errors, []);
  console.log('PASS upward scrolling stays anchored across delayed images and tables, with bounded virtual rows');
}
app.whenReady().then(() => { require('../../dist/main/index.js'); run().then(() => { console.log(`Artifacts: ${root}`); app.exit(0); }).catch(error => { console.error(error); console.error(`Artifacts: ${root}`); app.exit(1); }); });
