import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readWorkspacePosition, writeWorkspacePosition } from "../../apps/desktop/src/renderer/workbench/workspacePosition.js";

let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

it("restores the active file and both viewport positions without crossing project boundaries", () => {
  const state = { activePath: "chapters/results.tex", source: [["chapters/results.tex", { offset: 123, scrollTop: 700 }]] as Array<[string, { offset: number; scrollTop: number }]>, preview: [["chapters/results.tex", { offset: 140, scrollTop: 900 }]] as Array<[string, { offset: number; scrollTop: number }]> };
  writeWorkspacePosition("paper", "D:/Paper", state);
  expect(readWorkspacePosition("paper", "D:/Paper")).toEqual(state);
  expect(readWorkspacePosition("other", "D:/Paper").activePath).toBeUndefined();
  expect(readWorkspacePosition("paper", "D:/Other").activePath).toBeUndefined();
});

it("bounds stored positions while keeping the active file, and ignores invalid paths/coordinates", () => {
  const source = Array.from({ length: 40 }, (_, index) => [`file${index}.tex`, { offset: index, scrollTop: index * 10 }] as [string, { offset: number; scrollTop: number }]);
  source.push(["../outside.tex", { offset: 0, scrollTop: 0 }]);
  writeWorkspacePosition("p", "root", { activePath: "file0.tex", source, preview: [] });
  const restored = readWorkspacePosition("p", "root");
  expect(restored.source.length).toBeLessThanOrEqual(32);
  expect(restored.source.at(-1)?.[0]).toBe("file0.tex");
  expect(restored.source.some(([path]) => path === "../outside.tex")).toBe(false);
  writeWorkspacePosition("p", "root", { activePath: "D:/outside.tex", source: [["file.tex", { offset: -1, scrollTop: 0 }]], preview: [] });
  expect(readWorkspacePosition("p", "root")).toEqual({ source: [], preview: [] });
});

it("tolerates unavailable or damaged storage", () => {
  vi.stubGlobal("localStorage", { getItem: () => "broken", setItem: () => { throw new Error("quota"); } });
  expect(readWorkspacePosition("p", "root")).toEqual({ source: [], preview: [] });
  expect(() => writeWorkspacePosition("p", "root", { source: [], preview: [] })).not.toThrow();
});
