import type { ImagePreferences } from "@latex-editor/contracts";
import { latexCommandField, latexControlSequences, maskLatexComments } from "@latex-editor/editor-core/latex-source";
import { parseFigure } from "./parser.js";
import { patchFigureSource } from "./patch.js";
import type { ImageObject, SourceRange, SubfigureObject } from "./model.js";

export type SubfigureSyntax = "subfigure" | "subfloat";
export interface FigureSlot { range: SourceRange; imageIndex: number; image: ImageObject | undefined; child?: SubfigureObject }
export class FigureLayoutError extends Error {
  constructor(readonly reason: "capacity" | "complex") { super(reason); }
}

export function gridDimension(value: number): number { return Number.isFinite(value) ? Math.max(1, Math.min(6, Math.floor(value))) : 1; }
export function automaticSubfigureWidth(columns: number): string { return `${Math.max(0.05, 1 / gridDimension(columns) - 0.025).toFixed(3)}\\textwidth`; }

function topLevelImage(source: string, offset: number): boolean {
  let braces = 0;
  for (let index = 0; index < offset; index++) {
    if (source[index] === "\\") { index++; continue; }
    if (source[index] === "{") braces++;
    else if (source[index] === "}") braces--;
  }
  return braces === 0;
}

export function figureLayout(source: string) {
  const figure = parseFigure(source);
  if (!figure) return undefined;
  const masked = maskLatexComments(source);
  const imageDepths = new Map([...latexControlSequences(masked)].filter(token => token.name === "includegraphics").map(token => [token.start, token.environmentDepth]));
  const slots: FigureSlot[] = figure.subfigures.length ? figure.subfigures.map(child => ({ range: child.sourceRange, imageIndex: figure.images.findIndex(image => image.sourceRange.start === child.images[0]?.sourceRange.start), image: child.images[0], child }))
    : figure.images.map((image, imageIndex) => ({ range: image.sourceRange, imageIndex, image }));
  const covered = slots.reduce((sum, slot) => sum + (slot.child?.images.length ?? 1), 0);
  const supported = covered === figure.images.length && slots.every((slot, index) => (!slot.child || slot.child.images.length === 1) && (!slots[index - 1] || slots[index - 1]!.range.end <= slot.range.start)
    && (slot.child || topLevelImage(masked, slot.range.start) && (imageDepths.get(slot.range.start) ?? 0) <= (figure.environment === "inline" ? 0 : 1)));
  const rowLengths: number[] = [];
  let length = 0;
  slots.forEach((slot, index) => {
    length++;
    const next = slots[index + 1];
    const gap = next ? masked.slice(slot.range.end, next.range.start) : "";
    if (!next || /\\\\(?:\s*\[[^\]]*\])?|\\par\b|\n[ \t]*\n/.test(gap)) { rowLengths.push(length); length = 0; }
  });
  return { figure, slots, supported, rows: Math.max(1, rowLengths.length), columns: Math.max(1, ...rowLengths), syntax: (figure.subfigures[0]?.syntax ?? "subfigure") as SubfigureSyntax };
}

function replace(source: string, range: SourceRange, value: string): string { return source.slice(0, range.start) + value + source.slice(range.end); }

/** Swap whole units so paths/options, child captions and labels stay together. */
export function swapFigureSlots(source: string, from: number, to: number): string {
  const layout = figureLayout(source);
  if (!layout?.supported) throw new FigureLayoutError("complex");
  const first = layout.slots[from], second = layout.slots[to];
  if (!first || !second || from === to) return source;
  const edits = [ { range: first.range, value: source.slice(second.range.start, second.range.end) }, { range: second.range, value: source.slice(first.range.start, first.range.end) } ];
  for (const edit of edits.sort((a, b) => b.range.start - a.range.start)) source = replace(source, edit.range, edit.value);
  return source;
}

function gapComments(gap: string): string {
  const masked = maskLatexComments(gap);
  const residual = masked.replace(/\\\\(?:\s*\[[^\]]*\])?|\\(?:hfill|par|smallskip|medskip|bigskip|quad|qquad)\b|\\[hv]space\*?\s*\{[^{}]*\}/g, "").trim();
  if (residual) throw new FigureLayoutError("complex");
  return gap.split(/\r?\n/).map((line, index) => {
    const maskedLine = masked.split(/\r?\n/)[index] ?? "";
    const start = [...line].findIndex((char, offset) => char === "%" && maskedLine[offset] !== "%");
    return start < 0 ? "" : line.slice(start);
  }).filter(Boolean).join("\n");
}

