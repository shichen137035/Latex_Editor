import { basename, dirname, extname, relative, resolve } from "node:path";
import { access } from "node:fs/promises";
import type { Project, ProjectPdfDocument, ProjectTreeNode } from "@latex-editor/contracts" with { "resolution-mode": "import" };

export async function projectPdfDocuments(project: Project, files: {
  listTree(projectId: string): Promise<ProjectTreeNode[]>;
  readText(projectId: string, path: string): Promise<{ content: string }>;
  resolveFilePath(projectId: string, path: string, exists?: boolean): Promise<string>;
}): Promise<ProjectPdfDocument[]> {
  const { isStandaloneLatexDocument, latexDocumentLinks, latexDocumentPathCandidates } = await import("@latex-editor/editor-core/latex-source");
  const { documentOutputDirectory } = await import("@latex-editor/compiler-latexmk");
  const paths: string[] = [];
  const walk = (nodes: ProjectTreeNode[]) => {
    for (const node of nodes) {
      if (/(?:^|\/)(?:\.texweave|\.latex-editor)(?:\/|$)/.test(node.relativePath)) continue;
      if (node.kind === "file") paths.push(node.relativePath);
      if (node.children) walk(node.children);
    }
  };
  walk(await files.listTree(project.id));
  const sources = new Map<string, string>();
  await Promise.all(paths.filter(path => /\.tex$/i.test(path)).map(async path => {
    try { sources.set(path, (await files.readText(project.id, path)).content); } catch { /* Unreadable source stays out of ownership discovery. */ }
  }));
  const included = (file: string, seen = new Set<string>()): string[] => {
    if (seen.has(file)) return [];
    seen.add(file);
    for (const link of latexDocumentLinks(sources.get(file) ?? "")) {
      if (link.kind !== "include") continue;
      const target = latexDocumentPathCandidates(file, link.path).find(path => sources.has(path));
      if (target) included(target, seen);
    }
    return [...seen];
  };
  const exists = async (path: string) => {
    try { await access(await files.resolveFilePath(project.id, path, true)); return true; } catch { return false; }
  };
  const outputs: ProjectPdfDocument[] = [], owned = new Set<string>();
  for (const [sourceFile, source] of [...sources].sort(([a], [b]) => a.localeCompare(b))) {
    if (sourceFile !== project.mainFile && !isStandaloneLatexDocument(source)) continue;
    const output = documentOutputDirectory(project.canonicalPath, sourceFile, project.mainFile);
    const stem = basename(sourceFile, extname(sourceFile));
    const internalPdf = relative(project.canonicalPath, resolve(output, `${stem}.pdf`)).replaceAll("\\", "/");
    const publicPdf = output === project.canonicalPath ? `${stem}.pdf` : `${dirname(sourceFile)}/${stem}.pdf`.replace(/^\.\//, "");
    const internalExists = await exists(internalPdf);
    const pdfFile = internalExists ? internalPdf : publicPdf;
    owned.add(publicPdf); owned.add(internalPdf);
    const syncReady = internalExists && (await exists(internalPdf.replace(/\.pdf$/i, ".synctex.gz")) || await exists(internalPdf.replace(/\.pdf$/i, ".synctex")));
    outputs.push({ id: sourceFile, sourceFile, sourceFiles: included(sourceFile), pdfFile,
      ...(syncReady ? { syncFile: internalPdf } : {}), available: internalExists || await exists(publicPdf) });
  }
  for (const path of paths.filter(path => /\.pdf$/i.test(path) && !owned.has(path)).sort()) {
    const syncReady = await exists(path.replace(/\.pdf$/i, ".synctex.gz")) || await exists(path.replace(/\.pdf$/i, ".synctex"));
    outputs.push({ id: path, pdfFile: path, sourceFiles: [], ...(syncReady ? { syncFile: path } : {}), available: true });
  }
  return outputs.sort((a, b) => Number(b.sourceFile === project.mainFile) - Number(a.sourceFile === project.mainFile));
}
