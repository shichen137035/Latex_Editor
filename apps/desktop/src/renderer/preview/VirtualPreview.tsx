import { Fragment, Profiler, useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";

export interface VirtualPreviewItem {
  id: string;
  estimatedHeight: number;
}

export function virtualWindow(heights: number[], top: number, viewportHeight: number, overscan = 700, cachedOffsets?: number[]): { indices: number[]; offsets: number[] } {
  const offsets = cachedOffsets ?? [0];
  if (!cachedOffsets) for (const height of heights) offsets.push(offsets[offsets.length - 1]! + Math.max(1, height));
  const low = Math.max(0, top - overscan);
  const high = top + viewportHeight + overscan;
  let left = 0, right = heights.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (offsets[middle + 1]! < low) left = middle + 1;
    else right = middle;
  }
  const indices: number[] = [];
  for (let index = left; index < heights.length && offsets[index]! <= high; index += 1) indices.push(index);
  return { indices, offsets };
}

export class VirtualPreviewController {
  readonly heights = new Map<string, number>();
  readonly mounted = new Set<string>();
  root: HTMLElement | null = null;
  #revision = 0;
  #heightRevision = 0;
  #listeners = new Set<() => void>();
  #frame = 0;
  #rootObserver: ResizeObserver | undefined;
  #heightLookups = 0;
  #heightHits = 0;
  #warnedRows = new Set<string>();
  #warnedMounted = false;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };
  snapshot = (): number => this.#revision;
  get heightRevision(): number { return this.#heightRevision; }
  #emit = () => {
    if (import.meta.env.DEV && this.mounted.size > 120 && !this.#warnedMounted) {
      this.#warnedMounted = true;
      console.warn(`Preview Performance Warning: ${this.mounted.size} blocks are mounted`);
    }
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  };
  #onScroll = () => {
    if (this.#frame) return;
    this.#frame = requestAnimationFrame(() => { this.#frame = 0; this.#emit(); });
  };
  connect(root: HTMLElement): void {
    if (this.root === root) return;
    this.disconnect();
    this.root = root;
    root.addEventListener("scroll", this.#onScroll, { passive: true });
    this.#rootObserver = new ResizeObserver(this.#onScroll);
    this.#rootObserver.observe(root);
    this.#emit();
  }
  disconnect(): void {
    this.root?.removeEventListener("scroll", this.#onScroll);
    this.#rootObserver?.disconnect();
    if (this.#frame) cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.root = null;
  }
  reset(): void { this.heights.clear(); this.mounted.clear(); this.#heightLookups = 0; this.#heightHits = 0; this.#warnedRows.clear(); this.#warnedMounted = false; this.#heightRevision += 1; this.#emit(); }
  heightFor(id: string, estimate: number): number {
    this.#heightLookups += 1;
    const cached = this.heights.get(id);
    if (cached !== undefined) { this.#heightHits += 1; return cached; }
    return estimate;
  }
  heightHitRate(): number { return this.#heightLookups ? this.#heightHits / this.#heightLookups : 0; }
  reportRowRender(id: string, duration: number): void {
    if (duration > 32 && !this.#warnedRows.has(id)) {
      this.#warnedRows.add(id);
      console.warn(`Preview Performance Warning: block ${id} rendered in ${duration.toFixed(1)} ms`);
    }
  }
  measure(id: string, height: number, element: HTMLElement, estimate: number): void {
    if (!Number.isFinite(height) || height < 1) return;
    const old = this.heights.get(id) ?? estimate;
    if (Math.abs(old - height) < 1) return;
    this.heights.set(id, height);
    this.#heightRevision += 1;
    const root = this.root;
    if (root && element.getBoundingClientRect().bottom < root.getBoundingClientRect().top) root.scrollTop += height - old;
    this.#emit();
  }
  mountedCount(): number { return this.mounted.size; }
}

function MeasuredRow({ item, controller, children, as = "div", ordinal }: { item: VirtualPreviewItem; controller: VirtualPreviewController; children: ReactNode; as?: "div" | "li"; ordinal?: number }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    controller.mounted.add(item.id);
    const measure = () => controller.measure(item.id, element.getBoundingClientRect().height, element, item.estimatedHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); controller.mounted.delete(item.id); };
  }, [controller, item.id]);
  return as === "li"
    ? <li className="preview-virtual-row" ref={ref as RefObject<HTMLLIElement>} data-virtual-node-id={item.id} value={ordinal}>{children}</li>
    : <div className="preview-virtual-row" ref={ref as RefObject<HTMLDivElement>} data-virtual-node-id={item.id}>{children}</div>;
}

export function VirtualPreviewList<T extends VirtualPreviewItem>({ items, controller, rootRef, forcedIds, renderItem, as = "div" }: {
  items: T[];
  controller: VirtualPreviewController;
  rootRef: RefObject<HTMLElement | null>;
  forcedIds: ReadonlySet<string>;
  renderItem(item: T): ReactNode;
  as?: "div" | "ol" | "ul";
}) {
  useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const listRef = useRef<HTMLElement | null>(null);
  const setListRef = useCallback((element: HTMLElement | null) => { listRef.current = element; }, []);
  const [listTop, setListTop] = useState(0);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const list = listRef.current;
    if (!root || !list) return;
    controller.connect(root);
    const top = list.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
    if (Math.abs(top - listTop) > 1) setListTop(top);
  });
  const root = rootRef.current;
  const geometry = useMemo(() => {
    const heights = items.map((item) => controller.heightFor(item.id, item.estimatedHeight));
    const offsets = [0];
    for (const height of heights) offsets.push(offsets[offsets.length - 1]! + Math.max(1, height));
    return { heights, offsets };
  }, [items, controller, controller.heightRevision]);
  const { indices: visible, offsets } = virtualWindow(geometry.heights, (root?.scrollTop ?? 0) - listTop, root?.clientHeight ?? 800, 700, geometry.offsets);
  const included = new Set(visible);
  items.forEach((item, index) => { if (forcedIds.has(item.id)) included.add(index); });
  const indices = [...included].sort((a, b) => a - b);
  const children: ReactNode[] = [];
  let cursor = 0;
  for (const index of indices) {
    if (index > cursor) children.push(as === "div"
      ? <div key={`space:${cursor}`} className="preview-virtual-spacer" style={{ height: offsets[index]! - offsets[cursor]! }}/>
      : <li key={`space:${cursor}`} className="preview-virtual-spacer" aria-hidden="true" style={{ height: offsets[index]! - offsets[cursor]!, listStyle: "none" }}/>);
    const item = items[index]!;
    const content = renderItem(item);
    children.push(<MeasuredRow key={item.id} item={item} controller={controller} as={as === "div" ? "div" : "li"} {...(as === "ol" ? { ordinal: index + 1 } : {})}>{import.meta.env.DEV
      ? <Profiler id={item.id} onRender={(_id, _phase, duration) => controller.reportRowRender(item.id, duration)}>{content}</Profiler>
      : content}</MeasuredRow>);
    cursor = index + 1;
  }
  if (cursor < items.length) children.push(as === "div"
    ? <div key={`space:${cursor}`} className="preview-virtual-spacer" style={{ height: offsets[items.length]! - offsets[cursor]! }}/>
    : <li key={`space:${cursor}`} className="preview-virtual-spacer" aria-hidden="true" style={{ height: offsets[items.length]! - offsets[cursor]!, listStyle: "none" }}/>);
  const content = <Fragment>{children}</Fragment>;
  if (as === "ol") return <ol ref={setListRef} className="preview-virtual-list preview-list" data-virtual-total={items.length}>{content}</ol>;
  if (as === "ul") return <ul ref={setListRef} className="preview-virtual-list preview-list" data-virtual-total={items.length}>{content}</ul>;
  return <div ref={setListRef} className="preview-virtual-list" data-virtual-total={items.length}>{content}</div>;
}
