export function compilationTargets(mainFile: string, activePath?: string): string[] {
  const selected = activePath?.replaceAll("\\", "/");
  return selected && /\.tex$/i.test(selected) && selected !== mainFile.replaceAll("\\", "/") ? [mainFile, selected] : [mainFile];
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
