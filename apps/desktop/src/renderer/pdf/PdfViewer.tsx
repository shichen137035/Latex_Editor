import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactNode } from "react";
import { AnnotationType, getDocument, GlobalWorkerOptions, TextLayer, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import type { SyncTexPdfPosition } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import "./pdf-viewer.css";
import { capturePdfReadingPosition, pdfPageBoxes, restorePdfReadingPosition, type PdfReadingPosition } from "./position.js";
import { releasePdfRender } from "./renderResources.js";

GlobalWorkerOptions.workerSrc = workerUrl;
type Zoom = "width" | "page" | number;
export interface PdfViewState { zoom: Zoom; position?: PdfReadingPosition | undefined; }
export interface PdfLinkDestination { value: string | unknown[]; requestId: number; }
interface PdfLink { id: string; rect: number[]; dest?: string | unknown[]; unsafeUrl?: string; url?: string; }
interface Props {
  dataUrl: string;
  target?: SyncTexPdfPosition | undefined;
  onReverse(page: number, x: number, y: number): void;
  onInteract(): void;
  viewState?: MutableRefObject<PdfViewState | undefined> | undefined;
  label?: string | undefined;
  toolbar?: ReactNode;
  destination?: PdfLinkDestination | undefined;
  onPdfLink?: ((href: string) => void) | undefined;
}
// PDF points are 1/72 inch; CSS pixels are 1/96 inch.
const cssUnits = 96 / 72;
function pageScale(page: PDFPageProxy, zoom: Zoom, width: number, height: number) {
  const base = page.getViewport({ scale: 1 });
  if (typeof zoom === "number") return zoom * cssUnits;
  const fitWidth = Math.max(1, width - 32) / base.width;
  return zoom === "width" ? fitWidth : Math.min(fitWidth, Math.max(1, height - 32) / base.height);
}

export function PdfViewer({ dataUrl, target, onReverse, onInteract, viewState, label, toolbar, destination, onPdfLink }: Props) {
  const [document, setDocument] = useState<PDFDocumentProxy>();
  const [firstPage, setFirstPage] = useState<PDFPageProxy>();
  const [error, setError] = useState<string>();
  const [zoom, setZoom] = useState<Zoom>(viewState?.current?.zoom ?? "width");
  const [loading, setLoading] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentDocument = useRef<PDFDocumentProxy | undefined>(undefined);
  const ownedDocuments = useRef(new Set<PDFDocumentProxy>());
  const pendingPosition = useRef<PdfReadingPosition | undefined>(viewState?.current?.position);
  const pendingTarget = useRef<SyncTexPdfPosition | undefined>(undefined);
  const consumedTarget = useRef<SyncTexPdfPosition | undefined>(undefined);
  const linkSequence = useRef(0);
  const readyPages = useRef(new Set<number>());
  const restoreFrame = useRef(0);
  const geometryChanged = useRef<() => void>(() => undefined);
  const capture = () => {
    const root = scrollRef.current;
    return root ? capturePdfReadingPosition(pdfPageBoxes(root), root.scrollTop, root.scrollLeft) : undefined;
  };
  const remember = () => {
    const position = capture();
    if (viewState && position && !pendingPosition.current && !pendingTarget.current) viewState.current = { zoom, position };
  };
  geometryChanged.current = () => {
    cancelAnimationFrame(restoreFrame.current);
    restoreFrame.current = requestAnimationFrame(() => {
      const root = scrollRef.current;
      const doc = currentDocument.current;
      if (!root || !doc || !size.width) return;
      const targetPage = Math.min(doc.numPages, pendingTarget.current?.page ?? pendingPosition.current?.page ?? 0);
      if (!targetPage) return;
      for (let page = 1; page <= targetPage; page += 1) if (!readyPages.current.has(page)) return;
      const boxes = pdfPageBoxes(root);
      if (pendingTarget.current) {
        const destination = pendingTarget.current;
        const box = boxes.find(page => page.page === targetPage);
        const shell = root.querySelector<HTMLElement>(`[data-page="${targetPage}"]`);
        if (!box || !shell) return;
        const scale = Number(shell.dataset.scale) || 1;
        root.scrollTop = Math.max(0, box.top + destination.y * scale - root.clientHeight / 2);
        root.scrollLeft = Math.max(0, shell.getBoundingClientRect().left - root.getBoundingClientRect().left + root.scrollLeft + destination.x * scale - root.clientWidth / 2);
        pendingTarget.current = undefined;
        pendingPosition.current = undefined;
      } else if (pendingPosition.current) {
        const restored = restorePdfReadingPosition(pendingPosition.current, boxes);
        if (restored) { root.scrollTop = restored.top; root.scrollLeft = restored.left; }
        pendingPosition.current = undefined;
      }
      remember();
    });
  };
  const preserve = () => { pendingPosition.current = capture() ?? viewState?.current?.position; };
  const interact = () => {
    linkSequence.current++;
    pendingPosition.current = undefined;
    pendingTarget.current = undefined;
    onInteract();
    remember();
  };
  const navigateDestination = async (doc: PDFDocumentProxy, value: string | unknown[]) => {
    const sequence = ++linkSequence.current;
    let explicit: unknown[] | null;
    if (typeof value === "string") {
      const params = new URLSearchParams(value);
      if (params.has("page")) {
        const page = Number(params.get("page"));
        if (Number.isInteger(page) && page > 0 && page <= doc.numPages) {
          pendingPosition.current = { page, fraction: 0, left: 0 }; geometryChanged.current();
        }
        return;
      }
      const name = params.get("nameddest") ?? value;
      if (name.startsWith("[")) {
        try { const parsed: unknown = JSON.parse(name); explicit = Array.isArray(parsed) ? parsed : null; } catch { return; }
      } else explicit = await doc.getDestination(name);
    } else explicit = value;
    if (!explicit?.length || doc !== currentDocument.current) return;
    const index = typeof explicit[0] === "number" ? explicit[0] : await doc.getPageIndex(explicit[0] as { num: number; gen: number });
    if (!Number.isInteger(index) || index < 0 || index >= doc.numPages) return;
    const page = await doc.getPage(index + 1);
    if (doc !== currentDocument.current || sequence !== linkSequence.current) return;
    const mode = (explicit[1] as { name?: string } | undefined)?.name;
    const x = mode === "XYZ" && typeof explicit[2] === "number" ? explicit[2] : 0;
    const y = mode === "XYZ" ? explicit[3] : mode === "FitH" || mode === "FitBH" ? explicit[2] : undefined;
    const point = page.getViewport({ scale: 1 }).convertToViewportPoint(x, typeof y === "number" ? y : page.view[3]!);
    pendingTarget.current = { page: index + 1, x: point[0]!, y: point[1]! }; pendingPosition.current = undefined;
    geometryChanged.current();
  };
  useEffect(() => {
    if (document && destination) void navigateDestination(document, destination.value).catch(() => undefined);
  }, [document, destination]);
  useEffect(() => {
    let cancelled = false;
    let adopted = false;
    let task: ReturnType<typeof getDocument> | undefined;
    setLoading(true);
    setError(undefined);
    try {
      const data = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(",") + 1)), (char) => char.charCodeAt(0));
      task = getDocument({ data });
    } catch (reason) { setError(String(reason)); setLoading(false); return; }
    void task.promise.then(async (value) => {
      const first = await value.getPage(1);
      if (!cancelled) {
        // Capture at adoption time: the reader can continue scrolling while the new PDF loads.
        if (currentDocument.current) preserve();
        readyPages.current.clear();
        currentDocument.current = value;
        ownedDocuments.current.add(value);
        adopted = true;
        setDocument(value); setFirstPage(first); setLoading(false);
      }
    }).catch((reason: unknown) => { if (!cancelled) { setError(String(reason)); setLoading(false); } });
    return () => { cancelled = true; if (!adopted) void task?.destroy().catch(() => undefined); };
  }, [dataUrl]);
  useEffect(() => () => { if (document) { ownedDocuments.current.delete(document); void document.destroy().catch(() => undefined); } }, [document]);
  useEffect(() => () => {
    cancelAnimationFrame(restoreFrame.current);
    for (const pending of ownedDocuments.current) void pending.destroy().catch(() => undefined);
    ownedDocuments.current.clear();
  }, []);
  useLayoutEffect(() => {
    if (!target) { pendingTarget.current = undefined; return; }
    if (target && target !== consumedTarget.current) {
      consumedTarget.current = target;
      pendingTarget.current = target;
      pendingPosition.current = undefined;
      geometryChanged.current();
    }
  }, [target]);
  useLayoutEffect(() => { geometryChanged.current(); }, [document, zoom, size]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let timer: ReturnType<typeof setTimeout>;
    let measuredWidth = -1;
    let measuredHeight = -1;
    const measure = () => {
      if (measuredWidth === element.clientWidth && measuredHeight === element.clientHeight) return;
      if (currentDocument.current) preserve();
      measuredWidth = element.clientWidth; measuredHeight = element.clientHeight;
      setSize({ width: measuredWidth, height: measuredHeight });
    };
    measure();
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(measure, 80);
    });
    observer.observe(element);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, []);
  const actualZoom = firstPage && size.width ? pageScale(firstPage, zoom, size.width, size.height) / cssUnits : 1;
  const changeZoom = (value: Zoom) => { if (value === zoom) return; preserve(); setZoom(value); };
  const adjust = (delta: number) => changeZoom(Math.min(4, Math.max(.25, Math.round((actualZoom + delta) * 100) / 100)));
  return <div className="pdf-document">
    <div className="pdf-zoom-toolbar">
      <button aria-label={t("pdf.zoomOut")} onClick={() => adjust(-.1)}>−</button>
      <select aria-label={t("pdf.zoom")} value={typeof zoom === "number" ? String(zoom) : zoom} onChange={(event) => {
        const value = event.target.value;
        changeZoom(value === "width" || value === "page" ? value : Number(value));
      }}>
        <option value="width">{t("pdf.fitWidth")}</option><option value="page">{t("pdf.fitPage")}</option>
        {[...new Set([.25, .5, .75, 1, 1.25, 1.5, 2, 3, 4, ...(typeof zoom === "number" ? [zoom] : [])])].sort((a, b) => a - b).map((value) => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
      </select>
      <button aria-label={t("pdf.zoomIn")} onClick={() => adjust(.1)}>＋</button>
      <span>{Math.round(actualZoom * 100)}%</span>
      {label && <small className="pdf-origin-label">{label}</small>}{loading && document && <small>{t("pdf.loading")}</small>}
      {toolbar}
    </div>
    {error && document && <div className="pdf-update-error" role="status">{error}</div>}
    <div className="pdf-viewer" ref={scrollRef} aria-label={t("ui.PdfViewer.pdf_preview")} onPointerDown={interact} onWheel={interact} onKeyDown={interact} onScroll={remember}>
      {!document ? <div className={error ? "pdf-viewer-error" : "pdf-viewer-loading"}>{error ?? t("pdf.loading")}</div> :
        Array.from({ length: document.numPages }, (_, index) => <PdfPage key={index + 1} document={document} fallbackPage={firstPage} pageNumber={index + 1} zoom={zoom} size={size} target={target?.page === index + 1 ? target : undefined} onLink={link => { interact(); if (link.dest) void navigateDestination(document!, link.dest).catch(() => undefined); else onPdfLink?.(link.unsafeUrl ?? link.url ?? ""); }} onReverse={onReverse} onReady={page => { readyPages.current.add(page); geometryChanged.current(); }}/>)}
    </div>
  </div>;
}

function PdfPage({ document, fallbackPage, pageNumber, target, onReverse, onReady, onLink, zoom, size }: {
  document: PDFDocumentProxy; pageNumber: number; target?: SyncTexPdfPosition | undefined;
  fallbackPage: PDFPageProxy | undefined; onReady(page: number): void;
  onLink(link: PdfLink): void;
  onReverse(page: number, x: number, y: number): void; zoom: Zoom; size: { width: number; height: number };
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const textHost = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PDFPageProxy>();
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const [links, setLinks] = useState<PdfLink[]>([]);
  const [clickMarker, setClickMarker] = useState<{ x: number; y: number; id: number }>();
  const markerTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(markerTimer.current), []);
  useEffect(() => {
    let cancelled = false;
    setPage(undefined);
    setError(""); setClickMarker(undefined);
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
  const dimensions = page ?? fallbackPage;
  const scale = dimensions && size.width ? pageScale(dimensions, zoom, size.width, size.height) : 1;
  const viewport = dimensions?.getViewport({ scale });
  useEffect(() => {
    let cancelled = false;
    setLinks([]);
    if (page && visible) void page.getAnnotations().then(annotations => {
      if (!cancelled) setLinks(annotations.filter(item => item.annotationType === AnnotationType.LINK
        && (item.dest || /\.pdf(?:#|$)/i.test(item.unsafeUrl ?? item.url ?? "") || (item.unsafeUrl ?? item.url ?? "").startsWith("#"))) as PdfLink[]);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [page, visible]);
  useLayoutEffect(() => { if (page && size.width) onReady(pageNumber); }, [page, scale, size.width, size.height]);
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
    const layer = globalThis.document.createElement("div");
    layer.className = "textLayer";
    layer.style.setProperty("--total-scale-factor", String(scale));
    const textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport: nextViewport });
    let task: ReturnType<PDFPageProxy["render"]>;
    try {
      task = page.render({ canvas, viewport: nextViewport, transform: [density, 0, 0, density, 0, 0] });
    } catch (reason) {
      setError(String(reason));
      return;
    }
    void Promise.all([task.promise, textLayer.render()]).then(() => {
      if (!cancelled) { canvasHost.current?.replaceChildren(canvas); textHost.current?.replaceChildren(...Array.from(layer.childNodes)); setError(""); }
    }).catch((reason: unknown) => {
      if (!cancelled && (reason as { name?: string }).name !== "RenderingCancelledException") setError(String(reason));
    });
    const host = textHost.current;
    return () => {
      cancelled = true;
      host?.replaceChildren();
      void releasePdfRender(task, textLayer, canvas).catch(() => undefined);
    };
  }, [page, visible, scale, size.width]);
  return <div ref={shellRef} className="pdf-page" data-page={pageNumber} data-scale={scale} style={{ width: viewport?.width ?? 600, height: viewport?.height ?? 800, "--total-scale-factor": scale } as CSSProperties} onDoubleClick={(event) => {
    if ((event.target as Element).closest(".pdf-link")) return;
    if (!viewport) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const id = Date.now();
    setClickMarker({ x, y, id });
    clearTimeout(markerTimer.current);
    markerTimer.current = setTimeout(() => setClickMarker((value) => value?.id === id ? undefined : value), 900);
    onReverse(pageNumber, x / scale, y / scale);
  }}><div ref={canvasHost} className="pdf-canvas-host"/><div ref={textHost} className="textLayer"/>{viewport && links.map(link => {
    const rect = viewport.convertToViewportRectangle(link.rect), left = Math.min(rect[0]!, rect[2]!), top = Math.min(rect[1]!, rect[3]!);
    return <button type="button" className="pdf-link" key={link.id} data-pdf-link={link.unsafeUrl ?? link.url ?? "internal"} aria-label={t("pdf.followReference")} title={link.unsafeUrl ?? link.url ?? t("pdf.followReference")} style={{ left, top, width: Math.abs(rect[2]! - rect[0]!), height: Math.abs(rect[3]! - rect[1]!) }} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onLink(link); }}/>;
  })}{error && <div className="pdf-viewer-error">{error}</div>}{target && <span className="pdf-sync-marker" style={{ left: target.x * scale, top: target.y * scale }}/>} {clickMarker && <span className="pdf-click-marker" style={{ left: clickMarker.x, top: clickMarker.y }}/>}<small>{pageNumber}</small></div>;
}
