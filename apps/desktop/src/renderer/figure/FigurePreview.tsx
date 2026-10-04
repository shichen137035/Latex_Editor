import { useEffect, useMemo, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { ResolvedGraphic } from "@latex-editor/contracts";
import { parseFigure, optionValue } from "./parser.js";

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
  if (!asset) return <div className="figure-preview-placeholder loading">Loading {sourcePath}…</div>;
  if (!asset.exists || !asset.dataUrl) return <div className="figure-preview-placeholder"><strong>{sourcePath}</strong><span>{asset.error?.replaceAll("_", " ") ?? "Image not found"}</span></div>;
  const style = width && width.endsWith("\\textwidth") ? { width: `${Math.min(100, Number.parseFloat(width) * 100)}%` } : undefined;
  const cacheKey = `${projectId}:${asset.resolvedPath ?? sourcePath}:${asset.modifiedAt ?? ""}:${asset.size ?? 0}`;
  return asset.format === "pdf" ? <PdfImage dataUrl={asset.dataUrl} alt={sourcePath} cacheKey={cacheKey}/> : <img src={asset.dataUrl} alt={sourcePath} style={style} loading="lazy" decoding="async"/>;
}

export function FigurePreview({ source, graphicPaths, api, projectId, texPath, onChooseSlot }: { source: string; graphicPaths: string[]; api: EditorApi | undefined; projectId: string; texPath: string; onChooseSlot?(index: number): void }) {
  const figure = useMemo(() => parseFigure(source), [source]);
  if (!figure) return <div className="figure-preview-placeholder">No image source</div>;
  if (!api) return <div className="figure-preview-placeholder">Image preview unavailable</div>;
  const imageGrid = <div className={figure.images.length > 1 ? "figure-preview-grid" : "figure-preview-single"}>{figure.images.map((image, index) => <FigureAsset key={image.id} api={api} projectId={projectId} texPath={texPath} sourcePath={image.sourcePath} graphicPaths={graphicPaths} width={optionValue(image, "width")} onChoose={() => onChooseSlot?.(index)}/>)}</div>;
  return <figure className={`preview-figure alignment-${figure.alignment}`}>{imageGrid}{figure.caption && <figcaption>{figure.caption}</figcaption>}{figure.label && <small>{figure.label}</small>}</figure>;
}
