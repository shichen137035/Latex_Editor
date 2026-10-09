import type { EnvironmentDefinition, PreviewDocument, PreviewNode, SourceSpan, StructuralBlock } from "./types.js";

import { includeNewBuiltInDirectives, inferBlockKind, type BlockKind, type PreviewDirectiveDefinition } from "@latex-editor/contracts";
import { automaticLabelOccurrences, findBlockLabel, isAutomaticLabel } from "./labels.js";
import type { BlockLabelRange } from "./labels.js";
import { documentTitleRegion } from "./document-title.js";

/** Bump when source ownership changes so persisted indexes refresh on upgrade. */
export const STRUCTURE_PARSER_REVISION = 6;

interface RawBlock {
  start: number;
  end: number;
  bodyStart: number;
  bodyEnd: number;
  environmentId: string;
  origin: "latex" | "virtual";
  title?: string;
  parent?: RawBlock;
}

interface OpenBlock {
  marker: "environment" | "virtual" | "disabled";
  name: string;
  start: number;
  bodyStart: number;
  title?: string;
}

const headingLevel: Record<string, number> = { chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5 };

function positionResolver(source: string): (offset: number) => { line: number; column: number } {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) if (source.charCodeAt(index) === 10) lineStarts.push(index + 1);
  return (offset) => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if ((lineStarts[middle] ?? 0) <= offset) low = middle;
      else high = middle;
    }
    return { line: low + 1, column: offset - (lineStarts[low] ?? 0) + 1 };
  };
}

function span(source: string, filePath: string, startOffset: number, endOffset: number, positionAt: (offset: number) => { line: number; column: number }): SourceSpan {
  const start = positionAt(startOffset);
  const end = positionAt(endOffset);
  return { filePath, startOffset, endOffset, startLine: start.line, startColumn: start.column, endLine: end.line, endColumn: end.column };
}

function commentedAt(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  let escaped = false;
  for (let cursor = lineStart; cursor <= offset; cursor++) {
    const character = source[cursor];
    if (character === "%" && !escaped) return true;
    escaped = character === "\\" ? !escaped : false;
  }
  return false;
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

/** Shared visibility check used by conservative incremental Preview updates. */
export function hasVisiblePreviewContent(value: string): boolean {
  return stripForVisibility(value).length > 0;
}

type ContentSlice = { start: number; end: number };
const standaloneCommandPattern = /^[ \t]*\\([A-Za-z@]+)\*?(?:[ \t]*\[[^\]\r\n]*\])?(?:[ \t]*\{[^{}\r\n]*\})*[ \t]*(?:%[^\r\n]*)?\r?$/gm;
const inlineCommandPattern = /\\([A-Za-z@]+)\*?(?:[ \t]*\[[^\]\r\n]*\])?(?:[ \t]*\{[^{}\r\n]*\})*/y;

interface DirectiveOccurrence { start: number; end: number; name: string; placement: PreviewDirectiveDefinition["placement"] }

