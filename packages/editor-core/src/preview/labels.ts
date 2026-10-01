import type { EnvironmentDefinition } from "./types.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keep automatically-created labels predictable and valid for normal LaTeX references. */
export function environmentLabelStem(environmentName: string): string {
  return environmentName.replace(/\*+$/, "").replace(/[^A-Za-z0-9:_-]+/g, "-") || "block";
}

function environmentBeginPattern(environmentName: string): RegExp {
  return new RegExp(`\\\\begin\\{${escapeRegExp(environmentName)}\\}`, "g");
}

function commandPattern(command: string): RegExp {
  return new RegExp(`\\\\${escapeRegExp(command)}\\*?\\{`, "g");
}

export function environmentOccurrence(source: string, environmentName: string, endOffset = source.length): number {
  const prefix = source.slice(0, Math.max(0, endOffset));
  return [...prefix.matchAll(environmentBeginPattern(environmentName))].length;
}

function commandOccurrence(source: string, command: string, endOffset = source.length): number {
  const prefix = source.slice(0, Math.max(0, endOffset));
  return [...prefix.matchAll(commandPattern(command))].length;
}

export function nextAutomaticLabel(source: string, definition: EnvironmentDefinition): string | undefined {
  const name = definition.match.kind === "latex-environment" ? definition.match.name : definition.match.kind === "command" ? definition.match.command : undefined;
  if (!name) return undefined;
  const stem = environmentLabelStem(name);
  const labels = new Set([...source.matchAll(/\\label\s*\{([^}\n]+)\}/g)].map((match) => match[1]?.trim()).filter((value): value is string => Boolean(value)));
  const occurrence = definition.match.kind === "latex-environment" ? environmentOccurrence(source, name) : commandOccurrence(source, name);
  let number = occurrence + 1;
  let candidate = `${stem}:${number}`;
  while (labels.has(candidate)) candidate = `${stem}:${++number}`;
  return candidate;
}

export function nextAutomaticEnvironmentLabel(source: string, definition: EnvironmentDefinition): string | undefined {
  return definition.match.kind === "latex-environment" ? nextAutomaticLabel(source, definition) : undefined;
}

/** One linear scan per source revision, shared by every environment/heading. */
export function automaticLabelOccurrences(source: string): ReadonlyMap<number, number> {
  const counts = new Map<string, number>();
  const occurrences = new Map<number, number>();
  for (const match of source.matchAll(/\\begin\{([^}]+)\}|\\([A-Za-z@]+)\*?\{/g)) {
    const name = match[1] ?? match[2];
    if (!name) continue;
    // Keep command and environment occurrence domains independent.
    const key = `${match[1] ? "env" : "command"}:${name}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    occurrences.set(match.index, count);
  }
  return occurrences;
}

export function isAutomaticLabel(source: string, startOffset: number, definition: EnvironmentDefinition, label: string, occurrences?: ReadonlyMap<number, number>): boolean {
  const name = definition.match.kind === "latex-environment" ? definition.match.name : definition.match.kind === "command" ? definition.match.command : undefined;
  if (!name) return false;
  const markerEnd = source.indexOf("}", startOffset);
  const occurrence = occurrences ? occurrences.get(startOffset) ?? 0 : markerEnd >= 0
    ? definition.match.kind === "latex-environment" ? environmentOccurrence(source, name, markerEnd + 1) : commandOccurrence(source, name, markerEnd + 1)
    : 0;
  return occurrence > 0 && label === `${environmentLabelStem(name)}:${occurrence}`;
}

export function isAutomaticEnvironmentLabel(source: string, startOffset: number, environmentName: string, label: string, occurrences?: ReadonlyMap<number, number>): boolean {
  const definition = { match: { kind: "latex-environment", name: environmentName } } as EnvironmentDefinition;
  return isAutomaticLabel(source, startOffset, definition, label, occurrences);
}

export interface BlockLabelRange { label: string; startOffset: number; endOffset: number }

/** Search only the owner's body gaps, skipping child blocks, comments and escapes. */
export function findBlockLabel(source: string, start = 0, end = source.length, children: Array<{ startOffset: number; endOffset: number }> = []): BlockLabelRange | undefined {
  const find = (from: number, to: number): BlockLabelRange | undefined => {
    const value = source.slice(from, to);
    for (const match of value.matchAll(/%[^\r\n]*|\\(?:[\\%]|label\s*\{([^}\r\n]*)\})/g)) {
      if (match[1] !== undefined) return { label: match[1].trim(), startOffset: from + match.index, endOffset: from + match.index + match[0].length };
    }
    return undefined;
  };
  let cursor = start;
  for (const child of children) {
    const label = find(cursor, Math.min(end, child.startOffset));
    if (label) return label;
    cursor = Math.max(cursor, child.endOffset);
  }
  return find(Math.min(cursor, end), end);
}

/** Insert after the opening line, including compact one-line environments. */
export function addEnvironmentLabel(snippet: string, label: string | undefined): string {
  if (!label || !/^\s*\\begin\{/.test(snippet)) return snippet;
  const firstLineEnd = snippet.indexOf("\n");
  if (firstLineEnd < 0) {
    const opening = /^\s*\\begin\{[^}]+\}/.exec(snippet);
    if (!opening) return snippet;
    let end = opening[0].length;
    // Preserve required arguments (e.g. tabular's columns, alignat's count)
    // and optional captions before inserting a label into the actual body.
    while (end < snippet.length) {
      let start = end;
      while (/\s/.test(snippet[start] ?? "") && start < snippet.length) start++;
      const opener = snippet[start];
      if (opener !== "{" && opener !== "[") break;
      const closer = opener === "{" ? "}" : "]";
      let depth = 1, cursor = start + 1;
      for (; cursor < snippet.length && depth; cursor++) {
        if (snippet[cursor] === "\\") { cursor++; continue; }
        if (snippet[cursor] === opener) depth++;
        else if (snippet[cursor] === closer) depth--;
      }
      if (depth) return snippet;
      end = cursor;
    }
    return `${snippet.slice(0, end)}\n  \\label{${label}}\n${snippet.slice(end)}`;
  }
  return `${snippet.slice(0, firstLineEnd + 1)}  \\label{${label}}\n${snippet.slice(firstLineEnd + 1)}`;
}

/** Insert a label after a section-like command while preserving the cursor position in its title. */
export function addCommandLabel(snippet: string, label: string | undefined): string {
  if (!label) return snippet;
  const command = /^\s*\\[A-Za-z@]+\*?\{[^{}]*\}/.exec(snippet);
  if (!command) return snippet;
  const commandEnd = command[0].length;
  return `${snippet.slice(0, commandEnd)}\\label{${label}}${snippet.slice(commandEnd)}`;
}

/** Replace an existing label or add one in the least surprising position for the block form. */
export function upsertBlockLabel(source: string, label: string, ownedRange?: { startOffset: number; endOffset: number } | null): string {
  // Preview supplies its parser-owned range; null means the owner has no label.
  // A regex over the entire section would silently rename a descendant's label.
  const existing = ownedRange === undefined ? findBlockLabel(source) : ownedRange;
  if (existing) return source.slice(0, existing.startOffset) + `\\label{${label}}` + source.slice(existing.endOffset);
  if (/^\s*\\begin\{/.test(source)) return addEnvironmentLabel(source, label);
  if (/^\s*\\[A-Za-z@]+\*?\{[^{}]*\}/.test(source)) return addCommandLabel(source, label);
  const display = /^\s*\\\[/.exec(source);
  if (display) return source.slice(0, display[0].length) + `\n  \\label{${label}}` + source.slice(display[0].length);
  return source;
}
