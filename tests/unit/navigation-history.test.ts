import { describe, expect, it } from "vitest";
import { NavigationHistory, navigationLocationValid, type NavigationLocation } from "../../apps/desktop/src/renderer/workbench/NavigationHistory.js";

const layout: NavigationLocation["layout"] = { mode: "single", singlePane: "preview", leftPane: "preview", rightPane: "pdf" };
const location = (offset: number, path = "main.tex"): NavigationLocation => ({ path, offset, layout });
const valid = () => true;

describe("navigation history", () => {
  it("walks backward and forward through several jumps and discards a broken redo branch", () => {
    const history = new NavigationHistory();
    history.record(location(10), location(30));
    history.record(location(30), location(60));
    history.record(location(60), location(90, "notes.tex"));

    expect(history.back(valid)).toMatchObject({ path: "main.tex", offset: 60 });
    expect(history.back(valid)?.offset).toBe(30);
    expect(history.forward(valid)?.offset).toBe(60);
    history.record(location(60), location(75));
    expect(history.forward(valid)).toBeUndefined();
    expect(history.back(valid)?.offset).toBe(60);
    expect(history.back(valid)?.offset).toBe(30);
    expect(history.back(valid)?.offset).toBe(10);
    expect(history.back(valid)).toBeUndefined();
  });

  it("clears both directions when an unrelated file action interrupts navigation", () => {
    const history = new NavigationHistory();
    history.record(location(1), location(2));
    history.back(valid);
    expect(history.canForward).toBe(true);
    history.clear();
    expect(history.canBack).toBe(false);
    expect(history.canForward).toBe(false);
  });

  it("remaps a surviving link and skips a link removed by editing", () => {
    const history = new NavigationHistory();
    let source = String.raw`See \ref{thm:x}. \label{thm:x}`;
    const text = String.raw`\ref{thm:x}`;
    const start = source.indexOf(text);
    const from: NavigationLocation = { ...location(start), link: { start, text, targetLabel: "thm:x" } };
    history.record(from, location(source.indexOf(String.raw`\label{thm:x}`)));
    const isValid = (point: NavigationLocation) => navigationLocationValid(point, source);

    source = `Intro. ${source}`;
    history.mapEdit("main.tex", [{ start: 0, end: 0, newLength: 7 }]);
    expect(history.back(isValid)?.offset).toBe(start + 7);
    expect(history.forward(isValid)?.offset).toBe(source.indexOf(String.raw`\label{thm:x}`));

    const removed = source.indexOf(text);
    source = source.slice(0, removed) + source.slice(removed + text.length);
    history.mapEdit("main.tex", [{ start: removed, end: removed + text.length, newLength: 0 }]);
    expect(history.back(isValid)).toBeUndefined();
    expect(history.forward(isValid)).toBeUndefined();
  });

  it("invalidates a jump when its target label disappears", () => {
    const history = new NavigationHistory();
    const source = String.raw`See \ref{thm:x}.`;
    const start = source.indexOf(String.raw`\ref{thm:x}`);
    history.record({ ...location(start), link: { start, text: String.raw`\ref{thm:x}`, targetLabel: "thm:x" } }, location(2));
    expect(history.back((point) => navigationLocationValid(point, source))).toBeUndefined();
  });
});
