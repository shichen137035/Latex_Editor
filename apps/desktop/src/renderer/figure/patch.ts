import { latexCommandField, latexControlSequences, maskLatexComments } from "@latex-editor/editor-core/latex-source";
import { patchGraphicOption } from "./options.js";
import { maskSubfigures, parseFigure } from "./parser.js";
import type { FigurePatch } from "./model.js";

function replaceRange(source: string, start: number, end: number, value: string): string {
  return source.slice(0, start) + value + source.slice(end);
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
    const next = patchGraphicOption(currentOptions, key, value);
    if (image.optionsRange) result = replaceRange(result, image.optionsRange.start, image.optionsRange.end, next);
    else if (next) {
      const brace = result.lastIndexOf("{", image.pathRange.start);
      result = result.slice(0, brace) + `[${next}]` + result.slice(brace);
    }
  }
  figure = parseFigure(result);
  if (!figure) return result;
  if (patch.placement !== undefined && figure.environment !== "inline") {
    const opening = /\\begin\{figure\*?\}(?:\[([^\]]*)\])?/.exec(maskLatexComments(result));
    if (opening) {
      const existing = opening[1];
      result = existing !== undefined
        ? replaceRange(result, opening.index + opening[0].length - existing.length - 1, opening.index + opening[0].length - 1, patch.placement)
        : replaceRange(result, (opening.index ?? 0) + opening[0].length, (opening.index ?? 0) + opening[0].length, patch.placement ? `[${patch.placement}]` : "");
    }
  }
  if (patch.alignment !== undefined && figure.environment !== "inline") {
    const desired = patch.alignment === "center" ? "\\centering" : patch.alignment === "left" ? "\\raggedright" : patch.alignment === "right" ? "\\raggedleft" : "";
    const existing = [...latexControlSequences(result)].find(token => token.environmentDepth <= 1 && ["centering", "raggedright", "raggedleft"].includes(token.name));
    if (existing) result = replaceRange(result, existing.start, existing.end, desired);
    else if (desired) {
      const opening = /\\begin\{figure\*?\}(?:\[[^\]]*\])?/.exec(maskLatexComments(result));
      if (opening) result = replaceRange(result, (opening.index ?? 0) + opening[0].length, (opening.index ?? 0) + opening[0].length, `\n  ${desired}`);
    }
  }
  const endIndex = Math.max(0, maskLatexComments(result).search(/\\end\{figure\*?\}/));
  const patchOuter = (command: string, value: string | undefined, before: number) => {
    if (value === undefined) return;
    const current = parseFigure(result);
    const field = latexCommandField(maskSubfigures(result, current?.subfigures ?? []), command);
    if (field) result = replaceRange(result, field.body.start, field.body.end, value);
    else if (value) result = result.slice(0, before) + `  \\${command}{${value}}\n` + result.slice(before);
  };
  patchOuter("caption", patch.caption, endIndex);
  const labelInsert = Math.max(0, maskLatexComments(result).search(/\\end\{figure\*?\}/));
  patchOuter("label", patch.label, labelInsert);
  return result;
}
