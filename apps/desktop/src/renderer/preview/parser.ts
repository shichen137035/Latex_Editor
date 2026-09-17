import type { ContentRegion, EnvironmentDefinition, PreviewDocument, PreviewNode, SourceSpan, StructuralBlock } from "./types.js";

interface RawBlock {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  environmentId: string;
  origin: "latex" | "virtual";
  title?: string;
  latexLabel?: string;
  parent?: RawBlock;
}

interface OpenBlock {
  marker: "environment" | "virtual";
  name: string;
  start: number;
  bodyStart: number;
  title?: string;
}

const headingLevel: Record<string, number> = { section: 1, subsection: 2, subsubsection: 3 };

function positionAt(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) { line += 1; lineStart = index + 1; }
  }
  return { line, column: offset - lineStart + 1 };
}

function span(source: string, filePath: string, startOffset: number, endOffset: number): SourceSpan {
  const start = positionAt(source, startOffset);
  const end = positionAt(source, endOffset);
  return { filePath, startOffset, endOffset, startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column };
}

function commentedAt(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const prefix = source.slice(lineStart, offset);
  let escapes = 0;
  for (let index = prefix.length - 1; index >= 0 && prefix[index] === "\\"; index -= 1) escapes += 1;
  const percent = prefix.lastIndexOf("%");
  return percent >= 0 && (escapes % 2 === 0 || percent < prefix.length - escapes);
}

function metadataValue(metadata: string, key: string): string | undefined {
  const quoted = new RegExp(`${key}="([^"]*)"`).exec(metadata)?.[1];
  if (quoted !== undefined) return quoted;
  return new RegExp(`${key}=([^\\s]+)`).exec(metadata)?.[1];
}

function stripForVisibility(value: string): string {
  return value
    .replace(/^\s*%.*$/gm, "")
    .replace(/\\(?:begin|end)\{[^}]+\}/g, "")
    .replace(/\\label\{[^}]+\}/g, "")
    .replace(/\\(?:documentclass|usepackage|newcommand|title|author|date)\*?(?:\[[^\]]*\])?\{[^}]*\}/g, "")
    .replace(/\\(?:maketitle|tableofcontents)\b/g, "")
    .trim();
}

function paragraphRanges(source: string, start: number, end: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const value = source.slice(start, end);
  const separator = /\n[ \t]*\n+/g;
  let cursor = 0;
  const add = (from: number, to: number) => {
    let left = start + from;
    let right = start + to;
    while (left < right && /\s/.test(source[left] ?? "")) left += 1;
    while (right > left && /\s/.test(source[right - 1] ?? "")) right -= 1;
    if (left < right && stripForVisibility(source.slice(left, right))) ranges.push([left, right]);
  };
  for (const match of value.matchAll(separator)) {
    add(cursor, match.index ?? cursor);
    cursor = (match.index ?? cursor) + match[0].length;
  }
  add(cursor, value.length);
  return ranges;
}

function labelIn(value: string): string | undefined {
  return /\\label\{([^}]+)\}/.exec(value)?.[1];
}

function environmentLookup(definitions: EnvironmentDefinition[]): Map<string, EnvironmentDefinition> {
  const result = new Map<string, EnvironmentDefinition>();
  for (const definition of definitions) {
    if (definition.match.kind === "latex-environment") result.set(definition.match.name, definition);
  }
  return result;
}

function lastOpenIndex(entries: OpenBlock[], predicate: (entry: OpenBlock) => boolean): number {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry && predicate(entry)) return index;
  }
  return -1;
}

