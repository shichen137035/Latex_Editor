import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultWheelAccelerationPreferences as defaults } from "../../packages/contracts/src/settings.js";
import { installWheelAcceleration, WheelAccelerationTracker } from "../../apps/desktop/src/renderer/wheelAcceleration.js";

describe("conservative accelerated scrolling", () => {
  const target = {};
  function burst(tracker: WheelAccelerationTracker, delta = 120, interval = 40, count = 24, preferences = defaults) {
    return Array.from({ length: count }, (_, index) => tracker.multiplier(target, "y", delta, index * interval, 600, 10000, preferences));
  }

  it("does not accelerate a few ordinary wheel notches", () => {
    expect(burst(new WheelAccelerationTracker(), 120, 50, 8)).toEqual(Array(8).fill(1));
  });

  it("requires large travel as well as sustained fast input", () => {
    const values = burst(new WheelAccelerationTracker());
    expect(values.slice(0, 8)).toEqual(Array(8).fill(1));
    expect(values.at(-1)).toBeGreaterThan(1.1);
    expect(Math.max(...values)).toBeLessThanOrEqual(defaults.maxMultiplier);
    expect(burst(new WheelAccelerationTracker(), 300, 10, 20)).toEqual(Array(20).fill(1));
  });

  it("leaves slow scrolling and high-frequency tiny trackpad deltas at native speed", () => {
    expect(burst(new WheelAccelerationTracker(), 120, 100, 40)).toEqual(Array(40).fill(1));
    expect(burst(new WheelAccelerationTracker(), 2, 8, 200)).toEqual(Array(200).fill(1));
  });

  it("does not accelerate a short scrollable list", () => {
    const tracker = new WheelAccelerationTracker();
    for (let i = 0; i < 30; i += 1) expect(tracker.multiplier(target, "y", 120, i * 30, 600, 700, defaults)).toBe(1);
  });

  it("immediately removes the boost after a pause or a noticeably slower cadence, including old saved settings", () => {
    for (const gap of [90, 150, 500]) {
      const tracker = new WheelAccelerationTracker();
      const saved = { ...defaults, decayMs: 1500 };
      expect(burst(tracker, 120, 30, 30, saved).at(-1)).toBeGreaterThan(1);
      expect(tracker.multiplier(target, "y", 120, 29 * 30 + gap, 600, 10000, saved)).toBe(1);
    }
  });

  it("quickly decays when input changes to small adjustment movements", () => {
    const tracker = new WheelAccelerationTracker();
    const peak = burst(tracker, 120, 30, 30).at(-1)!;
    const tail = Array.from({ length: 8 }, (_, i) => tracker.multiplier(target, "y", 5, 29 * 30 + (i + 1) * 30, 600, 10000, defaults));
    expect(tail[0]).toBeLessThan(peak);
    expect(tail.at(-1)).toBe(1);
    expect(tail.every((value, i) => i === 0 || value <= tail[i - 1]!)).toBe(true);
  });

  it("resets on reversal, switching axes, or switching scroll containers", () => {
    for (const [nextTarget, axis, delta] of [[target, "y", -120], [target, "x", 120], [{}, "y", 120]] as const) {
      const tracker = new WheelAccelerationTracker();
      burst(tracker);
      expect(tracker.multiplier(nextTarget, axis, delta, 24 * 40, 600, 10000, defaults)).toBe(1);
    }
  });

  it("respects the maximum speed and clears disabled or invalid input", () => {
    const tracker = new WheelAccelerationTracker();
    const preferences = { ...defaults, strength: 10, maxMultiplier: 2 };
    expect(Math.max(...burst(tracker, 300, 15, 100, preferences))).toBe(2);
    expect(tracker.multiplier(target, "y", NaN, 1600, 600, 10000, defaults)).toBe(1);
    expect(tracker.multiplier(target, "y", 120, 1630, 600, 10000, { ...defaults, enabled: false })).toBe(1);
  });
});

class ScrollElement {
  parentElement: ScrollElement | null = null;
  scrollTop = 0;
  scrollLeft = 0;
  scrollHeight = 10000;
  scrollWidth = 600;
  clientHeight = 600;
  clientWidth = 600;
  isConnected = true;
  editable = false;
  closest() { return this.editable ? this : null; }
  contains(other: ScrollElement) {
    for (let node: ScrollElement | null = other; node; node = node.parentElement) if (node === this) return true;
    return false;
  }
}

describe("wheel event routing cost and native behavior", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  function fixture() {
    const root = new ScrollElement(), leaf = new ScrollElement();
    leaf.parentElement = root;
    const document = { scrollingElement: root, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("document", document);
    vi.stubGlobal("HTMLElement", ScrollElement);
    vi.stubGlobal("WheelEvent", { DOM_DELTA_LINE: 1, DOM_DELTA_PAGE: 2 });
    const getStyle = vi.fn((element: ScrollElement) => ({ overflowX: "hidden", overflowY: element === root ? "auto" : "hidden", overscrollBehaviorX: "auto", overscrollBehaviorY: "auto" }));
    vi.stubGlobal("getComputedStyle", getStyle);
    const time = vi.spyOn(performance, "now");
    const dispose = installWheelAcceleration(() => defaults);
    const handler = document.addEventListener.mock.calls[0]![1] as (event: WheelEvent) => void;
    const wheel = (delta: number, now: number) => {
      time.mockReturnValue(now);
      const event = { deltaX: 0, deltaY: delta, deltaMode: 0, target: leaf, composedPath: () => [leaf, root], cancelable: true, preventDefault: vi.fn() };
      handler(event as unknown as WheelEvent);
      if (!event.preventDefault.mock.calls.length) root.scrollTop += delta;
      return event;
    };
    return { root, leaf, wheel, getStyle, dispose, document };
  }

  it("keeps normal scrolling native and reuses the scroll container within the gesture", () => {
    const f = fixture();
    for (let i = 0; i < 100; i += 1) expect(f.wheel(5, i * 20).preventDefault).not.toHaveBeenCalled();
    expect(f.root.scrollTop).toBe(500);
    expect(f.getStyle).toHaveBeenCalledTimes(2);
    f.dispose();
    expect(f.document.removeEventListener).toHaveBeenCalledOnce();
  });

  it("only intercepts a sustained large gesture, and returns reversal to native scrolling", () => {
    const f = fixture();
    for (let i = 0; i < 8; i += 1) expect(f.wheel(120, i * 40).preventDefault).not.toHaveBeenCalled();
    const boost = f.wheel(120, 8 * 40);
    expect(boost.preventDefault).toHaveBeenCalledOnce();
    expect(f.root.scrollTop).toBeGreaterThan(9 * 120);
    expect(f.wheel(-120, 9 * 40).preventDefault).not.toHaveBeenCalled();
    f.dispose();
  });
});
