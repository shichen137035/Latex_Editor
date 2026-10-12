// Isolated UI regression; stages files but never sends a model request.
const { app, BrowserWindow, ipcMain } = require("electron");
const { desktopInvoke, desktopEvents } = require("@latex-editor/contracts/desktop-ipc");
const { randomUUID } = require("node:crypto");
const { mkdtempSync, mkdirSync, readdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const assert = require("node:assert/strict");
const root = mkdtempSync(resolve(tmpdir(), "texweave-ai-attachments-"));
const projects = join(root, "projects"), profile = join(root, "profile");
mkdirSync(projects); app.setPath("userData", profile);
const cache = join(profile, "ai", "attachment-cache");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let page;
const errors = [];
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
const evaluate = source => page.webContents.executeJavaScript(source, true);
async function until(check, label) {
  for (let i = 0; i < 120; i++) {
    assert.equal(errors.length, 0, errors.join("\n"));
    if (await check()) return;
    await delay(75);
  }
  throw new Error(`Timed out: ${label}`);
}
function cacheFiles(path = cache) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? cacheFiles(join(path, entry.name)) : [join(path, entry.name)]);
}
async function paste() {
  await evaluate(`(() => {
    const input = document.querySelector('.ai-composer textarea');
    const transfer = new DataTransfer();
    transfer.items.add(new File(['Attachment bytes'], 'draft.txt', {type:'text/plain'}));
    input.dispatchEvent(new ClipboardEvent('paste', {clipboardData:transfer,bubbles:true,cancelable:true}));
  })()`);
  await until(() => evaluate("document.querySelectorAll('.ai-attachment-chip').length === 1"), "pasted attachment");
  assert.equal(cacheFiles().length, 1);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until(() => evaluate("!!document.querySelector('.project-directory-v044') && !!window.latexEditor"), "home");
  const project = await evaluate(`window.latexEditor.projects.create({name:'Attachment check',parentPath:${JSON.stringify(projects)}})`);
  const conversation = await evaluate(`window.latexEditor.ai.createConversation('codex',${JSON.stringify(project.id)})`);
  page.reload();
  await until(() => evaluate("!!document.querySelector('.directory-project-row')"), "project list");
  await evaluate("document.querySelector('.directory-project-row').click()");
  await until(() => evaluate("!!document.querySelector('.workbench')"), "workbench");
  // Render the composer without signing in or contacting either model provider.
  for (const endpoint of [desktopInvoke.ai.status, desktopInvoke.ai.detect, desktopInvoke.ai.copilotStatus]) {
    ipcMain.removeHandler(endpoint.channel);
    ipcMain.handle(endpoint.channel, () => ({ auth: "signed_in", process: "running", accountLabel: "Attachment regression" }));
  }
  for (const endpoint of [desktopInvoke.ai.models, desktopInvoke.ai.copilotModels]) {
    ipcMain.removeHandler(endpoint.channel); ipcMain.handle(endpoint.channel, () => []);
  }
  const history = { ...conversation, messages: Array.from({length:40}, (_, index) => ({id:"history-"+index,role:"assistant",status:"complete",createdAt:Date.now()-10000,content:("## Result\n\nA formatted **paragraph** with $x^2+y^2$ and a reference.\n\n").repeat(8)})) };
  ipcMain.removeHandler(desktopInvoke.ai.conversations.channel);
  ipcMain.handle(desktopInvoke.ai.conversations.channel, () => ({conversations:[history],changeSets:[]}));
  let sentContent;
  ipcMain.removeHandler(desktopInvoke.ai.send.channel);
  ipcMain.handle(desktopInvoke.ai.send.channel, (_event, input) => {
    sentContent = input.content;
    history.updatedAt = Date.now();
    if (history.activeTaskId) {
      history.queuedMessages ??= [];
      history.queuedMessages.push({id:input.taskId,content:input.content,createdAt:Date.now()});
      publishHistory();
      return {conversation:history,taskId:history.activeTaskId,queued:true};
    }
    history.messages.push({id:"sent",role:"user",content:input.content,createdAt:Date.now(),status:"complete"});
    return {conversation:history,taskId:input.taskId};
  });
  function publishHistory() {
    history.revision = (history.revision ?? 0) + 1;
    page.webContents.send(desktopEvents.toRenderer.aiUpdate.channel,{kind:'conversation',payload:history});
  }
  ipcMain.removeHandler(desktopInvoke.ai.sendQueued.channel);
  ipcMain.handle(desktopInvoke.ai.sendQueued.channel, (_event, id, messageId) => {
    assert.equal(id,conversation.id);
    const selected=history.queuedMessages.find(item=>item.id===messageId);
    assert.ok(selected); history.messages.at(-1).status='complete';
    history.queuedMessages=history.queuedMessages.filter(item=>item.id!==messageId);
    history.messages.push({id:randomUUID(),role:'user',content:selected.content,createdAt:Date.now(),status:'complete'}, {id:randomUUID(),role:'assistant',content:'Priority reply',createdAt:Date.now(),status:'streaming'});
    history.activeTaskId=messageId; publishHistory();
    return {conversation:history,taskId:messageId};
  });
  ipcMain.removeHandler(desktopInvoke.ai.removeQueued.channel);
  ipcMain.handle(desktopInvoke.ai.removeQueued.channel, (_event,id,messageId)=>{
    assert.equal(id,conversation.id);
    history.queuedMessages=history.queuedMessages.filter(item=>item.id!==messageId);publishHistory();
  });
  await evaluate("document.querySelectorAll('.activity-bar > div:first-child > button')[3].click()");
  await until(() => evaluate("!!document.querySelector('.ai-composer textarea')"), "AI composer");
  await until(() => evaluate("document.querySelectorAll('.ai-message.assistant').length === 40"), "long conversation history");
  const typing = await evaluate(`(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const input = document.querySelector('.ai-composer textarea');
    const getter = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight').get;
    let reads = 0;
    Object.defineProperty(input, 'scrollHeight', {configurable:true,get(){reads++;return getter.call(this);}});
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const content = 'Typing with a large formula history. 中文输入检查。 Last character!';
    const started = performance.now();
    for (const character of content) {
      setter.call(input,input.value+character);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
    const milliseconds = performance.now()-started;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    delete input.scrollHeight;
    return {content,value:input.value,reads,milliseconds,enabled:!document.querySelector('.ai-send-button').disabled};
  })()`);
  assert.equal(typing.value, typing.content);
  assert.equal(typing.enabled, true);
  assert.ok(typing.reads <= 2, 'typing in one frame batches textarea measurement');
  await evaluate("document.querySelector('.ai-send-button').click()");
  await until(async () => sentContent === typing.content, "send uses the entire latest draft");
  await until(() => evaluate("document.querySelector('.ai-composer textarea').value === ''"), "clear draft after sending");
  console.log(`PASS composer: 40 Markdown/formula messages; input batch ${typing.milliseconds.toFixed(1)}ms, ${typing.reads} height measurement(s); latest text sent intact`);
  const longDraft = Array.from({length:40}, (_, index) => 'Draft line '+index).join('\n');
  await evaluate(`(() => {const input=document.querySelector('.ai-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(longDraft)});input.dispatchEvent(new Event('input',{bubbles:true}));input.setSelectionRange(10,12);})()`);
  await until(() => evaluate("document.querySelector('.ai-composer textarea').style.height === '110px'"), "normal composer height cap");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.ai-composer textarea')).overflowY"), 'auto');
  await evaluate("document.querySelector('.ai-composer-expand').click()");
  await until(() => evaluate("!!document.querySelector('.ai-composer-backdrop') && parseFloat(document.querySelector('.ai-composer textarea').style.height)>200"), "expanded input panel");
  assert.equal(await evaluate("document.querySelector('.ai-composer textarea').value"),longDraft);
  assert.deepEqual(await evaluate("[document.querySelector('.ai-composer textarea').selectionStart,document.querySelector('.ai-composer textarea').selectionEnd]"),[10,12]);
  await evaluate("(() => {const input=document.querySelector('.ai-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,input.value+'\\nExpanded edit');input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.ai-composer-backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));})()");
  await until(() => evaluate("!document.querySelector('.ai-composer-backdrop')"), "outside click collapses input");
  assert.equal(await evaluate("document.querySelector('.ai-composer textarea').value"),longDraft+'\nExpanded edit');
  await evaluate("document.querySelector('.ai-composer-expand').click()");
  await until(() => evaluate("!!document.querySelector('.ai-composer-backdrop')"), "reopen expanded input");
  await evaluate("document.querySelector('.ai-composer-expand').click()");
  await until(() => evaluate("!document.querySelector('.ai-composer-backdrop')"), "toggle button collapses input");
  await evaluate("(() => {const input=document.querySelector('.ai-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  console.log('PASS bounded composer: internal scrolling, expanded panel, preserved draft/caret, outside click and toggle collapse');
  history.activeTaskId=randomUUID();
  history.messages.push({id:randomUUID(),role:'assistant',content:'Working',createdAt:Date.now(),status:'streaming'});publishHistory();
  await until(()=>evaluate("!!document.querySelector('.ai-send-button.stopping')"),'running task stop control');
  for (const content of ['Queued one','Queued two']) {
    await evaluate(`(() => {const input=document.querySelector('.ai-composer textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(content)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(()=>evaluate("!!document.querySelector('.ai-send-button:not(.stopping)') && !document.querySelector('.ai-send-button:not(.stopping)').disabled"),'send while task is running');
    await evaluate("document.querySelector('.ai-send-button:not(.stopping)').click()");
    await until(()=>evaluate("document.querySelector('.ai-composer textarea').value === ''"),'queued draft cleared');
  }
  assert.equal(await evaluate("document.querySelectorAll('.ai-message-queue li').length"),2);
  assert.ok(await evaluate("!!document.querySelector('.ai-send-button.stopping')"));
  await evaluate("document.querySelector('.ai-message-queue li button').click()");
  await until(()=>evaluate("document.querySelectorAll('.ai-message-queue li').length === 1"),'send selected queued message now');
  assert.equal(history.messages.at(-2).content,'Queued one');
  await evaluate("document.querySelector('.ai-message-queue li button:last-child').click()");
  await until(()=>evaluate("!document.querySelector('.ai-message-queue')"),'remove pending queued message');
  delete history.activeTaskId;history.messages.at(-1).status='complete';publishHistory();
  await until(()=>evaluate("!document.querySelector('.ai-send-button.stopping')"),'priority response completed');
  console.log('PASS queue UI: send during generation, pending list, send-now and remove controls, independent Stop button');
  await paste();
  await evaluate("document.querySelector('.ai-attachment-chip button').click()");
  await until(() => evaluate("document.querySelectorAll('.ai-attachment-chip').length === 0"), "removed chip");
  await until(async () => cacheFiles().length === 0, "removed cache file");
  console.log("PASS remove: chip and temporary file are both released");
  await paste();
  await evaluate("document.querySelector('.logo-button').click()");
  await until(() => evaluate("!!document.querySelector('.project-directory-v044')"), "return home");
  await until(async () => cacheFiles().length === 0, "unmount cleanup");
  console.log("PASS leaving project: attachment draft releases its temporary files");
  await evaluate("document.querySelector('.directory-project-row').click()");
  await until(() => evaluate("!!document.querySelector('.activity-bar')"), "reopen project");
  await evaluate("document.querySelectorAll('.activity-bar > div:first-child > button')[3].click()");
  await until(() => evaluate("!!document.querySelector('.ai-composer textarea')"), "reopened composer");
  await paste();
  await new Promise(resolve => {
    app.once("will-quit", event => {
      try { assert.equal(cacheFiles().length, 0); console.log("PASS window destruction: backend draft cleanup completes before exit"); resolve(); }
      catch (error) { event.preventDefault(); console.error(error); app.exit(1); }
    });
    page.destroy();
  });
  console.log("Artifacts:", root);
}
require("../../dist/main/index.js");
const timeout = setTimeout(() => { console.error("Attachment check timed out"); app.exit(1); }, 45000);
app.whenReady().then(run).then(() => { clearTimeout(timeout); app.exit(0); }).catch(error => { console.error(error); console.error("Artifacts:", root); app.exit(1); });
