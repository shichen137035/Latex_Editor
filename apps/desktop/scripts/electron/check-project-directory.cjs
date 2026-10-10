const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
const root = mkdtempSync(join(tmpdir(), "texweave-directory-ui-"));
const folders = join(root, "projects"); mkdirSync(folders);
app.setPath("userData", join(root, "profile"));
const version = require("../../../../package.json").version;
let page;
const errors = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = async script => {
  try { return await page.webContents.executeJavaScript(script, true); }
  catch (error) { throw new Error(`Evaluation failed: ${script}\n${errors.join("\n")}`, { cause: error }); }
};
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
async function until(script, label) {
  for (let attempt = 0; attempt < 200; attempt++) {
    assert.deepEqual(errors, []);
    if (await evaluate(script)) return;
    await delay(50);
  }
  const diagnostics = label === 'native page scrolling' ? await evaluate(`(() => { const list=document.querySelector('.directory-project-list'), rect=list.getBoundingClientRect(); return {viewport:[innerWidth,innerHeight],scrollTop:list.scrollTop,scrollHeight:list.scrollHeight,clientHeight:list.clientHeight,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},rows:list.querySelectorAll('.directory-project-row').length,lastWheel:window.__lastWheel}; })()`) : undefined;
  throw new Error(`Timed out: ${label}${diagnostics ? `\nDiagnostics: ${JSON.stringify(diagnostics)}` : ''}`);
}
async function register(name, index) {
  const folder = join(folders, name); mkdirSync(folder);
  writeFileSync(join(folder, 'main.tex'), '\\documentclass{article}\n\\begin{document}\nProject ' + index + '\n\\end{document}\n');
  mkdirSync(join(folder, 'images'));
  writeFileSync(join(folder, 'images', 'plot.png'), Buffer.alloc(8192 * (index + 1)));
  return evaluate(`window.latexEditor.projects.register(${JSON.stringify(folder)})`);
}
async function refresh() {
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', 'directory rows');
  await until('!document.querySelector(".directory-size-loading")', 'project sizes');
}
async function search(text) {
  await evaluate(`(() => { const input = document.querySelector('.directory-global-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
async function capture(name) { writeFileSync(join(root, name), (await page.webContents.capturePage()).toPNG()); }
async function geometry() {
  return evaluate(`(() => {
    const list=document.querySelector('.directory-project-list'), head=document.querySelector('.directory-table-head'), row=list.querySelector('.directory-project-row');
    const rect=element=>element.getBoundingClientRect();
    const search=rect(document.querySelector('.directory-global-search')), workspace=rect(document.querySelector('.directory-workspace-button'));
    return { overflow: list.scrollWidth-list.clientWidth, outer: document.documentElement.scrollHeight-window.innerHeight,
      aligned: Math.abs(rect(head.children[2]).x-rect(row.children[2]).x), headerFont: parseFloat(getComputedStyle(head).fontSize),
      rowHeight: rect(row).height, topbarOverlap: search.left < workspace.right && search.right > workspace.left && search.top < workspace.bottom && search.bottom > workspace.top,
      background: getComputedStyle(document.querySelector('.directory-board')).pointerEvents };
  })()`);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', 'directory');
  page.unmaximize(); page.setContentSize(1280, 820); await delay(100);
  const first = await register('NICA Research', 0);
  await register('PPAR Study', 1); await register('LaTeX Notes', 2);
  await evaluate(`window.latexEditor.projects.updateDirectoryEntry(${JSON.stringify(first.id)},{isFavorite:true,isPinned:true})`);
  await refresh();
  await until(`document.querySelector('[data-app-version]')?.textContent === ${JSON.stringify('v'+version)}`, 'unified version');
  assert.equal(await evaluate('document.querySelector(".directory-table-head").textContent.includes("Project size")'), true);
  let measurements = await geometry();
  assert.ok(measurements.headerFont >= 15); assert.ok(measurements.rowHeight <= 55); assert.equal(measurements.topbarOverlap,false); assert.ok(measurements.aligned < 2); assert.ok(measurements.overflow < 2); assert.equal(measurements.background, 'none');
  await capture('home-small.png');
  for (let index = 3; index < 63; index++) await register('Paper ' + String(index).padStart(2,'0'), index);
  await refresh();
  assert.equal(await evaluate('document.querySelectorAll(".directory-project-row").length'), 10);
  assert.equal(await evaluate('document.querySelectorAll(".directory-pagination button[aria-current=page]")[0].textContent'), '1');
  assert.equal(await evaluate('document.querySelector(".directory-page-previous").disabled'), true);
  page.setContentSize(1280, 600); await delay(150);
  const point = await evaluate(`(() => { const r=document.querySelector('.directory-project-list').getBoundingClientRect();return {x:Math.round(r.right-45),y:Math.round(r.top+r.height/2)}; })()`);
  const headerTop = await evaluate('document.querySelector(".directory-table-head").getBoundingClientRect().top');
  await evaluate('window.__lastWheel = null; document.addEventListener("wheel", event => { window.__lastWheel = {deltaY:event.deltaY,defaultPrevented:event.defaultPrevented,target:event.target?.className,isTrusted:event.isTrusted}; }, true)');
  page.focus(); page.webContents.sendInputEvent({type:'mouseMove',...point});
  for (let i=0;i<12;i++) { page.webContents.sendInputEvent({type:'mouseWheel',...point,deltaY:-110,deltaX:0}); await delay(25); }
  await until('document.querySelector(".directory-project-list").scrollTop > 0', 'native page scrolling');
  assert.equal(await evaluate('document.querySelector(".directory-table-head").getBoundingClientRect().top'), headerTop);
  measurements = await geometry(); assert.ok(measurements.aligned < 2); assert.ok(measurements.outer < 2); assert.ok(measurements.overflow < 2);
  await evaluate('document.querySelectorAll(".directory-more")[9].click()');
  await until('!!document.querySelector(".directory-action-menu")', 'last-row actions');
  assert.ok(await evaluate('document.querySelector(".directory-action-menu").getBoundingClientRect().bottom <= window.innerHeight'));
  assert.equal(await evaluate('document.querySelectorAll(".directory-action-menu button").length'), await evaluate('document.querySelectorAll(".directory-action-menu button .directory-icon").length'));
  await evaluate('document.querySelector(".directory-heading").click()');
  await capture('home-many.png');
  await evaluate('document.querySelector(".directory-page-next").click()');
  await until('document.querySelector(".directory-pagination [aria-current=page]").textContent === "2"', 'next page');
  assert.equal(await evaluate('document.querySelector(".directory-project-list").scrollTop'), 0);
  await evaluate(`Array.from(document.querySelectorAll('.directory-pagination button')).find(button => button.textContent === '7').click()`);
  await until('document.querySelectorAll(".directory-project-row").length === 3', 'partial last page');
  assert.equal(await evaluate('document.querySelector(".directory-page-next").disabled'), true);
  await evaluate('document.querySelector(".directory-table-head input").click()');
  await until('document.querySelectorAll(".directory-project-row.selected").length === 3', 'page-scoped select all');
  assert.equal(await evaluate('document.querySelectorAll(".directory-project-row .directory-icon-selected").length'), 3);
  await capture('home-selected.png');
  await evaluate(`Array.from(document.querySelectorAll('.directory-bulk-bar button')).find(button=>button.textContent.includes('Remove from list')).click()`);
  await until('document.querySelectorAll(".project-removal-options button").length === 3', 'bulk removal retention choices');
  await evaluate('document.querySelector(".project-removal-options button").click()');
  await until('document.querySelector(".directory-pagination [aria-current=page]").textContent === "6" && document.querySelectorAll(".directory-project-row").length === 10', 'last-page removal clamps pagination');
  await evaluate('document.querySelector(".directory-page-previous").click()');
  await until('document.querySelector(".directory-pagination [aria-current=page]").textContent === "5"', 'previous page');
  assert.equal(await evaluate('!!document.querySelector(".directory-bulk-bar")'), false);
  await search('NICA');
  await until('document.querySelectorAll(".directory-project-row").length === 1', 'project search resets pagination');
  assert.ok(await evaluate('document.querySelector(".directory-project-row").textContent.includes("NICA")'));
  assert.equal(await evaluate('!!document.querySelector(".directory-pagination")'), false);
  assert.equal(await evaluate('document.querySelector(".directory-project-list").scrollTop'), 0);
  await search('');
  await until('document.querySelectorAll(".directory-project-row").length === 10', 'clear search');
  assert.equal(await evaluate('document.querySelector(".directory-pagination [aria-current=page]").textContent'), '1');
  await evaluate('document.querySelectorAll(".directory-tabs button")[1].click()');
  await until('document.querySelectorAll(".directory-project-row").length === 1', 'pinned filter');
  await evaluate('document.querySelectorAll(".directory-tabs button")[2].click()');
  await until('document.querySelectorAll(".directory-project-row").length === 1', 'favorites filter');
  await evaluate('document.querySelectorAll(".directory-tabs button")[3].click()');
  await until('document.querySelectorAll(".directory-project-row").length === 0', 'empty recent filter');
  await evaluate('document.querySelectorAll(".directory-tabs button")[0].click()');
  await until('document.querySelectorAll(".directory-project-row").length === 10', 'all projects');
  await evaluate('document.querySelector(".directory-sort-trigger").click()');
  await until('!!document.querySelector(".directory-sort-options [role=menuitemradio]")', 'sort options');
  await evaluate(`Array.from(document.querySelectorAll('.directory-sort-options [role=menuitemradio]')).find(button => button.textContent.trim() === 'Name').click()`);
  await until('document.querySelector(".directory-sort-trigger")?.textContent.includes("Name")', 'sort selection');
  const name = await evaluate('document.querySelector(".directory-project-row .directory-name-text strong").textContent');
  await evaluate('document.querySelector(".directory-direction").click()');
  await until(`document.querySelector('.directory-project-row .directory-name-text strong').textContent === ${JSON.stringify(name)}`, 'pinned project remains first when sorting');
  assert.equal(await evaluate('document.querySelector(".directory-pagination [aria-current=page]").textContent'), '1');
  page.unmaximize(); page.setContentSize(960,720); await delay(150);
  assert.ok(await evaluate('window.innerWidth <= 1000'), 'compact viewport actually applied');
  measurements = await geometry(); assert.ok(measurements.overflow < 2); assert.ok(measurements.aligned < 2);
  assert.equal(measurements.topbarOverlap,false);
  await capture('home-compact.png');
  await evaluate(`window.latexEditor.settings.set('theme','dark')`);
  await refresh();
  await until('document.documentElement.dataset.theme === "dark"', 'dark theme');
  await capture('home-dark.png');
  assert.deepEqual(errors, []);
  console.log('PASS project size, compact rows, icons, ten-project pagination, native scrolling, page-scoped selection, filters, search, sorting and narrow layout');
  console.log(`Artifacts: ${root}`);
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(()=>app.exit(0)).catch(error=>{console.error(error);console.error(`Artifacts: ${root}`);app.exit(1);});
});
