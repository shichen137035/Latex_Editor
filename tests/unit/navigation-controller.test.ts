import { describe, expect, it, vi } from "vitest";
import type { SetStateAction } from "react";
import { createNavigationController, type NavigationRequest } from "../../apps/desktop/src/renderer/workbench/navigationController.js";
import { createFileOpeningController } from "../../apps/desktop/src/renderer/workbench/fileOpening.js";
import { NavigationHistory } from "../../apps/desktop/src/renderer/workbench/NavigationHistory.js";
import { defaultLayout, type PersistedLayout } from "../../apps/desktop/src/renderer/workbench/layout.js";
import type { EditorTab } from "../../apps/desktop/src/renderer/workbench/fileActions.js";

function deferred() {
  let resolve!: (value: { content: string }) => void;
  const promise = new Promise<{ content: string }>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let layout: PersistedLayout = { ...defaultLayout, mode: "single", singlePane: "preview", leftPane: "preview" };
  let request: NavigationRequest | undefined;
  const source = "First line.\nSecond line.\nThird line.";
  const activePathRef = { current: "main.tex" as string | undefined };
  const tabsRef = { current: [{ path: "main.tex", content: source, dirty: false }] as EditorTab[] };
  const sequenceRef = { current: 0 };
  const history = new NavigationHistory();
  const read = vi.fn<(project: string, path: string) => Promise<{ content: string }>>(async () => ({ content: source }));
  const options = {
    project: { id: "project" }, api: { files: { read } }, pdfFile: "main.pdf", layout,
    setLayout: vi.fn((update: SetStateAction<PersistedLayout>) => { layout = typeof update === "function" ? update(layout) : update; }),
    activePathRef, tabsRef, editorRef: { current: null }, sourceModelPath: { current: undefined }, lastTextPane: { current: "preview" },
    sourcePositions: { current: new Map() }, previewPositions: { current: new Map([["main.tex", { offset: 3, scrollTop: 80 }]]) },
    previewViewportAnchor: { current: undefined }, navigationHistory: { current: history }, navigationNonce: { current: 0 }, fileOpenSequence: sequenceRef,
    setNavigationRequest: vi.fn((update: SetStateAction<NavigationRequest | undefined>) => { request = typeof update === "function" ? update(request) : update; }), setPdfTarget: vi.fn(),
    openFile: vi.fn()
  } as unknown as Parameters<typeof createNavigationController>[0];
  options.openFile = createFileOpeningController({
    api: options.api, project: options.project, activePathRef, tabsRef, sequenceRef,
    openingFilesRef: { current: new Map() }, savedContents: { current: new Map() },
    setAiDiffFile: vi.fn(), setActivePath: (update) => { activePathRef.current = typeof update === "function" ? update(activePathRef.current) : update; },
    setTabs: (update) => { tabsRef.current = typeof update === "function" ? update(tabsRef.current) : update; }, rememberPreviewPosition: vi.fn()
  }).openFile;
  return { controller: createNavigationController(options), options, read, history, activePathRef, tabsRef, sequenceRef, source,
    get request() { return request; }, get layout() { return layout; } };
}

