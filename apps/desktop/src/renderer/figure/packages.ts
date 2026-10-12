import { latexHeadingFields, maskLatexComments } from "@latex-editor/editor-core/latex-source";

export function figurePackageLoaded(source: string, name: string): boolean {
  return [...latexHeadingFields(source, ["usepackage", "RequirePackage", "RequirePackageWithOptions"])].some(field => field.body.value.split(",").some(value => value.trim() === name));
}

/** Add packages only in a document preamble; never at the start of a chapter body. */
export function addFigurePackage(source: string, name: "subcaption" | "subfig", context = source): { source: string; offset: number; length: number } {
  if (figurePackageLoaded(context, name)) return { source, offset: 0, length: 0 };
  if (figurePackageLoaded(context, name === "subcaption" ? "subfig" : "subcaption") || figurePackageLoaded(context, "subfigure")) throw new Error("image.layout.packageConflict");
  const masked = maskLatexComments(source);
  const start = /\\begin\s*\{document\}/.exec(masked)?.index;
  const documentClass = [...latexHeadingFields(source, ["documentclass"])][0];
  if (!documentClass && start === undefined) throw new Error("image.layout.noPreamble");
  const ieee = documentClass?.body.value.trim() === "IEEEtran";
  const offset = start ?? documentClass!.end;
  const text = `\n\\usepackage${name === "subfig" && ieee ? "[caption=false]" : ""}{${name}}\n`;
  return { source: source.slice(0, offset) + text + source.slice(offset), offset, length: text.length };
}
