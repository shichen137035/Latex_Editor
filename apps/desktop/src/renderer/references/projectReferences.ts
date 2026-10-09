import { citationKeyIdentity, citationOccurrences, parseBibtex, type BibEntry } from "./bibtex.js";

export interface ReferenceDocument { fileId: string; content: string; }
export interface ProjectBibEntry extends BibEntry { filePath: string; id: string; uses: number; duplicate: boolean; }

/** Index the working documents, including unsaved BibTeX buffers, without importing them. */
export function indexProjectReferences(documents: ReferenceDocument[]) {
  const usage = new Map<string, number>();
  for (const occurrence of citationOccurrences(documents.filter(document => /\.tex$/i.test(document.fileId)).map(document => ({ filePath: document.fileId, content: document.content })))) {
    const key = citationKeyIdentity(occurrence.key);
    usage.set(key, (usage.get(key) ?? 0) + 1);
  }
  const files = documents.filter(document => /\.bib$/i.test(document.fileId)).map(document => ({
    path: document.fileId, ...parseBibtex(document.content)
  })).sort((a, b) => a.path.localeCompare(b.path));
  const counts = new Map<string, number>();
  for (const file of files) for (const entry of file.entries) {
    const key = citationKeyIdentity(entry.citationKey);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const entries: ProjectBibEntry[] = files.flatMap(file => file.entries.map(entry => ({
    ...entry, filePath: file.path, id: `${file.path}:${entry.start}`,
    uses: usage.get(citationKeyIdentity(entry.citationKey)) ?? 0,
    duplicate: (counts.get(citationKeyIdentity(entry.citationKey)) ?? 0) > 1
  })));
  return { files, entries };
}

export function filterProjectReferences(entries: ProjectBibEntry[], query: string, filePath = "", entryType = "") {
  const needle = query.trim().toLocaleLowerCase();
  return entries.filter(entry => (!filePath || entry.filePath === filePath) && (!entryType || entry.entryType === entryType)
    && (!needle || [entry.citationKey, entry.entryType, entry.filePath, ...Object.values(entry.fields)].join(" ").toLocaleLowerCase().includes(needle)));
}
