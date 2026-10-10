import type { ProjectPdfDocument } from "@latex-editor/contracts";

export function previewDocumentForSource(documents: ProjectPdfDocument[], path: string | undefined, main: string | undefined, selected?: string): ProjectPdfDocument | undefined {
  const file = path?.replaceAll("\\", "/");
  const direct = file ? documents.find(doc => doc.sourceFile === file || doc.pdfFile === file || doc.id === file) : undefined;
  if (direct) return direct;
  const owners = documents.filter(doc => file && doc.sourceFiles.includes(file));
  return owners.find(doc => doc.id === selected) ?? owners.find(doc => doc.sourceFile === main) ?? owners[0]
    ?? documents.find(doc => doc.sourceFile === main) ?? documents[0];
}

export function compilationTargets(mainFile: string, activePath?: string): string[] {
  const selected = activePath?.replaceAll("\\", "/");
  return selected && /\.tex$/i.test(selected) && selected !== mainFile.replaceAll("\\", "/") ? [mainFile, selected] : [mainFile];
}

/** PDF links are relative to the public PDF, never the isolated build folder. */
export function projectPdfLink(documents: ProjectPdfDocument[], current: ProjectPdfDocument, href: string, main?: string): { id: string; destination?: string } | undefined {
  if (/^[A-Za-z][A-Za-z\d+.-]*:|^[\\/]/.test(href)) return;
  const [rawPath, ...fragment] = href.split("#");
  let path: string;
  try { path = decodeURIComponent(rawPath ?? ""); } catch { return; }
  if (path && !/\.pdf$/i.test(path)) return;
  const publicFile = (doc: ProjectPdfDocument) => doc.sourceFile && doc.sourceFile === main ? pdfFileForSource(main)!
    : doc.sourceFile ? doc.sourceFile.replace(/\.tex$/i, ".pdf") : doc.pdfFile;
  const normalize = (value: string) => {
    const parts: string[] = [];
    for (const part of value.split("/")) {
      if (part === "..") { if (!parts.length) return; parts.pop(); }
      else if (part && part !== ".") parts.push(part);
    }
    return parts.join("/");
  };
  const directory = publicFile(current).split("/").slice(0, -1).join("/");
  const candidates = [normalize(`${directory}/${path}`), normalize(path)];
  const document = !path ? current : candidates.map(candidate => documents.find(doc => publicFile(doc) === candidate || doc.pdfFile === candidate)).find(Boolean);
  if (!document) return;
  let destination: string | undefined;
  try { destination = fragment.length ? decodeURIComponent(fragment.join("#")) : undefined; } catch { return; }
  return { id: document.id, ...(destination ? { destination } : {}) };
}

export function pdfFileForSource(source?: string): string | undefined {
  return source?.split(/[\\/]/).at(-1)?.replace(/\.tex$/i, ".pdf");
}

/** Only a project output can be used for SyncTeX; scratch PDFs are handled separately. */
export function projectPdfFile(root: string, absolute?: string): string | undefined {
  if (!absolute) return;
  const prefix = root.replaceAll("\\", "/").replace(/\/$/, "") + "/", path = absolute.replaceAll("\\", "/");
  const within = /^[A-Za-z]:\//.test(prefix) ? path.toLowerCase().startsWith(prefix.toLowerCase()) : path.startsWith(prefix);
  const local = within ? path.slice(prefix.length) : undefined;
  return local && !local.split("/").includes("..") ? local : undefined;
}
