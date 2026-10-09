import { describe, expect, it } from "vitest";
import { DIRECTORY_PAGE_SIZE, directoryPageNumbers, projectPage } from "../../apps/desktop/src/renderer/directory/pagination.js";

describe("project pagination", () => {
  it("caps every page at ten projects and preserves a partial final page", () => {
    expect(DIRECTORY_PAGE_SIZE).toBe(10);
    expect(projectPage(63, 0)).toEqual({ index: 0, count: 7, start: 0, end: 10 });
    expect(projectPage(63, 6)).toEqual({ index: 6, count: 7, start: 60, end: 63 });
    expect(projectPage(10, 0)).toEqual({ index: 0, count: 1, start: 0, end: 10 });
  });
  it("clamps pages after filtering/deleting and handles empty projects", () => {
    expect(projectPage(0, 6)).toEqual({ index: 0, count: 1, start: 0, end: 0 });
    expect(projectPage(60, 6)).toEqual({ index: 5, count: 6, start: 50, end: 60 });
    expect(projectPage(1, 6)).toEqual({ index: 0, count: 1, start: 0, end: 1 });
    expect(projectPage(11, -1).index).toBe(0);
  });
  it("keeps long pagination compact while retaining the first, active and last page", () => {
    expect(directoryPageNumbers(0, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(directoryPageNumbers(0, 100)).toEqual([0, 1, 2, 3, 4, "gap", 99]);
    expect(directoryPageNumbers(50, 100)).toEqual([0, "gap", 48, 49, 50, 51, 52, "gap", 99]);
  });
});
