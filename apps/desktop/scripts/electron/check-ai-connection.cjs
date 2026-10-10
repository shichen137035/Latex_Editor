// Real Electron IPC + renderer + Codex handshake; never opens an authentication flow.
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const labels = require("../../src/renderer/i18n/locales/en.json");
const root = mkdtempSync(join(tmpdir(), "texweave-ai-connection-"));
const projects = join(root, "projects");
mkdirSync(projects);
app.setPath("userData", join(root, "profile"));
let page;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const rendererErrors = [];
app.on("web-contents-created", (_event, contents) => {
  contents.on("console-message", details => {
    if (details.level === "error" || details.level === 3) rendererErrors.push(`${details.sourceId ?? "renderer"}:${details.lineNumber ?? 0} ${details.message}`);
  });
  contents.on("render-process-gone", (_event, details) => rendererErrors.push(`renderer process exited: ${JSON.stringify(details)}`));
});
const evaluate = async script => {
  try { return await page.webContents.executeJavaScript(script, true); }
  catch (error) { throw new Error(`Renderer evaluation failed: ${script}\n${rendererErrors.join("\n")}`, { cause: error }); }
};
async function until(expression, label) {
  for (let i = 0; i < 150; i++) {
    if (await evaluate(expression)) return;
    await delay(100);
  }
  const diagnostics = await evaluate(`(() => ({
    title: document.title,
    body: document.body?.innerText?.slice(-1800) ?? '',
    modes: Array.from(document.querySelectorAll('.ai-mode-switch [role="tab"]')).map(button => ({ text: button.textContent.trim(), selected: button.getAttribute('aria-selected'), disabled: button.disabled })),
    status: document.querySelector('.ai-connect-card')?.innerText ?? '',
    cli: document.querySelector('.ai-cli-path')?.innerText ?? '',
    error: document.querySelector('.ai-error')?.innerText ?? '',
  }))()`);
  throw new Error(`Timed out: ${label}\nUI diagnostics: ${JSON.stringify(diagnostics, null, 2)}\nRenderer errors: ${rendererErrors.join("\n") || "none"}`);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(100);
  page = BrowserWindow.getAllWindows()[0];
  await until("!!window.latexEditor && !!document.querySelector('.directory-main')", "project directory");
  const detected = await evaluate("window.latexEditor.ai.detect()");
  assert.ok(detected.executablePath, detected.error);
  assert.notEqual(detected.process, "not_detected");
  console.log("PASS renderer IPC: discovers Codex without the IDE's private PATH");
  await evaluate(`window.latexEditor.projects.create({name:'AI connection check',parentPath:${JSON.stringify(projects)}})`);
  page.reload();
  await until("!!document.querySelector('.directory-project-row')", "test project list");
  await evaluate("document.querySelector('.directory-project-row').click()");
  await until("!!document.querySelector('.activity-bar')", "workbench");
  await until(`Array.from(document.querySelectorAll('.activity-bar button')).some(button => button.title.startsWith(${JSON.stringify(labels["activity.ai"])}))`, "AI activity button");
  await evaluate(`Array.from(document.querySelectorAll('.activity-bar button')).find(button => button.title.startsWith(${JSON.stringify(labels["activity.ai"])})).click()`);
  await until("!!document.querySelector('.ai-mode-switch [role=\"tab\"]')", "AI mode selector");
  await evaluate(`Array.from(document.querySelectorAll('.ai-mode-switch [role="tab"]')).find(button => button.textContent.trim() === ${JSON.stringify(labels["ai.codex"])}).click()`);
  await until(`Array.from(document.querySelectorAll('.ai-mode-switch [role="tab"]')).some(button => button.textContent.trim() === ${JSON.stringify(labels["ai.codex"])} && button.getAttribute('aria-selected') === 'true')`, "Codex mode");
  await until("!!document.querySelector('.ai-cli-path') && !!document.querySelector('.ai-connect-card .primary-button:not(:disabled)')", "AI sign-in button");
  let connected = await evaluate("window.latexEditor.ai.status()");
  assert.equal(connected.process, "running");
  assert.equal(connected.auth, "signed_out");
  assert.equal(await evaluate("document.querySelector('.ai-error')?.textContent ?? ''"), "");
  console.log("PASS fresh profile: App Server initialize + account/read returns running / signed_out");
  await evaluate("document.querySelector('.ai-recheck').click()");
  await delay(50);
  await until("!document.querySelector('.ai-recheck').disabled", "retry completed");
  connected = await evaluate("window.latexEditor.ai.status()");
  assert.equal(connected.process, "running");
  assert.equal(await evaluate("document.querySelector('.ai-connect-card > strong').textContent"), labels["ai.connectTitle"]);
  assert.equal(await evaluate("document.querySelector('.ai-error')?.textContent ?? ''"), "");
  console.log("PASS Check again: stays connected and shows the ChatGPT sign-in card");
  const bounds = await evaluate("(() => { const r=document.querySelector('.ai-sidebar').getBoundingClientRect(); return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)}; })()");
  writeFileSync(join(root, "ai-connected.png"), (await page.webContents.capturePage(bounds)).toPNG());
  console.log("Screenshot:", join(root, "ai-connected.png"));
}
require("../../dist/main/index.js");
const timeout = setTimeout(() => { console.error("AI connection check timed out"); finish(1); }, 60000);
function finish(code) {
  clearTimeout(timeout);
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  app.exit(code);
}
app.whenReady().then(run).then(() => finish(0)).catch(error => { console.error(error.stack ?? error); if (rendererErrors.length) console.error("Renderer diagnostics:\n" + rendererErrors.join("\n")); console.error("Test profile:", root); finish(1); });
