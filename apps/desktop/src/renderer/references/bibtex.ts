export interface BibEntryPreview {
  entryType: string;
  citationKey: string;
  fields: Record<string, string>;
  rawBibtex: string;
  start: number;
  end: number;
  valid: boolean;
  error?: string;
}

export interface CitationOccurrence {
  filePath: string;
  line: number;
  column: number;
  command: string;
  key: string;
  start: number;
  end: number;
}

function splitTopLevel(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\" && quoted) { index += 1; continue; }
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "{") depth += 1;
    else if (!quoted && character === "}") depth = Math.max(0, depth - 1);
    else if (!quoted && depth === 0 && character === ",") { result.push(value.slice(start, index)); start = index + 1; }
  }
  result.push(value.slice(start));
  return result;
}

function cleanValue(value: string): string {
  return value.trim().replace(/^\{([\s\S]*)\}$/, "$1").replace(/^"([\s\S]*)"$/, "$1").replace(/\s+/g, " ").trim();
}

export function parseBibtex(source: string): { entries: BibEntryPreview[]; invalid: Array<{ raw: string; message: string; start: number; end: number }> } {
  const entries: BibEntryPreview[] = [];
  const invalid: Array<{ raw: string; message: string; start: number; end: number }> = [];
  const marker = /@([A-Za-z][\w-]*)\s*([({])/g;
  for (const match of source.matchAll(marker)) {
    const start = match.index ?? 0;
    const opener = match[2];
    if (!opener) continue;
    const closer = opener === "{" ? "}" : ")";
    let depth = 1;
    let quoted = false;
    let end = start + match[0].length;
    for (let index = end; index < source.length; index += 1) {
      const character = source[index];
      if (character === "\\" && quoted) { index += 1; continue; }
      if (character === '"') quoted = !quoted;
      if (!quoted && character === opener) depth += 1;
      if (!quoted && character === closer) { depth -= 1; if (depth === 0) { end = index + 1; break; } }
    }
    const raw = source.slice(start, depth === 0 ? end : source.length);
    if (depth !== 0) { invalid.push({ raw, message: `Unclosed @${match[1]} entry.`, start, end: source.length }); break; }
    if (["comment", "preamble", "string"].includes(match[1]?.toLocaleLowerCase() ?? "")) continue;
    const parts = splitTopLevel(raw.slice(match[0].length, -1));
    const citationKey = parts.shift()?.trim() ?? "";
    const fields: Record<string, string> = {};
    let valid = Boolean(citationKey);
    let error = citationKey ? undefined : `@${match[1]} is missing a citation key.`;
    for (const part of parts) {
      const equal = part.indexOf("=");
      if (equal < 0) { if (part.trim()) { valid = false; error ??= `Invalid field in ${citationKey || match[1]}.`; } continue; }
      const name = part.slice(0, equal).trim().toLocaleLowerCase();
      if (name) fields[name] = cleanValue(part.slice(equal + 1));
    }
    entries.push({ entryType: match[1]?.toLocaleLowerCase() ?? "unknown", citationKey, fields, rawBibtex: raw, start, end, valid, ...(error ? { error } : {}) });
  }
  return { entries, invalid };
}

export function field(entry: Pick<BibEntryPreview, "fields">, name: string): string {
  return entry.fields[name.toLocaleLowerCase()] ?? "";
}

export function citationOccurrences(documents: Array<{ filePath: string; content: string }>): CitationOccurrence[] {
  const occurrences: CitationOccurrence[] = [];
  const pattern = /\\([A-Za-z]*cite[A-Za-z]*)\s*(?:\[[^\]]*\]\s*)?\{([^{}]*)\}/g;
  for (const document of documents) {
    for (const match of document.content.matchAll(pattern)) {
      const command = match[1] ?? "cite";
      const keyStart = (match.index ?? 0) + match[0].indexOf("{") + 1;
      for (const key of (match[2] ?? "").split(",").map((item) => item.trim()).filter(Boolean)) {
        const local = (match[2] ?? "").indexOf(key);
        const offset = keyStart + Math.max(0, local);
        occurrences.push({ filePath: document.filePath, line: document.content.slice(0, offset).split("\n").length, column: offset - document.content.lastIndexOf("\n", offset - 1), command, key, start: offset, end: offset + key.length });
      }
    }
  }
  return occurrences;
}
