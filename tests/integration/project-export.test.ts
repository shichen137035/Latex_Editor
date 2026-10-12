import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createProjectSourceArchive } from "../../apps/desktop/src/main/project-export.js";
import { readRecorderDependencies } from "../../packages/compiler-latexmk/src/recorder.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function setup(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), "texweave-export-")); roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return { root, output: join(root, "export.zip") };
}

// Read actual ZIP file entries and data, rather than checking only the selection plan.
async function contents(path: string) {
  const zip = await readFile(path), files = new Map<string, string>();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x0403_4b50) {
    expect(zip.readUInt16LE(offset + 6)).toBe(0x0800);
    const size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const name = zip.subarray(offset + 30, offset + 30 + nameLength).toString("utf8").split("/").slice(1).join("/");
    const start = offset + 30 + nameLength + extra;
    files.set(name, inflateRawSync(zip.subarray(start, start + size)).toString("utf8"));
    offset = start + size;
  }
  expect(zip.readUInt32LE(offset)).toBe(0x0201_4b50);
  return files;
}

describe("project exports", () => {
  it("exports all source and resource files, excluding every document PDF, metadata and byproducts", async () => {
    const { root, output } = await setup({
      "nested/main.tex": String.raw`\includegraphics{fig/generated}`, "nested/main.pdf": "compiled", "main.pdf": "compiled nested primary", "other.tex": "other", "other.pdf": "compiled other",
      "fig/generated.tex": String.raw`\documentclass{standalone}`, "fig/generated.pdf": "generated figure resource",
      "images/diagram.pdf": "PDF resource", "章节/数据.csv": "1,2", "custom.ist": "index style",
      "nested/main.aux": "aux", "main.log": "log", ".texweave/history/large": "history", ".latex-editor/old": "legacy", ".git/config": "git", "node_modules/package": "package", "export.zip": "previous export"
    });
    await createProjectSourceArchive(root, "nested/main.tex", output);
    const files = await contents(output);
    expect([...files.keys()].sort()).toEqual(["custom.ist", "fig/generated.tex", "fig/generated.pdf", "images/diagram.pdf", "nested/main.tex", "other.tex", "章节/数据.csv"].sort());
    expect(files.get("章节/数据.csv")).toBe("1,2");
  });

  it("exports the recursive main closure with images, bibliography, local styles, data and cross-document sources", async () => {
    const { root, output } = await setup({
      "main.tex": String.raw`\documentclass{local}\usepackage{custom,amsmath}\graphicspath{{fig/}}\input{chapters/a}\bibliography{refs,refs2}\bibliographystyle{local}\externaldocument[prefix-]{other}\InputIfFileExists{optional.tex}{}{} % \input{missing}`,
      "chapters/a.tex": String.raw`\includegraphics[width={.5\textwidth}]{绘图}\input chapters/b \pgfplotstableread{data/results.csv}`,
      "chapters/b.tex": String.raw`\input{chapters/a}\inputminted{python}{code/example.py}`,
      "local.cls": String.raw`\LoadClass{article}\RequirePackage{nested/local}`,
      "nested/local.sty": String.raw`\input{macros.def}`,
      "custom.sty": "custom package", "macros.def": "macros", "local.bst": "bib style", "refs.bib": "bib1", "refs2.bib": "bib2",
      "fig/绘图.pdf": "PDF figure", "fig/unused.png": "unused image", "data/results.csv": "1,2", "code/example.py": "print(1)",
      "other.tex": String.raw`\documentclass{article}\addbibresource{other.bib}`, "other.bib": "other bib", "other.pdf": "other compiled output",
      "unrelated.tex": "not included", "unused.bib": "unused", "main.pdf": "compiled main", "main.aux": "aux"
    });
    await createProjectSourceArchive(root, "main.tex", output, { scope: "main" });
    const files = await contents(output);
    expect([...files.keys()].sort()).toEqual(["main.tex", "chapters/a.tex", "chapters/b.tex", "local.cls", "nested/local.sty", "custom.sty", "macros.def", "local.bst", "refs.bib", "refs2.bib", "fig/绘图.pdf", "data/results.csv", "code/example.py", "other.tex", "other.bib"].sort());
    expect(files.get("main.tex")).toContain("\\externaldocument");
  });

  it("resolves nested imports and constant macros without requiring a compilation", async () => {
    const { root, output } = await setup({
      "paper/main.tex": String.raw`\def\figurepath{fig/plot}\import{parts/}{chapter}\includegraphics{\figurepath}`,
      "paper/parts/chapter.tex": String.raw`\subimport{details/}{body}`, "paper/parts/details/body.tex": "details",
      "fig/plot.png": "image", "unused.tex": "unused", "details/body.tex": "unrelated path with same name"
    });
    await createProjectSourceArchive(root, "paper/main.tex", output, { scope: "main" });
    expect([...(await contents(output)).keys()].sort()).toEqual(["paper/main.tex", "paper/parts/chapter.tex", "paper/parts/details/body.tex", "fig/plot.png"].sort());
  });

  it("uses current recorder inputs for dynamic resources but rejects stale records", async () => {
    const { root, output } = await setup({ "main.tex": String.raw`\includegraphics{\generatedName}`, "fig/actual.png": "dynamic", "unused.tex": "unused" });
    await expect(createProjectSourceArchive(root, "main.tex", output, { scope: "main" })).rejects.toThrow("Compile");
    await createProjectSourceArchive(root, "main.tex", output, { scope: "main", recorder: { inputs: ["main.tex", "fig/actual.png", ".texweave/build/generated.aux"], modifiedAt: Date.now() + 1000 } });
    expect([...(await contents(output)).keys()].sort()).toEqual(["fig/actual.png", "main.tex"]);
    const original = await readFile(output);
    await expect(createProjectSourceArchive(root, "main.tex", output, { scope: "main", recorder: { inputs: ["main.tex", "fig/actual.png"], modifiedAt: 0 } })).rejects.toThrow("Compile");
    expect(await readFile(output)).toEqual(original);
    await rm(join(root, "fig", "actual.png"));
    await expect(createProjectSourceArchive(root, "main.tex", output, { scope: "main", recorder: { inputs: ["main.tex", "fig/actual.png"], modifiedAt: Date.now() + 1000 } })).rejects.toThrow("Compile");
    expect(await readFile(output)).toEqual(original);
  });

  it("fails clearly on missing or outside dependencies without replacing an existing destination", async () => {
    const { root, output } = await setup({ "main.tex": String.raw`\input{missing}\includegraphics{../../outside}`, "export.zip": "keep previous archive" });
    await expect(createProjectSourceArchive(root, "main.tex", output, { scope: "main" })).rejects.toThrow("could not be resolved");
    expect(await readFile(output, "utf8")).toBe("keep previous archive");
    await expect(createProjectSourceArchive(root, "../outside.tex", output, { scope: "main" })).rejects.toThrow("could not be resolved");
  });

  it("shares the compiler recorder parser and honors its working directory and output flags", async () => {
    const { root } = await setup({ "main.tex": "main", "chapter.tex": "chapter" });
    const fls = `PWD ${root}\nINPUT main.tex\nINPUT chapter.tex\nINPUT chapter.tex\nINPUT ../outside.tex\nINPUT ${join(root, "images", "plot.pdf")}\n`;
    await mkdir(join(root, "aux")); await writeFile(join(root, "aux", "main.fls"), fls);
    const record = await readRecorderDependencies(root, "main.tex", ["-auxdir", "aux", "-outdir=elsewhere"]);
    expect(record?.inputs).toEqual(["chapter.tex", "images/plot.pdf", "main.tex"]);
    expect(record?.modifiedAt).toBeGreaterThan(0);
    expect(await readRecorderDependencies(root, "absent.tex", [])).toBeUndefined();
  });
});
