const { app, BrowserWindow } = require("electron");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const root = mkdtempSync(join(tmpdir(), "texweave-companion-"));
app.setPath("userData", join(root, "profile"));
const delay = ms => new Promise(done => setTimeout(done, ms));
const errors = [];
let page;
let themeOperation;
let seededThemeId;
let petTools;
// Keep model calls local while exercising the real pet service and gateway.
const { CodexAppServer } = require("../../dist/main/ai/codex-app-server.js");
CodexAppServer.prototype.startTurn = async function(input) { petTools = input.toolHandlers; input.onThreadReady?.("theme-check-thread"); return { threadId: "theme-check-thread", turnId: "theme-check-turn" }; };
CodexAppServer.prototype.interruptTurn = async function() {};
async function seedVerifiedOperation() {
  const { CapabilityRegistry } = require("../../dist/main/capabilities/registry.js");
  const { CapabilityService } = require("../../dist/main/capabilities/gateway.js");
  const { SettingsRepository } = require("../../dist/main/settings.js");
  const { ThemeRepository } = require("../../dist/main/themes.js");
  const profile = app.getPath("userData");
  const registry = new CapabilityRegistry();
  await registry.initialize(join(__dirname, "../../../../resources/capabilities/registry-v1.sqlite"));
  const settings = new SettingsRepository(profile, async () => { throw new Error("No test project"); });
  await settings.initialize();
  const themeRoot = join(root, "themes");
  const themes = new ThemeRepository(join(root, "resources"), themeRoot); await themes.initialize();
  await settings.set("themeDirectory", themeRoot);
  const service = new CapabilityService(registry, { settings, themes, journalPath: join(profile, "ai/operation-journal.sqlite"), projectState: () => undefined });
  service.initialize();
  try {
    const sessionId = randomUUID();
    const tools = service.bind({ origin: "pet", sessionId, alive: () => true, permissionMode: () => "auto", requestApproval: async () => false, skills: [], readSkill: async () => "", handlers: {} }).toolHandlers;
    const plan = JSON.parse(await tools.tw_plan_operation({ id: "settings.fontSize.set", arguments: { scope: "global", value: 18 }, requestId: "desktop-setting" }));
    assert.equal(plan.ok, true);
    assert.equal(JSON.parse(await tools.tw_execute_operation({ operationId: plan.data.operationId, action: "apply" })).data.status, "verified");
    const themePlan = JSON.parse(await tools.tw_plan_operation({ id: "themes.create", arguments: { name: "Gateway dark", css: ":root { color-scheme: dark; --color-bg-panel: #162334; --color-text-primary: #e1efff; }" }, requestId: "desktop-theme" }));
    assert.equal(themePlan.ok, true);
    const created = JSON.parse(await tools.tw_execute_operation({ operationId: themePlan.data.operationId, action: "apply" }));
    assert.equal(created.data.status, "verified");
    seededThemeId = created.data.result.id;
    const activation = JSON.parse(await tools.tw_plan_operation({ id: "settings.theme.set", arguments: { scope: "global", value: seededThemeId }, requestId: "desktop-theme-activation" }));
    assert.equal(activation.ok, true);
    assert.equal(JSON.parse(await tools.tw_execute_operation({ operationId: activation.data.operationId, action: "apply" })).data.status, "verified");
    themeOperation = activation.data.operationId;
    const path = join(profile, "ai/companion"); mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "conversations.json"), JSON.stringify({ version: 1, conversations: [{ id: sessionId, mode: "chat", title: "Setting change", createdAt: Date.now(), updatedAt: Date.now(), messages: [{ id: randomUUID(), role: "assistant", content: "Updated the requested font size.", status: "complete", createdAt: Date.now(), operations: service.operationReports([plan.data.operationId]) }] }] }));
  } finally { service.close(); registry.close(); }
}
app.on("web-contents-created", (_event, contents) => contents.on("console-message", ({ level, message }) => {
  if ((level === "error" || level === 3) && !message.includes("Canceled: Canceled")) errors.push(message);
}));
const evaluate = code => page.webContents.executeJavaScript(code, true);
async function until(code, label) {
  for (let i = 0; i < 200; i++) { assert.deepEqual(errors, []); if (await evaluate(code)) return; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}
async function checkGatewayTheme() {
  const conversation = await evaluate('window.latexEditor.companionChat.createConversation("codex")');
  const sent = await evaluate(`window.latexEditor.companionChat.send({conversationId:${JSON.stringify(conversation.id)},content:"Create and use a dark theme."})`);
  try {
    const call = async (name, args) => { const result = JSON.parse(await petTools[name](args)); assert.equal(result.ok, true, JSON.stringify(result)); return result.data; };
    const plan = await call("tw_plan_operation", { id: "themes.create", arguments: { name: "Live pet theme", css: ":root { color-scheme: dark; --color-bg-panel: #172b3c; --color-text-primary: #e2f3ff; }" }, requestId: "live-theme" });
    const created = await call("tw_execute_operation", { operationId: plan.operationId, action: "apply" });
    const activation = await call("tw_plan_operation", { id: "settings.theme.set", arguments: { scope: "global", value: created.result.id }, requestId: "live-theme-setting" });
    await call("tw_execute_operation", { operationId: activation.operationId, action: "apply" });
    await until('getComputedStyle(document.documentElement).getPropertyValue("--color-bg-panel").trim() === "#172b3c"', "new pet theme applies without a renderer reload");
    await call("tw_execute_operation", { operationId: activation.operationId, action: "undo" });
    await until('document.documentElement.dataset.theme === "tech-dark"', "live pet theme Undo restores previous theme");
    await evaluate(`window.latexEditor.themes.remove(${JSON.stringify(created.result.id)})`);
    console.log("PASS live pet gateway theme creation, immediate activation and Undo");
    const blockPlan = await call("tw_plan_operation", { id: "customization.blocks.upsert", arguments: { scope: "global", id: "pet-note", mode: "create", baseId: "remark", patch: { label: "Pet note", match: { kind: "latex-environment", name: "petnote" }, style: { colorMode: "adaptive", baseColor: "#168895" } } }, requestId: "live-block" });
    await call("tw_execute_operation", { operationId: blockPlan.operationId, action: "apply" });
    const commandPlan = await call("tw_plan_operation", { id: "customization.commands.upsert", arguments: { scope: "global", id: "pet-break", mode: "create", patch: { label: "Pet break", match: { kind: "command", name: "petbreak" }, display: "divider", color: "#168895" } }, requestId: "live-command" });
    await call("tw_execute_operation", { operationId: commandPlan.operationId, action: "apply" });
    const saved = await evaluate('window.latexEditor.settings.get()');
    assert.ok(saved.global.environments.some(item => item.id === "pet-note"));
    assert.ok(saved.global.previewDirectives.some(item => item.id === "pet-break"));
    assert.equal((await call("tw_get_state", { id: "customization.blocks.read", arguments: { scope: "global", id: "pet-note" } })).definition.builtIn, false);
    assert.equal((await call("tw_get_state", { id: "customization.commands.read", arguments: { scope: "global", id: "pet-break" } })).definition.match.name, "petbreak");
    await call("tw_execute_operation", { operationId: commandPlan.operationId, action: "undo" });
    await call("tw_execute_operation", { operationId: blockPlan.operationId, action: "undo" });
    const restored = await evaluate('window.latexEditor.settings.get()');
    assert.ok(!restored.global.environments?.some(item => item.id === "pet-note"));
    assert.ok(!restored.global.previewDirectives?.some(item => item.id === "pet-break"));
    console.log("PASS live pet custom block/command creation, saved definitions and Undo");
  } finally { await evaluate(`window.latexEditor.companionChat.cancel(${JSON.stringify(sent.taskId)})`); }
}
async function toggleInSettings() {
  await evaluate('document.querySelector("button[aria-label=Settings]").click()');
  await until('!!document.querySelector("[data-setting=companionEnabled] input")', "visibility preference");
  await evaluate('document.querySelector("[data-setting=companionEnabled] input").click()');
  await delay(150);
  await evaluate('document.querySelector(".settings-close").click()');
}
async function checkSkills() {
  const catalog = await evaluate('window.latexEditor.companionSkills.list()');
  assert.equal(catalog.length, 6);
  assert.ok(catalog.every(skill => !("content" in skill)), "discovery has no skill bodies");
  const context = await evaluate('window.latexEditor.companionSkills.prepare(["companion-settings"])');
  assert.equal(context.core.name, "companion-core");
  assert.deepEqual(context.skills.map(skill => skill.name), ["companion-settings"]);
  assert.equal(await evaluate('window.latexEditor.companionSkills.setEnabled({name:"companion-core",enabled:false}).then(()=>false,()=>true)'), true);
  await evaluate('document.querySelector("button[aria-label=Settings]").click()');
  await until('!!document.querySelector("[data-section=ai]")', "settings navigation");
  await evaluate('document.querySelector("[data-section=ai]").click(); document.querySelectorAll(".settings-level-switch button")[1].click()');
  await until('!!document.querySelector("[data-manager=aiSkills]")', "skills manager entry");
  await evaluate('document.querySelector("[data-manager=aiSkills]").click()');
  await until('!!document.querySelector(".companion-skill-tabs")', "separate skill libraries");
  await evaluate('document.querySelectorAll(".companion-skill-tabs button")[1].click()');
  await until('!!document.querySelector(".companion-skills-settings pre")', "foundation content");
  assert.equal(await evaluate('document.querySelector("input[aria-label=companion-core]").disabled'), true);
  assert.equal(await evaluate('document.querySelectorAll(".companion-skills-settings .ai-skills-detail-head button").length'), 0);
  assert.equal(await evaluate('document.querySelectorAll(".manager-presets-button").length'), 0, "project skill presets do not leak into the pet library");
  await evaluate('Array.from(document.querySelectorAll("button")).find(button=>button.textContent.includes("New skill")).click()');
  await until('!!document.querySelector(".companion-skills-settings textarea")', "custom skill editor");
  await evaluate(`(() => {
    const area = document.querySelector('.companion-skills-settings textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area, '---\\nname: my-skill\\ndescription: Interface test preference.\\n---\\n\\nUse concise answers.');
    area.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  await evaluate('document.querySelector(".companion-skills-settings .ai-skills-actions .primary").click()');
  await until('document.querySelector(".companion-skills-settings pre")?.textContent.includes("Use concise answers.")', "custom skill saved through UI");
  writeFileSync(join(root, "companion-skills.png"), (await page.webContents.capturePage()).toPNG());
  page.reload();
  await until('!!document.querySelector(".companion-pet")', "home after skill save");
  assert.equal((await evaluate('window.latexEditor.companionSkills.read("my-skill")')).source, "custom");
  const before = await evaluate('window.latexEditor.settings.get()');
  const preset = await evaluate('window.latexEditor.settings.createPreset({format:"texweave-settings-preset",version:1,name:"Companion test",kind:"settings",preferences:{fontSize:18}})');
  assert.equal(preset.name, "Companion test");
  const theme = await evaluate('window.latexEditor.themes.create({name:"Companion test",css:":root { --color-bg-panel: #ecfaff; }"})');
  try {
    assert.ok(theme.id.startsWith("custom-"));
    assert.deepEqual((await evaluate('window.latexEditor.settings.get()')).global, before.global, "creating presets and themes does not apply them");
  } finally { await evaluate(`window.latexEditor.themes.remove(${JSON.stringify(theme.id)})`); }
  assert.equal(await evaluate('window.latexEditor.settings.createPreset({format:"texweave-settings-preset",version:1,name:"Invalid",kind:"settings",preferences:{lastProject:"elsewhere"}}).then(()=>false,()=>true)'), true);
}
async function run() {
  while (!BrowserWindow.getAllWindows().length) await delay(50);
  page = BrowserWindow.getAllWindows()[0];
  await until('!!document.querySelector(".companion-pet")', "default visible pet");
  const registry = await evaluate('window.latexEditor.capabilities.status()');
  assert.equal(registry.available, true, "Electron can open the generated SQLite capability catalog");
  const { capabilityManifest } = require("../../dist/main/capabilities/manifest.js");
  assert.equal(registry.count, (await capabilityManifest()).length);
  await until('getComputedStyle(document.documentElement).getPropertyValue("--color-bg-panel").trim() === "#162334"', "gateway-created theme loaded");
  await evaluate(`window.latexEditor.capabilities.undo(${JSON.stringify(themeOperation)})`);
  await until('document.documentElement.dataset.theme === "light"', "gateway theme activation Undo");
  await evaluate(`window.latexEditor.themes.remove(${JSON.stringify(seededThemeId)})`);
  console.log("PASS saved gateway theme and activation Undo");
  const rect = await evaluate('(() => { const r=document.querySelector(".companion-pet").getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,vw:innerWidth,vh:innerHeight}; })()');
  assert.ok(rect.x > rect.vw / 2 && rect.y > rect.vh / 2, "default lower-right position");
  const before = await evaluate('window.latexEditor.settings.get()');
  await evaluate('document.querySelector(".companion-pet").dispatchEvent(new MouseEvent("click", {bubbles:true, detail:1}))');
  assert.equal(await evaluate('!!document.querySelector(".companion-panel")'), false, "left click does not open chat");
  await evaluate('document.querySelector(".companion-pet").dispatchEvent(new MouseEvent("contextmenu", {bubbles:true, cancelable:true, button:2}))');
  await until('!!document.querySelector(".companion-panel")', "pet chat opens");
  assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".companion-chat-toolbar select:first-child option")).map(option=>option.value)'), ["chat", "codex"], "pet uses the existing Copilot and Codex providers");
  assert.equal(await evaluate('document.querySelector(".companion-chat-compose textarea")?.disabled'), false, "home chat input does not require a project");
  assert.equal(await evaluate('document.activeElement === document.querySelector(".companion-chat-compose textarea")'), true, "right click focuses the composer");
  await evaluate(`(() => {
    const area = document.querySelector('.companion-chat-compose textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area, 'A global pet draft');
    area.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
  assert.equal(await evaluate('!!document.querySelector(".companion-connect") || !!document.querySelector(".companion-account")'), true, "pet shows the shared provider sign-in state");
  assert.deepEqual((await evaluate('window.latexEditor.settings.get()')).global, before.global);
  await until('!!document.querySelector(".ai-setting-operation button")', "verified setting report");
  await evaluate('document.querySelector(".ai-setting-operation button").click()');
  await until('document.querySelector(".ai-setting-operation span")?.textContent === "Undone"', "setting Undo report");
  assert.equal((await evaluate('window.latexEditor.settings.get()')).global.fontSize, undefined, "Undo restores inherited/default setting through main-process IPC");
  await evaluate('document.querySelector(".companion-panel header button").click()');
  await until('!document.querySelector(".companion-panel")', "panel closed");
  await evaluate('document.activeElement?.blur()');
  page.webContents.sendInputEvent({type:"keyDown", keyCode:"T"});
  page.webContents.sendInputEvent({type:"keyUp", keyCode:"T"});
  await until('!!document.querySelector(".companion-panel")', "T opens pet chat");
  assert.equal(await evaluate('document.querySelector(".companion-chat-compose textarea").value'), "A global pet draft", "closing the panel retains its global draft");
  assert.equal(await evaluate('(() => { const e=new KeyboardEvent("keydown",{key:"t",code:"KeyT",bubbles:true,cancelable:true}); document.querySelector(".companion-chat-compose textarea").dispatchEvent(e); return e.defaultPrevented; })()'), false, "typing T is not captured as a shortcut");
  await evaluate('document.querySelector(".companion-panel header button").click()');
  await until('!document.querySelector(".companion-panel")', "panel closed again");
  await evaluate('document.querySelector(".directory-global-search input").dispatchEvent(new KeyboardEvent("keydown",{key:"t",code:"KeyT",bubbles:true,cancelable:true}))');
  assert.equal(await evaluate('!!document.querySelector(".companion-panel")'), false, "typing in another input does not open pet chat");
  const petConversation = await evaluate('window.latexEditor.companionChat.createConversation("chat")');
  assert.equal((await evaluate('window.latexEditor.ai.conversations()')).conversations.some(item => item.id === petConversation.id), false, "pet and project histories are isolated");
  await delay(150);
  const dragRect = await evaluate('(() => { const r=document.querySelector(".companion-pet").getBoundingClientRect(); return {x:r.x,y:r.y}; })()');
  const x = Math.round(dragRect.x + 32), y = Math.round(dragRect.y + 32);
  page.focus();
  page.webContents.sendInputEvent({ type: "mouseMove", x, y });
  page.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
  await delay(80);
  page.webContents.sendInputEvent({ type: "mouseMove", x: x - 120, y: y - 100, button: "left", modifiers: ["leftButtonDown"] });
  await delay(80);
  page.webContents.sendInputEvent({ type: "mouseUp", x: x - 120, y: y - 100, button: "left", clickCount: 1 });
  await until(`document.querySelector('.companion-pet').getBoundingClientRect().x < ${dragRect.x - 50}`, "drag movement");
  assert.equal(await evaluate('!!document.querySelector(".companion-panel")'), false, "drag is not click");
  await toggleInSettings();
  await until('!document.querySelector(".companion-pet")', "disabled visibility");
  page.reload();
  await until('!!document.querySelector(".directory-help")', "reloaded home");
  assert.equal(await evaluate('!!document.querySelector(".companion-pet")'), false, "visibility saved across reload");
  await toggleInSettings();
  await until('!!document.querySelector(".companion-pet")', "re-enabled pet");
  await checkSkills();
  await evaluate('window.latexEditor.settings.set("theme", "tech-dark")');
  await evaluate('window.latexEditor.settings.set("locale", "zh-CN")');
  page.reload();
  await until('document.querySelector(".companion-pet")?.getAttribute("aria-label") === "宠物助手"', "localized pet");
  await evaluate('document.querySelector(".companion-pet").dispatchEvent(new MouseEvent("contextmenu", {bubbles:true,cancelable:true,button:2}))');
  await until('!!document.querySelector(".companion-panel")', "dark panel");
  const background = await evaluate('getComputedStyle(document.querySelector(".companion-panel")).backgroundColor');
  assert.notEqual(background, "rgb(255, 255, 255)", "theme surface is respected");
  await delay(150);
  writeFileSync(join(root, "companion.png"), (await page.webContents.capturePage()).toPNG());
  assert.deepEqual(errors, []);
  assert.equal(await evaluate('document.querySelector(".companion-chat-compose textarea").value'), "A global pet draft", "draft survives reload, locale, and theme changes");
  assert.equal((await evaluate('window.latexEditor.companionChat.conversations()')).some(item => item.id === petConversation.id), true, "global pet history survives reload");
  const projects = join(root, "projects"); mkdirSync(projects);
  await evaluate(`window.latexEditor.projects.create({name:"pet-project",parentPath:${JSON.stringify(projects)},styleResourceIds:[]})`);
  page.reload();
  await until('!!document.querySelector(".directory-project-row")', "project listed");
  await evaluate('document.querySelector(".directory-project-row").click()');
  await until('!!document.querySelector(".activity-bar")', "project workspace opened");
  await evaluate('document.activeElement?.blur()');
  page.webContents.sendInputEvent({type:"keyDown", keyCode:"T"});
  page.webContents.sendInputEvent({type:"keyUp", keyCode:"T"});
  await until('!!document.querySelector(".companion-chat-compose textarea")', "pet chat available in project");
  assert.equal(await evaluate('document.querySelector(".companion-chat-compose textarea").value'), "A global pet draft", "opening a project does not replace the global draft");
  await evaluate('document.querySelector(".workbench-topbar .logo-button").click()');
  await until('!!document.querySelector(".directory-help")', "returned home");
  assert.equal(await evaluate('document.querySelector(".companion-chat-compose textarea").value'), "A global pet draft", "returning home keeps the same chat draft");
  await checkGatewayTheme();
  console.log(`PASS companion right-click/T, typing protection, global chat/history/draft, shared accounts, dragging, preferences, theme and skills. Artifacts: ${root}`);
}
app.whenReady().then(async () => {
  await seedVerifiedOperation();
  require("../../dist/main/index.js");
  run().then(() => app.exit(0)).catch(error => { console.error(error); console.error(errors); app.exit(1); });
}).catch(error => { console.error(error); app.exit(1); });
