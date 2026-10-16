const {app,BrowserWindow,ipcMain}=require("electron");
const {mkdtempSync,mkdirSync}=require("node:fs");const {tmpdir}=require("node:os");const {join}=require("node:path");const assert=require("node:assert/strict");
const labels=require("../../src/renderer/i18n/locales/en.json");const root=mkdtempSync(join(tmpdir(),"texweave-codex-settings-"));app.setPath("userData",join(root,"profile"));mkdirSync(join(root,"projects"));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));let page;
const evaluate=code=>page.webContents.executeJavaScript(code,true);
async function until(code,label){for(let i=0;i<250;i++){if(await evaluate(code))return;await delay(50);}throw new Error(label+"\n"+await evaluate("document.body.innerText.slice(-3500)"));}
async function run(){
 while(!BrowserWindow.getAllWindows().length)await delay(50);page=BrowserWindow.getAllWindows()[0];await until('!!document.querySelector(".directory-main")','home');
 let status={process:"not_detected",auth:"unknown"};let installs=0,fail=true;
 for(const channel of ["ai:detect","ai:status","ai:install","ai:set-executable","ai:models"])ipcMain.removeHandler(channel);
 ipcMain.handle("ai:detect",()=>status);ipcMain.handle("ai:status",()=>status);ipcMain.handle("ai:models",()=>[]);
 ipcMain.handle("ai:install",async()=>{installs++;await delay(50);if(fail){fail=false;throw new Error("Fixture download failed");}status={process:"stopped",auth:"signed_out",executablePath:join(root,"codex.exe")};return status;});
 ipcMain.handle("ai:set-executable",(_event,path)=>{status={...status,executablePath:path,process:"stopped"};return status;});
 await evaluate('document.querySelector(".directory-actions > .icon-button:last-child").click()');await until('!!document.querySelector("[data-section=ai]")','settings');
 await evaluate('document.querySelector("[data-section=ai]").click()');await until('!!document.querySelector("[data-codex-install]")','Codex environment settings');
 await evaluate('document.querySelector("[data-codex-install]").click()');await until('!!document.querySelector("[data-codex-environment] [role=alert]") && !document.querySelector("[data-codex-install]").disabled','failed installation retry');
 await evaluate('document.querySelector("[data-codex-install]").click()');await until('document.querySelector("#codex-environment-path").value.includes("codex.exe")','installed CLI path');assert.equal(installs,2);
 // Restart the renderer to close preferences, then exercise missing CLI on the Codex page.
 status={process:"not_detected",auth:"unknown"};
 await evaluate(`window.latexEditor.projects.create({name:'Codex environment',parentPath:${JSON.stringify(join(root,"projects"))}})`);page.reload();await until('!!document.querySelector(".directory-project-row")','project');
 await evaluate('document.querySelector(".directory-project-row").click()');await until('!!document.querySelector(".activity-bar")','workbench');
 await evaluate(`Array.from(document.querySelectorAll('.activity-bar button')).find(button=>button.title.startsWith(${JSON.stringify(labels['activity.ai'])})).click()`);
 await until('!!document.querySelector(".ai-mode-switch")','AI modes');
 await evaluate(`Array.from(document.querySelectorAll('.ai-mode-switch [role=tab]')).find(button=>button.textContent.trim()===${JSON.stringify(labels['ai.codex'])}).click()`);
 await until(`Array.from(document.querySelectorAll('.ai-connect-card button')).some(button=>button.textContent===${JSON.stringify(labels['ai.installCodex'])})`,'install from missing Codex page');
 await evaluate(`Array.from(document.querySelectorAll('.ai-connect-card button')).find(button=>button.textContent===${JSON.stringify(labels['ai.installCodex'])}).click()`);
 await until('!!document.querySelector(".ai-cli-path")','CLI installed from Codex page');assert.equal(installs,3);
 await evaluate(`Array.from(document.querySelectorAll('.ai-connect-card button')).find(button=>button.textContent===${JSON.stringify(labels['ai.environmentTitle'])}).click()`);
 await until('!!document.querySelector("[data-codex-environment]")','environment settings opened from Codex');
 console.log("PASS Codex settings, installation failure/retry, missing-CLI installation button and environment settings navigation");
}
require("../../dist/main/index.js");const timer=setTimeout(()=>app.exit(1),60000);app.whenReady().then(run).then(()=>{clearTimeout(timer);app.exit(0);}).catch(error=>{console.error(error);console.error(root);app.exit(1);});
