import type { FigureObject, GraphicOption, ImageObject, SourceRange, SubfigureObject } from "./model.js";

function splitOptions(raw: string): GraphicOption[] {
  const result: GraphicOption[] = [];
  let start = 0;
  let braces = 0;
  for (let index = 0; index <= raw.length; index += 1) {
    const char = raw[index];
    if (char === "{") braces += 1;
    else if (char === "}") braces = Math.max(0, braces - 1);
    if (index < raw.length && (char !== "," || braces > 0)) continue;
    const entry = raw.slice(start, index).trim();
    if (entry) {
      const equals = entry.indexOf("=");
      result.push(equals < 0
        ? { key: entry, raw: entry }
        : { key: entry.slice(0, equals).trim(), value: entry.slice(equals + 1).trim(), raw: entry });
    }
    start = index + 1;
  }
  return result;
}

function innerValue(source: string, expression: RegExp): string | undefined {
  return expression.exec(source)?.[1]?.trim();
}

export function parseGraphicPaths(source: string): string[] {
  const paths: string[] = [];
  for (const match of source.matchAll(/\\graphicspath\s*\{((?:\{[^{}]*\}\s*)+)\}/g)) {
    for (const part of (match[1] ?? "").matchAll(/\{([^{}]*)\}/g)) if ((part[1] ?? "").trim()) paths.push((part[1] ?? "").trim());
  }
  return paths;
}

export function parseImages(source: string, baseOffset = 0): ImageObject[] {
  const images: ImageObject[] = [];
  const expression = /\\includegraphics\s*(?:\[([\s\S]*?)\])?\s*\{([^{}]*)\}/g;
  for (const match of source.matchAll(expression)) {
    const localStart = match.index ?? 0;
    const full = match[0];
    const path = match[2] ?? "";
    // The last opening brace belongs to the image path. This also locates an
    // empty `{}` slot correctly; lastIndexOf("") would point after the brace.
    const pathLocal = localStart + full.lastIndexOf("{") + 1;
    const bracketStart = match[1] === undefined ? -1 : localStart + full.indexOf("[");
    images.push({
      id: `image:${baseOffset + localStart}`,
      sourcePath: path.trim(),
      options: splitOptions(match[1] ?? ""),
      sourceRange: { start: baseOffset + localStart, end: baseOffset + localStart + full.length },
      pathRange: { start: baseOffset + pathLocal, end: baseOffset + pathLocal + path.length },
      ...(bracketStart >= 0 ? { optionsRange: { start: baseOffset + bracketStart + 1, end: baseOffset + bracketStart + 1 + (match[1]?.length ?? 0) } } : {})
    });
  }
  return images;
}

function subfigures(source: string, baseOffset: number): SubfigureObject[] {
  const result: SubfigureObject[] = [];
  const expression = /\\begin\{subfigure\}(?:\[([^\]]*)\])?\{([^{}]+)\}([\s\S]*?)\\end\{subfigure\}/g;
  for (const match of source.matchAll(expression)) {
    const start = match.index ?? 0;
    const body = match[3] ?? "";
    const bodyStart = start + match[0].indexOf(body);
    const caption = innerValue(body, /\\caption\*?\{([^{}]*)\}/);
    const label = innerValue(body, /\\label\{([^{}]*)\}/);
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
  const environmentMatch = /\\begin\{(figure\*?)\}(?:\[([^\]]*)\])?([\s\S]*?)\\end\{\1\}/.exec(source);
  const inlineImages = parseImages(source, baseOffset);
  if (!environmentMatch && !inlineImages.length) return undefined;
  const localStart = environmentMatch?.index ?? inlineImages[0]!.sourceRange.start - baseOffset;
  const figureSource = environmentMatch?.[0] ?? source.slice(localStart, inlineImages.at(-1)!.sourceRange.end - baseOffset);
  const sourceRange: SourceRange = { start: baseOffset + localStart, end: baseOffset + localStart + figureSource.length };
  const images = parseImages(figureSource, sourceRange.start);
  const nested = subfigures(figureSource, sourceRange.start);
  const knownCommands = /\\(?:begin|end|includegraphics|caption\*?|label|centering|raggedright|raggedleft|hfill|vspace|hspace|textwidth|linewidth|columnwidth)\b/;
  const unknownCommands = [...figureSource.matchAll(/\\([A-Za-z@]+)\b/g)].some((match) => !knownCommands.test(`\\${match[1]}`));
  const placement = environmentMatch?.[2]?.trim();
  const caption = innerValue(figureSource, /\\caption\*?\{([^{}]*)\}/);
  const label = innerValue(figureSource, /\\label\{([^{}]*)\}/);
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
