/**
 * Convert a Hunspell .dic file into a plain UTF-8 word list.
 * Kazakh's legacy dictionary contains an extensive affix table and many listed
 * inflected forms. Keeping only those explicit forms bounds nspell's memory
 * use; the full affix rules are not expanded during installation.
 */
export function flattenHunspellDictionary(dic: string): string {
  const lines = dic.replace(/^\uFEFF/, "").split(/\r?\n/);
  const first = lines[0]?.trim() ?? "";
  const sourceLines = /^\d+$/.test(first) ? lines.slice(1) : lines;
  const words = new Set<string>();
  for (const line of sourceLines) {
    const value = line.trim();
    if (!value) continue;
    const slash = value.indexOf("/");
    const word = (slash < 0 ? value : value.slice(0, slash)).replaceAll("\\/", "/");
    if (/^[\p{L}\p{M}'’ʼ-]{1,100}$/u.test(word)) words.add(word);
  }
  if (words.size < 1000) throw new Error("Kazakh dictionary is empty or incomplete");
  if (words.size > 250_000) throw new Error("Kazakh dictionary is unexpectedly large");
  return `${words.size}\n${[...words].join("\n")}\n`;
}
