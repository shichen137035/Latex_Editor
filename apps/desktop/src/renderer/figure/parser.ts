import type { FigureObject, ImageObject, SourceRange, SubfigureObject } from "./model.js";
import { latexCommandField, latexControlSequences, maskLatexComments, readLatexGroup } from "@latex-editor/editor-core/latex-source";
import { parseGraphicOptions } from "./options.js";

export function parseGraphicPaths(source: string): string[] {
  const paths: string[] = [];
  for (const match of maskLatexComments(source).matchAll(/\\graphicspath\s*\{((?:\{[^{}]*\}\s*)+)\}/g)) {
    for (const part of (match[1] ?? "").matchAll(/\{([^{}]*)\}/g)) if ((part[1] ?? "").trim()) paths.push((part[1] ?? "").trim());
  }
  return paths;
}

export function parseImages(source: string, baseOffset = 0): ImageObject[] {
  const images: ImageObject[] = [];
  const masked = maskLatexComments(source);
  for (const token of latexControlSequences(masked)) {
    if (token.name !== "includegraphics") continue;
    let cursor = token.end;
    while (cursor < masked.length && /\s/.test(masked[cursor]!)) cursor++;
    const options = readLatexGroup(masked, cursor, "[", "]");
    if (options) { cursor = options.end + 1; while (cursor < masked.length && /\s/.test(masked[cursor]!)) cursor++; }
    const path = readLatexGroup(masked, cursor);
    if (!path) continue;
    images.push({
      id: `image:${baseOffset + token.start}`, sourcePath: source.slice(path.start, path.end).trim(),
      options: parseGraphicOptions(options ? source.slice(options.start, options.end) : ""),
      sourceRange: { start: baseOffset + token.start, end: baseOffset + path.end + 1 },
      pathRange: { start: baseOffset + path.start, end: baseOffset + path.end },
      ...(options ? { optionsRange: { start: baseOffset + options.start, end: baseOffset + options.end } } : {})
    });
  }
  return images;
}

function subfigures(source: string, baseOffset: number): SubfigureObject[] {
  const result: SubfigureObject[] = [];
  const masked = maskLatexComments(source), tokens = [...latexControlSequences(masked)];
  for (const token of tokens) {
    if (token.name !== "begin" && token.name !== "subfloat") continue;
    let cursor = token.end;
    const space = () => { while (/\s/.test(masked[cursor] ?? "") && cursor < masked.length) cursor++; };
    space();
    if (token.name === "begin") {
      const name = readLatexGroup(masked, cursor);
      if (name?.value !== "subfigure") continue;
      cursor = name.end + 1; space();
    }
    const optional: string[] = [];
    while (masked[cursor] === "[") {
      const value = readLatexGroup(masked, cursor, "[", "]");
      if (!value) break;
      optional.push(source.slice(value.start, value.end)); cursor = value.end + 1; space();
    }
    const argument = readLatexGroup(masked, cursor);
    if (!argument) continue;
    const closing = token.name === "begin" ? tokens.find(end => end.start > argument.end && end.name === "end" && end.environmentDepth === token.environmentDepth + 1 && /^\s*\{subfigure\}/.test(masked.slice(end.end))) : undefined;
    if (token.name === "begin" && !closing) continue;
    const end = closing ? masked.indexOf("}", closing.end) + 1 : argument.end + 1;
    const bodyStart = closing ? argument.end + 1 : argument.start;
    const bodyEnd = closing ? closing.start : argument.end;
    const body = source.slice(bodyStart, bodyEnd);
    const caption = closing ? latexCommandField(body, "caption")?.body.value.trim() : optional.at(-1)?.trim();
    const label = latexCommandField(source.slice(token.start, end), "label")?.body.value.trim();
    result.push({
      id: `subfigure:${baseOffset + token.start}`, syntax: closing ? "subfigure" : "subfloat",
      ...(closing ? { width: source.slice(argument.start, argument.end).trim(), widthRange: { start: baseOffset + argument.start, end: baseOffset + argument.end } } : {}),
      bodyRange: { start: baseOffset + bodyStart, end: baseOffset + bodyEnd },
      ...(caption !== undefined ? { caption } : {}),
      ...(label !== undefined ? { label } : {}),
      sourceRange: { start: baseOffset + token.start, end: baseOffset + end },
      images: parseImages(body, baseOffset + bodyStart)
    });
  }
  return result;
}

/** Hide child metadata while retaining outer command offsets. */
export function maskSubfigures(source: string, children: SubfigureObject[]): string {
  let result = source;
  for (const child of children) result = result.slice(0, child.sourceRange.start) + source.slice(child.sourceRange.start, child.sourceRange.end).replace(/[^\r\n]/g, " ") + result.slice(child.sourceRange.end);
  return result;
}

export function parseFigure(source: string, baseOffset = 0): FigureObject | undefined {
  const masked = maskLatexComments(source);
  const environmentMatch = /\\begin\{(figure\*?)\}(?:\[([^\]]*)\])?([\s\S]*?)\\end\{\1\}/.exec(masked);
  const inlineImages = parseImages(source, baseOffset);
  if (!environmentMatch && !inlineImages.length) return undefined;
  const localStart = environmentMatch?.index ?? inlineImages[0]!.sourceRange.start - baseOffset;
  const figureSource = source.slice(localStart, environmentMatch ? localStart + environmentMatch[0].length : inlineImages.at(-1)!.sourceRange.end - baseOffset);
  const sourceRange: SourceRange = { start: baseOffset + localStart, end: baseOffset + localStart + figureSource.length };
  const images = parseImages(figureSource, sourceRange.start);
  const nested = subfigures(figureSource, sourceRange.start);
  const knownCommands = /\\(?:begin|end|includegraphics|caption\*?|label|centering|raggedright|raggedleft|hfill|vspace|hspace|textwidth|linewidth|columnwidth)\b/;
  const unknownCommands = [...figureSource.matchAll(/\\([A-Za-z@]+)\b/g)].some((match) => !knownCommands.test(`\\${match[1]}`));
  const placement = environmentMatch?.[2]?.trim();
  const outer = maskSubfigures(figureSource, nested.map(child => ({ ...child, sourceRange: { start: child.sourceRange.start - sourceRange.start, end: child.sourceRange.end - sourceRange.start } })));
  const captionField = latexCommandField(outer, "caption"), labelField = latexCommandField(outer, "label");
  const caption = captionField ? figureSource.slice(captionField.body.start, captionField.body.end).trim() : undefined;
  const label = labelField ? figureSource.slice(labelField.body.start, labelField.body.end).trim() : undefined;
  return {
    id: `figure:${sourceRange.start}`,
    environment: environmentMatch ? environmentMatch[1] as "figure" | "figure*" : "inline",
    ...(placement !== undefined ? { placement } : {}),
    alignment: /\\centering\b/.test(figureSource) ? "center" : /\\raggedright\b/.test(figureSource) ? "left" : /\\raggedleft\b/.test(figureSource) ? "right" : "none",
    ...(caption !== undefined ? { caption } : {}),
    ...(label !== undefined ? { label } : {}),
    sourceRange,
    images,
    subfigures: nested,
    partiallyEditable: unknownCommands
  };
}

export function optionValue(image: ImageObject, key: string): string | undefined {
  return image.options.find((option) => option.key.toLowerCase() === key.toLowerCase())?.value;
}
