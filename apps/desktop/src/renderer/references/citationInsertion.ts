import { isValidCitationKey } from "./bibtex.js";

// Local Preview editors register only while mounted. Closing a file/project removes its target.
const targets = new Set<{ projectId: string; path: string; insert(text: string): boolean }>();
export function registerCitationTarget(projectId: string, path: string, insert: (text: string) => boolean) {
  const target = { projectId, path, insert };
  targets.add(target);
  return () => { targets.delete(target); };
}
export function insertPreviewCitation(projectId: string, path: string, text: string): boolean {
  for (const target of [...targets].reverse()) if (target.projectId === projectId && target.path === path && target.insert(text)) return true;
  return false;
}
export function citationText(key: string): string {
  if (!isValidCitationKey(key)) throw new Error("Invalid citation key.");
  return `\\cite{${key}}`;
}
export function citationInsertionOffset(content: string, requested?: number): number {
  if (requested !== undefined) return Math.max(0, Math.min(content.length, requested));
  const end = content.lastIndexOf("\\end{document}");
  return end < 0 ? content.length : end;
}