/** Builds a non-overlapping PreviewNode tree while retaining exact source offsets. */
export function parsePreview(source: string, filePath: string, definitions: EnvironmentDefinition[]): PreviewDocument {
  const diagnostics: string[] = [];
  const rawBlocks: RawBlock[] = [];
  const open: OpenBlock[] = [];
  const environmentByName = environmentLookup(definitions);
  let documentStart = 0;
  let documentEnd = source.length;

  const tokenPattern = /\\begin\{([^}]+)\}(?:\[([^\]]*)\])?|\\end\{([^}]+)\}|\\\[|\\\]|^\s*%\s*tw:block-(begin|end)\b([^\r\n]*)/gm;
  for (const match of source.matchAll(tokenPattern)) {
    const offset = match.index ?? 0;
    if (match[1] !== undefined && !commentedAt(source, offset)) {
      open.push({ marker: "environment", name: match[1], start: offset, bodyStart: offset + match[0].length, ...(match[2] ? { title: match[2] } : {}) });
      continue;
    }
    if (match[3] !== undefined && !commentedAt(source, offset)) {
      const index = lastOpenIndex(open, (entry) => entry.marker === "environment" && entry.name === match[3]);
      if (index < 0) { diagnostics.push(`Unmatched \\end{${match[3]}} at offset ${offset}.`); continue; }
      const entry = open[index];
      if (!entry) continue;
      open.splice(index, 1);
      if (entry.name === "document") { documentStart = entry.bodyStart; documentEnd = offset; continue; }
      const definition = environmentByName.get(entry.name);
      if (definition?.enabled === false) continue;
      const value = source.slice(entry.start, offset + match[0].length);
      const latexLabel = labelIn(value);
      rawBlocks.push({ start: entry.start, end: offset + match[0].length, bodyStart: entry.bodyStart, bodyEnd: offset, environmentId: definition?.id ?? `custom:${entry.name}`, origin: "latex", ...(entry.title ? { title: entry.title } : {}), ...(latexLabel ? { latexLabel } : {}) });
      continue;
    }
    if (match[0] === "\\[") {
      open.push({ marker: "environment", name: "__display_math__", start: offset, bodyStart: offset + 2 });
      continue;
    }
    if (match[0] === "\\]") {
      const index = lastOpenIndex(open, (entry) => entry.name === "__display_math__");
      const entry = index >= 0 ? open[index] : undefined;
      if (!entry) { diagnostics.push(`Unmatched \\] at offset ${offset}.`); continue; }
      open.splice(index, 1);
      const definition = definitions.find((item) => item.match.kind === "display-math");
      if (definition?.enabled !== false) rawBlocks.push({ start: entry.start, end: offset + 2, bodyStart: entry.bodyStart, bodyEnd: offset, environmentId: definition?.id ?? "display-math", origin: "latex" });
      continue;
    }
    if (match[4] === "begin") {
      const metadata = match[5] ?? "";
      const title = metadataValue(metadata, "title");
      open.push({ marker: "virtual", name: metadataValue(metadata, "type") ?? "custom", start: offset, bodyStart: offset + match[0].length, ...(title ? { title } : {}) });
      continue;
    }
    if (match[4] === "end") {
      const index = lastOpenIndex(open, (entry) => entry.marker === "virtual");
      const entry = index >= 0 ? open[index] : undefined;
      if (!entry) { diagnostics.push(`Unmatched virtual block end at offset ${offset}.`); continue; }
      open.splice(index, 1);
      const definition = definitions.find((item) => item.match.kind === "virtual-block" && item.match.type === entry.name);
      if (definition?.enabled !== false) rawBlocks.push({ start: entry.start, end: offset + match[0].length, bodyStart: entry.bodyStart, bodyEnd: offset, environmentId: definition?.id ?? `virtual:${entry.name}`, origin: "virtual", ...(entry.title ? { title: entry.title } : {}) });
    }
  }
  for (const entry of open) diagnostics.push(`Unclosed ${entry.marker} ${entry.name} at offset ${entry.start}.`);

  const headings: Array<{ start: number; bodyStart: number; command: string; title: string; level: number }> = [];
  const headingPattern = /\\(section|subsection|subsubsection)\*?\{([^{}]*)\}/g;
  for (const match of source.matchAll(headingPattern)) {
    const start = match.index ?? 0;
    if (start < documentStart || start >= documentEnd || commentedAt(source, start)) continue;
    const commandName = match[1];
    if (!commandName) continue;
    const definition = definitions.find((item) => item.match.kind === "command" && item.match.command === commandName);
    if (definition?.enabled === false) continue;
    headings.push({ start, bodyStart: start + match[0].length, command: definition?.id ?? commandName, title: match[2] ?? "", level: headingLevel[commandName] ?? 3 });
  }
  headings.forEach((heading, index) => {
    let end = documentEnd;
    for (let next = index + 1; next < headings.length; next += 1) {
      const candidate = headings[next];
      if (candidate && candidate.level <= heading.level) { end = candidate.start; break; }
    }
    rawBlocks.push({ start: heading.start, end, bodyStart: heading.bodyStart, bodyEnd: end, environmentId: heading.command, origin: "latex", title: heading.title });
  });

  // Custom patterns are intentionally local and guarded: an invalid regular
  // expression only disables that definition and never prevents Preview.
  for (const definition of definitions) {
    if (!definition.enabled || definition.match.kind !== "custom-pattern" || !definition.match.pattern) continue;
    try {
      const expression = new RegExp(definition.match.pattern, "gm");
      for (const match of source.matchAll(expression)) {
        const start = match.index ?? 0;
        if (!match[0] || start < documentStart || start + match[0].length > documentEnd) continue;
        rawBlocks.push({ start, end: start + match[0].length, bodyStart: start, bodyEnd: start + match[0].length, environmentId: definition.id, origin: "virtual" });
      }
    } catch (reason) {
      diagnostics.push(`Custom pattern ${definition.id} is invalid: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  const candidates = rawBlocks
    .filter((block) => block.start >= documentStart && block.end <= documentEnd && block.end > block.start)
    .sort((left, right) => left.start - right.start || right.end - left.end);
  const valid: RawBlock[] = [];
  const stack: RawBlock[] = [];
  for (const block of candidates) {
    while (stack.length && block.start >= (stack.at(-1)?.end ?? 0)) stack.pop();
    const parent = stack.at(-1);
    if (parent && block.end > parent.end) { diagnostics.push(`Crossing block ${block.environmentId} was rendered as fallback content.`); continue; }
    if (parent) block.parent = parent;
    valid.push(block);
    stack.push(block);
  }

  const buildChildren = (parent: RawBlock | undefined, rangeStart: number, rangeEnd: number, parentId?: string): PreviewNode[] => {
    const direct = valid.filter((block) => block.parent === parent);
    const nodes: PreviewNode[] = [];
    let cursor = rangeStart;
    const addContent = (from: number, to: number) => {
      for (const [start, end] of paragraphRanges(source, from, to)) {
        const node: ContentRegion = { id: `content:${filePath}:${start}:${end}`, kind: "content", contentType: "paragraph", source: span(source, filePath, start, end), raw: source.slice(start, end), ...(parentId ? { parentId } : {}) };
        nodes.push(node);
      }
    };
    for (const block of direct) {
      addContent(cursor, block.start);
      const id = `block:${filePath}:${block.start}:${block.end}:${block.environmentId}`;
      const node: StructuralBlock = {
        id, kind: "block", origin: block.origin, environmentId: block.environmentId,
        source: span(source, filePath, block.start, block.end),
        children: buildChildren(block, block.bodyStart, block.bodyEnd, id),
        ...(parentId ? { parentId } : {}), ...(block.title ? { title: block.title } : {}), ...(block.latexLabel ? { latexLabel: block.latexLabel } : {})
      };
      nodes.push(node);
      cursor = Math.max(cursor, block.end);
    }
    addContent(cursor, rangeEnd);
    return nodes;
  };

  return { filePath, nodes: buildChildren(undefined, documentStart, documentEnd), diagnostics };
}
