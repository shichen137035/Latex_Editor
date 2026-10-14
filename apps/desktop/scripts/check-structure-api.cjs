const { app } = require("electron");
const { mkdtempSync, mkdirSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");

// A separate registry/settings/project root; never opens or edits the user's papers.
const root = mkdtempSync(resolve(tmpdir(), "texweave-structure-check-"));
const projectRoot = resolve(root, "projects");
mkdirSync(projectRoot);
app.setPath("userData", resolve(root, "user-data"));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
let window;
app.on("browser-window-created", (_event, created) => { window = created; created.on("show", () => created.hide()); });
const evaluate = (code) => window.webContents.executeJavaScript(code, true);
async function until(code, label) {
  for (let attempt = 0; attempt < 100; attempt++) { if (window && !window.webContents.isLoadingMainFrame() && await evaluate(code)) return; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
const data = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data; };

async function run() {
  await until("Boolean(window.latexEditor?.structure)", "structure bridge");
  const source = String.raw`\documentclass{article}
\begin{document}
\section{Main}
\begin{theorem}[Target]\label{thm:target}
Body paragraph.

\begin{equation}\label{eq:target}x=y\end{equation}
\end{theorem}
\section{Empty}
\end{document}`;
  const project = await evaluate(`window.latexEditor.projects.create({ name: "structure-test", parentPath: ${JSON.stringify(projectRoot)} })`);
  await evaluate(`window.latexEditor.files.write(${JSON.stringify(project.id)}, "main.tex", ${JSON.stringify(source)})`);
  const call = (name, input) => evaluate(`window.latexEditor.structure[${JSON.stringify(name)}](${JSON.stringify(project.id)}, ${JSON.stringify(input)})`);
  const theorem = data(await call("find_blocks", { label: "thm:target" }))[0];
  const detail = data(await call("get_block", { blockId: theorem.id }));
  assert.deepEqual(detail.children.map((child) => child.type), ["paragraph", "equation"]);
  const paragraph = data(await call("get_block_source", { blockId: detail.children[0].id }));
  const changed = data(await call("replace_block_content", { blockId: paragraph.blockId, expectedRevision: paragraph.revision, content: "Edited body paragraph." }));
  assert.equal(changed.revision, paragraph.revision + 1);
  const stale = await call("replace_block_content", { blockId: paragraph.blockId, expectedRevision: paragraph.revision, content: "Must not be written" });
  assert.equal(stale.error.code, "STALE_BLOCK");
  const saved = await evaluate(`window.latexEditor.files.read(${JSON.stringify(project.id)}, "main.tex")`);
  assert(saved.content.includes("Edited body paragraph."));
  assert(saved.content.includes("x=y"));
  assert(saved.content.includes("\\label{thm:target}"));
  assert(!saved.content.includes("Must not be written"));
  const snapshot = data(await evaluate(`window.latexEditor.structure.snapshot(${JSON.stringify(project.id)})`));
  assert.equal(snapshot.schemaVersion, 2);
  assert(!Array.isArray(snapshot.blocks));
  assert(Object.values(snapshot.blocks).some((block) => block.placeholder));
  const legacyGraph = await evaluate(`window.latexEditor.blockGraph.snapshot(${JSON.stringify(project.id)})`);
  assert(legacyGraph.blocks.some((block) => block.id === theorem.id));
  const structuralChildren = await evaluate(`window.latexEditor.blockGraph.getStructuralChildren(${JSON.stringify(project.id)}, ${JSON.stringify(theorem.id)})`);
  // The graph API returns structural child IDs in stable lexical order while
  // the document index keeps source order; verify membership, not ordering.
  assert.deepEqual([...structuralChildren].sort(), [...snapshot.blocks[theorem.id].childIds].sort());
  const neighborhood = await evaluate(`window.latexEditor.blockGraph.getRelationNeighborhood(${JSON.stringify(project.id)}, ${JSON.stringify(theorem.id)}, "both", 1)`);
  assert(neighborhood);
  const persisted = readFileSync(resolve(project.canonicalPath, ".texweave", "structure.json"), "utf8");
  assert(!persisted.includes("Edited body paragraph."));

  window.webContents.reload();
  await until("Boolean(document.querySelector('.directory-project-row'))", "project directory");
  await evaluate("document.querySelector('.directory-project-row').click()");
  await until("Boolean(document.querySelector('.view-switch'))", "project workbench");
  await evaluate("Array.from(document.querySelectorAll('.view-switch button')).find(button => button.textContent === 'Visual').click()");
  await until("document.querySelector('.structured-preview')?.innerText.includes('Edited body paragraph.')", "shared Preview parser");
  await delay(200);
  assert.equal(data(await call("find_blocks", { label: "thm:target" }))[0].id, theorem.id);
  console.log("PASS: actual Electron IPC reads/writes, stale revision rejection, canonical index, and Preview compatibility.");
}

const timeout = setTimeout(() => { console.error("Structure IPC check timed out; artifacts:", root); app.exit(1); }, 45000);
require("../dist/main/index.js");
app.whenReady().then(run).then(() => { clearTimeout(timeout); app.exit(0); }).catch((error) => { clearTimeout(timeout); console.error(error); console.error("Artifacts:", root); app.exit(1); });
