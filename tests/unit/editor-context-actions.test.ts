import { afterEach, describe, expect, it, vi } from "vitest";
import type { editor } from "monaco-editor";
import { installEditorContextActions } from "../../apps/desktop/src/renderer/workbench/editorContextActions.js";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  let resolve!: (text: string) => void;
  vi.stubGlobal("navigator", { clipboard: { readText: () => new Promise<string>(done => { resolve = done; }) } });
  const actions = new Map<string, editor.IActionDescriptor>();
  let version = 1;
  let readOnly = false;
  let path = "main.tex";
  const model = { getVersionId: () => version, isDisposed: () => false };
  let activeModel: typeof model | null = model;
  const selection = { equalsSelection: (other: unknown) => other === selection };
  let selections = [selection];
  const executeEdits = vi.fn();
  const target = {
    addAction: (action: editor.IActionDescriptor) => { actions.set(action.id, action); return { dispose() {} }; },
    getModel: () => activeModel, getSelections: () => selections, getRawOptions: () => ({ readOnly }), executeEdits
  } as unknown as editor.IStandaloneCodeEditor;
  const disposable = installEditorContextActions(target, undefined, () => path);
  return { actions, target, disposable, executeEdits, resolve: (text: string) => resolve(text), change: () => { version += 1; }, switchModel: () => { activeModel = null; }, switchFile: () => { path = "same-content.tex"; }, moveCursor: () => { selections = [{ equalsSelection: () => false }]; }, makeReadOnly: () => { readOnly = true; } };
}

describe("asynchronous source clipboard actions", () => {
  it("pastes into the captured selection when the editor is unchanged", async () => {
    const test = setup();
    const pending = test.actions.get("texweave.pastePlain")!.run(test.target);
    test.resolve("plain text");
    await pending;
    expect(test.executeEdits).toHaveBeenCalledWith("texweave-paste-plain", [expect.objectContaining({ text: "plain text" })]);
    test.disposable.dispose();
  });
  it.each(["edit", "switch", "same-content-file", "cursor", "readonly"])("cancels paste if %s changes during clipboard access", async reason => {
    const test = setup();
    const pending = test.actions.get("texweave.pastePlain")!.run(test.target);
    if (reason === "edit") test.change();
    if (reason === "switch") test.switchModel();
    if (reason === "same-content-file") test.switchFile();
    if (reason === "cursor") test.moveCursor();
    if (reason === "readonly") test.makeReadOnly();
    test.resolve("stale text");
    await pending;
    expect(test.executeEdits).not.toHaveBeenCalled();
    test.disposable.dispose();
  });
});
