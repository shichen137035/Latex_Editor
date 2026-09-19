import type { editor as MonacoEditor } from "monaco-editor";
import { t } from "../i18n/index.js";

/** Adds TeXWeave-specific entries while preserving Monaco's native cut/copy/paste menu. */
export function installEditorContextActions(editor: MonacoEditor.IStandaloneCodeEditor, onForwardSync?: (line: number, column: number) => void): { dispose(): void } {
  const actions = [
    editor.addAction({ id: "texweave.pastePlain", label: t("editor.context.pastePlain"), contextMenuGroupId: "9_cutcopypaste", contextMenuOrder: 4, run: async () => {
      const text = await navigator.clipboard.readText();
      const selections = editor.getSelections() ?? [];
      editor.executeEdits("texweave-paste-plain", selections.map((range) => ({ range, text, forceMoveMarkers: true })));
    } }),
    editor.addAction({ id: "texweave.deleteSelection", label: t("editor.context.delete"), contextMenuGroupId: "9_cutcopypaste", contextMenuOrder: 5, precondition: "editorHasSelection", run: () => {
      editor.executeEdits("texweave-delete", (editor.getSelections() ?? []).map((range) => ({ range, text: "", forceMoveMarkers: true })));
    } }),
    ...(onForwardSync ? [editor.addAction({ id: "texweave.forwardSync", label: t("editor.context.goToPdf"), contextMenuGroupId: "navigation", contextMenuOrder: 1.5, run: () => {
      const position = editor.getPosition();
      if (position) onForwardSync(position.lineNumber, position.column);
    } })] : [])
  ];
  return { dispose: () => actions.forEach((action) => action.dispose()) };
}