describe("document navigation transactions", () => {
  it("captures the live cursor after edits instead of the saved Preview scroll position", () => {
    const f = fixture();
    f.options.sourceModelPath.current = "main.tex";
    f.options.sourcePositions.current.set("main.tex", { offset: 1, scrollTop: 0 });
    f.options.editorRef.current = {
      getDomNode: () => ({ isConnected: true }), getPosition: () => ({ lineNumber: 3, column: 2 }),
      getModel: () => ({ getOffsetAt: () => f.source.indexOf("Third") + 1 }), getScrollTop: () => 240
    } as unknown as NonNullable<typeof f.options.editorRef.current>;
    f.options.onNavigationPosition = vi.fn();
    f.controller.requestPreviewAtSourcePosition();
    expect(f.request).toEqual({ path: "main.tex", offset: f.source.indexOf("Third") + 1, nonce: 1 });
    expect(f.options.sourcePositions.current.get("main.tex")).toEqual({ offset: f.request!.offset, scrollTop: 240 });
    expect(f.options.onNavigationPosition).toHaveBeenCalledWith("main.tex", f.request!.offset);
    expect(f.history.canBack).toBe(false);
    f.controller.requestPreviewAtSourcePosition();
    expect(f.request?.nonce).toBe(2);
  });

  it("ignores another file's or an unmounted model and clamps the fallback after deletion", () => {
    const f = fixture();
    f.options.sourcePositions.current.set("main.tex", { offset: 999, scrollTop: 240 });
    const getOffsetAt = vi.fn(() => 5);
    f.options.editorRef.current = {
      getDomNode: () => ({ isConnected: false }), getPosition: () => ({ lineNumber: 1, column: 1 }),
      getModel: () => ({ getOffsetAt })
    } as unknown as NonNullable<typeof f.options.editorRef.current>;
    f.options.sourceModelPath.current = "main.tex";
    f.controller.requestPreviewAtSourcePosition();
    expect(f.request?.offset).toBe(f.source.length);
    f.options.sourceModelPath.current = "other.tex";
    f.controller.requestPreviewAtSourcePosition();
    expect(getOffsetAt).not.toHaveBeenCalled();
    expect(f.request?.path).toBe("main.tex");
  });

  it("restores both files and exact positions after a prefixed external reference jump", async () => {
    const f = fixture();
    f.options.onNavigationPosition = vi.fn();
    const text = String.raw`\ref{S-thm:result}`;
    f.tabsRef.current[0]!.content = `Intro. ${text}`;
    const target = String.raw`Intro.\label {thm:result}`;
    f.read.mockResolvedValue({ content: target });
    await f.controller.navigateTo("supplement.tex", { offset: 6 }, "preview", true, { path: "main.tex", offset: 7, layout: f.layout, link: { start: 7, text, targetLabel: "thm:result", targetPath: "supplement.tex" } });
    expect(f.history.canBack).toBe(true);
    expect(f.options.onNavigationPosition).toHaveBeenLastCalledWith("supplement.tex", 6);
    await f.controller.navigateBack();
    expect(f.request).toMatchObject({ path: "main.tex", offset: 7 });
    expect(f.options.onNavigationPosition).toHaveBeenLastCalledWith("main.tex", 7);
    await f.controller.navigateForward();
    expect(f.request).toMatchObject({ path: "supplement.tex", offset: 6 });
    await f.controller.navigateBack();
    expect(f.request).toMatchObject({ path: "main.tex", offset: 7 });
  });
  it("preserves Visual mode and restores both the origin and destination", async () => {
    const f = fixture();
    await f.controller.navigateTo("notes.tex", { line: 2, column: 3 });
    expect(f.activePathRef.current).toBe("notes.tex");
    expect(f.layout.singlePane).toBe("preview");
    await f.controller.navigateBack();
    expect(f.request).toMatchObject({ path: "main.tex", offset: 3 });
    await f.controller.navigateForward();
    expect(f.request).toMatchObject({ path: "notes.tex", offset: f.source.indexOf("Second") + 2 });
  });

  it("does not record a slower superseded file jump", async () => {
    const f = fixture(), slow = deferred(), fast = deferred();
    f.read.mockImplementation((_project, path) => path === "slow.tex" ? slow.promise : fast.promise);
    const first = f.controller.navigateTo("slow.tex", { offset: 8 }, "source");
    const second = f.controller.navigateTo("fast.tex", { offset: 16 });
    fast.resolve({ content: f.source }); await second;
    slow.resolve({ content: f.source }); await first;
    expect(f.activePathRef.current).toBe("fast.tex");
    expect(f.request).toMatchObject({ path: "fast.tex", offset: 16 });
    expect(f.layout.singlePane).toBe("preview");
    expect(f.history.back(() => true)).toMatchObject({ path: "main.tex", offset: 3 });
    expect(f.history.back(() => true)).toBeUndefined();
  });

  it("preserves a Code/Visual layout change made during an asynchronous file read", async () => {
    const f = fixture(), pending = deferred();
    f.read.mockImplementation(() => pending.promise);
    const layoutRef = { current: f.layout };
    f.options.layoutRef = layoutRef;
    const navigation = f.controller.navigateTo("notes.tex", { offset: 8 });
    layoutRef.current = { ...f.layout, mode: "split", leftPane: "source" };
    pending.resolve({ content: f.source }); await navigation;
    expect(f.layout).toMatchObject({ mode: "split", leftPane: "source" });
    f.history.back(() => true);
    expect(f.history.forward(() => true)?.layout).toMatchObject({ mode: "split", leftPane: "source" });
  });

  it("cancels pending history work when a manual tab action interrupts it", async () => {
    const f = fixture(), pending = deferred();
    f.read.mockImplementation(() => pending.promise);
    const navigation = f.controller.navigateTo("slow.tex", { offset: 8 }, "source");
    f.sequenceRef.current += 1;
    f.options.setNavigationRequest(undefined);
    f.history.clear();
    pending.resolve({ content: f.source }); await navigation;
    expect(f.activePathRef.current).toBe("main.tex");
    expect(f.history.canBack).toBe(false);
    expect(f.layout.singlePane).toBe("preview");
    expect(f.request).toBeUndefined();
  });

  it("clears failed opening requests without changing mode or history", async () => {
    const f = fixture();
    f.read.mockRejectedValue(new Error("Missing file"));
    await f.controller.navigateTo("missing.tex", { line: 9 }, "source");
    expect(f.request).toBeUndefined();
    expect(f.layout.singlePane).toBe("preview");
    expect(f.history.canBack).toBe(false);
  });

  it("keeps only the latest offset when two jumps share one file read", async () => {
    const f = fixture(), pending = deferred();
    f.read.mockImplementation(() => pending.promise);
    const first = f.controller.navigateTo("notes.tex", { offset: 8 });
    const second = f.controller.navigateTo("notes.tex", { offset: 19 });
    pending.resolve({ content: f.source }); await Promise.all([first, second]);
    expect(f.read).toHaveBeenCalledOnce();
    expect(f.request).toMatchObject({ path: "notes.tex", offset: 19 });
    expect(f.history.back(() => true)?.path).toBe("main.tex");
    expect(f.history.forward(() => true)?.offset).toBe(19);
    expect(f.history.forward(() => true)).toBeUndefined();
  });

  it("uses the remembered text pane for PDF reverse sync in a split layout", async () => {
    const f = fixture();
    f.options.layout = { ...f.layout, mode: "split", leftPane: "source" };
    f.options.api = { ...f.options.api, synctex: { reverse: vi.fn(async () => ({ file: "notes.tex", line: 2, column: 1 })) } } as unknown as NonNullable<typeof f.options.api>;
    await f.controller.reverseSyncFromPdf(1, 10, 20);
    expect(f.layout.leftPane).toBe("preview");
    expect(f.request).toMatchObject({ path: "notes.tex", line: 2 });
  });

  it("ignores a PDF sync response after a newer file action", async () => {
    const f = fixture();
    let finish!: (target: { file: string; line: number; column: number }) => void;
    const result = new Promise<{ file: string; line: number; column: number }>((resolve) => { finish = resolve; });
    f.options.api = { ...f.options.api, synctex: { reverse: vi.fn(() => result) } } as unknown as NonNullable<typeof f.options.api>;
    const syncing = f.controller.reverseSyncFromPdf(1, 10, 20);
    f.sequenceRef.current += 1;
    finish({ file: "notes.tex", line: 2, column: 1 }); await syncing;
    expect(f.read).not.toHaveBeenCalled();
    expect(f.request).toBeUndefined();
    expect(f.history.canBack).toBe(false);
  });

  it("keeps the history stack intact when a dirty Preview draft declines navigation", async () => {
    const f = fixture();
    await f.controller.navigateTo("notes.tex", { offset: 12 });
    f.options.prepareNavigation = vi.fn(() => false);
    await f.controller.navigateBack();
    expect(f.activePathRef.current).toBe("notes.tex");
    expect(f.history.canBack).toBe(true);
    expect(f.history.canForward).toBe(false);
  });

  it("commits a draft before validating surviving navigation links", async () => {
    const f = fixture();
    const text = String.raw`\ref{sec:one}`;
    f.tabsRef.current[0]!.content = `${text}\\label{sec:one}`;
    f.history.record({ path: "main.tex", offset: 0, layout: f.layout, link: { start: 0, text, targetLabel: "sec:one" } },
      { path: "main.tex", offset: 12, layout: f.layout });
    f.options.prepareNavigation = () => { f.tabsRef.current[0]!.content = "Removed the reference and label."; return true; };
    await f.controller.navigateBack();
    expect(f.history.canForward).toBe(false);
    expect(f.request).toBeUndefined();
  });
});
