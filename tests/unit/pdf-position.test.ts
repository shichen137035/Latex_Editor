import { describe, expect, it } from "vitest";
import { capturePdfReadingPosition, restorePdfReadingPosition } from "../../apps/desktop/src/renderer/pdf/position.js";

describe("PDF reading position", () => {
  it("preserves page and fraction after page sizes change", () => {
    const position = capturePdfReadingPosition([{ page: 1, top: 16, height: 800 }, { page: 2, top: 834, height: 800 }], 1234, 24)!;
    expect(position).toEqual({ page: 2, fraction: .5, left: 24 });
    expect(restorePdfReadingPosition(position, [{ page: 1, top: 16, height: 1000 }, { page: 2, top: 1034, height: 1000 }])).toEqual({ top: 1534, left: 24 });
  });
  it("clamps removed pages to the last remaining page", () => {
    expect(restorePdfReadingPosition({ page: 8, fraction: .4, left: 0 }, [{ page: 1, top: 16, height: 800 }, { page: 2, top: 834, height: 800 }])).toEqual({ top: 1154, left: 0 });
    expect(capturePdfReadingPosition([], 100)).toBeUndefined();
    expect(restorePdfReadingPosition({ page: 1, fraction: 0, left: 0 }, [])).toBeUndefined();
  });
});
