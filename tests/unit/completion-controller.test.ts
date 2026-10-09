import { describe, expect, it, vi } from "vitest";
import type { CancellationToken, editor, languages } from "monaco-editor";
import { CompletionController } from "../../apps/desktop/src/renderer/completion/CompletionController.js";

function harness(source = "\\cite{new", read?: () => Promise<{ content: string }>) {
  let provider!: languages.CompletionItemProvider;
  let version = 1;
  let path = "main.tex";
  const model = { getLineContent: () => source, getValue: () => source, getVersionId: () => version, isDisposed: () => false } as unknown as editor.ITextModel;
  const fileRead = vi.fn(read ?? (async () => ({ content: "@article{oldKey,title={Disk}}" })));
  const options = {
    monaco: { languages: { registerCompletionItemProvider: (_language: string, value: languages.CompletionItemProvider) => { provider = value; return { dispose: vi.fn() }; }, CompletionItemKind: { Reference: 1, Value: 2 }, CompletionItemInsertTextRule: { InsertAsSnippet: 4 } } },
    api: { files: { read: fileRead }, resources: { searchCommands: async () => [] } }, projectId: "project",
    getModel: () => model, getCurrentPath: () => path,
    getTree: () => [{ name: "refs.bib", relativePath: "refs.bib", kind: "file" }],
    getEnvironments: () => [], isDocumentWordCompletionEnabled: () => true,
    getOpenDocuments: () => [{ path: "refs.bib", content: "@article{newKey,title={Unsaved}}" }]
  } as unknown as ConstructorParameters<typeof CompletionController>[0];
  const controller = new CompletionController(options);
  const token = { isCancellationRequested: false } as CancellationToken;
  const request = (target = model) => Promise.resolve(provider.provideCompletionItems(target, { lineNumber: 1, column: source.length + 1 }, { triggerKind: 0 }, token));
  return { controller, options, request, fileRead, token, change: () => { version += 1; }, switchPath: () => { path = "other.tex"; } };
}

describe("editor completion request lifecycle", () => {
  it("refreshes changed bibliography contents when the tree refreshes even if its paths are unchanged", async () => {
    let content = "@book{oldKey,title={Old}}";
    const test = harness("\\cite{", async () => ({ content }));
    let tree = [{ name: "refs.bib", relativePath: "refs.bib", kind: "file" as const }];
    test.options.getTree = () => tree; test.options.getOpenDocuments = () => [];
    try {
      expect((await test.request())?.suggestions.map(item => item.label)).toContain("oldKey");
      content = "@book{newKey,title={Changed}}"; tree = [...tree];
      expect((await test.request())?.suggestions.map(item => item.label)).toContain("newKey");
      expect(test.fileRead).toHaveBeenCalledTimes(2);
    } finally { test.controller.dispose(); }
  });
  it("only serves its own editor and uses unsaved project buffers", async () => {
    const test = harness();
    try {
      expect((await test.request({} as editor.ITextModel))?.suggestions).toEqual([]);
      expect(test.fileRead).not.toHaveBeenCalled();
      expect((await test.request())?.suggestions.map(item => item.label)).toContain("newKey");
      expect((await test.request())?.suggestions.map(item => item.label)).not.toContain("oldKey");
    } finally { test.controller.dispose(); }
  });
  it.each(["edit", "switch", "cancel", "dispose"])("discards a pending request after %s", async action => {
    let resolve!: (value: { content: string }) => void;
    const test = harness("\\cite{new", () => new Promise(done => { resolve = done; }));
    const pending = test.request();
    if (action === "edit") test.change();
    if (action === "switch") test.switchPath();
    if (action === "cancel") (test.token as { isCancellationRequested: boolean }).isCancellationRequested = true;
    if (action === "dispose") test.controller.dispose();
    resolve({ content: "@article{newKey,title={Disk}}" });
    expect((await pending)?.suggestions).toEqual([]);
    test.controller.dispose();
  });
  it("preserves declarations outside a Preview source fragment", async () => {
    const test = harness("\\ref{out");
    const prefix = "\\label{outside}\n";
    test.options.getOpenDocuments = () => [{ path: "main.tex", content: prefix + "Old fragment" }];
    test.options.getSourceRange = () => ({ start: prefix.length, end: prefix.length + "Old fragment".length });
    try { expect((await test.request())?.suggestions.map(item => item.label)).toContain("outside"); }
    finally { test.controller.dispose(); }
  });
  it("does not let an in-flight read undo cache invalidation", async () => {
    let resolve!: (value: { content: string }) => void;
    let reads = 0;
    const test = harness("\\cite{new", () => ++reads === 1 ? new Promise(done => { resolve = done; }) : Promise.resolve({ content: "@article{newKey,title={Updated}}" }));
    test.options.getOpenDocuments = () => [];
    const pending = test.request();
    test.controller.invalidate();
    resolve({ content: "@article{oldKey,title={Stale}}" });
    try {
      expect((await pending)?.suggestions.map(item => item.label)).toContain("newKey");
      expect(reads).toBe(2);
    } finally { test.controller.dispose(); }
  });
});
