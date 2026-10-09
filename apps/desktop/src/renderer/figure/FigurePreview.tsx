import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { ResolvedGraphic } from "@latex-editor/contracts";
import { parseFigure, optionValue } from "./parser.js";
import { t } from "../i18n/index.js";

GlobalWorkerOptions.workerSrc = workerUrl;
type EditorApi = NonNullable<Window["latexEditor"]>;
const pdfPreviewCache = new Map<string, string>();

function PdfImage({ dataUrl, alt, cacheKey }: { dataUrl: string; alt: string; cacheKey: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  const cached = pdfPreviewCache.get(cacheKey);
  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    const comma = dataUrl.indexOf(",");
    const bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), (char) => char.charCodeAt(0));
    const task = getDocument({ data: bytes });
    void task.promise.then(async (document) => {
      const page = await document.getPage(1);
      if (cancelled || !canvasRef.current) return;
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 900 / natural.width) });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
      if (!cancelled) pdfPreviewCache.set(cacheKey, canvas.toDataURL("image/png"));
    }).catch(() => setError(true));
    return () => { cancelled = true; task.destroy(); };
  }, [dataUrl, cacheKey, cached]);
  if (cached) return <img src={cached} alt={alt}/>;
  return error ? <div className="figure-preview-placeholder">PDF preview unavailable</div> : <canvas ref={canvasRef} aria-label={alt}/>;
}

function FigureAsset({ api, projectId, texPath, sourcePath, graphicPaths, width, onChoose }: { api: EditorApi; projectId: string; texPath: string; sourcePath: string; graphicPaths: string[]; width: string | undefined; onChoose?(): void }) {
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
  if (!sourcePath) return <button type="button" className="figure-preview-empty-slot" onClick={(event) => { event.stopPropagation(); onChoose?.(); }}><span>＋</span><strong>Choose image</strong></button>;
  let content: ReactNode;
  if (!asset) content = <div className="figure-preview-placeholder loading">Loading {sourcePath}…</div>;
  else if (!asset.exists || !asset.dataUrl) content = <div className="figure-preview-placeholder"><strong>{sourcePath}</strong><span>{asset.error?.replaceAll("_", " ") ?? "Image not found"}</span></div>;
  else {
    const style = width && width.endsWith("\\textwidth") ? { width: `${Math.min(100, Number.parseFloat(width) * 100)}%` } : undefined;
    const cacheKey = `${projectId}:${asset.resolvedPath ?? sourcePath}:${asset.modifiedAt ?? ""}:${asset.size ?? 0}`;
    content = asset.format === "pdf" ? <PdfImage dataUrl={asset.dataUrl} alt={sourcePath} cacheKey={cacheKey}/> : <img src={asset.dataUrl} alt={sourcePath} style={style} loading="lazy" decoding="async" draggable={false}/>;
  }
  return <div className={`figure-preview-image-choice${onChoose ? " editable" : ""}`} role={onChoose ? "button" : undefined} tabIndex={onChoose ? 0 : undefined} aria-label={onChoose ? t("image.replaceImage", { path: sourcePath }) : undefined} title={onChoose ? t("image.replaceImage", { path: sourcePath }) : undefined} onClick={event => {
    if (!onChoose || !(event.target as Element).closest("img, canvas, .figure-preview-placeholder")) return;
    event.stopPropagation(); onChoose();
  }} onKeyDown={event => {
    if (!onChoose || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !["Enter", " "].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); onChoose();
  }}>{content}</div>;
}

export function FigurePreview({ source, graphicPaths, api, projectId, texPath, onChooseSlot, captionContent }: { source: string; graphicPaths: string[]; api: EditorApi | undefined; projectId: string; texPath: string; onChooseSlot?: ((index: number) => void) | undefined; captionContent?: ReactNode }) {
  const figure = useMemo(() => parseFigure(source), [source]);
  if (!figure) return <div className="figure-preview-placeholder">No image source</div>;
  if (!api) return <div className="figure-preview-placeholder">Image preview unavailable</div>;
  const imageGrid = <div className={figure.images.length > 1 ? "figure-preview-grid" : "figure-preview-single"}>{figure.images.map((image, index) => <FigureAsset key={image.id} api={api} projectId={projectId} texPath={texPath} sourcePath={image.sourcePath} graphicPaths={graphicPaths} width={optionValue(image, "width")} {...(onChooseSlot ? { onChoose: () => onChooseSlot(index) } : {})}/>)}</div>;
  return <figure className={`preview-figure alignment-${figure.alignment}`}>{imageGrid}{(captionContent ?? figure.caption) && <figcaption>{captionContent ?? figure.caption}</figcaption>}{figure.label && <small>{figure.label}</small>}</figure>;
}
