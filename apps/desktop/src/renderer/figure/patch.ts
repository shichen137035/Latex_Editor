import { parseFigure } from "./parser.js";
import type { FigurePatch } from "./model.js";

function replaceRange(source: string, start: number, end: number, value: string): string {
  return source.slice(0, start) + value + source.slice(end);
}

function optionRanges(raw: string): Array<{ start: number; end: number; key: string }> {
  const result: Array<{ start: number; end: number; key: string }> = [];
  let start = 0;
  let braces = 0;
  for (let index = 0; index <= raw.length; index += 1) {
    const character = raw[index];
    if (character === "{") braces += 1;
    else if (character === "}") braces = Math.max(0, braces - 1);
    if (index < raw.length && (character !== "," || braces > 0)) continue;
    const segment = raw.slice(start, index);
    const leading = segment.length - segment.trimStart().length;
    const trimmed = segment.trim();
    if (trimmed) result.push({ start: start + leading, end: start + leading + trimmed.length, key: trimmed.split("=", 1)[0]?.trim().toLowerCase() ?? "" });
    start = index + 1;
  }
  return result;
}

function updateOption(raw: string, key: string, value: string | boolean | undefined): string {
  const ranges = optionRanges(raw);
  const existing = ranges.find((item) => item.key === key.toLowerCase());
  if (value === undefined) return raw;
  if (value === false || value === "") {
    if (!existing) return raw;
    const index = ranges.indexOf(existing);
    const removeStart = index > 0 ? existing.start - 1 : existing.start;
    const removeEnd = index === 0 && ranges.length > 1 ? existing.end + 1 : existing.end;
    return raw.slice(0, removeStart) + raw.slice(removeEnd);
  }
  const replacement = value === true ? key : `${key}=${value}`;
  if (existing) return replaceRange(raw, existing.start, existing.end, replacement);
  return raw ? `${raw}${raw.trimEnd().endsWith(",") ? "" : ","}${replacement}` : replacement;
}

function patchCommandValue(source: string, command: string, value: string | undefined, before: number): string {
  if (value === undefined) return source;
  const expression = new RegExp(`\\\\${command}\\s*\\{([^{}]*)\\}`);
  const match = expression.exec(source);
  if (match) {
    const current = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].indexOf(current);
    return replaceRange(source, start, start + current.length, value);
  }
  if (!value) return source;
  return source.slice(0, before) + `  \\${command}{${value}}\n` + source.slice(before);
}

/** Applies only requested fields and leaves unknown commands/options byte-for-byte intact. */
export function patchFigureSource(source: string, patch: FigurePatch): string {
  let result = source;
  let figure = parseFigure(result);
  if (!figure) return source;
  const imageIndex = patch.imageIndex ?? 0;
  if (patch.sourcePath !== undefined) {
    const image = figure.images[imageIndex];
    if (image) result = replaceRange(result, image.pathRange.start, image.pathRange.end, patch.sourcePath);
  }
  const optionUpdates: Array<[string, string | boolean | undefined]> = [
    ["width", patch.width], ["height", patch.height], ["scale", patch.scale], ["angle", patch.angle], ["keepaspectratio", patch.keepAspectRatio]
  ];
  for (const [key, value] of optionUpdates) {
    if (value === undefined) continue;
    figure = parseFigure(result);
    const image = figure?.images[imageIndex];
    if (!image) continue;
    const currentOptions = image.optionsRange ? result.slice(image.optionsRange.start, image.optionsRange.end) : "";
    const next = updateOption(currentOptions, key, value);
    if (image.optionsRange) result = replaceRange(result, image.optionsRange.start, image.optionsRange.end, next);
    else if (next) {
      const brace = result.lastIndexOf("{", image.pathRange.start);
      result = result.slice(0, brace) + `[${next}]` + result.slice(brace);
    }
  }
  figure = parseFigure(result);
  if (!figure) return result;
  if (patch.placement !== undefined && figure.environment !== "inline") {
    const opening = /\\begin\{figure\*?\}(?:\[([^\]]*)\])?/.exec(result);
    if (opening) {
      const existing = opening[1];
      result = existing !== undefined
        ? replaceRange(result, (opening.index ?? 0) + opening[0].indexOf(existing), (opening.index ?? 0) + opening[0].indexOf(existing) + existing.length, patch.placement)
        : replaceRange(result, (opening.index ?? 0) + opening[0].length, (opening.index ?? 0) + opening[0].length, patch.placement ? `[${patch.placement}]` : "");
    }
  }
  if (patch.alignment !== undefined && figure.environment !== "inline") {
    const desired = patch.alignment === "center" ? "\\centering" : patch.alignment === "left" ? "\\raggedright" : patch.alignment === "right" ? "\\raggedleft" : "";
    const existing = /\\(?:centering|raggedright|raggedleft)\b/.exec(result);
    if (existing) result = replaceRange(result, existing.index, existing.index + existing[0].length, desired);
    else if (desired) {
      const opening = /\\begin\{figure\*?\}(?:\[[^\]]*\])?/.exec(result);
      if (opening) result = replaceRange(result, (opening.index ?? 0) + opening[0].length, (opening.index ?? 0) + opening[0].length, `\n  ${desired}`);
    }
  }
  const endIndex = Math.max(0, result.search(/\\end\{figure\*?\}/));
  result = patchCommandValue(result, "caption", patch.caption, endIndex);
  const labelInsert = Math.max(0, result.search(/\\end\{figure\*?\}/));
  result = patchCommandValue(result, "label", patch.label, labelInsert);
  return result;
}
