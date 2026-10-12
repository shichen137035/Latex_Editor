const { app, BrowserWindow, dialog } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const assert = require("node:assert/strict");
const expectedVersion = require("../../../../package.json").version;
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
async function fill(selector, value) {
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', {bubbles:true})); })()`);
}
async function assertLanguageChoices(selector) {
  assert.deepEqual(await evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options).map(option => [option.value, option.textContent])`), [
    ['en', 'English'], ['ja', '日本語'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['ko', '한국어'], ['fr', 'Français']
  ]);
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
  await until(`document.querySelector('[data-app-version]')?.textContent === ${JSON.stringify("v" + expectedVersion)}`, 'home version from root package');
  assert.equal((await evaluate('window.latexEditor.app.info()')).version, expectedVersion);
  await evaluate(`document.querySelector('.directory-new-main').click()`);
  await until('!!document.querySelector(".style-picker-entry")', 'new project style selector');
  await evaluate('document.querySelector(".style-picker-entry").click()');
  await until('!!document.querySelector(".style-selector")', 'style selector dialog');
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".style-selector-item strong")).map(option => option.textContent)'), ['默认', '空白', '精简']);
  await evaluate('document.querySelector(".style-selector footer button").click()');
  await evaluate(`document.querySelector('.project-creation-card .close-button').click()`);
  await evaluate(`document.querySelector('.directory-project-row').click()`); page.focus();
  await until(`document.querySelector('.structured-preview [data-environment="theorem"]')?.textContent.includes('Theorem')`, 'fixed English names by default');
  assert.ok(await evaluate(`document.querySelector('.structured-preview .preview-directive-label')?.textContent === 'Appendix begins'`));
  await evaluate(`window.latexEditor.settings.set('fixedBlockNameLanguage',false)`);
  await until(`document.querySelector('.structured-preview [data-environment="theorem"]')?.textContent.includes('定理')`, 'Chinese preview labels');
  assert.ok(await evaluate(`document.querySelector('.structured-preview').textContent.includes('Authored English heading') && document.querySelector('.structured-preview').textContent.includes('Authored theorem title')`));
  console.log('PASS Chinese home, presets, version and Preview; authored text remains unchanged');
  await press(',', ['control']); await until('!!document.querySelector(".preferences-body")', 'settings');
  await manager('projectBuild', '块环境管理器');
  await until('!!document.querySelector(".environment-manager-page")', 'block manager');
  await evaluate(`document.querySelector('.environment-catalog-list [data-environment-id="theorem"]').click()`);
  await until(`document.querySelector('.environment-editor-title h2')?.textContent === '定理'`, 'translated theorem name');
  assert.equal(await evaluate(`document.querySelector('[name="localizedNameLocale"]').value`), 'zh-CN');
  await assertLanguageChoices('[name="localizedNameLocale"]');
  await fill('[name="localizedName"]', '本地定理');
  await until(`document.querySelector('.environment-editor-title h2')?.textContent === '本地定理'`, 'Chinese name override');
  await choose('[name="localizedNameLocale"]', 'en');
  assert.equal(await evaluate(`document.querySelector('[name="localizedName"]').value`), 'Theorem');
  await fill('[name="localizedName"]', 'Claim');
  await until(`document.querySelector('[name="localizedName"]').value === 'Claim'`, 'English name override');
  assert.equal(await evaluate(`document.querySelector('.environment-editor-title h2').textContent`), '本地定理');
  await evaluate(`document.querySelector('.environment-manager-toolbar-controls button.primary').click()`);
  await until(`document.querySelector('[name="localizedName"]').value === '自定义 1'`, 'new custom name uses interface language');
  await fill('[name="localizedName"]', '');
  await until(`document.querySelector('[name="localizedName"]').value === '' && document.querySelector('.environment-editor-title h2').textContent === 'custom-1'`, 'empty custom key has safe ID fallback');
  await choose('[name="localizedNameLocale"]', 'en');
  await fill('[name="localizedName"]', 'Custom block');
  await until(`document.querySelector('.environment-editor-title h2').textContent === 'Custom block'`, 'custom English fallback');
  await choose('[name="localizedNameLocale"]', 'zh-CN');
  assert.ok(await evaluate(`document.querySelector('[name="localizedName"]').value === '' && document.querySelector('[name="localizedName"]').placeholder === 'Custom block'`));
  await evaluate(`Array.from(document.querySelectorAll('.environment-manager-mode button')).find(button => button.textContent.includes('XML')).click()`);
  await until(`document.querySelector('.environment-xml textarea')?.value.includes('<name locale="en" value="Claim" />')`, 'localized names in XML');
  assert.ok(await evaluate(`document.querySelector('.environment-xml textarea').value.includes('<name locale="zh-CN" value="" />')`));
  await evaluate(`document.querySelector('.environment-xml button.primary').click()`);
  await evaluate(`document.querySelector('.environment-manager-mode button').click()`);
  await evaluate(`document.querySelector('.environment-catalog-list [data-environment-id="theorem"]').click()`);
  await until(`document.querySelector('[name="localizedName"]').value === '本地定理'`, 'XML roundtrip restores language names');
  assert.ok(await evaluate(`document.querySelector('.environment-detail-scroll, .environment-definition-editor, .environment-editor')?.textContent.includes('标题字体') ?? document.querySelector('.environment-manager-page').textContent.includes('标题字体')`));
  await delay(250);
  writeFileSync(join(root, 'block-manager-zh.png'), (await page.webContents.capturePage()).toPNG());
  await evaluate(`document.querySelector('.settings-manager-return').click()`);
  await manager('projectBuild', '预览命令管理器');
  await until(`document.querySelector('.directive-editor-heading h2')?.textContent === '附录开始'`, 'directive manager');
  await assertLanguageChoices('[name="localizedNameLocale"]');
  assert.equal(await evaluate(`document.querySelector('[name="localizedNameLocale"]').value`), 'zh-CN');
  await fill('[name="localizedName"]', '补充资料');
  await until(`document.querySelector('.directive-editor-heading h2')?.textContent === '补充资料'`, 'Chinese command name');
  await choose('[name="localizedNameLocale"]', 'en');
  await fill('[name="localizedName"]', 'Supplement');
  await until(`document.querySelector('[name="localizedName"]').value === 'Supplement'`, 'English command name');
  await evaluate(`document.querySelector('.directive-add').click()`);
  await until(`document.querySelector('[name="localizedName"]').value === '自定义命令'`, 'custom command name uses interface language');
  await fill('[name="localizedName"]', '');
  await until(`document.querySelector('.directive-editor-heading h2').textContent === 'custom-command-1'`, 'blank custom command name falls back safely');
  await choose('[name="localizedNameLocale"]', 'en');
  await fill('[name="localizedName"]', 'Custom marker');
  await until(`document.querySelector('.directive-editor-heading h2').textContent === 'Custom marker'`, 'command English fallback');
  await choose('[name="localizedNameLocale"]', 'zh-CN');
  assert.ok(await evaluate(`document.querySelector('[name="localizedName"]').value === '' && document.querySelector('[name="localizedName"]').placeholder === 'Custom marker'`));
  await delay(250);
  writeFileSync(join(root, 'command-manager-zh.png'), (await page.webContents.capturePage()).toPNG());
  await evaluate(`document.querySelector('.settings-manager-return').click()`);
  await manager('projectBuild', '样式资源管理器');
  await until(`document.querySelector('.style-resource-list')?.textContent.includes('默认') && document.querySelector('.style-resource-detail')?.textContent.includes('学术写作')`, 'style manager data');
  assert.ok(await evaluate(`document.querySelector('.style-resource-list').textContent.includes('默认') && document.querySelector('.style-resource-detail').textContent.includes('学术写作')`));
  await evaluate(`document.querySelector('.settings-manager-return').click()`);
  await evaluate(`document.querySelector('[data-section="general"]').click(); document.querySelectorAll('.settings-level-switch button')[0].click()`);
  await until(`!!document.querySelector('[data-setting="locale"] select')`, 'language preference');
  await assertLanguageChoices('[data-setting="locale"] select');
  await assertLanguageChoices('[data-setting="blockNameLanguage"] select');
  await choose('[data-setting="locale"] select', 'en');
  await assertLanguageChoices('[data-setting="locale"] select');
  await assertLanguageChoices('[data-setting="blockNameLanguage"] select');
  await until(`document.querySelector('.structured-preview [data-environment="theorem"]')?.textContent.includes('Claim') && document.querySelector('.structured-preview .preview-directive-label')?.textContent === 'Supplement'`, 'live English preview');
  await choose('[data-setting="locale"] select', 'zh-CN');
  await until(`document.querySelector('.structured-preview [data-environment="theorem"]')?.textContent.includes('本地定理') && document.querySelector('.structured-preview .preview-directive-label')?.textContent === '补充资料'`, 'live Chinese preview');
  await evaluate(`document.querySelector('[data-setting="fixedBlockNameLanguage"] input').click()`);
  await until(`document.querySelector('.structured-preview [data-environment="theorem"]')?.textContent.includes('Claim') && document.querySelector('.structured-preview .preview-directive-label')?.textContent === 'Supplement'`, 'fixed English affects both types immediately');
  await choose('[data-setting="blockNameLanguage"] select', 'zh-CN');
  await until(`document.querySelector('.structured-preview [data-environment="theorem"]')?.textContent.includes('本地定理') && document.querySelector('.structured-preview .preview-directive-label')?.textContent === '补充资料'`, 'fixed Chinese affects both types immediately');
  await choose('[data-setting="locale"] select', 'en');
  await until(`document.documentElement.lang === 'en'`, 'English UI');
  assert.ok(await evaluate(`document.querySelector('.structured-preview [data-environment="theorem"]').textContent.includes('本地定理') && document.querySelector('.structured-preview .preview-directive-label').textContent === '补充资料'`));
  await choose('[data-setting="locale"] select', 'zh-CN');
  await evaluate(`document.querySelector('.settings-close').click()`);
  console.log('PASS per-language names, XML roundtrip and live display-language rules for environments and directives');
  await evaluate(`document.querySelector('.workbench-topbar .logo-button').click()`);
  await until(`!!document.querySelector('.directory-project-row')`, 'close document session before reload');
  await until(`document.querySelector('[data-app-version]')?.textContent === ${JSON.stringify("v" + expectedVersion)}`, 'home version after leaving project');
  page.reload();
  await until(`!!document.querySelector('.directory-project-row')`, 'directory after reload');
  await evaluate(`document.querySelector('.directory-project-row').click()`);
  await until(`document.querySelector('.structured-preview [data-environment="theorem"]')?.textContent.includes('本地定理') && document.querySelector('.structured-preview .preview-directive-label')?.textContent === '补充资料'`, 'names and display rule survive reload');

  let saveOptions;
  dialog.showSaveDialog = async (...args) => { saveOptions = args.at(-1); return { canceled: true }; };
  await evaluate(`window.latexEditor.exports.mainSourceArchive(${id})`);
  assert.equal(saveOptions.title, '导出主文件相关源码'); assert.equal(saveOptions.filters[0].name, 'ZIP 压缩包');
  await evaluate(`document.querySelector('.activity-bar button[title^="文献库"]').click()`);
  await until('!!document.querySelector(".reference-quick-panel")', 'reference tool');
  assert.ok(await evaluate(`document.querySelector('.reference-quick-panel').textContent.includes('当前项目')`));
  console.log('PASS native export labels and project reference tools are localized');
  assert.deepEqual(errors, []);
}
app.whenReady().then(() => {
  require('../../dist/main/index.js');
  run().then(() => { console.log(`Artifacts: ${root}`); app.exit(0); }).catch(error => { console.error(error); console.error(`Artifacts: ${root}`); app.exit(1); });
});
