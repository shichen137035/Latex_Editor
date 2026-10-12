import { latexHeadingFields } from "@latex-editor/editor-core/latex-source";
import { addFigurePackage } from "../figure/packages.js";
import { subfigurePackage } from "../figure/layout.js";
import type { FigureSelection } from "../figure/FigureInspector.js";

interface FigureEditDocument { path: string; content: string }
export interface FigureEditPlan {
  document: FigureEditDocument;
  before: string;
  selection: FigureSelection;
  preamble?: { document: FigureEditDocument; before: string };
}

export async function planFigureEdit(selection: FigureSelection, replacement: string, options: {
  mainFile?: string | undefined;
  activePath(): string | undefined;
  documents(): FigureEditDocument[];
  documentFiles(path: string): string[];
  read(path: string): Promise<string>;
}): Promise<FigureEditPlan> {
  const active = options.documents().find(file => file.path === selection.fileId);
  if (!active || options.activePath() !== selection.fileId || active.content.slice(selection.start, selection.end) !== selection.source) throw new Error("image.layout.changed");
  let source = active.content.slice(0, selection.start) + replacement + active.content.slice(selection.end), start = selection.start;
  const required = subfigurePackage(replacement);
  let preamble: FigureEditPlan["preamble"];
  if (required) {
    const documentClass = [...latexHeadingFields(active.content, ["documentclass"])][0];
    const owner = documentClass && documentClass.body.value.trim() !== "subfiles" ? active.path : options.mainFile ?? active.path;
    const openOwner = options.documents().find(file => file.path === owner);
    const ownerSource = owner === active.path ? active.content : openOwner?.content ?? await options.read(owner);
    const context = options.documentFiles(owner).map(path => options.documents().find(file => file.path === path)?.content ?? "").join("\n");
    const edited = addFigurePackage(owner === active.path ? source : ownerSource, required, ownerSource + "\n" + context);
    if (edited.length) {
      if (owner === active.path) { source = edited.source; if (edited.offset <= start) start += edited.length; }
      else preamble = { document: { path: owner, content: edited.source }, before: ownerSource };
    }
    if (options.documents().find(file => file.path === selection.fileId)?.content !== active.content || options.activePath() !== selection.fileId) throw new Error("image.layout.changed");
    const latestOwner = options.documents().find(file => file.path === owner);
    if (owner !== active.path && latestOwner && latestOwner.content !== ownerSource) throw new Error("image.layout.changed");
  }
  return { before: active.content, document: { path: active.path, content: source }, selection: { ...selection, source: replacement, start, end: start + replacement.length }, ...(preamble ? { preamble } : {}) };
}
