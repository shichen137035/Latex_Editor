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
  const expression = /\\begin\{subfigure\}(?:\[([^\]]*)\])?\{([^{}]+)\}([\s\S]*?)\\end\{subfigure\}/g;
  for (const match of maskLatexComments(source).matchAll(expression)) {
    const start = match.index ?? 0;
    const maskedBody = match[3] ?? "";
    const bodyOffset = match[0].indexOf(maskedBody);
    const body = source.slice(start + bodyOffset, start + bodyOffset + maskedBody.length);
    const bodyStart = start + bodyOffset;
    const caption = latexCommandField(body, "caption")?.body.value.trim();
    const label = latexCommandField(body, "label")?.body.value.trim();
    result.push({
      id: `subfigure:${baseOffset + start}`,
      width: (match[2] ?? "").trim(),
      ...(caption !== undefined ? { caption } : {}),
      ...(label !== undefined ? { label } : {}),
      sourceRange: { start: baseOffset + start, end: baseOffset + start + match[0].length },
      images: parseImages(body, baseOffset + bodyStart)
    });
  }
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
  const caption = latexCommandField(figureSource, "caption")?.body.value.trim();
  const label = latexCommandField(figureSource, "label")?.body.value.trim();
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
