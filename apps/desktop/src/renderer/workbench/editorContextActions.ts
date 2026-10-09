import type { editor as MonacoEditor } from "monaco-editor";
import { t } from "../i18n/index.js";

/** Adds TeXWeave-specific entries while preserving Monaco's native cut/copy/paste menu. */
export function installEditorContextActions(editor: MonacoEditor.IStandaloneCodeEditor, onForwardSync?: (line: number, column: number) => void, getFileContext?: () => string | undefined): { dispose(): void } {
  const actions = [
    editor.addAction({ id: "texweave.pastePlain", label: t("editor.context.pastePlain"), precondition: "!editorReadonly", contextMenuGroupId: "9_cutcopypaste", contextMenuOrder: 4, run: async () => {
      const model = editor.getModel();
      const version = model?.getVersionId();
      const selections = editor.getSelections() ?? [];
      const fileContext = getFileContext?.();
      if (!model || editor.getRawOptions().readOnly) return;
      const text = await navigator.clipboard.readText();
      if (model.isDisposed() || editor.getModel() !== model || model.getVersionId() !== version || editor.getRawOptions().readOnly || getFileContext?.() !== fileContext) return;
      const current = editor.getSelections() ?? [];
      if (current.length !== selections.length || current.some((selection, index) => !selection.equalsSelection(selections[index]!))) return;
      editor.executeEdits("texweave-paste-plain", selections.map((range) => ({ range, text, forceMoveMarkers: true })));
    } }),
    editor.addAction({ id: "texweave.deleteSelection", label: t("editor.context.delete"), contextMenuGroupId: "9_cutcopypaste", contextMenuOrder: 5, precondition: "editorHasSelection && !editorReadonly", run: () => {
      if (editor.getRawOptions().readOnly) return;
      editor.executeEdits("texweave-delete", (editor.getSelections() ?? []).map((range) => ({ range, text: "", forceMoveMarkers: true })));
    } }),
    ...(onForwardSync ? [editor.addAction({ id: "texweave.forwardSync", label: t("editor.context.goToPdf"), contextMenuGroupId: "navigation", contextMenuOrder: 1.5, run: () => {
      const position = editor.getPosition();
      if (position) onForwardSync(position.lineNumber, position.column);
    } })] : [])
  ];
  return { dispose: () => actions.forEach((action) => action.dispose()) };
}
