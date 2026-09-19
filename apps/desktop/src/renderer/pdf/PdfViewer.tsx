import { useEffect, useRef, useState, type CSSProperties } from "react";
import { getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { SyncTexPdfPosition } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import "./pdf-viewer.css";

GlobalWorkerOptions.workerSrc = workerUrl;
type Zoom = "width" | "page" | number;
interface Props {
  dataUrl: string;
  target?: SyncTexPdfPosition | undefined;
  onReverse(page: number, x: number, y: number): void;
  onInteract(): void;
}
// PDF points are 1/72 inch; CSS pixels are 1/96 inch.
const cssUnits = 96 / 72;
function pageScale(page: PDFPageProxy, zoom: Zoom, width: number, height: number) {
  const base = page.getViewport({ scale: 1 });
  if (typeof zoom === "number") return zoom * cssUnits;
  const fitWidth = Math.max(1, width - 32) / base.width;
  return zoom === "width" ? fitWidth : Math.min(fitWidth, Math.max(1, height - 32) / base.height);
}

export function PdfViewer({ dataUrl, target, onReverse, onInteract }: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [firstPage, setFirstPage] = useState<PDFPageProxy>();
  const [error, setError] = useState<string>();
  const [zoom, setZoom] = useState<Zoom>("width");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    setDocument(undefined);
    setFirstPage(undefined);
    setError(undefined);
    // Decode locally; do not ask the worker to fetch a large data URL.
    const data = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (char) => char.charCodeAt(0));
    const task = getDocument({ data });
    void task.promise.then(async (value) => {
      const first = await value.getPage(1);
      if (!cancelled) { setDocument(value); setFirstPage(first); }
    }).catch((reason: unknown) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; void task.destroy(); };
  }, [dataUrl]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 80);
    });
    observer.observe(element);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);
  const actualZoom = firstPage && size.width ? pageScale(firstPage, zoom, size.width, size.height) / cssUnits : 1;
  const adjust = (delta: number) => setZoom(Math.min(4, Math.max(.25, Math.round((actualZoom + delta) * 100) / 100)));
  return <div className="pdf-document">
    <div className="pdf-zoom-toolbar">
      <button aria-label={t("pdf.zoomOut")} onClick={() => adjust(-.1)}>−</button>
      <select aria-label={t("pdf.zoom")} value={typeof zoom === "number" ? String(zoom) : zoom} onChange={(event) => {
        const value = event.target.value;
        setZoom(value === "width" || value === "page" ? value : Number(value));
      }}>
        <option value="width">{t("pdf.fitWidth")}</option><option value="page">{t("pdf.fitPage")}</option>
        {[...new Set([.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4, ...(typeof zoom === "number" ? [zoom] : [])])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
      </select>
      <button aria-label={t("pdf.zoomIn")} onClick={() => adjust(.1)}>＋</button>
      <span>{Math.round(actualZoom * 100)}%</span>
    </div>
    <div className="pdf-viewer" ref={scrollRef} aria-label="PDF preview" onPointerDown={onInteract}>
      {error ? <div className="pdf-viewer-error">{error}</div> : !document ? <div className="pdf-viewer-loading">{t("pdf.loading")}</div> :
        Array.from({ length: document.numPages }, (_, index) => <PdfPage key={index + 1} document={document} pageNumber={index + 1} zoom={zoom} size={size} target={target?.page === index + 1 ? target : undefined} onReverse={onReverse}/>)}
    </div>
  </div>;
}

function PdfPage({ document, pageNumber, target, onReverse, zoom, size }: {
  document: PDFDocumentProxy; pageNumber: number; target?: SyncTexPdfPosition | undefined;
  onReverse(page: number, x: number, y: number): void; zoom: Zoom; size: { width: number; height: number };
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy>();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [clickMarker, setClickMarker] = useState<{ x: number; y: number; id: number }>();
  useEffect(() => {
    let cancelled = false;
    setPage(undefined);
    void document.getPage(pageNumber).then((value) => { if (!cancelled) setPage(value); }).catch((reason: unknown) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [document, pageNumber]);
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new IntersectionObserver((entries) => setVisible(entries.some((entry) => entry.isIntersecting)), { root: shell.closest(".pdf-viewer"), rootMargin: "900px 0px" });
    observer.observe(shell);
    return () => observer.disconnect();
  }, []);
  const scale = page && size.width ? pageScale(page, zoom, size.width, size.height) : 1;
  const viewport = page?.getViewport({ scale });
  useEffect(() => {
    if (!page || !visible || !size.width || !textHost.current) return;
    let cancelled = false;
    const nextViewport = page.getViewport({ scale });
    // Render into a fresh canvas: cancelled tasks never share a drawing surface.
    const canvas = globalThis.document.createElement("canvas");
    const density = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(nextViewport.width * density);
    canvas.height = Math.ceil(nextViewport.height * density);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    textHost.current.replaceChildren();
    const textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: textHost.current, viewport: nextViewport });
    let task: ReturnType<PDFPageProxy["render"]>;
    try {
      task = page.render({ canvas, viewport: nextViewport, transform: [density, 0, 0, density, 0, 0] });
    } catch (reason) {
      setError(String(reason));
      return;
    }
    void Promise.all([task.promise, textLayer.render()]).then(() => {
      if (!cancelled) { canvasHost.current?.replaceChildren(canvas); setError(""); }
    }).catch((reason: unknown) => {
      if (!cancelled && (reason as { name?: string }).name !== "RenderingCancelledException") setError(String(reason));
    });
    return () => { cancelled = true; task.cancel(); textLayer.cancel(); };
  }, [page, visible, scale, size.width]);
  useEffect(() => {
    if (target && page && size.width) shellRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [target, page, size.width]);
  return <div ref={shellRef} className="pdf-page" data-page={pageNumber} style={{ width: viewport?.width ?? 600, height: viewport?.height ?? 800, "--total-scale-factor": scale } as CSSProperties} onDoubleClick={(event) => {
    if (!viewport) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const id = Date.now();
    setClickMarker({ x, y, id });
    window.setTimeout(() => setClickMarker((value) => value?.id === id ? undefined : value), 900);
    onReverse(pageNumber, x / scale, y / scale);
  }}><div ref={canvasHost} className="pdf-canvas-host"/><div ref={textHost} className="textLayer"/>{error && <div className="pdf-viewer-error">{error}</div>}{target && <span className="pdf-sync-marker" style={{ left: target.x * scale, top: target.y * scale }}/>} {clickMarker && <span className="pdf-click-marker" style={{ left: clickMarker.x, top: clickMarker.y }}/>}<small>{pageNumber}</small></div>;
}
