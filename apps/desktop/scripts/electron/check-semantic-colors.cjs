const { app, BrowserWindow } = require('electron');
const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const root = mkdtempSync(join(tmpdir(), 'texweave-colors-'));
const projects = join(root, 'projects'); mkdirSync(projects);
app.setPath('userData', join(root, 'profile'));
let page;
const errors = [], delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.on('web-contents-created', (_event, contents) => contents.on('console-message', ({ level, message }) => {
  if ((level === 'error' || level === 3) && !message.includes('Canceled: Canceled')) errors.push(message);
}));
const evaluate = async script => { try { return await page.webContents.executeJavaScript(script, true); } catch (error) { throw new Error(`Evaluation failed: ${script}\n${errors.join("\n")}`, { cause: error }); } };
async function until(script, name) {
  for (let i = 0; i < 200; i++) { assert.deepEqual(errors, []); if (await evaluate(script)) return; await delay(50); }
  throw new Error(`Timed out: ${name}`);
}
async function reopen(theme) {
  if (await evaluate('!!document.querySelector(".workbench")')) {
    await evaluate('document.querySelector(".logo-button").click()');
    await until('!!document.querySelector(".directory-project-row")', 'close project before reload');
  }
  await evaluate(`window.latexEditor.settings.set('theme',${JSON.stringify(theme)})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', 'directory');
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector("[data-environment=customfixed]") && !!document.getElementById("texweave-adaptive-colors")', 'colored preview');
  await delay(150);
}
async function colors() {
  return evaluate(`(() => {
    const sample = id => { const block = document.querySelector('[data-environment="'+id+'"]'); const label = block.querySelector('.preview-environment-label'); const styles = getComputedStyle(block); return { accent: styles.getPropertyValue('--block-accent').trim(), label: getComputedStyle(label).color, background: getComputedStyle(label).backgroundColor }; };
    const directive = document.querySelector('.preview-directive');
    const fixed = document.querySelector('[data-environment="customfixed"]');
    return { algorithm: sample('algorithm'), custom: sample('customadaptive'), fixed: sample('customfixed'), fixedBody: getComputedStyle(fixed.querySelector('.preview-block-body')).color, fixedFill: getComputedStyle(fixed).backgroundColor, directive: directive ? getComputedStyle(directive).getPropertyValue('--directive-color').trim() : null };
  })()`);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!window.latexEditor && !!document.querySelector(".project-directory-v044")', 'app ready');
  const project = await evaluate(`window.latexEditor.projects.create({name:'Colors',parentPath:${JSON.stringify(projects)}})`);
  const id = JSON.stringify(project.id);
  const style = { accentToken: '#12a080', fillToken: '#ffffff', borderToken: '#b5d3cd', selectedBorderToken: '#12a080', labelBackgroundToken: '#ddf3ed', labelTextToken: '#125840' };
  const environment = (name, mode) => ({ id: name, family: 'generic', enabled: true, builtIn: false, label: name, labelKey: "", match: { kind: 'latex-environment', name }, style: { ...style, baseColor: '#12a080', colorMode: mode }, behavior: { inlineEditable: true, allowChildren: true, showHeader: true, showLabel: false } });
  const catalog = require('../../../../resources/environments/preview-environments.json');
  const builtIns = catalog.previewEnvironments.map(item => ({ ...item, enabled: true, builtIn: true, labelKey: 'environment.' + item.id, style: { ...catalog.defaultStyle, ...catalog.familyStyles[item.family], ...item.style }, behavior: { ...catalog.defaultBehavior, ...item.behavior } }));
  await evaluate(`window.latexEditor.settings.set('environments',${JSON.stringify([...builtIns, environment('customadaptive', 'adaptive'), environment('customfixed', 'fixed')])},${id})`);
  await evaluate(`window.latexEditor.settings.set('layout',{mode:'single',singlePane:'preview',leftPane:'preview',rightPane:'pdf'},${id})`);
  const source = '\\documentclass{article}\n\\begin{document}\n\\section{Colors}\n\\begin{algorithm}\n\\State Example\n\\end{algorithm}\n\\begin{customadaptive}Adaptive block\\end{customadaptive}\n\\begin{customfixed}Fixed block\\end{customfixed}\n\\newpage\n\\end{document}\n';
  await evaluate(`window.latexEditor.files.write(${id},'main.tex',${JSON.stringify(source)})`);
  await reopen('light'); const light = await colors();
  await reopen('dark'); const dark = await colors();
  assert.notEqual(light.algorithm.accent, dark.algorithm.accent);
  assert.notEqual(light.custom.label, dark.custom.label);
  assert.deepEqual(light.fixed, dark.fixed);
  const luminosity = color => {
    const rgb = color.match(/[\d.]+/g).slice(0, 3).map(n => Number(n) / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const bodyLight = luminosity(dark.fixedBody), fillLight = luminosity(dark.fixedFill);
  assert.ok((Math.max(bodyLight, fillLight) + .05) / (Math.min(bodyLight, fillLight) + .05) >= 4.45, 'fixed white surface retains readable body text in dark theme');
  assert.notEqual(light.directive, dark.directive);
  writeFileSync(join(root, 'dark.png'), (await page.webContents.capturePage()).toPNG());
  const themePath = join(root, 'Rose.css');
  writeFileSync(themePath, ':root { --color-bg-panel:#fff0f6; --color-bg-app:#fce6f0; --color-text-primary:#392335; --semantic-label-mix:.18; }');
  const [theme] = await evaluate(`window.latexEditor.themes.importFiles([${JSON.stringify(themePath)}])`);
  await reopen(theme.id); const rose = await colors();
  assert.notEqual(rose.custom.background, light.custom.background);
  assert.deepEqual(rose.fixed, light.fixed);
  await evaluate(`window.latexEditor.settings.set('themeColorProfiles',{${JSON.stringify(theme.id)}:{labelMix:.35}})`);
  await reopen(theme.id); const customized = await colors();
  assert.notEqual(customized.custom.background, rose.custom.background);
  writeFileSync(join(root, 'rose.png'), (await page.webContents.capturePage()).toPNG());
  page.focus();
  page.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['control'] });
  page.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: ['control'] });
  await until('!!document.querySelector(".preferences-body")', 'settings');
  await evaluate(`document.querySelector('[data-section="appearance"]').click(); document.querySelectorAll('.settings-level-switch button')[1].click()`);
  await until('!!document.querySelector(".settings-manager-entry-open")', 'theme manager entry');
  await evaluate('document.querySelector(".settings-manager-entry-open").click()');
  await until('document.querySelectorAll(".theme-color-settings input").length === 6', 'theme color controls');
  await evaluate(`(() => {
    const input = document.querySelectorAll('.theme-color-settings input')[4];
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '20');
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await evaluate(`document.querySelectorAll('.theme-color-settings input')[4].focus(); document.querySelector('.theme-color-settings select').focus()`);
  await until(`getComputedStyle(document.querySelector('[data-environment="customadaptive"] .preview-environment-label')).backgroundColor !== ${JSON.stringify(customized.custom.background)}`, 'parameter applies without closing manager');
  await evaluate(`Array.from(document.querySelectorAll('.theme-catalog-row')).find(row => row.querySelector('strong').textContent === 'Dark').querySelector('button').click()`);
  await until(`document.documentElement.dataset.theme === 'dark' && document.querySelectorAll('.theme-color-settings input')[4].value === '14'`, 'theme switching restores per-theme defaults');
  writeFileSync(join(root, 'settings.png'), (await page.webContents.capturePage()).toPNG());
  await evaluate(`window.latexEditor.themes.remove(${JSON.stringify(theme.id)})`);
  await evaluate(`document.querySelector('.settings-manager-return').click()`);
  await until('!!document.querySelector(".settings-dialog-header")', 'return to settings');
  await evaluate(`document.querySelector('.settings-dialog-header .settings-close').click()`);
  const tokenFixed = environment('customfixed', 'fixed'); tokenFixed.style.fillToken = '--env-definition-fill';
  await evaluate(`window.latexEditor.settings.set('environments',${JSON.stringify([...builtIns, environment('customadaptive', 'adaptive'), tokenFixed])},${id})`);
  await reopen('light');
  await reopen('dark');
  const tokenColors = await colors(), tokenText = luminosity(tokenColors.fixedBody), tokenFill = luminosity(tokenColors.fixedFill);
  assert.ok((Math.max(tokenText, tokenFill) + .05) / (Math.min(tokenText, tokenFill) + .05) >= 4.45, 'explicit CSS variable fill resolves after theme role update');
  for (const managerTheme of ['dark', 'tech-dark']) {
    await reopen(managerTheme);
    page.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['control'] });
    page.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: ['control'] });
    await until('!!document.querySelector(".preferences-body")', 'manager settings');
    await evaluate(`document.querySelector('[data-section="projectBuild"]').click(); document.querySelectorAll('.settings-level-switch button')[1].click()`);
    await until('!!document.querySelector("[data-manager=blockEnvironments]")', 'block manager entry');
    await evaluate('document.querySelector("[data-manager=blockEnvironments]").click()');
    await until('!!document.querySelector(".environment-catalog-toolbar")', 'block manager');
    for (const selector of ['.environment-catalog-toolbar', '.environment-catalog-search input', '.environment-catalog-filters select', '.environment-editor', '.environment-form-grid input', '.color-token-picker', '.environment-preview-sample-button']) {
      const background = await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).backgroundColor`);
      assert.ok(luminosity(background) < .25, `${managerTheme} ${selector} must not retain a light background: ${background}`);
    }
    writeFileSync(join(root, `manager-${managerTheme}.png`), (await page.webContents.capturePage()).toPNG());
    await evaluate('document.querySelectorAll(".environment-manager-mode button")[1].click()');
    await until('!!document.querySelector(".environment-xml textarea")', 'XML editor');
    const xmlBackground = await evaluate('getComputedStyle(document.querySelector(".environment-xml textarea")).backgroundColor');
    assert.ok(luminosity(xmlBackground) < .25, `${managerTheme} XML editor must use a dark surface`);
    await evaluate('document.querySelector(".settings-manager-return").click()');
    await until('!!document.querySelector(".settings-dialog-header")', 'return from block manager');
    await evaluate('document.querySelector(".settings-dialog-header .settings-close").click()');
  }
  assert.deepEqual(errors, []);
  console.log('PASS light/dark/custom adaptation, fixed colors, commands, live parameter editing and theme switching in manager');
  console.log(`Artifacts: ${root}`);
}
app.whenReady().then(() => { require('../../dist/main/index.js'); run().then(() => app.exit(0)).catch(error => { console.error(error); console.error(`Artifacts: ${root}`); app.exit(1); }); });
