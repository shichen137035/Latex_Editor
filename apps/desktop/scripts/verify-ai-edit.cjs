// Small isolated edit probe through the production App Server bridge.
// Usage: node verify-ai-edit.cjs <user-data> <codex-exe>
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const [userData, executable] = process.argv.slice(2);
if (!userData || !executable) throw new Error("Pass user-data directory and Codex executable.");
const workspace = mkdtempSync(join(tmpdir(), "texweave-ai-edit-probe-"));
const mainFile = join(workspace, "main.tex");
writeFileSync(mainFile, "\\documentclass{article}\n\\begin{document}\nAlpha\n\\end{document}\n", "utf8");

(async () => {
  const { CodexAppServer } = await import("../dist/main/ai/codex-app-server.js");
  const server = new CodexAppServer({ userDataPath: resolve(userData), executable: () => resolve(executable), version: "0.5.1", onApprovalDecision: (event) => console.log("approval:", event.method, event.approved) });
  let answer = "";
  let complete;
  const done = new Promise((resolveDone) => { complete = resolveDone; });
  const unsubscribe = server.onEvent((event) => {
    if (event.method === "item/started" && event.params.item?.type === "fileChange") console.log("file change item paths:", event.params.item.changes?.map((change) => change.path));
    if (event.method === "item/fileChange/patchUpdated") console.log("patch paths:", event.params.changes?.map((change) => change.path));
    if (event.method === "item/agentMessage/delta") answer += String(event.params.delta ?? "");
    if (event.method === "turn/completed") complete(String(event.params.turn?.status ?? "unknown"));
  });
  const timeout = setTimeout(() => complete("timeout"), 90000);
  try {
    const status = await server.refresh();
    if (status.auth !== "signed_in") throw new Error("The TeXWeave AI profile is not signed in.");
    await server.startTurn({ cwd: workspace, mode: "codex", prompt: "Read main.tex, then use the file change/patch tool to replace the single word Alpha with Beta. Change no other text or files." });
    const result = await done;
    const content = readFileSync(mainFile, "utf8");
    console.log("turn status:", result, "file changed:", content.includes("Beta") && !content.includes("Alpha"), "answer:", answer.slice(0, 350));
    if (result !== "completed" || !content.includes("Beta") || content.includes("Alpha")) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); unsubscribe(); await server.stop(); rmSync(workspace, { recursive: true, force: true }); }
})();
