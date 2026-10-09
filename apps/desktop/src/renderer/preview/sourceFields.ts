import { latexCommandField, maskLatexComments, readLatexGroup } from "@latex-editor/editor-core/latex-source";

export interface PreviewSourceField { start: number; end: number; value: string }

export function environmentOptionField(source: string): PreviewSourceField | undefined {
  if (!/^\s*\\begin\b/.test(source)) return;
  const masked = maskLatexComments(source);
  const begin = /^\s*\\begin\s*\{[^{}]+\}\s*/.exec(masked);
  const field = begin && readLatexGroup(masked, begin[0].length, "[", "]");
  return field ? { ...field, value: source.slice(field.start, field.end) } : undefined;
}

/** A caption is a source command, not a semantic block; skip captions of nested subfigures. */
export function captionSourceField(source: string): (PreviewSourceField & { body: PreviewSourceField }) | undefined {
  return latexCommandField(source, "caption");
}

export function replaceSourceField(source: string, field: PreviewSourceField, value: string): string | undefined {
  if (source.slice(field.start, field.end) !== field.value) return;
  return source.slice(0, field.start) + value + source.slice(field.end);
}
