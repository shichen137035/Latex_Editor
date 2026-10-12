import { expect, it, vi } from "vitest";
import { releasePdfRender } from "../../apps/desktop/src/renderer/pdf/renderResources.js";

it("detaches offscreen PDF canvases and releases bitmap memory after drawing stops", async () => {
  let settled!: () => void;
  const render = { cancel: vi.fn(), promise: new Promise<void>(done => { settled = done; }) };
  const text = { cancel: vi.fn() };
  const canvas = { width: 2000, height: 3000, remove: vi.fn() };
  const released = releasePdfRender(render, text, canvas);
  expect(render.cancel).toHaveBeenCalledOnce();
  expect(text.cancel).toHaveBeenCalledOnce();
  expect(canvas.remove).toHaveBeenCalledOnce();
  expect(canvas.width * canvas.height).toBe(6_000_000);
  settled();
  await released;
  expect(canvas.width * canvas.height).toBe(0);
});
