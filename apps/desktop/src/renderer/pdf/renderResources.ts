/** Release the native bitmap only once PDF.js has stopped drawing into it. */
export async function releasePdfRender(render: { cancel(): void; promise: Promise<unknown> }, textLayer: { cancel(): void }, canvas: Pick<HTMLCanvasElement, "width" | "height" | "remove">): Promise<void> {
  render.cancel();
  textLayer.cancel();
  canvas.remove();
  await render.promise.catch(() => undefined);
  canvas.width = 0;
  canvas.height = 0;
}
