// Real Electron UI + project file/history operations; fake providers, isolated profile.
const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const root = mkdtempSync(join(tmpdir(), "texweave-ai-review-"));
const profile = join(root, "profile"), projects = join(root, "projects");
const storePath = join(profile, "ai", "conversations.json");
mkdirSync(projects); app.setPath("userData", profile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let page, project;
const changeSets = [];
const rendererErrors = [];
const evaluate = async script => {
  try { return await page.webContents.executeJavaScript(script, true); }
  catch (error) {
    const ui = await page.webContents.executeJavaScript("document.body?.innerText?.slice(-1200) ?? ''", true).catch(() => "unavailable");
    throw new Error(`Renderer evaluation failed: ${script}\nVisible UI: ${ui}\nRenderer errors: ${rendererErrors.join("\n") || "none"}`, { cause: error });
  }
};
async function until(expression, label = expression) {
  for (let i = 0; i < 180; i++) { if (await evaluate(expression)) return; await delay(60); }
  const state = await evaluate(`(() => ({
    panes: Array.from(document.querySelectorAll('.work-pane')).map(pane => pane.className),
    diff: document.querySelector('.ai-inline-diff-heading')?.innerText ?? '',
    changePaths: Array.from(document.querySelectorAll('.ai-change-path')).map(button => button.textContent.trim()),
    notice: document.querySelector('.block-notice')?.innerText ?? '',
    viewButtons: Array.from(document.querySelectorAll('.view-switch button')).map(button => ({ text: button.textContent.trim(), active: button.classList.contains('active') })),
  }))()`);
  throw new Error(`Timed out: ${label}\nUI state: ${JSON.stringify(state)}`);
}
function hunk(id, oldStart, oldText, newText) {
  const count = text => text.match(/[^\n]*\n|[^\n]+$/g)?.length ?? 0;
  return { id, oldStart, oldLines: count(oldText), newStart: oldStart, newLines: count(newText), oldText, newText, decision: "pending" };
}
const publish = changes => page.webContents.send("ai:update", { kind: "changes", payload: structuredClone(changes) });
const nativeHistory = () => JSON.parse(readFileSync(storePath, "utf8"));
function mock(channel, handler) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); }
const editorText = "document.querySelector('.editor-surface .monaco-editor')?.textContent?.replaceAll('\\u00a0',' ')";
const original = "\\documentclass{article}\n\\begin{document}\nOld A\n1\n2\n3\n4\n5\nOld B\n\\end{document}\n";
function blankPdf() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>', '<< /Length 0 >>\nstream\n\nendstream'];
  let pdf = '%PDF-1.4\n'; const offsets = [0];
  for (let index = 0; index < objects.length; index++) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  page.webContents.setBackgroundThrottling(false);
  page.webContents.on("console-message", details => {
    if (details.level === "error" || details.level === 3) rendererErrors.push(`${details.sourceId ?? "renderer"}:${details.lineNumber ?? 0} ${details.message}`);
  });
  page.webContents.on("render-process-gone", (_event, details) => rendererErrors.push(`renderer process exited: ${JSON.stringify(details)}`));
  page.on("show", () => page.hide()); page.hide();
  await until("!!window.latexEditor && !!document.querySelector('.directory-main')");
  for (const channel of ["ai:detect", "ai:status", "ai:copilot:status"]) mock(channel, () => ({ auth: "signed_in", process: "running", accountLabel: "Local UI test" }));
  for (const channel of ["ai:models", "ai:copilot:models"]) mock(channel, () => [{ id: "test", name: "Test model", isDefault: true, supportedReasoningEfforts: [{ effort: "high" }] }]);
  // Compiler behavior has dedicated checks; keep report UI checks independent of installed TeX and build duration.
  mock("compile:run", (_event, _projectId, mainFile = "main.tex") => {
    const pdf = blankPdf();
    writeFileSync(join(project.canonicalPath, mainFile.replace(/\.tex$/i, '.pdf')), pdf);
    return { compilationId: randomUUID(), status: "succeeded", exitCode: 0, startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(), durationMs: 0, mainFile, diagnostics: [], stdoutTail: "", stderrTail: "",
      pdfDataUrl: `data:application/pdf;base64,${pdf.toString('base64')}` };
  });
  mock("ai:conversations", (_event, projectId) => {
    const conversations = nativeHistory().conversations.filter(item => item.projectId === projectId);
    return { conversations, changeSets: changeSets.filter(item => conversations.some(chat => chat.id === item.conversationId)) };
  });
  mock("ai:change-set:applied", (_event, id, ids, error) => {
    const changes = changeSets.find(item => item.id === id);
    for (const file of changes.files) for (const h of file.hunks) if (ids.includes(h.id) && h.decision === "pending") h.applied = true;
    if (error) changes.autoApplyError = error;
    publish(changes); return changes;
  });
  mock("ai:change-set:resolve", (_event, id, decisions, applied) => {
    const changes = changeSets.find(item => item.id === id);
    for (const file of changes.files) {
      for (const h of file.hunks) if (h.decision === "pending" && decisions[h.id]) { h.decision = decisions[h.id]; h.applied = h.decision === "accepted" && (applied || h.applied); }
      file.status = file.hunks.every(h => h.decision === "accepted") ? "accepted" : file.hunks.every(h => h.decision === "rejected") ? "rejected" : "partially_accepted";
    }
    changes.status = changes.files.every(file => file.status === "accepted") ? "accepted" : changes.files.every(file => file.status === "rejected") ? "rejected" : "partially_accepted";
    publish(changes); return changes;
  });
  mock("ai:change-set:dismiss", (_event, input) => {
    const ids = new Set(Array.isArray(input) ? input : [input]);
    for (let index = changeSets.length - 1; index >= 0; index--) if (ids.has(changeSets[index].id)) changeSets.splice(index, 1);
  });
  project = await evaluate(`window.latexEditor.projects.create({ name:'AI UI test', parentPath:${JSON.stringify(projects)} })`);
  await evaluate(`window.latexEditor.settings.set('layout',{ mode:'single', singlePane:'source', sidebarVisible:true, sidebarWidth:360 },${JSON.stringify(project.id)})`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)},'main.tex',${JSON.stringify(original)})`);
  await evaluate(`window.latexEditor.files.createFile(${JSON.stringify(project.id)},'obsolete.txt').then(()=>window.latexEditor.files.write(${JSON.stringify(project.id)},'obsolete.txt','remove me'))`);
  await evaluate(`window.latexEditor.ai.createConversation('codex',${JSON.stringify(project.id)})`);
  page.reload(); await until("!!document.querySelector('.directory-project-row')");
  await evaluate("document.querySelector('.directory-project-row').click()");
  await until("!!document.querySelector('.activity-bar')");
  const labels = require("../src/renderer/i18n/locales/en.json");
  await evaluate(`Array.from(document.querySelectorAll('.activity-bar button')).find(button=>button.title.startsWith(${JSON.stringify(labels["activity.ai"])})).click()`);
  await until("!!document.querySelector('.ai-new-chat') && !!document.querySelector('.ai-permission-trigger')");
  assert.equal(await evaluate("!!document.querySelector('.ai-sidebar-heading')"), false);
  await evaluate("document.querySelector('.ai-new-chat').click()");
  await until("document.querySelector('.ai-history-trigger small')?.textContent==='2'");
  assert.equal(nativeHistory().conversations.length, 2);
  await evaluate("document.querySelector('.ai-rename-chat').click()");
  await until("!!document.querySelector('.ai-rename-form input')");
  await evaluate("(()=>{const input=document.querySelector('.ai-rename-form input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Paper edits');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await evaluate("document.querySelector('.ai-rename-form').requestSubmit()");
  await until("!document.querySelector('.ai-rename-form') && document.querySelector('.ai-history-trigger').textContent.includes('Paper edits')");
  assert.ok(nativeHistory().conversations.some(item => item.title === "Paper edits"));
  assert.ok(await evaluate("document.querySelector('.ai-permission-trigger').textContent.includes('Approve for me')"));
  await evaluate("document.querySelector('.ai-permission-trigger').click()");
  await until("document.querySelectorAll('.ai-permission-menu [role=menuitemradio]').length===3");
  await evaluate("document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
  await until("!document.querySelector('.ai-permission-menu')");
  const conversation = nativeHistory().conversations.find(item => item.title === "Paper edits");
  const changed = original.replace("Old A", "New A").replace("Old B", "New B");
  const changes = { id: randomUUID(), conversationId: conversation.id, createdAt: Date.now(), permissionMode: "auto", status: "pending", files: [
    { path: "main.tex", type: "modify", originalContent: original, proposedContent: changed, status: "pending", hunks: [hunk("a", 2, "Old A\n", "New A\n"), hunk("b", 8, "Old B\n", "New B\n")] },
    { path: "helper.tex", type: "create", proposedContent: "Helper text\n", status: "pending", hunks: [hunk("create", 0, "", "Helper text\n")] },
    { path: "obsolete.txt", type: "delete", originalContent: "remove me", status: "pending", hunks: [hunk("delete", 0, "remove me", "")] }
  ] };
  changeSets.push(changes); publish(changes);
  for (let i = 0; i < 180 && !changes.files.every(file => file.hunks.every(h => h.applied)); i++) await delay(60);
  assert.ok(changes.files.every(file => file.hunks.every(h => h.applied)), JSON.stringify(changes));
  await until(`${editorText}?.includes('New A') && ${editorText}?.includes('New B')`);
  assert.equal(await evaluate("!!document.querySelector('.ai-change-set header [data-action=accept-all]')"), false, "auto-applied changes offer Undo instead of Accept all");
  assert.equal(await evaluate("!!document.querySelector('.ai-change-set header [data-action=undo]')"), true, "auto-applied changes remain reversible");
  assert.equal(readFileSync(join(project.canonicalPath, "helper.tex"), "utf8"), "Helper text\n");
  assert.equal(await evaluate(`window.latexEditor.files.tree(${JSON.stringify(project.id)}).then(tree=>tree.some(node=>node.name==='obsolete.txt'))`), false);
  await until("document.querySelectorAll('.ai-file-summary').length===3");
  assert.equal(await evaluate("document.querySelector('.ai-new-chat').getBoundingClientRect().width>30 && document.querySelector('.ai-rename-chat').getBoundingClientRect().width>20"), true);
  writeFileSync(join(root, "ai-review.png"), (await page.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  await evaluate("document.querySelector('.ai-change-set > header [data-action=view-changes]').click()");
  await until("!!document.querySelector('.monaco-diff-editor') && !!document.querySelector('.ai-diff-close')");
  await evaluate("document.querySelector('.ai-diff-close').click()");
  await until("!document.querySelector('.monaco-diff-editor')");
  await evaluate("Array.from(document.querySelectorAll('.ai-change-path')).find(button=>button.textContent==='obsolete.txt').click()");
  await until("!!document.querySelector('.monaco-diff-editor') && document.querySelector('.ai-inline-diff-heading span')?.textContent==='obsolete.txt'");
  await evaluate("document.querySelector('.ai-diff-close').click()");
  await until("!document.querySelector('.monaco-diff-editor')");
  await evaluate("document.querySelector('.ai-change-expand').click()");
  await until("document.querySelectorAll('.ai-hunk').length===2");
  assert.equal(await evaluate("!!document.querySelector('.ai-hunk [data-action=accept]')"), false, "already-applied hunks do not offer Accept");
  assert.equal(await evaluate("!!document.querySelector('.ai-hunk [data-action=undo]')"), true, "already-applied hunks offer Undo");
  await evaluate("document.querySelectorAll('.ai-hunk')[1].querySelector('[data-action=undo]').click()");
  await until("document.querySelectorAll('.ai-hunk').length===1");
  assert.equal(changes.files[0].hunks[1].decision, "rejected");
  await until(`${editorText}?.includes('Old B') && ${editorText}?.includes('New A')`);
  await until("document.querySelector('.save-status')?.classList.contains('saved')", "AI edits saved before undo");
  await evaluate("document.querySelector('.ai-change-set > header button').click()");
  await until("!document.querySelector('.ai-change-set') && !document.querySelector('.ai-undo-row')");
  await until(`window.latexEditor.files.read(${JSON.stringify(project.id)},'main.tex').then(file=>file.content===${JSON.stringify(original)})`, "automatic edits undone");
  assert.equal(await evaluate(`window.latexEditor.files.tree(${JSON.stringify(project.id)}).then(tree=>tree.some(node=>node.name==='helper.tex'))`), false);
  assert.equal(readFileSync(join(project.canonicalPath, "obsolete.txt"), "utf8"), "remove me");
  await evaluate("document.querySelector('.ai-permission-trigger').click()");
  await until("!!document.querySelector('.ai-permission-menu button.ask')");
  await evaluate("document.querySelector('.ai-permission-menu button.ask').click()");
  await until("document.querySelector('.ai-permission-trigger')?.textContent.includes('Ask for approval')");
  const before = original;
  const ask = { id: randomUUID(), conversationId: conversation.id, createdAt: Date.now(), permissionMode: "ask", status: "pending", files: [
    { path: "main.tex", type: "modify", originalContent: before, proposedContent: before.replace("Old A", "Ask edit"), status: "pending", hunks: [hunk("ask-edit", 2, "Old A\n", "Ask edit\n")] },
    { path: "proposed.tex", type: "create", proposedContent: "Pending new file\n", status: "pending", hunks: [hunk("ask-create", 0, "", "Pending new file\n")] }
  ] };
  changeSets.push(ask); publish(ask);
  await until("!!document.querySelector('.ai-change-set')"); await delay(300);
  assert.equal(ask.files[0].hunks[0].applied, undefined);
  assert.equal((await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)},'main.tex')`)).content, before, "Ask mode leaves source unchanged until approval");
  assert.equal(await evaluate(`window.latexEditor.files.tree(${JSON.stringify(project.id)}).then(tree=>tree.some(node=>node.name==='proposed.tex'))`), false);
  await evaluate("document.querySelector('.ai-change-set > header button').click()");
  await until("!document.querySelector('.ai-change-set')");
  await until(`window.latexEditor.files.read(${JSON.stringify(project.id)},'main.tex').then(file=>file.content===${JSON.stringify(before.replace("Old A", "Ask edit"))})`, "approved source edit saved");
  assert.equal((await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)},'main.tex')`)).content, before.replace("Old A", "Ask edit"), "Accept all applies the approved source changes");
  assert.equal(readFileSync(join(project.canonicalPath, "proposed.tex"), "utf8"), "Pending new file\n");
  await evaluate("document.querySelector('.ai-permission-trigger').click()");
  await until("!!document.querySelector('.ai-permission-menu button.full')");
  await evaluate("window.confirm=()=>true; document.querySelector('.ai-permission-menu button.full').click()");
  await until("document.querySelector('.ai-permission-picker').classList.contains('full')");
  assert.equal((await evaluate("window.latexEditor.settings.get()")).global.aiPermissionMode, "full");
  const protectedPath = ".texweave/protected.json";
  const protectedContent = '{"safe":true}\n';
  await evaluate(`window.latexEditor.files.createFile(${JSON.stringify(project.id)},${JSON.stringify(protectedPath)}).then(()=>window.latexEditor.files.write(${JSON.stringify(project.id)},${JSON.stringify(protectedPath)},${JSON.stringify(protectedContent)}))`);
  const protectedChanges = { id: randomUUID(), conversationId: conversation.id, createdAt: Date.now(), permissionMode: "ask", status: "pending", files: [
    { path: protectedPath, type: "modify", originalContent: protectedContent, proposedContent: '{"safe":false}\n', status: "pending", hunks: [hunk("protected", 0, protectedContent, '{"safe":false}\n')] }
  ] };
  changeSets.push(protectedChanges); publish(protectedChanges);
  await until("document.querySelector('.ai-change-set')?.textContent.includes('.texweave/protected.json')");
  await evaluate("document.querySelector('.ai-change-set > header button').click()");
  await until("document.querySelector('.ai-error')?.textContent.includes('internal file')");
  assert.equal(readFileSync(join(project.canonicalPath, protectedPath), "utf8"), protectedContent);
  assert.equal(protectedChanges.files[0].hunks[0].applied, undefined);
  console.log("PASS AI UI: visible new/rename/history; persistent rename; 3 permission modes/default auto/outside dismissal; automatic edits+create+delete with Undo-only actions; deleted-file source diff; per-hunk Undo; Ask mode waits for and accepts approval.");
  console.log("PASS AI UI: unrelated TeXWeave internal files remain protected.");
  await require('./ai/change-report-check.cjs')({ page, project, evaluate, until, conversation, changeSets, hunk, publish });
  await require('./ai/renderer-performance.cjs')({ page, evaluate, until, conversation });
  console.log("Screenshot:", join(root, "ai-review.png"));
}
require("../dist/main/index.js");
const watchdog = setTimeout(() => { console.error("FAIL AI UI timeout"); app.exit(1); }, 60000);
app.whenReady().then(() => run().then(() => { clearTimeout(watchdog); app.exit(0); }).catch(async error => {
  console.error(error); console.error("Artifacts:", root);
  try {
    if (page) { console.error(await evaluate("JSON.stringify({ai:document.querySelector('.ai-sidebar')?.textContent,editor:document.querySelector('.editor-surface')?.textContent,tabs:document.querySelector('.editor-tabs')?.textContent,bounds:document.querySelector('.editor-surface')?.getBoundingClientRect(),mode:document.querySelector('.work-pane')?.className})")); writeFileSync(join(root, "failure.png"), (await page.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG()); }
  } catch (captureError) { console.error("Capture:", captureError.message); }
  finally { clearTimeout(watchdog); app.exit(1); }
}));
