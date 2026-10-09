import type { WheelAccelerationPreferences } from "@latex-editor/contracts";

type ScrollAxis = "x" | "y";
interface AccelerationState {
  target: object;
  axis: ScrollAxis;
  direction: -1 | 1;
  time: number;
  extraMultiplier: number;
  magnitude: number;
  samples: Array<{ time: number; distance: number }>;
}

const BURST_WINDOW_MS = 650;
const RESET_GAP_MS = 120;
const RAPID_GAP_MS = 85;
const MINIMUM_DURATION_MS = 250;
const MINIMUM_EVENTS = 7;
const MINIMUM_DELTA = 20;

/** Acceleration requires sustained travel, not just a high event frequency. */
export class WheelAccelerationTracker {
  private previous: AccelerationState | undefined;

  reset(): void { this.previous = undefined; }

  multiplier(target: object, axis: ScrollAxis, delta: number, now: number, viewport: number, extent: number, preferences: WheelAccelerationPreferences): number {
    if (!preferences.enabled || !Number.isFinite(delta) || !Number.isFinite(now) || Math.abs(delta) < 0.01 || extent < viewport * 2) {
      this.reset(); return 1;
    }
    const direction = delta > 0 ? 1 : -1;
    const magnitude = Math.abs(delta);
    const prior = this.previous;
    const elapsed = prior ? now - prior.time : Infinity;
    const continuous = prior && prior.target === target && prior.axis === axis && prior.direction === direction && elapsed >= 0 && elapsed < RESET_GAP_MS;
    const samples = continuous && elapsed < RAPID_GAP_MS ? prior.samples.filter((sample) => now - sample.time <= BURST_WINDOW_MS) : [];
    if (magnitude >= MINIMUM_DELTA) samples.push({ time: now, distance: magnitude });
    // Coalesced high-frequency input must not create an unbounded history.
    if (samples.length > 128) samples.splice(0, samples.length - 128);
    const slowed = magnitude < MINIMUM_DELTA || continuous && magnitude < prior.magnitude * 0.5 || elapsed >= RAPID_GAP_MS;
    const retained = continuous ? prior.extraMultiplier * Math.exp(-elapsed * (slowed ? 4 : 1) / preferences.decayMs) : 0;
    const distance = samples.reduce((sum, sample) => sum + sample.distance, 0);
    const sustained = samples.length >= MINIMUM_EVENTS && now - samples[0]!.time >= MINIMUM_DURATION_MS
      && distance >= Math.max(1000, viewport * 1.75);
    const cadence = Math.max(0, 1 - elapsed / RAPID_GAP_MS);
    const gain = sustained && !slowed ? preferences.strength * 0.06 * cadence * Math.min(3, magnitude / 120) : 0;
    // A noticeable cadence drop ends the boost even with a long decay setting.
    const extraMultiplier = elapsed >= RAPID_GAP_MS ? 0 : Math.min(preferences.maxMultiplier - 1, retained + gain);
    this.previous = { target, axis, direction, time: now, extraMultiplier, magnitude: continuous ? Math.max(magnitude, prior.magnitude * 0.9) : magnitude, samples };
    return extraMultiplier < 0.05 ? 1 : 1 + extraMultiplier;
  }
}

function eventElement(event: WheelEvent): HTMLElement | undefined {
  for (const item of event.composedPath()) {
    if (item instanceof HTMLElement) return item;
  }
  return event.target instanceof HTMLElement ? event.target : undefined;
}

function getWheelDelta(event: WheelEvent, target: HTMLElement, axis: ScrollAxis): number {
  let delta = axis === "x" ? event.deltaX : event.deltaY;
  if (axis === "x" && event.shiftKey && delta === 0) delta = event.deltaY;
  if (!Number.isFinite(delta) || delta === 0) return delta;
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    const style = getComputedStyle(target);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const fontSize = Number.parseFloat(style.fontSize);
    delta *= Number.isFinite(lineHeight) ? lineHeight : Number.isFinite(fontSize) ? fontSize * 1.2 : 19.2;
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    delta *= axis === "x" ? target.clientWidth || window.innerWidth : target.clientHeight || window.innerHeight;
  }
  return delta;
}

function hasRoomToScroll(element: HTMLElement, axis: ScrollAxis, direction: -1 | 1): boolean {
  const position = axis === "x" ? element.scrollLeft : element.scrollTop;
  const extent = axis === "x" ? element.scrollWidth : element.scrollHeight;
  const viewport = axis === "x" ? element.clientWidth : element.clientHeight;
  const maximum = extent - viewport;
  return maximum > 1 && (direction > 0 ? position < maximum - 1 : position > 1);
}

function findScrollChain(start: HTMLElement, axis: ScrollAxis, direction: -1 | 1): HTMLElement[] {
  const property = axis === "x" ? "overflowX" : "overflowY";
  const overscrollProperty = axis === "x" ? "overscrollBehaviorX" : "overscrollBehaviorY";
  const root = document.scrollingElement as HTMLElement | null;
  const chain: HTMLElement[] = [];
  let chainingAllowed = true;
  for (let element: HTMLElement | null = start; element; element = element.parentElement) {
    const style = getComputedStyle(element);
    const overflow = style[property];
    if ((overflow === "auto" || overflow === "scroll" || overflow === "overlay") && hasRoomToScroll(element, axis, direction)) chain.push(element);
    if (style[overscrollProperty] === "contain" || style[overscrollProperty] === "none") { chainingAllowed = false; break; }
    if (element === root) break;
  }
  if (chainingAllowed && root && !chain.includes(root) && hasRoomToScroll(root, axis, direction)) chain.push(root);
  return chain;
}

