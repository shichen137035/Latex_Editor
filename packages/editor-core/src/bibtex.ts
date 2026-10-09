import { maskLatexComments } from "./latex-source.js";

export interface BibEntry {
  entryType: string;
  citationKey: string;
  fields: Record<string, string>;
  rawBibtex: string;
  start: number;
  end: number;
  valid: boolean;
  error?: string;
}

export interface BibtexDiagnostic {
  raw: string;
  message: string;
  start: number;
  end: number;
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

const entryMarker = /^@([A-Za-z][\w-]*)\s*([({])/;
const specialEntries = new Set(["comment", "preamble", "string"]);

function splitTopLevel(value: string): string[] {
  const result: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\\") { index += 1; continue; }
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === "{") braceDepth += 1;
    else if (!quoted && character === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (!quoted && braceDepth === 0 && character === "(") parenDepth += 1;
    else if (!quoted && braceDepth === 0 && character === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (!quoted && braceDepth === 0 && parenDepth === 0 && character === ",") {
      result.push(value.slice(start, index));
      start = index + 1;
    }
  }
  result.push(value.slice(start));
  return result;
}

function cleanFieldValue(value: string): string {
  return value.trim().replace(/^\{([\s\S]*)\}$/, "$1").replace(/^"([\s\S]*)"$/, "$1").replace(/\s+/g, " ").trim();
}

function findEntryEnd(source: string, bodyStart: number, opener: "{" | "("): number | undefined {
  let braceDepth = opener === "{" ? 1 : 0;
  let parenDepth = opener === "(" ? 1 : 0;
  let quoted = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\") { index += 1; continue; }
    if (character === '"') quoted = !quoted;
    if (quoted) continue;
    if (character === "{") braceDepth += 1;
    else if (character === "}" && braceDepth > 0) {
      braceDepth -= 1;
      if (opener === "{" && braceDepth === 0) return index + 1;
    } else if (opener === "(" && braceDepth === 0 && character === "(") parenDepth += 1;
    else if (opener === "(" && braceDepth === 0 && character === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) return index + 1;
    }
  }
  return undefined;
}

/** One parser for both project .bib previews and the shared library importer. */
export function parseBibtex(source: string): { entries: BibEntry[]; invalid: BibtexDiagnostic[] } {
  const entries: BibEntry[] = [];
  const invalid: BibtexDiagnostic[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    let start = cursor;
    let match: RegExpMatchArray | null = null;
    while (start < source.length) {
      if (source[start] === "%") {
        const newline = source.indexOf("\n", start);
        start = newline < 0 ? source.length : newline + 1;
        continue;
      }
      if (source[start] === "@") {
        match = source.slice(start).match(entryMarker);
        if (match) break;
      }
      start += 1;
    }
    if (!match) break;

    const entryType = (match[1] ?? "unknown").toLowerCase();
    const opener = match[2] as "{" | "(" | undefined;
    if (!opener) { cursor = start + 1; continue; }
    const bodyStart = start + match[0].length;
    const end = findEntryEnd(source, bodyStart, opener);
    if (end === undefined) {
      invalid.push({ raw: source.slice(start), message: `Unclosed @${entryType} entry.`, start, end: source.length });
      break;
    }

    cursor = end;
    const rawBibtex = source.slice(start, end);
    if (specialEntries.has(entryType)) continue;

    const content = source.slice(bodyStart, end - 1);
    const parts = splitTopLevel(content);
    const citationKey = parts.shift()?.trim() ?? "";
    const fields: Record<string, string> = {};
    let valid = isValidCitationKey(citationKey);
    let error = valid ? undefined : citationKey ? `Invalid citation key in @${entryType}.` : `@${entryType} is missing a citation key.`;
    if (!valid) invalid.push({ raw: rawBibtex, message: error!, start, end });

    for (const part of parts) {
      const equal = part.indexOf("=");
      if (equal < 0) {
        if (part.trim()) {
          valid = false;
          error ??= `Invalid field in ${citationKey || entryType}.`;
          invalid.push({ raw: part.trim(), message: error, start, end });
        }
        continue;
      }
      const name = part.slice(0, equal).trim().toLowerCase();
      if (name) fields[name] = cleanFieldValue(part.slice(equal + 1));
    }

    entries.push({ entryType, citationKey, fields, rawBibtex, start, end, valid, ...(error ? { error } : {}) });
  }
  return { entries, invalid };
}

export function field(entry: Pick<BibEntry, "fields">, name: string): string {
  return entry.fields[name.toLowerCase()] ?? "";
}

export function isValidCitationKey(key: string): boolean {
  return Boolean(key.trim()) && !/[\s,{}()\\%#]/.test(key);
}

export function citationKeyIdentity(key: string): string {
  return key.trim().toLowerCase();
}

export function renderBibtexEntry(entry: Pick<BibEntry, "entryType" | "citationKey" | "fields">, citationKey = entry.citationKey): string {
  const fields = Object.entries(entry.fields)
    .filter(([, value]) => value.trim())
    .map(([name, value]) => `  ${name} = {${value}}`)
    .join(",\n");
  return `@${entry.entryType}{${citationKey}${fields ? `,\n${fields}` : ""}\n}`;
}

export function bibtexEntryWithKey(entry: Pick<BibEntry, "entryType" | "citationKey" | "fields"> & { rawBibtex?: string }, citationKey: string): string {
  if (entry.rawBibtex) {
    return entry.rawBibtex.replace(/^(@[A-Za-z][\w-]*\s*[({]\s*)[^,})\s]+/, (_match, prefix: string) => `${prefix}${citationKey}`);
  }
  return renderBibtexEntry(entry, citationKey);
}

export function citationOccurrences(documents: Array<{ filePath: string; content: string }>): CitationOccurrence[] {
  const occurrences: CitationOccurrence[] = [];
  const pattern = /(?<!\\)\\([A-Za-z]*cite[A-Za-z]*)\*?\s*(?:\[[^\]]*\]\s*)*\{([^{}]*)\}/g;
  for (const document of documents) {
    // Mask comments without changing offsets used by source navigation.
    const searchable = maskLatexComments(document.content);
    for (const match of searchable.matchAll(pattern)) {
      const command = match[1] ?? "cite";
      const body = match[2] ?? "";
      const keyStart = (match.index ?? 0) + match[0].lastIndexOf("{") + 1;
      let bodyOffset = 0;
      for (const key of body.split(",").map((item) => item.trim()).filter(Boolean)) {
        const local = body.indexOf(key, bodyOffset);
        const offset = keyStart + Math.max(0, local);
        bodyOffset = Math.max(0, local) + key.length;
        occurrences.push({
          filePath: document.filePath,
          line: document.content.slice(0, offset).split("\n").length,
          column: offset - document.content.lastIndexOf("\n", offset - 1),
          command,
          key,
          start: offset,
          end: offset + key.length
        });
      }
    }
  }
  return occurrences;
}
