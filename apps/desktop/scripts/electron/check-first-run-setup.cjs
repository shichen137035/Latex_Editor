const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
const root = mkdtempSync(join(tmpdir(), "texweave-initial-setup-"));
mkdirSync(join(root, "profile"));
app.setPath("userData", join(root, "profile"));
app.setPath("sessionData", join(root, "profile"));
process.argv.push("--setup");

// Deterministic language downloads use the real dictionary installer and files.
let attempts = 0;
global.fetch = async input => {
  const url = String(input);
  if (url.includes("api.github.com/repos/wooorm/dictionaries/contents")) return Response.json([{ name: "fr", type: "dir" }]);
  if (url.endsWith("/readme.md")) return new Response("| [`dictionary-fr`](https://example.test) | French | MIT |\n");
  if (url.endsWith("/fr/index.aff")) return new Response("SET UTF-8\nTRY abcdefghijklmnopqrstuvwxyz\n");
  if (url.endsWith("/fr/index.dic")) return ++attempts === 1 ? new Response("Unavailable", { status: 503 }) : new Response("2\nbonjour\nmonde\n");
  throw new Error("Unexpected setup download: " + url);
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let page;
const evaluate = code => page.webContents.executeJavaScript(code, true);
async function until(code, label) {
  for (let i = 0; i < 300; i++) { if (await evaluate(code)) return; await delay(50); }
  throw new Error("Timed out: " + label + "\n" + await evaluate("document.body.innerText.slice(0, 3000)"));
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!document.querySelector(".first-run-setup") && !document.querySelector("[data-setup-next]").disabled', "first setup");
  assert.equal(await evaluate('!!document.querySelector(".directory-main").closest("[inert]")'), true);
  const styles = await evaluate("window.latexEditor.styleResources.list()");
  for (const id of ["default", "light", "empty"]) assert.ok(styles.some(item => item.id === id && item.source === "built-in"));
  await evaluate('document.querySelector("[data-setup-later]").click()');
  await until('!document.querySelector(".first-run-setup")', "remind next time");
  assert.equal((await evaluate("window.latexEditor.installation.state()")).setupCompletedAt, undefined);
  page.reload();
  await until('!!document.querySelector("[data-dictionary=fr]") && !document.querySelector("[data-setup-next]").disabled', "pending setup after restart");
  await evaluate('document.querySelector("[data-dictionary=fr]").click(); document.querySelector("[data-setup-next]").click()');
  await until('!!document.querySelector(".first-run-setup [role=alert]") && !document.querySelector("[data-setup-next]").disabled', "failed download");
  assert.equal(attempts, 1);
  assert.equal(await evaluate('document.querySelector("[data-dictionary=fr]").checked'), true);
  assert.equal((await evaluate("window.latexEditor.installation.state()")).setupCompletedAt, undefined);
  writeFileSync(join(root, "setup-languages.png"), (await page.webContents.capturePage()).toPNG());

  // Exercise the shared toolchain controls without installing tools on this host.
  let job = { supported: true, defaultDirectory: join(root, "TinyTeX"), directory: join(root, "TinyTeX"), phase: "idle", running: false, downloadedBytes: 0, totalBytes: 0, log: "" };
  for (const channel of ["toolchain:install-status", "toolchain:install", "toolchain:install-cancel"]) ipcMain.removeHandler(channel);
  ipcMain.handle("toolchain:install-status", () => job);
  let selectedPlan;
  ipcMain.handle("toolchain:install", (_event, directory, selection) => { selectedPlan = selection; job = { ...job, selection, directory, phase: "downloading", running: true, totalBytes: 100, downloadedBytes: 30 }; return job; });
  ipcMain.handle("toolchain:install-cancel", () => { job = { ...job, phase: "cancelled", running: false }; return job; });
  await evaluate('document.querySelector("[data-setup-next]").click()');
  await until('!!document.querySelector("[data-setup-finish]") && !!document.querySelector(".toolchain-install-panel button.primary:not(:disabled)")', "tools step after successful retry");
  assert.equal(attempts, 2);
  assert.equal(await evaluate('document.querySelector("[data-texlive-auto-install]").checked'), true);
  await evaluate('document.querySelector("[data-texlive-auto-install]").click()');
  await until('window.latexEditor.settings.get().then(value => value.global.texLiveAutoInstall === false)', "TeX Live automatic package setting persistence");
  assert.equal(await evaluate('document.querySelectorAll(".first-run-setup .environment-tool-row").length'), 7);
  assert.ok((await evaluate("window.latexEditor.spellcheck.status()")).availableLanguages.includes("fr"));
  await assert.rejects(() => evaluate('window.latexEditor.installation.completeSetup(["uninstalled-language"])'), /language|语言/);
  await evaluate('document.querySelector(".toolchain-install-options").open = true; document.querySelector("#latex-install-distribution").scrollIntoView({block: "center"})');
  assert.equal(await evaluate('document.querySelector("#latex-install-distribution").value'), "miktex");
  assert.equal(await evaluate('document.querySelector("[data-latex-full]").checked'), false);
  assert.equal(await evaluate('document.querySelectorAll("[data-latex-component]").length'), 5);
  await evaluate('document.querySelector("[data-latex-component=math]").click(); document.querySelector("[data-latex-component=chinese]").click()');
  await evaluate('document.querySelector("[data-latex-full]").click()');
  assert.equal(await evaluate('document.querySelector("[data-latex-component=tables]").disabled'), true);
  await evaluate('document.querySelector("[data-latex-full]").click()');
  await evaluate('document.querySelector(".toolchain-install-panel button.primary").click()');
  assert.equal(selectedPlan.distribution, "miktex");
  assert.deepEqual([...selectedPlan.components].sort(), ["chinese", "tables"]);
  assert.equal(selectedPlan.full, false);
  await until('document.querySelector("[data-setup-finish]").disabled && !!document.querySelector("progress")', "installation in progress");
  assert.equal(await evaluate('document.querySelector("[data-setup-later]").disabled'), true);
  await evaluate('document.querySelector(".toolchain-install-actions button:not(.primary)").click()');
  await until('!document.querySelector("[data-setup-finish]").disabled', "cancelled installation");
  assert.equal(await evaluate('document.querySelector("[data-latex-component=chinese]").disabled'), false);
  // Change the selected distribution through React's input event path.
  await evaluate(`(() => { const select = document.querySelector("#latex-install-distribution"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, "tinytex"); select.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  assert.equal(await evaluate('document.querySelector("#latex-install-distribution").value'), "tinytex");
  assert.equal(await evaluate('!!document.querySelector("[data-latex-auto]")'), false);
  await evaluate('document.querySelector(".toolchain-install-options").open = true; document.querySelector(".toolchain-install-components").scrollIntoView({block: "center"})');
  writeFileSync(join(root, "setup-tools.png"), (await page.webContents.capturePage()).toPNG());
  await evaluate('document.querySelector("[data-setup-finish]").click()');
  await until('!document.querySelector(".first-run-setup")', "completed setup");
  const state = JSON.parse(readFileSync(join(root, "profile/config/installation.json"), "utf8"));
  assert.ok(state.setupCompletedAt);
  assert.ok(state.setupDictionaryIds.includes("fr"));
  assert.ok((await evaluate("window.latexEditor.settings.get()")).global.spellCheckActiveLanguages.includes("fr"));
  process.argv.splice(process.argv.indexOf("--setup"), 1);
  page.reload();
  await until('!!document.querySelector(".directory-main")', "restart after setup");
  assert.equal((await evaluate("window.latexEditor.installation.setupStatus()")).required, false);
  assert.equal((await evaluate("window.latexEditor.settings.get()")).global.texLiveAutoInstall, false);
  assert.equal(await evaluate('!!document.querySelector(".first-run-setup")'), false);
  assert.ok((await evaluate("window.latexEditor.spellcheck.status()")).availableLanguages.includes("fr"));
  console.log("PASS first setup, reminder, real dictionary failure/retry and persistence, toolchain progress/cancel, completion and default styles");
  console.log("Artifacts: " + root);
}
require("../../dist/main/index.js");
app.whenReady().then(run).then(() => app.exit(0)).catch(error => { console.error(error); console.error(root); app.exit(1); });