function applyScrollDelta(chain: HTMLElement[], axis: ScrollAxis, delta: number): void {
  let remaining = delta;
  for (const element of chain) {
    const current = axis === "x" ? element.scrollLeft : element.scrollTop;
    const maximum = Math.max(0, (axis === "x" ? element.scrollWidth - element.clientWidth : element.scrollHeight - element.clientHeight));
    const available = remaining > 0 ? maximum - current : current;
    const applied = Math.sign(remaining) * Math.min(Math.abs(remaining), Math.max(0, available));
    if (axis === "x") element.scrollLeft = current + applied;
    else element.scrollTop = current + applied;
    remaining -= applied;
    if (Math.abs(remaining) < 0.01) break;
  }
}

function wheelAxis(event: WheelEvent): ScrollAxis {
  if (event.shiftKey && event.deltaX === 0 && event.deltaY !== 0) return "x";
  return Math.abs(event.deltaX) > Math.abs(event.deltaY) ? "x" : "y";
}

export function installWheelAcceleration(readPreferences: () => WheelAccelerationPreferences): () => void {
  const tracker = new WheelAccelerationTracker();
  let cached: { target: HTMLElement; axis: ScrollAxis; direction: -1 | 1; time: number; chain: HTMLElement[] } | undefined;
  const reset = () => { tracker.reset(); cached = undefined; };
  const scrollChain = (start: HTMLElement, axis: ScrollAxis, delta: number, now: number) => {
    const direction = delta > 0 ? 1 : -1;
    if (cached && cached.axis === axis && cached.direction === direction && now - cached.time < RESET_GAP_MS
      && cached.target.isConnected && cached.target.contains(start) && hasRoomToScroll(cached.target, axis, direction)) {
      cached.time = now;
      return cached.chain;
    }
    const chain = findScrollChain(start, axis, direction);
    cached = chain[0] ? { target: chain[0], axis, direction, time: now, chain } : undefined;
    return chain;
  };
  const onWheel = (event: WheelEvent) => {
    const preferences = readPreferences();
    if (!preferences.enabled || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) { reset(); return; }

    const start = eventElement(event);
    if (!start || start.closest("input, select, textarea, [contenteditable='true'], [role='slider']")) { reset(); return; }

    const shiftedVerticalWheel = event.shiftKey && event.deltaX === 0 && event.deltaY !== 0;
    const horizontalDelta = getWheelDelta(event, start, "x");
    const verticalDelta = shiftedVerticalWheel ? 0 : getWheelDelta(event, start, "y");
    const now = performance.now();
    const preferredAxis = wheelAxis(event);
    const preferredDelta = preferredAxis === "x" ? horizontalDelta : verticalDelta;
    const preferredChain = Math.abs(preferredDelta) > 0.01 ? scrollChain(start, preferredAxis, preferredDelta, now) : [];
    const axis: ScrollAxis = preferredChain.length ? preferredAxis : preferredAxis === "x" ? "y" : "x";
    const primaryDelta = axis === "x" ? horizontalDelta : verticalDelta;
    const primaryChain = preferredChain.length ? preferredChain : Math.abs(primaryDelta) > 0.01 ? scrollChain(start, axis, primaryDelta, now) : [];
    if (!Number.isFinite(primaryDelta) || Math.abs(primaryDelta) < 0.01) return;
    const target = primaryChain[0];
    if (!target) { reset(); return; }

    const viewport = axis === "x" ? target.clientWidth : target.clientHeight;
    const extent = (axis === "x" ? target.scrollWidth : target.scrollHeight) - viewport;
    const multiplier = tracker.multiplier(target, axis, primaryDelta, now, viewport, extent, preferences);
    if (multiplier < 1.05) return;

    // Only inspect a secondary axis once a large scrolling gesture qualifies.
    const horizontalChain = axis === "x" ? primaryChain : Math.abs(horizontalDelta) > 0.01 ? findScrollChain(start, "x", horizontalDelta > 0 ? 1 : -1) : [];
    const verticalChain = axis === "y" ? primaryChain : Math.abs(verticalDelta) > 0.01 ? findScrollChain(start, "y", verticalDelta > 0 ? 1 : -1) : [];

    const manualMultiplier = event.cancelable ? multiplier : multiplier - 1;
    if (event.cancelable) event.preventDefault();
    if (horizontalChain.length) applyScrollDelta(horizontalChain, "x", getWheelDelta(event, horizontalChain[0]!, "x") * manualMultiplier);
    if (verticalChain.length) applyScrollDelta(verticalChain, "y", getWheelDelta(event, verticalChain[0]!, "y") * manualMultiplier);
  };

  document.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    document.removeEventListener("wheel", onWheel);
    reset();
  };
}
