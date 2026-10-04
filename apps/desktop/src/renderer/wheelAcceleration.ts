import type { WheelAccelerationPreferences } from "@latex-editor/contracts";

type ScrollAxis = "x" | "y";
interface AccelerationState {
  target: HTMLElement;
  axis: ScrollAxis;
  direction: -1 | 1;
  time: number;
  extraMultiplier: number;
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
  let previous: AccelerationState | undefined;
  const onWheel = (event: WheelEvent) => {
    const preferences = readPreferences();
    if (!preferences.enabled || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) { previous = undefined; return; }

    const start = eventElement(event);
    if (!start || start.closest("input, select, textarea, [contenteditable='true'], [role='slider']")) { previous = undefined; return; }

    const shiftedVerticalWheel = event.shiftKey && event.deltaX === 0 && event.deltaY !== 0;
    const horizontalDelta = getWheelDelta(event, start, "x");
    const verticalDelta = shiftedVerticalWheel ? 0 : getWheelDelta(event, start, "y");
    const horizontalChain = Math.abs(horizontalDelta) > 0.01 ? findScrollChain(start, "x", horizontalDelta > 0 ? 1 : -1) : [];
    const verticalChain = Math.abs(verticalDelta) > 0.01 ? findScrollChain(start, "y", verticalDelta > 0 ? 1 : -1) : [];
    const preferredAxis = wheelAxis(event);
    const preferredChain = preferredAxis === "x" ? horizontalChain : verticalChain;
    const axis: ScrollAxis = preferredChain.length ? preferredAxis : preferredAxis === "x" ? "y" : "x";
    const primaryDelta = axis === "x" ? horizontalDelta : verticalDelta;
    const primaryChain = axis === "x" ? horizontalChain : verticalChain;
    if (!Number.isFinite(primaryDelta) || Math.abs(primaryDelta) < 0.01) return;
    const direction = primaryDelta > 0 ? 1 : -1;
    const target = primaryChain[0];
    if (!target) { previous = undefined; return; }

    const now = performance.now();
    let extraMultiplier = 0;
    if (previous && previous.target === target && previous.axis === axis && previous.direction === direction) {
      const elapsed = Math.max(0, now - previous.time);
      if (elapsed <= preferences.decayMs * 3) {
        const retained = previous.extraMultiplier * Math.exp(-elapsed / preferences.decayMs);
        const cadence = Math.max(0, 1 - elapsed / (preferences.decayMs * 0.75));
        extraMultiplier = Math.min(preferences.maxMultiplier - 1, retained + preferences.strength * 0.12 * cadence);
      }
    }
    previous = { target, axis, direction, time: now, extraMultiplier };

    const multiplier = Math.min(preferences.maxMultiplier, 1 + extraMultiplier);
    if (multiplier < 1.05) return;

    const manualMultiplier = event.cancelable ? multiplier : multiplier - 1;
    if (event.cancelable) event.preventDefault();
    if (horizontalChain.length) applyScrollDelta(horizontalChain, "x", getWheelDelta(event, horizontalChain[0]!, "x") * manualMultiplier);
    if (verticalChain.length) applyScrollDelta(verticalChain, "y", getWheelDelta(event, verticalChain[0]!, "y") * manualMultiplier);
  };

  document.addEventListener("wheel", onWheel, { passive: false });
  return () => {
    document.removeEventListener("wheel", onWheel);
    previous = undefined;
  };
}