function directiveOccurrences(source: string, start: number, end: number, rules: Map<string, PreviewDirectiveDefinition>, explicitBlocks: RawBlock[]): DirectiveOccurrence[] {
  const occurrences: DirectiveOccurrence[] = [];
  const markedCommands = new Map<number, DirectiveOccurrence>();
  const ignoredOccurrences = new Set<DirectiveOccurrence>();
  for (const match of source.slice(start, end).matchAll(standaloneCommandPattern)) {
    const name = match[1] ?? "", rule = rules.get(name);
    if (!rule) continue;
    const offset = start + (match.index ?? 0);
    const occurrence = { start: offset, end: offset + match[0].length, name, placement: rule.placement ?? "nested" };
    occurrences.push(occurrence);
    markedCommands.set(offset + match[0].indexOf("\\"), occurrence);
  }
  // Part switches also work on the same line as prose or a following heading.
  // Escapes, comments, macro arguments and explicit wrappers are not implicit
  // document scopes; never mistake a command example there for a part switch.
  let cursor = start, depth = 0, blockCursor = 0, explicitEnd = -1;
  while (cursor < end) {
    while (blockCursor < explicitBlocks.length && explicitBlocks[blockCursor]!.start <= cursor) {
      explicitEnd = Math.max(explicitEnd, explicitBlocks[blockCursor++]!.end);
    }
    if (cursor < explicitEnd) { cursor = explicitEnd; continue; }
    const character = source[cursor];
    if (character === "%") {
      const newline = source.indexOf("\n", cursor);
      cursor = newline < 0 ? end : newline + 1;
      continue;
    }
    if (character === "\\") {
      let commandEnd = cursor + 1;
      while (commandEnd < end && /[A-Za-z@]/.test(source[commandEnd]!)) commandEnd += 1;
      if (commandEnd === cursor + 1) { cursor += 2; continue; }
      const name = source.slice(cursor + 1, commandEnd), rule = rules.get(name);
      const marked = markedCommands.get(cursor);
      if (depth !== 0 && marked) ignoredOccurrences.add(marked);
      if (depth === 0 && rule?.placement === "independent" && !markedCommands.has(cursor)) {
        inlineCommandPattern.lastIndex = cursor;
        const match = inlineCommandPattern.exec(source);
        const occurrenceEnd = cursor + (match?.[0].length ?? name.length + 1);
        if (occurrenceEnd <= end) occurrences.push({ start: cursor, end: occurrenceEnd, name, placement: "independent" });
      }
      cursor = commandEnd;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") depth = Math.max(0, depth - 1);
    cursor += 1;
  }
  return occurrences.filter((occurrence) => !ignoredOccurrences.has(occurrence)).sort((left, right) => left.start - right.start);
}

function firstAtOrAfter(entries: ReadonlyArray<{ start: number }>, offset: number): number {
  let low = 0, high = entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (entries[middle]!.start < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function onlyWhitespaceAndComments(value: string): boolean {
  return /^(?:\s|%[^\r\n]*(?:\r?\n|$))*$/.test(value);
}

function paragraphRanges(source: string, start: number, end: number): ContentSlice[] {
  const ranges: ContentSlice[] = [];
  const value = source.slice(start, end);
  const separator = /\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*/g;
  let cursor = 0;
  const add = (from: number, to: number) => {
    let left = start + from;
    let right = start + to;
    while (left < right && /\s/.test(source[left] ?? "")) left += 1;
    while (right > left && /\s/.test(source[right - 1] ?? "")) right -= 1;
    if (left < right && stripForVisibility(source.slice(left, right))) ranges.push({ start: left, end: right });
  };
  for (const match of value.matchAll(separator)) {
    add(cursor, match.index ?? cursor);
    cursor = (match.index ?? cursor) + match[0].length;
  }
  add(cursor, value.length);
  return ranges;
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
export function parsePreview(source: string, filePath: string, definitions: EnvironmentDefinition[], directives: PreviewDirectiveDefinition[] = []): PreviewDocument {
  const diagnostics: string[] = [];
  const rawBlocks: RawBlock[] = [];
  const open: OpenBlock[] = [];
  const environmentByName = environmentLookup(definitions);
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const directiveByName = new Map(directives.filter((item) => item.enabled && item.match.kind === "command").map((item) => [item.match.kind === "command" ? item.match.name : "", item]));
  const commandDefinitions = new Map(definitions.filter((definition) => definition.match.kind === "command").map((definition) => [definition.match.kind === "command" ? definition.match.command : "", definition]));
  const positionAt = positionResolver(source);
  const labelOccurrences = automaticLabelOccurrences(source);
  let documentStart = 0;
  let documentEnd = source.length;

  const tokenPattern = /\\begin\{([^}]+)\}(?:\[([^\]]*)\])?|\\end\{([^}]+)\}|\\\[|\\\]|^[ \t]*%[ \t]*tw:block-(begin|end)\b([^\r\n]*)|^[ \t]*%<(texweave:disable|\/texweave:disable)>[ \t]*(?:\r?\n)?/gm;
  for (const match of source.matchAll(tokenPattern)) {
    const offset = match.index ?? 0;
    // Only explicit TeXWeave comment directives are structural; ordinary
    // comments must never open or close an environment or display-math block.
    if (match[4] === undefined && match[6] === undefined && commentedAt(source, offset)) continue;
    if (match[6] === "texweave:disable") {
      open.push({ marker: "disabled", name: "texweave-disabled", start: offset, bodyStart: offset + match[0].length });
      continue;
    }
    if (match[6] === "/texweave:disable") {
      const index = lastOpenIndex(open, (entry) => entry.marker === "disabled");
      const entry = index >= 0 ? open[index] : undefined;
      if (!entry) { diagnostics.push(`Unmatched disabled block end at offset ${offset}.`); continue; }
      open.splice(index, 1);
      rawBlocks.push({ start: entry.start, end: offset + match[0].length, bodyStart: entry.bodyStart, bodyEnd: offset, environmentId: "texweave-disabled", origin: "virtual" });
      continue;
    }
    if (match[1] !== undefined) {
      open.push({ marker: "environment", name: match[1], start: offset, bodyStart: offset + match[0].length, ...(match[2] ? { title: match[2] } : {}) });
      continue;
    }
    if (match[3] !== undefined) {
      const index = lastOpenIndex(open, (entry) => entry.marker === "environment" && entry.name === match[3]);
      if (index < 0) { diagnostics.push(`Unmatched \\end{${match[3]}} at offset ${offset}.`); continue; }
      const entry = open[index];
      if (!entry) continue;
      open.splice(index, 1);
      if (entry.name === "document") { documentStart = entry.bodyStart; documentEnd = offset; continue; }
      const definition = environmentByName.get(entry.name);
      if (definition?.enabled === false) continue;
      rawBlocks.push({ start: entry.start, end: offset + match[0].length, bodyStart: entry.bodyStart, bodyEnd: offset, environmentId: definition?.id ?? `custom:${entry.name}`, origin: "latex", ...(entry.title ? { title: entry.title } : {}) });
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

  const titleRegion = documentTitleRegion(source, documentStart, documentEnd);
  const title = titleRegion ? {
    ...(titleRegion.title !== undefined ? { title: titleRegion.title } : {}),
    ...(titleRegion.author !== undefined ? { author: titleRegion.author } : {}),
    date: titleRegion.date,
    source: span(source, filePath, titleRegion.start, titleRegion.end, positionAt),
    bodySource: span(source, filePath, titleRegion.bodyStart, titleRegion.end, positionAt)
  } : undefined;

  // Heading commands have implicit ends. Commands that switch document parts
  // close those scopes; spacing/page commands leave a heading only at its tail.
  // Explicit begin/end and virtual wrappers must remain intact, including code
  // examples containing command names that would otherwise look like boundaries.
  const scopeRules = new Map(includeNewBuiltInDirectives(directives)
    .filter((item) => item.enabled && item.match.kind === "command")
    .map((item) => [item.match.kind === "command" ? item.match.name : "", item]));
  const explicitBlocks = rawBlocks.slice().sort((left, right) => left.start - right.start);
  const commands = directiveOccurrences(source, documentStart, documentEnd, scopeRules, explicitBlocks);
  const scopeCommands: Array<{ start: number; end: number; placement: PreviewDirectiveDefinition["placement"] }> = [];
  let explicitCursor = 0, explicitEnd = -1;
  for (const command of commands) {
    const { start, end } = command;
    while (explicitCursor < explicitBlocks.length && explicitBlocks[explicitCursor]!.start <= start) {
      explicitEnd = Math.max(explicitEnd, explicitBlocks[explicitCursor++]!.end);
    }
    if (end <= explicitEnd) continue;
    scopeCommands.push(command);
  }
  const boundaries = scopeCommands.filter((command) => command.placement === "independent");

  const headings: Array<{ start: number; bodyStart: number; command: string; title: string; level: number }> = [];
  const headingPattern = /\\(chapter|section|subsection|subsubsection|paragraph)\*?\{([^{}]*)\}/g;
  for (const match of source.matchAll(headingPattern)) {
    const start = match.index ?? 0;
    if (start < documentStart || start >= documentEnd || commentedAt(source, start)) continue;
    const commandName = match[1];
    if (!commandName) continue;
    const definition = commandDefinitions.get(commandName);
    if (definition?.enabled === false) continue;
    const bodyStart = start + match[0].length;
    headings.push({ start, bodyStart, command: definition?.id ?? commandName, title: match[2] ?? "", level: headingLevel[commandName] ?? 3 });
  }
  const nearestHeadingAtLevel: Array<number | undefined> = [];
  headings.slice().reverse().forEach((heading) => {
    let end = documentEnd;
    for (let level = 1; level <= heading.level; level += 1) {
      const candidate = nearestHeadingAtLevel[level];
      if (candidate !== undefined) end = Math.min(end, candidate);
    }
    const boundary = boundaries[firstAtOrAfter(boundaries, heading.bodyStart)];
    if (boundary) end = Math.min(end, boundary.start);
    for (let index = firstAtOrAfter(scopeCommands, end) - 1; index >= 0; index -= 1) {
      const command = scopeCommands[index]!;
      if (command.start < heading.bodyStart || command.placement !== "trailing"
        || command.end > end || !onlyWhitespaceAndComments(source.slice(command.end, end))) break;
      end = command.start;
    }
    rawBlocks.push({ start: heading.start, end, bodyStart: heading.bodyStart, bodyEnd: end, environmentId: heading.command, origin: "latex", title: heading.title });
    nearestHeadingAtLevel[heading.level] = heading.start;
  });

  // Standalone \includegraphics is an image object, not a LaTeX environment,
  // but it still needs a selectable Visual surface. Images already owned by a
  // figure/subfigure are rendered by their parent and are not duplicated here.
  const figureIntervals = rawBlocks.filter((block) => /^\\begin\{(?:figure\*?|subfigure)\}/.test(source.slice(block.start, block.bodyStart))).sort((a, b) => a.start - b.start);
  let figureCursor = 0, figureEnd = 0;
  for (const match of source.matchAll(/\\includegraphics\s*(?:\[[\s\S]*?\])?\s*\{[^{}]+\}/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start < documentStart || end > documentEnd || commentedAt(source, start)) continue;
    while (figureCursor < figureIntervals.length && figureIntervals[figureCursor]!.start <= start) figureEnd = Math.max(figureEnd, figureIntervals[figureCursor++]!.end);
    const insideFigure = figureEnd >= end;
    if (!insideFigure && definitions.find(definition => definition.id === "inline-image")?.enabled !== false) rawBlocks.push({ start, end, bodyStart: start, bodyEnd: end, environmentId: "inline-image", origin: "latex" });
  }

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
    .filter((block) => block.start >= documentStart && block.end <= documentEnd && block.end > block.start
      && !(title && block.start >= title.bodySource.startOffset && block.end <= title.bodySource.endOffset))
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

  const childrenByParent = new Map<RawBlock | undefined, RawBlock[]>();
  for (const block of valid) {
    const children = childrenByParent.get(block.parent) ?? [];
    children.push(block);
    childrenByParent.set(block.parent, children);
  }
  // Algorithm floats and algorithmic bodies are structural code: their nested
  // environments and prose must remain in the tree. Verbatim code is atomic.
  const contentBlockIds = new Set(definitions.filter((definition) => ["equation", "figure", "table"].includes(definition.family)
    || (definition.family === "code" && (inferBlockKind(definition.id) === "content" || definition.behavior.allowChildren === false))).map((definition) => definition.id));
  contentBlockIds.add("display-math");
  contentBlockIds.add("texweave-disabled");
  const headingBlockIds = new Set(headings.map((heading) => heading.command));
  for (const block of valid) {
    // Sectioning commands can have content even when their semantic graph kind
    // is content (notably \paragraph). Keep that body in the preview tree.
    if (inferBlockKind(block.environmentId) === "content" && !headingBlockIds.has(block.environmentId)) contentBlockIds.add(block.environmentId);
  }
  const semanticKindFor = (block: RawBlock): BlockKind => {
    if (block.environmentId === "texweave-disabled") return "content";
    const definition = definitionById.get(block.environmentId);
    return definition && ["equation", "figure", "table"].includes(definition.family)
      ? "content" : inferBlockKind(block.environmentId);
  };

  const ownedLabels = new Map<RawBlock, BlockLabelRange>();

  const buildChildren = (parent: RawBlock | undefined, rangeStart: number, rangeEnd: number, parentId?: string): PreviewNode[] => {
    const direct = childrenByParent.get(parent) ?? [];
    const nodes: PreviewNode[] = [];
    let cursor = rangeStart;
    const addContent = (from: number, to: number) => {
      const label = parent ? ownedLabels.get(parent) : undefined;
      // A structural owner's label is metadata, not paragraph source. Keeping
      // it in a paragraph would let prose-only edits silently erase references.
      const labelGaps = label && label.startOffset >= from && label.endOffset <= to
        ? [[from, label.startOffset], [label.endOffset, to]] : [[from, to]];
      const gaps = labelGaps.flatMap(([left = from, right = to]) => !title || right <= title.bodySource.startOffset || left >= title.bodySource.endOffset
        ? [[left, right]] : [[left, Math.max(left, title.bodySource.startOffset)], [Math.min(right, title.bodySource.endOffset), right]]);
      for (const [left, right] of gaps) {
        const addSlices = (from: number, to: number) => {
          for (const part of paragraphRanges(source, from, to)) {
            nodes.push({ id: `content:${filePath}:${part.start}:${part.end}`, kind: "content", contentType: "paragraph",
              origin: "source", source: span(source, filePath, part.start, part.end, positionAt), raw: source.slice(part.start, part.end),
              ...(parentId ? { parentId } : {}) });
          }
        };
        if (!directiveByName.size) { addSlices(left!, right!); continue; }
        let cursor = left!;
        for (let index = firstAtOrAfter(commands, left!); index < commands.length; index += 1) {
          const command = commands[index]!;
          if (command.start >= right!) break;
          const definition = directiveByName.get(command.name);
          if (!definition || command.end > right!) continue;
          const { start, end } = command;
          addSlices(cursor, start);
          nodes.push({ id: `content:${filePath}:${start}:${end}`, kind: "content", contentType: "directive", directiveId: definition.id,
            origin: "source", source: span(source, filePath, start, end, positionAt), raw: source.slice(start, end), ...(parentId ? { parentId } : {}) });
          cursor = end;
        }
        addSlices(cursor, right!);
      }
    };
    for (const block of direct) {
      addContent(cursor, block.start);
      const id = `block:${filePath}:${block.start}:${block.end}:${block.environmentId}`;
      const semanticKind = semanticKindFor(block);
      const definition = definitionById.get(block.environmentId);
      const excluded = contentBlockIds.has(block.environmentId) ? [] : (childrenByParent.get(block) ?? []).map((child) => ({ startOffset: child.start, endOffset: child.end }));
      const label = findBlockLabel(source, block.bodyStart, block.bodyEnd, excluded);
      if (label) ownedLabels.set(block, label);
      const autoLabel = label && definition ? isAutomaticLabel(source, block.start, definition, label.label, labelOccurrences) : false;
      const node: StructuralBlock = {
        id, kind: "block", semanticKind, origin: block.origin, environmentId: block.environmentId,
        source: span(source, filePath, block.start, block.end, positionAt),
        body: span(source, filePath, block.bodyStart, block.bodyEnd, positionAt),
        // Equation blocks own their full TeX body; math internals are not
        // paragraph or child blocks in TeXWeave's document tree.
        children: contentBlockIds.has(block.environmentId) ? [] : buildChildren(block, block.bodyStart, block.bodyEnd, id),
        ...(parentId ? { parentId } : {}), ...(block.title ? { title: block.title } : {}),
        ...(label ? { latexLabel: label.label, labelSource: span(source, filePath, label.startOffset, label.endOffset, positionAt) } : {}), ...(autoLabel ? { autoLabel: true } : {})
      };
      nodes.push(node);
      cursor = Math.max(cursor, block.end);
    }
    addContent(cursor, rangeEnd);
    return nodes;
  };

  return { filePath, nodes: buildChildren(undefined, documentStart, documentEnd), diagnostics, ...(title ? { title } : {}) };
}
