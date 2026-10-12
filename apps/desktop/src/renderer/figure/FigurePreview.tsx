import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { ResolvedGraphic } from "@latex-editor/contracts";
import { optionValue } from "./parser.js";
import { patchFigureSource } from "./patch.js";
import { t } from "../i18n/index.js";
import { environmentPreview, previewSizingStyle } from "../preview/environment-preview.js";
import { figureLayout, swapFigureSlots, type FigureSlot } from "./layout.js";

GlobalWorkerOptions.workerSrc = workerUrl;
type EditorApi = NonNullable<Window["latexEditor"]>;
const pdfPreviewCache = new Map<string, string>();

function rememberPdfPreview(key: string, value: string): void {
  const budget = 8 * 1024 * 1024;
  if (value.length > budget) return;
  pdfPreviewCache.delete(key); pdfPreviewCache.set(key, value);
  let characters = [...pdfPreviewCache.values()].reduce((sum, image) => sum + image.length, 0);
  while (pdfPreviewCache.size > 32 || characters > budget) {
    const oldest = pdfPreviewCache.entries().next().value;
    if (!oldest) break;
    characters -= oldest[1].length; pdfPreviewCache.delete(oldest[0]);
  }
}

export function releaseFigurePreviewCache(projectId: string): void {
  for (const key of pdfPreviewCache.keys()) if (key.startsWith(`${projectId}:`)) pdfPreviewCache.delete(key);
}

function PdfImage({ dataUrl, alt, cacheKey, style }: { dataUrl: string; alt: string; cacheKey: string; style?: CSSProperties | undefined }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  const [rendered, setRendered] = useState<{ key: string; url: string }>();
  const cached = rendered?.key === cacheKey ? rendered.url : pdfPreviewCache.get(cacheKey);
  useEffect(() => {
    if (cached) { pdfPreviewCache.delete(cacheKey); pdfPreviewCache.set(cacheKey, cached); return; }
    setError(false);
    let cancelled = false;
    const comma = dataUrl.indexOf(",");
    const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (char) => char.charCodeAt(0));
    const task = getDocument({ data: bytes });
    let rendering: ReturnType<PDFPageProxy["render"]> | undefined;
    let canvas: HTMLCanvasElement | undefined;
    void task.promise.then(async (document) => {
      const page = await document.getPage(1);
      if (cancelled || !canvasRef.current) return;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 900 / natural.width, Math.sqrt(3_000_000 / (natural.width * natural.height))) });
      canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      rendering = page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport });
      await rendering.promise;
      if (!cancelled) {
        const url = canvas.toDataURL("image/png");
        rememberPdfPreview(cacheKey, url);
        setRendered({ key: cacheKey, url });
      }
    }).catch(() => { if (!cancelled) setError(true); }).finally(async () => {
      await task.destroy().catch(() => undefined);
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    });
    return () => { cancelled = true; rendering?.cancel(); void task.destroy().catch(() => undefined); };
  }, [dataUrl, cacheKey]);
  if (cached) return <img src={cached} alt={alt} style={style} draggable={false}/>;
  return error ? <div className="figure-preview-placeholder">{t("ui.FigurePreview.pdf_preview_unavailable")}</div> : <canvas ref={canvasRef} aria-label={alt} style={style}/>;
}

export function FigureAsset({ api, projectId, texPath, sourcePath, graphicPaths, width, onChoose, clickLabel }: { api: EditorApi; projectId: string; texPath: string; sourcePath: string; graphicPaths: string[]; width: string | undefined; onChoose?(): void; clickLabel?: string | undefined }) {
  const [asset, setAsset] = useState<ResolvedGraphic>();
  useEffect(() => {
    if (!sourcePath) { setAsset(undefined); return; }
    let current = true;
    setAsset(undefined);
    void api.images.resolve(projectId, texPath, sourcePath, graphicPaths).then((value) => { if (current) setAsset(value); }).catch(() => {
      if (current) setAsset({ requestedPath: sourcePath, exists: false, error: "FAILED_TO_DECODE" });
    });
    return () => { current = false; };
  }, [api, projectId, texPath, sourcePath, graphicPaths]);
  if (!sourcePath) return <button type="button" className="figure-preview-empty-slot" onClick={(event) => { event.stopPropagation(); onChoose?.(); }}><span>＋</span><strong>{clickLabel ?? t("ui.FigurePreview.choose_image")}</strong></button>;
  let content: ReactNode;
  if (!asset) content = <div className="figure-preview-placeholder loading">{t("ui.FigurePreview.loading")}{sourcePath}…</div>;
  else if (!asset.exists || !asset.dataUrl) content = <div className="figure-preview-placeholder"><strong>{sourcePath}</strong><span>{asset.error?.replaceAll("_", " ") ?? t("ui.FigurePreview.image_not_found")}</span></div>;
  else {
    const relativeWidth = width?.trim().match(/^(?:(\d*\.?\d+)\s*)?\\(?:textwidth|linewidth|columnwidth)$/);
    const style = relativeWidth ? { width: `${Math.min(100, Number(relativeWidth[1] ?? 1) * 100)}%` } : undefined;
    const cacheKey = `${projectId}:${asset.resolvedPath ?? sourcePath}:${asset.modifiedAt ?? ""}:${asset.size ?? 0}`;
    content = asset.format === "pdf" ? <PdfImage dataUrl={asset.dataUrl} alt={sourcePath} cacheKey={cacheKey} style={style}/> : <img src={asset.dataUrl} alt={sourcePath} style={style} loading="lazy" decoding="async" draggable={false}/>;
  }
  return <div className={`figure-preview-image-choice${onChoose ? " editable" : ""}`} role={onChoose ? "button" : undefined} tabIndex={onChoose ? 0 : undefined} aria-label={onChoose ? clickLabel ?? t("image.replaceImage", { path: sourcePath }) : undefined} title={onChoose ? clickLabel ?? t("image.replaceImage", { path: sourcePath }) : undefined} onClick={event => {
    if (!onChoose || !(event.target as Element).closest("img, canvas, .figure-preview-placeholder")) return;
    event.stopPropagation(); onChoose();
  }} onKeyDown={event => {
    if (!onChoose || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !["Enter", " "].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); onChoose();
  }}>{content}</div>;
}

