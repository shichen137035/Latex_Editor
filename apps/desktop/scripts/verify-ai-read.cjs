// Verifies that the real TeXWeave App Server bridge can inspect a project working copy.
// Usage: node verify-ai-read.cjs <workspace> <user-data> <codex-exe>
const { resolve } = require("node:path");

const [workspace, userData, executable] = process.argv.slice(2);
if (!workspace || !userData || !executable) throw new Error("Pass workspace, user-data directory, and Codex executable.");

(async () => {
  const { CodexAppServer } = await import("../dist/main/ai/codex-app-server.js");
  const server = new CodexAppServer({ userDataPath: resolve(userData), executable: () => resolve(executable), version: "0.5.1", onApprovalDecision: (event) => console.log("approval:", event.method, event.approved, String(event.command ?? "").slice(0, 250)) });
  let answer = "";
  let complete;
  const done = new Promise((resolveDone) => { complete = resolveDone; });
  const unsubscribe = server.onEvent((event) => {
    if (event.method === "item/started" || event.method === "item/completed") console.log("item:", event.method, String(event.params.item?.type ?? "unknown"));
    if (event.method === "item/agentMessage/delta") answer += String(event.params.delta ?? "");
    if (event.method === "turn/completed") complete(String(event.params.turn?.status ?? "unknown"));
  });
  const timeout = setTimeout(() => complete("timeout"), 90000);
  try {
    const status = await server.refresh();
    if (status.auth !== "signed_in") throw new Error("The TeXWeave AI profile is not signed in.");
    await server.startTurn({
      cwd: resolve(workspace),
      mode: "codex",
      prompt: "Use your shell tool to run Get-ChildItem -LiteralPath . -File -Name in the current workspace. Reply only with the count of .tex files and whether main.tex exists. Do not print contents or change files."
    });
    const result = await done;
    console.log("turn status:", result);
    console.log("answer:", answer.slice(0, 700));
    if (result !== "completed" || !/main\.tex exists:\s*yes/i.test(answer)) process.exitCode = 1;
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { clearTimeout(timeout); unsubscribe(); await server.stop(); }
})();
