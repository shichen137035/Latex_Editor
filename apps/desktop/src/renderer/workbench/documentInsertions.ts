import type { Dispatch, DragEvent, MutableRefObject, SetStateAction } from "react";
import type { PreferenceKey, PreferenceValues, Project } from "@latex-editor/contracts";
import type { OnMount } from "@monaco-editor/react";
import type { EnvironmentDefinition } from "../preview/types.js";
import { environmentCursorOffset, environmentInsertion } from "../preview/EnvironmentPicker.js";
import { addEnvironmentLabel, nextAutomaticLabel } from "../preview/labels.js";
import type { FigureSelection } from "../figure/FigureInspector.js";
import { emptyFigureInsertion, emptyMultiImageInsertion, imageInsertion, multiImageInsertion, uniqueFigureLabels } from "../figure/insert.js";
import type { ImageInsertChoice } from "../figure/ImageInsertDialog.js";
import { patchFigureSource } from "../figure/patch.js";
import type { TableInsertChoice } from "../table/TableInsertDialog.js";
import type { TableSelection } from "../table/model.js";
import { addLatexPackage, tableInsertion, uniqueTableLabel } from "../table/insert.js";
import type { EditorTab } from "./fileActions.js";
import { relativeAssetPath } from "./layout.js";

export type ImageDialogState = { kind: "insert" } | { kind: "replace"; selection: FigureSelection; imageIndex: number };

interface SettingsReader {
  get<K extends PreferenceKey>(key: K): PreferenceValues[K];
}

interface DocumentInsertionOptions {
  api: Window["latexEditor"];
  project: Project;
  store: SettingsReader;
  activeTab: EditorTab | undefined;
  sourceEditorVisible: boolean;
  editorRef: MutableRefObject<Parameters<OnMount>[0] | null>;
  previewInsertionAnchor: MutableRefObject<{ fileId: string; offset: number } | undefined>;
  previewViewportAnchor: MutableRefObject<{ fileId: string; offset: number } | undefined>;
  imageDialog: ImageDialogState | undefined;
  insertText(text: string, cursorOffset?: number, triggerSuggestions?: boolean): void;
  setEditorContent(content: string, edits?: Array<{ start: number; end: number; newLength: number }>): void;
  setFigureSelection: Dispatch<SetStateAction<FigureSelection | undefined>>;
  setTableSelection: Dispatch<SetStateAction<TableSelection | undefined>>;
  setImageDialog: Dispatch<SetStateAction<ImageDialogState | undefined>>;
  setTableDialogOpen(value: boolean): void;
  refreshTree(): Promise<unknown>;
  setBlockNotice: Dispatch<SetStateAction<string | undefined>>;
}