function cellSource(source: string, slot: FigureSlot | undefined, width: string, syntax: SubfigureSyntax, imageWidth: string): string {
  if (slot?.child) {
    if (slot.child.syntax !== syntax) throw new FigureLayoutError("complex");
    const raw = source.slice(slot.range.start, slot.range.end);
    if (slot.child.widthRange) return replace(raw, { start: slot.child.widthRange.start - slot.range.start, end: slot.child.widthRange.end - slot.range.start }, width);
    return patchFigureSource(raw, { imageIndex: 0, width });
  }
  const graphic = slot ? source.slice(slot.range.start, slot.range.end) : "\\includegraphics{}";
  const image = patchFigureSource(graphic, { width: syntax === "subfloat" ? width : imageWidth });
  return syntax === "subfloat" ? `\\subfloat[]{${image}}` : `\\begin{subfigure}{${width}}\n    \\centering\n    ${image}\n    \\caption{}\n  \\end{subfigure}`;
}

/** Change geometry while preserving the outer float and all non-empty child units. */
export function resizeFigureLayout(source: string, rows: number, columns: number, preferences: ImagePreferences, preferredSyntax: SubfigureSyntax = "subfigure"): string {
  const layout = figureLayout(source);
  if (!layout?.supported) throw new FigureLayoutError("complex");
  const r = gridDimension(rows), c = gridDimension(columns), count = r * c;
  let slots = [...layout.slots];
  if (slots.length > count) {
    const occupied = slots.filter(slot => {
      if (slot.image?.sourcePath || slot.child?.caption || slot.child?.label) return true;
      if (!slot.child?.bodyRange || !slot.image) return false;
      const body = maskLatexComments(source.slice(slot.child.bodyRange.start, slot.child.bodyRange.end));
      const graphic = { start: slot.image.sourceRange.start - slot.child.bodyRange.start, end: slot.image.sourceRange.end - slot.child.bodyRange.start };
      const remaining = replace(body, graphic, "").replace(/\\centering\b|\\(?:caption|label)\s*\{\s*\}/g, "").trim();
      return Boolean(remaining);
    });
    if (occupied.length > count) throw new FigureLayoutError("capacity");
    slots = occupied;
  }
  const comments = layout.slots.slice(0, -1).map((slot, index) => gapComments(source.slice(slot.range.end, layout.slots[index + 1]!.range.start))).filter(Boolean);
  const syntax = layout.figure.subfigures.length ? layout.syntax : preferredSyntax;
  const width = preferences.multiFigure.subfigureWidth === "auto" ? automaticSubfigureWidth(c) : preferences.multiFigure.subfigureWidth;
  const pieces: string[] = [];
  for (let index = 0; index < count; index++) {
    const slot = slots[index];
    if (count === 1 && !slot?.child) pieces.push(slot ? source.slice(slot.range.start, slot.range.end) : `\\includegraphics[width=${preferences.defaultInsert.width}]{} `);
    else pieces.push(cellSource(source, slot, width, syntax, preferences.multiFigure.imageWidth));
    if (index < count - 1) pieces.push((index + 1) % c ? preferences.multiFigure.horizontalGap : `\\\\[${preferences.multiFigure.verticalGap}]`);
  }
  if (comments.length) pieces.push(...comments);
  const body = pieces.join("\n  ");
  if (layout.figure.environment === "inline" && count > 1) return `\\begin{figure}[${preferences.defaultInsert.placement}]\n  \\centering\n  ${body}\n\\end{figure}`;
  const closing = maskedClosing(source);
  const insertion = latexCommandField(source, "caption")?.start ?? closing;
  const range = layout.slots.length ? { start: layout.slots[0]!.range.start, end: layout.slots.at(-1)!.range.end } : { start: insertion, end: insertion };
  return replace(source, range, `${body}${layout.slots.length ? "" : "\n"}`);
}

function maskedClosing(source: string): number { const index = maskLatexComments(source).search(/\\end\{figure\*?\}/); return index < 0 ? source.length : index; }

/** Prefer existing package syntax; subfig keeps IEEEtran's caption policy intact. */
export function preferredSubfigureSyntax(document: string): SubfigureSyntax {
  const source = maskLatexComments(document);
  return /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\s*\{[^}]*\bsubfig\b/.test(source) || /\\documentclass(?:\[[^\]]*\])?\s*\{IEEEtran\}/.test(source) ? "subfloat" : "subfigure";
}

export function subfigurePackage(source: string): "subcaption" | "subfig" | undefined {
  const masked = maskLatexComments(source);
  return /\\begin\s*\{subfigure\}/.test(masked) ? "subcaption" : /\\subfloat\b/.test(masked) ? "subfig" : undefined;
}
