import { afterEach, expect, it, vi } from "vitest";
import { capturePreviewScrollAnchor, restorePreviewScrollAnchor } from "../../apps/desktop/src/renderer/preview/scrollAnchor.js";
import { VirtualPreviewController } from "../../apps/desktop/src/renderer/preview/VirtualPreview.js";

afterEach(() => vi.unstubAllGlobals());

function layout() {
  const positions: Array<{ top: number; height: number; parent: boolean }> = [];
  const elements: HTMLElement[] = [];
  const root = {
    scrollTop: 1000, clientHeight: 600,
    getBoundingClientRect: () => ({ top: 100, bottom: 700 }),
    contains: (element: HTMLElement) => elements.includes(element),
    querySelectorAll: () => elements
  } as unknown as HTMLElement;
  const row = (id: string, top: number, height = 100, parent = false) => {
    const position = { top, height, parent }; positions.push(position);
    const element = {
      dataset: { virtualNodeId: id },
      querySelector: () => position.parent ? {} : null,
      getBoundingClientRect: () => ({ top: 100 + position.top - root.scrollTop, bottom: 100 + position.top - root.scrollTop + position.height, height: position.height })
    } as unknown as HTMLElement;
    elements.push(element);
    return position;
  };
  return { root, row, elements };
}

it("preserves the user's upward delta while compensating for a late image resize exactly once", () => {
  const test = layout(), position = test.row("visible", 1040);
  const anchor = capturePreviewScrollAnchor(test.root)!;
  test.root.scrollTop -= 120;
  position.top += 240;
  expect(restorePreviewScrollAnchor(test.root, anchor)).toBe(240);
  expect(position.top - test.root.scrollTop).toBe(160);
  expect(restorePreviewScrollAnchor(test.root, anchor)).toBe(0);
  position.top -= 300;
  expect(restorePreviewScrollAnchor(test.root, anchor)).toBe(-300);
  expect(position.top - test.root.scrollTop).toBe(160);
});

it("chooses a leaf anchor and does not sum ancestor and descendant height deltas", () => {
  const test = layout();
  test.row("section", 500, 2500, true);
  const child = test.row("child", 1040);
  const anchor = capturePreviewScrollAnchor(test.root)!;
  expect(anchor.id).toBe("child");
  child.top += 180;
  expect(restorePreviewScrollAnchor(test.root, anchor)).toBe(180);
  expect(child.top - test.root.scrollTop).toBe(40);
});

it("does not undo an explicit long navigation jump or guess at removed anchors", () => {
  const test = layout(); test.row("visible", 1040);
  const anchor = capturePreviewScrollAnchor(test.root)!;
  test.root.scrollTop += 4000;
  expect(restorePreviewScrollAnchor(test.root, anchor)).toBe(0);
  expect(test.root.scrollTop).toBe(5000);
  test.elements.length = 0;
  expect(restorePreviewScrollAnchor(test.root, anchor)).toBe(0);
});

it("batches parent and child measurements into one geometry notification per animation frame", () => {
  let frame!: FrameRequestCallback;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  const controller = new VirtualPreviewController(), notify = vi.fn();
  controller.subscribe(notify);
  const element = { isConnected: true } as HTMLElement;
  controller.measure("parent", 180, element, 180);
  controller.measure("child", 80, element, 40);
  expect(controller.heights.size).toBe(0);
  expect(notify).not.toHaveBeenCalled();
  frame(1);
  expect([...controller.heights]).toEqual([["parent", 180], ["child", 80]]);
  expect(notify).toHaveBeenCalledOnce();
});
