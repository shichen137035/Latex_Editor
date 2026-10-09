import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { LatexmkCompilerService } from "../../packages/compiler-latexmk/src/index.js";

it("serializes the same build directory and keeps immutable per-run PDF results", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-compile-artifacts-"));
  try {
    const script = join(root, "compiler.cjs");
    await writeFile(join(root, "main.tex"), "test input");
    await writeFile(script, `const fs = require('node:fs');
const step = fs.existsSync('step.txt') ? Number(fs.readFileSync('step.txt','utf8')) + 1 : 1;
fs.writeFileSync('step.txt',String(step)); fs.appendFileSync('timeline.txt','start'+step+'\\n');
setTimeout(() => { fs.writeFileSync('main.pdf','PDF result '+step); fs.appendFileSync('timeline.txt','end'+step+'\\n'); },80);`);
    const compiler = new LatexmkCompilerService({ projects: {} as never, files: {} as never, profiles: { getCompilerProfile: () => ({ id: "fake", executable: process.execPath, arguments: [script], timeoutMs: 5000 }) }, clock: { now: () => new Date() } });
    const [first, second] = await Promise.all([compiler.compileWorkspace({ workspaceRoot: root, mainFile: "main.tex" }), compiler.compileWorkspace({ workspaceRoot: root, mainFile: "main.tex" })]);
    expect(first.status).toBe("succeeded"); expect(second.status).toBe("succeeded");
    expect(await readFile(join(root, "timeline.txt"), "utf8")).toBe("start1\nend1\nstart2\nend2\n");
    const artifacts = await Promise.all([first.pdfArtifactPath!, second.pdfArtifactPath!].map(path => readFile(path, "utf8")));
    expect(new Set(artifacts)).toEqual(new Set(["PDF result 1", "PDF result 2"]));
    expect(await readFile(first.pdfPath!, "utf8")).toBe("PDF result 2");
  } finally { await rm(root, { recursive: true, force: true }); }
});