export function FigurePreview({ source, graphicPaths, api, projectId, texPath, onChooseSlot, onReorder, onRemove, captionContent, imageClickLabel, configuration = environmentPreview("") }: { source: string; graphicPaths: string[]; api: EditorApi | undefined; projectId: string; texPath: string; onChooseSlot?: ((index: number) => void) | undefined; onReorder?: ((replacement: string, imageIndex: number) => void) | undefined; onRemove?: ((replacement: string, imageIndex: number) => void) | undefined; captionContent?: ReactNode; imageClickLabel?: string | undefined; configuration?: ReturnType<typeof environmentPreview> }) {
  const layout = useMemo(() => figureLayout(source), [source]);
  const figure = layout?.figure;
  const [dragged, setDragged] = useState<number>(), [dropTarget, setDropTarget] = useState<number>();
  const dragType = "application/x-texweave-figure-slot";
  const canReorder = Boolean(onReorder && layout?.supported && configuration.behavior.inlineEditable);
  const canRemove = Boolean(onRemove && layout?.supported && configuration.behavior.inlineEditable);
  if (!figure) return <div className="figure-preview-placeholder">{t("ui.FigurePreview.no_image_source")}</div>;
  if (!api) return <div className="figure-preview-placeholder">{t("ui.FigurePreview.image_preview_unavailable")}</div>;
  const slots: FigureSlot[] = layout?.supported ? layout.slots : figure.images.map((image, imageIndex) => ({ range: image.sourceRange, image, imageIndex }));
  const imageGrid = <div className={slots.length > 1 ? "figure-preview-grid" : "figure-preview-single"} data-figure-rows={layout?.rows} data-figure-columns={layout?.columns} style={layout?.supported ? { gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` } : undefined}>{slots.map((slot, index) => {
    const image = slot.image;
    if (!image) return null;
    const child = slot.child;
    const rawWidth = optionValue(image, "width");
    const relative = !child || child.syntax === "subfloat" ? rawWidth?.match(/^(\d*\.?\d+)\\(?:textwidth|columnwidth|linewidth)$/) : undefined;
    const width = relative && layout?.supported ? `${Number(relative[1]) * layout.columns}\\linewidth` : rawWidth;
    return <div key={image.id} className={`figure-preview-cell${dragged === index ? " dragging" : ""}${dropTarget === index ? " drop-target" : ""}`} data-figure-slot={index} draggable={canReorder && Boolean(image.sourcePath)} onDragStart={event => {
      if (!canReorder) return;
      event.stopPropagation(); event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(dragType, JSON.stringify({ projectId, texPath, source, index })); setDragged(index);
    }} onDragEnd={() => { setDragged(undefined); setDropTarget(undefined); }} onDragOver={event => {
      if (!canReorder || !event.dataTransfer.types.includes(dragType)) return;
      event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setDropTarget(index);
    }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(undefined); }} onDrop={event => {
      if (!canReorder || !event.dataTransfer.types.includes(dragType)) return;
      event.preventDefault(); event.stopPropagation(); setDropTarget(undefined); setDragged(undefined);
      try {
        const payload = JSON.parse(event.dataTransfer.getData(dragType)) as { projectId: string; texPath: string; source: string; index: number };
        if (payload.projectId !== projectId || payload.texPath !== texPath || payload.source !== source || !Number.isInteger(payload.index)) return;
        onReorder?.(swapFigureSlots(source, payload.index, index), slot.imageIndex);
      } catch { /* Ignore foreign or outdated drag payloads. */ }
    }}><FigureAsset api={api} projectId={projectId} texPath={texPath} sourcePath={image.sourcePath} graphicPaths={graphicPaths} width={width} clickLabel={imageClickLabel} {...(onChooseSlot ? { onChoose: () => onChooseSlot(slot.imageIndex) } : {})}/>{configuration.behavior.showCaption && child?.caption && <div className="figure-preview-subcaption">{child.caption}</div>}{canReorder && slots.length > 1 && <span className="figure-slot-number" title={t("image.layout.dragHint")}>{index + 1}</span>}{canRemove && image.sourcePath && <button type="button" className="figure-preview-remove" aria-label={t("image.layout.remove")} title={t("image.layout.remove")} onClick={event => { event.stopPropagation(); onRemove?.(patchFigureSource(source, { imageIndex: slot.imageIndex, sourcePath: "" }), slot.imageIndex); }}>×</button>}</div>;
  })}</div>;
  return <figure className={`preview-figure alignment-${figure.alignment}`} style={previewSizingStyle(configuration.sizing)}>{imageGrid}{configuration.behavior.showCaption && (captionContent ?? figure.caption) && <figcaption>{captionContent ?? figure.caption}</figcaption>}{configuration.behavior.showLabel && figure.label && <small>{figure.label}</small>}</figure>;
}
