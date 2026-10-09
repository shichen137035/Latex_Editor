import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { ResolvedGraphic } from "@latex-editor/contracts";
import { parseFigure, optionValue } from "./parser.js";
import { t } from "../i18n/index.js";
import { environmentPreview, previewSizingStyle } from "../preview/environment-preview.js";

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
  const cached = pdfPreviewCache.get(cacheKey);
  useEffect(() => {
    if (cached) { pdfPreviewCache.delete(cacheKey); pdfPreviewCache.set(cacheKey, cached); return; }
    setError(false);
    let cancelled = false;
    const comma = dataUrl.indexOf(",");
    const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (char) => char.charCodeAt(0));
    const task = getDocument({ data: bytes });
    void task.promise.then(async (document) => {
      const page = await document.getPage(1);
      if (cancelled || !canvasRef.current) return;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 900 / natural.width, Math.sqrt(3_000_000 / (natural.width * natural.height))) });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      if (!cancelled) rememberPdfPreview(cacheKey, canvas.toDataURL("image/png"));
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; void task.destroy().catch(() => undefined); };
  }, [dataUrl, cacheKey, cached]);
  if (cached) return <img src={cached} alt={alt} style={style} draggable={false}/>;
  return error ? <div className="figure-preview-placeholder">{t("ui.FigurePreview.pdf_preview_unavailable")}</div> : <canvas ref={canvasRef} aria-label={alt} style={style}/>;
}

function FigureAsset({ api, projectId, texPath, sourcePath, graphicPaths, width, onChoose, clickLabel }: { api: EditorApi; projectId: string; texPath: string; sourcePath: string; graphicPaths: string[]; width: string | undefined; onChoose?(): void; clickLabel?: string | undefined }) {
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

export function FigurePreview({ source, graphicPaths, api, projectId, texPath, onChooseSlot, captionContent, imageClickLabel, configuration = environmentPreview("") }: { source: string; graphicPaths: string[]; api: EditorApi | undefined; projectId: string; texPath: string; onChooseSlot?: ((index: number) => void) | undefined; captionContent?: ReactNode; imageClickLabel?: string | undefined; configuration?: ReturnType<typeof environmentPreview> }) {
  const figure = useMemo(() => parseFigure(source), [source]);
  if (!figure) return <div className="figure-preview-placeholder">{t("ui.FigurePreview.no_image_source")}</div>;
  if (!api) return <div className="figure-preview-placeholder">{t("ui.FigurePreview.image_preview_unavailable")}</div>;
  const imageGrid = <div className={figure.images.length > 1 ? "figure-preview-grid" : "figure-preview-single"}>{figure.images.map((image, index) => <FigureAsset key={image.id} api={api} projectId={projectId} texPath={texPath} sourcePath={image.sourcePath} graphicPaths={graphicPaths} width={optionValue(image, "width")} clickLabel={imageClickLabel} {...(onChooseSlot ? { onChoose: () => onChooseSlot(index) } : {})}/>)}</div>;
  return <figure className={`preview-figure alignment-${figure.alignment}`} style={previewSizingStyle(configuration.sizing)}>{imageGrid}{configuration.behavior.showCaption && (captionContent ?? figure.caption) && <figcaption>{captionContent ?? figure.caption}</figcaption>}{configuration.behavior.showLabel && figure.label && <small>{figure.label}</small>}</figure>;
}