export function createDocumentInsertions(options: DocumentInsertionOptions) {
  const {
    api, project, store, activeTab, sourceEditorVisible, editorRef, previewInsertionAnchor,
    previewViewportAnchor, imageDialog, insertText, setEditorContent, setFigureSelection, setTableSelection,
    setImageDialog, setTableDialogOpen, refreshTree, setBlockNotice
  } = options;

  const insertImageSnippets = (generated: Array<{ text: string; cursorOffset: number }>, requestedAnchor?: number) => {
    if (!activeTab || !generated.length) return;
    const snippets = generated.map((snippet) => uniqueFigureLabels(snippet, activeTab.content));
    const joined = snippets.map((item) => item.text).join("\n\n");
    const firstCursor = snippets[0]?.cursorOffset;
    const editor = editorRef.current;
    if (sourceEditorVisible && editor?.getModel() && editor.getSelection()) { insertText(joined, firstCursor); return; }
    const insertionAnchor = previewInsertionAnchor.current?.fileId === activeTab.path ? previewInsertionAnchor.current.offset : undefined;
    const anchor = requestedAnchor ?? insertionAnchor ?? (previewViewportAnchor.current?.fileId === activeTab.path ? previewViewportAnchor.current.offset : activeTab.content.length);
    const prefix = anchor > 0 && !activeTab.content.slice(0, anchor).endsWith("\n") ? "\n\n" : "";
    const suffix = anchor < activeTab.content.length && !activeTab.content.slice(anchor).startsWith("\n") ? "\n\n" : "";
    previewInsertionAnchor.current = undefined;
    setEditorContent(activeTab.content.slice(0, anchor) + prefix + joined + suffix + activeTab.content.slice(anchor));
  };
  const importImages = async (paths: string[], type: "figure" | "inline", requestedAnchor?: number) => {
    if (!api || !activeTab || !paths.length) return;
    const imported = await api.images.import(project.id, paths, store.get("images").defaultDirectory);
    await refreshTree();
    const relativePaths = imported.filter((item) => item.kind === "file" && /\.(?:png|jpe?g|webp|svg|pdf)$/i.test(item.relativePath)).map((item) => relativeAssetPath(activeTab.path, item.relativePath));
    if (!relativePaths.length) return;
    insertImageSnippets(type === "figure" && relativePaths.length > 1 ? [multiImageInsertion(relativePaths, store.get("images"))] : relativePaths.map((path) => imageInsertion(path, store.get("images"), type)), requestedAnchor);
  };
  const chooseImagePath = async (choice: Extract<ImageInsertChoice, { kind: "project" | "local" }>): Promise<string | undefined> => {
    if (!api || !activeTab) return undefined;
    if (choice.kind === "project") return relativeAssetPath(activeTab.path, choice.path);
    const picked = await api.images.pick(false);
    if (!picked.length) return undefined;
    const [imported] = await api.images.import(project.id, picked, store.get("images").defaultDirectory);
    if (!imported || imported.kind !== "file") return undefined;
    await refreshTree();
    return relativeAssetPath(activeTab.path, imported.relativePath);
  };
  const applyImageChoice = async (choice: ImageInsertChoice) => {
    const dialog = imageDialog;
    if (!activeTab || !dialog) return;
    if (dialog.kind === "insert") {
      if (choice.kind === "empty") insertImageSnippets([emptyFigureInsertion(store.get("images"))]);
      else if (choice.kind === "multi") insertImageSnippets([emptyMultiImageInsertion(choice.rows, choice.columns, store.get("images"))]);
      else {
        const path = await chooseImagePath(choice);
        if (path) insertImageSnippets([imageInsertion(path, store.get("images"), "figure")]);
      }
      setImageDialog(undefined);
      return;
    }
    if (choice.kind !== "project" && choice.kind !== "local") return;
    const path = await chooseImagePath(choice);
    if (!path || activeTab.path !== dialog.selection.fileId) { setImageDialog(undefined); return; }
    const replacement = patchFigureSource(dialog.selection.source, { imageIndex: dialog.imageIndex, sourcePath: path });
    setEditorContent(activeTab.content.slice(0, dialog.selection.start) + replacement + activeTab.content.slice(dialog.selection.end));
    setFigureSelection({ ...dialog.selection, source: replacement, end: dialog.selection.start + replacement.length, imageIndex: dialog.imageIndex });
    setImageDialog(undefined);
  };
  const applyPreviewTableChange = (selection: TableSelection, replacement: string) => {
    if (!activeTab || activeTab.path !== selection.fileId) return;
    let next = activeTab.content.slice(0, selection.start) + replacement + activeTab.content.slice(selection.end);
    let start = selection.start;
    if (replacement.includes("\\multirow{") && !selection.source.includes("\\multirow{")) {
      const packageEdit = addLatexPackage(next, "multirow");
      next = packageEdit.source;
      if (packageEdit.insertedAt <= start) start += packageEdit.length;
    }
    setEditorContent(next);
    setTableSelection({ ...selection, start, source: replacement, end: start + replacement.length });
  };
  const applyTableChoice = (choice: TableInsertChoice) => {
    if (!activeTab) return;
    const preferences = store.get("tables");
    const insertion = uniqueTableLabel(tableInsertion(choice, preferences), activeTab.content);
    const editor = editorRef.current;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    const insertionAnchor = previewInsertionAnchor.current?.fileId === activeTab.path ? previewInsertionAnchor.current.offset : undefined;
    let anchor = sourceEditorVisible && model && selection
      ? model.getOffsetAt(selection.getStartPosition())
      : insertionAnchor ?? (previewViewportAnchor.current?.fileId === activeTab.path ? previewViewportAnchor.current.offset : activeTab.content.length);
    let source = activeTab.content;
    if (choice.addBooktabs) {
      const packageEdit = addLatexPackage(source, "booktabs");
      source = packageEdit.source;
      if (packageEdit.length && packageEdit.insertedAt <= anchor) anchor += packageEdit.length;
    }
    const prefix = anchor > 0 && !source.slice(0, anchor).endsWith("\n") ? "\n\n" : "";
    const suffix = anchor < source.length && !source.slice(anchor).startsWith("\n") ? "\n\n" : "";
    setEditorContent(source.slice(0, anchor) + prefix + insertion.text + suffix + source.slice(anchor));
    previewInsertionAnchor.current = undefined;
    setTableDialogOpen(false);
  };
  const dropImages = (event: DragEvent<HTMLElement>) => {
    if (!api || !event.dataTransfer.files.length) return;
    const paths = Array.from(event.dataTransfer.files).map((file) => api.files.pathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    event.preventDefault();
    let anchor: number | undefined;
    if ((event.target as Element).closest(".editor-surface")) {
      const target = editorRef.current?.getTargetAtClientPoint(event.clientX, event.clientY);
      if (target?.position) editorRef.current?.setPosition(target.position);
    } else {
      const sourceTarget = (event.target as Element).closest<HTMLElement>("[data-source-start-offset][data-source-end-offset]");
      if (sourceTarget) {
        const rect = sourceTarget.getBoundingClientRect();
        anchor = event.clientY < rect.top + rect.height / 2 ? Number(sourceTarget.dataset.sourceStartOffset) : Number(sourceTarget.dataset.sourceEndOffset);
      }
    }
    void importImages(paths, store.get("images").defaultInsert.type, anchor).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)));
  };
  const dropImagesToProject = (event: DragEvent<HTMLElement>) => {
    if (event.defaultPrevented) return;
    if (!api || !event.dataTransfer.files.length) return;
    const paths = Array.from(event.dataTransfer.files).map((file) => api.files.pathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    event.preventDefault();
    void api.images.import(project.id, paths, store.get("images").defaultDirectory).then(() => refreshTree()).catch((error: unknown) => setBlockNotice(error instanceof Error ? error.message : String(error)));
  };
  const insertEnvironment = (definition: EnvironmentDefinition) => {
    const editor = editorRef.current;
    const withAutomaticLabel = (snippet: string, source: string) => store.get("autoEnvironmentLabels") ? addEnvironmentLabel(snippet, nextAutomaticLabel(source, definition)) : snippet;
    try {
      const selection = editor?.getSelection();
      const model = editor?.getModel();
      if (sourceEditorVisible && editor && model && selection) {
        const selectedText = model.getValueInRange(selection);
        const snippet = withAutomaticLabel(environmentInsertion(definition, selectedText) ?? "", model.getValue());
        if (!snippet) return;
        const startOffset = model.getOffsetAt(selection.getStartPosition());
        editor.executeEdits("latex-environment-picker", [{ range: selection, text: snippet, forceMoveMarkers: true }]);
        editor.setPosition(model.getPositionAt(startOffset + environmentCursorOffset(snippet, selectedText)));
        editor.focus();
        return;
      }
    } catch { /* A single-pane Visual view may have disposed the Monaco instance. */ }
    const snippet = activeTab ? withAutomaticLabel(environmentInsertion(definition) ?? "", activeTab.content) : "";
    if (snippet && activeTab) {
      const anchor = previewInsertionAnchor.current?.fileId === activeTab.path ? previewInsertionAnchor.current.offset : activeTab.content.length;
      const prefix = anchor > 0 && !activeTab.content.slice(0, anchor).endsWith("\n") ? "\n\n" : "";
      const suffix = anchor < activeTab.content.length && !activeTab.content.slice(anchor).startsWith("\n") ? "\n\n" : "";
      previewInsertionAnchor.current = undefined;
      setEditorContent(activeTab.content.slice(0, anchor) + prefix + snippet + suffix + activeTab.content.slice(anchor));
    }
  };

  return { applyImageChoice, applyPreviewTableChange, applyTableChoice, dropImages, dropImagesToProject, insertEnvironment };
}
