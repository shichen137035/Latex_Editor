// Optional live Codex probes: read <workspace> <user-data> <codex-exe>, or edit <user-data> <codex-exe>.
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const [mode, ...args] = process.argv.slice(2);
const allowedModes = ["read", "edit"];
if (!allowedModes.includes(mode)) throw new Error(`Choose a probe: ${allowedModes.join(" or ")}.`);

const [workspaceArgument, userDataArgument, executableArgument] = mode === "read" ? args : [undefined, ...args];
if (!userDataArgument || !executableArgument || (mode === "read" && !workspaceArgument)) {
  const usage = mode === "read"
    ? "read <workspace> <user-data-directory> <codex-executable>"
    : "edit <user-data-directory> <codex-executable>";
  throw new Error(`Usage: node apps/desktop/scripts/ai/probe.cjs ${usage}`);
}

const workspace = mode === "edit"
  ? mkdtempSync(join(tmpdir(), "texweave-ai-edit-probe-"))
  : resolve(workspaceArgument);
const userData = resolve(userDataArgument);
const executable = resolve(executableArgument);
const mainFile = join(workspace, "main.tex");
if (mode === "edit") {
  writeFileSync(mainFile, "\\documentclass{article}\n\\begin{document}\nAlpha\n\\end{document}\n", "utf8");
}

async function run() {
  const { CodexAppServer } = await import("../../../../apps/desktop/dist/main/ai/codex-app-server.js");
  const version = require("../../../../package.json").version;
  const server = new CodexAppServer({
    userDataPath: userData,
    executable: () => executable,
    version,
    onApprovalDecision: event => console.log("approval:", event.method, event.approved, String(event.command ?? "").slice(0, 250))
  });
  let answer = "";
  let complete;
  const done = new Promise(resolveDone => { complete = resolveDone; });
  const unsubscribe = server.onEvent(event => {
    if (event.method === "item/started" || event.method === "item/completed") {
      const item = event.params.item;
      if (mode === "edit" && item?.type === "fileChange") console.log("file changes:", item.changes?.map(change => change.path));
      else if (mode === "read") console.log("item:", event.method, String(item?.type ?? "unknown"));
    }
    if (event.method === "item/fileChange/patchUpdated") console.log("patch paths:", event.params.changes?.map(change => change.path));
    if (event.method === "item/agentMessage/delta") answer += String(event.params.delta ?? "");
    if (event.method === "turn/completed") complete(String(event.params.turn?.status ?? "unknown"));
  });
  const timeout = setTimeout(() => complete("timeout"), 90000);
  try {
    const status = await server.refresh();
    if (status.auth !== "signed_in") throw new Error("The TeXWeave AI profile is not signed in.");
    const prompt = mode === "read"
      ? "Use your shell tool to run Get-ChildItem -LiteralPath . -File -Name in the current workspace. Reply only with the count of .tex files and whether main.tex exists. Do not print contents or change files."
      : "Read main.tex, then use the file change/patch tool to replace the single word Alpha with Beta. Change no other text or files.";
    await server.startTurn({ cwd: workspace, mode: "codex", prompt });
    const result = await done;
    if (mode === "edit") {
      const content = readFileSync(mainFile, "utf8");
      const changed = content.includes("Beta") && !content.includes("Alpha");
      console.log("turn status:", result, "file changed:", changed, "answer:", answer.slice(0, 350));
      if (result !== "completed" || !changed) process.exitCode = 1;
    } else {
      console.log("turn status:", result, "answer:", answer.slice(0, 700));
      if (result !== "completed" || !/main\.tex exists:\s*yes/i.test(answer)) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timeout);
    unsubscribe();
    await server.stop();
    if (mode === "edit") rmSync(workspace, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  if (mode === "edit") rmSync(workspace, { recursive: true, force: true });
  process.exitCode = 1;
});
