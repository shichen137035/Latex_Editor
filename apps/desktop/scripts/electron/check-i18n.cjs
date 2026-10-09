const { app, BrowserWindow, dialog } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-i18n-"));
const projects = join(root, "projects"); mkdirSync(projects);
app.setPath("userData", join(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
const errors = [];
let page;
const evaluate = async script => {
  try { return await page.webContents.executeJavaScript(script, true); }
  catch (error) { throw new Error(`${error.message}\nScript: ${script}\n${errors.join('\n')}`); }
};
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
async function until(script, label) {
  for (let i = 0; i < 300; i++) { assert.deepEqual(errors, []); if (await evaluate(script)) return; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
async function press(keyCode, modifiers = []) {
  page.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  page.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}
async function choose(selector, value) {
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('change', {bubbles:true})); })()`);
}
async function manager(section, label) {
  await evaluate(`document.querySelector('[data-section=${JSON.stringify(section)}]').click(); document.querySelectorAll('.settings-level-switch button')[1].click()`);
  await until(`!!document.querySelector('.settings-manager-entry-open[aria-label=${JSON.stringify(label)}]')`, label);
  await evaluate(`document.querySelector('.settings-manager-entry-open[aria-label=${JSON.stringify(label)}]').click()`);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', 'directory');
  const project = await evaluate(`window.latexEditor.projects.create({name:"Authored project",parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  await evaluate(`window.latexEditor.settings.set('locale','zh-CN')`);
  await evaluate(`window.latexEditor.settings.set('layout',{mode:'single',singlePane:'preview',leftPane:'preview',rightPane:'pdf'},${id})`);
  const source = '\\documentclass{article}\n\\begin{document}\n\\section{Authored English heading}\nAuthored body.\n\\begin{theorem}[Authored theorem title]\nA claim.\n\\end{theorem}\n\\appendix\n\\end{document}\n';
  await evaluate(`window.latexEditor.files.write(${id},'main.tex',${JSON.stringify(source)})`);
  page.reload(); await until('document.querySelector(".directory-heading")?.textContent.includes("项目")', 'Chinese home');
  assert.ok(await evaluate(`document.body.textContent.includes('v0.6.5')`));
  await evaluate(`document.querySelector('.directory-new-main').click()`);
  await until('!!document.querySelector(".resource-picker select")', 'new project presets');
  assert.deepEqual(await evaluate('Array.from(document.querySelector(".resource-picker select").options).map(option => option.textContent)'), ['默认', '空白', '精简']);
  await evaluate(`document.querySelector('.project-creation-card .close-button').click()`);
  await evaluate(`document.querySelector('.directory-project-row').click()`); page.focus();
  await until(`document.querySelector('.structured-preview [data-environment="theorem"]')?.textContent.includes('定理')`, 'Chinese preview labels');
  assert.ok(await evaluate(`document.querySelector('.structured-preview').textContent.includes('Authored English heading') && document.querySelector('.structured-preview').textContent.includes('Authored theorem title')`));
  console.log('PASS Chinese home, presets, version and Preview; authored text remains unchanged');
  await press(',', ['control']); await until('!!document.querySelector(".preferences-body")', 'settings');
  await manager('projectBuild', '块环境管理器');
  await until('!!document.querySelector(".environment-manager-page")', 'block manager');
  await evaluate(`document.querySelector('.environment-catalog-list [data-environment-id="theorem"]').click()`);
  await until(`document.querySelector('.environment-editor-title h2')?.textContent === '定理'`, 'translated theorem name');
  assert.ok(await evaluate(`document.querySelector('.environment-detail-scroll, .environment-definition-editor, .environment-editor')?.textContent.includes('标题字体') ?? document.querySelector('.environment-manager-page').textContent.includes('标题字体')`));
  await delay(250);
  writeFileSync(join(root, 'block-manager-zh.png'), (await page.webContents.capturePage()).toPNG());
  await evaluate(`document.querySelector('.settings-manager-return').click()`);
  await manager('projectBuild', '样式资源管理器');
  await until(`document.querySelector('.style-resource-list')?.textContent.includes('默认') && document.querySelector('.style-resource-detail')?.textContent.includes('学术写作')`, 'style manager data');
  assert.ok(await evaluate(`document.querySelector('.style-resource-list').textContent.includes('默认') && document.querySelector('.style-resource-detail').textContent.includes('学术写作')`));
  await evaluate(`document.querySelector('.settings-manager-return').click()`);
  await evaluate(`document.querySelector('[data-section="general"]').click(); document.querySelectorAll('.settings-level-switch button')[0].click()`);
  await until(`!!document.querySelector('[data-setting="locale"] select')`, 'language preference');
  await choose('[data-setting="locale"] select', 'en');
  await until(`document.querySelector('.structured-preview [data-environment="theorem"]')?.textContent.includes('Theorem')`, 'live English preview');
  await choose('[data-setting="locale"] select', 'zh-CN');
  await until(`document.querySelector('.structured-preview [data-environment="theorem"]')?.textContent.includes('定理')`, 'live Chinese preview');
  await evaluate(`document.querySelector('.settings-close').click()`);
  console.log('PASS managers and live language switching refresh memoized Preview labels');

  let saveOptions;
  dialog.showSaveDialog = async (...args) => { saveOptions = args.at(-1); return { canceled: true }; };
  await evaluate(`window.latexEditor.exports.mainTex(${id},'main.tex')`);
  assert.equal(saveOptions.title, '导出主 TeX 文件'); assert.equal(saveOptions.filters[0].name, 'TeX 源文件');
  await evaluate(`document.querySelector('.activity-bar button[title="文献库"]').click()`);
  await until('!!document.querySelector(".reference-quick-panel")', 'reference tool');
  assert.ok(await evaluate(`document.querySelector('.reference-quick-panel').textContent.includes('当前项目')`));
  console.log('PASS native export labels and project reference tools are localized');
  assert.deepEqual(errors, []);
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => { console.log(`Artifacts: ${root}`); app.exit(0); }).catch(error => { console.error(error); console.error(`Artifacts: ${root}`); app.exit(1); });
});
