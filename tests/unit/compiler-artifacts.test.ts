import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { expect, it } from "vitest";
import { LatexmkCompilerService } from "../../packages/compiler-latexmk/src/index.js";

it("publishes secondary PDFs and external-reference labels while keeping build files isolated", async () => {
  const root = await mkdtemp(join(tmpdir(), "texweave-secondary-pdf-"));
  try {
    await mkdir(join(root, "supplement"));
    await writeFile(join(root, "main.pdf"), "Primary PDF");
    await writeFile(join(root, "supplement/main.tex"), "Secondary input");
    const script = join(root, "compiler.cjs");
    await writeFile(script, `const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2), dir = args.find(arg => arg.startsWith('-outdir=')).slice(8);
fs.writeFileSync(path.join(dir, 'main.pdf'), 'Secondary PDF');
fs.writeFileSync(path.join(dir, 'main.aux'), 'Auxiliary data');
fs.writeFileSync(path.join(dir, 'main.fls'), '');`);
    const compiler = new LatexmkCompilerService({
      projects: { getProject: () => ({ id: "project", canonicalPath: root, mainFile: "main.tex" }) } as never,
      files: { resolveFilePath: async (_id: string, path: string) => resolve(root, path) } as never,
      profiles: { getCompilerProfile: () => ({ id: "fake", executable: process.execPath, arguments: [script], timeoutMs: 5000 }) },
      clock: { now: () => new Date() }
    });
    const result = await compiler.compile({ projectId: "project", mainFile: "supplement/main.tex" });
    expect(result.status).toBe("succeeded");
    expect(await readFile(join(root, "supplement/main.pdf"), "utf8")).toBe("Secondary PDF");
    expect(await readFile(join(root, "main.pdf"), "utf8")).toBe("Primary PDF");
    expect(basename(result.pdfPath!)).toBe("main.pdf");
    expect(result.pdfPath).not.toBe(join(root, "supplement/main.pdf"));
    expect(await readFile(join(root, "supplement/main.aux"), "utf8")).toBe("Auxiliary data");
    await expect(readFile(join(root, "supplement/main.fls"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

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
