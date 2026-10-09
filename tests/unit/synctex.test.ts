import { describe, expect, it } from "vitest";
import { parseForwardSync, syncTexRecords } from "../../apps/desktop/src/main/synctex.js";
import { syncTexDirectories } from "../../packages/compiler-latexmk/src/synctex-data.js";
import { resolve } from "node:path";

describe("SyncTeX result boundaries", () => {
  it("does not mix positions between records or confuse H with h", () => {
    const output = "Output:a.pdf\nPage:1\nH:90\nv:20\nOutput:a.pdf\nPage:2\nh:310\nv:105\nH:8\n";
    expect(parseForwardSync(output)).toEqual({ page: 2, x: 310, y: 105 });
    expect(() => parseForwardSync("Page:1\nH:90\nv:20")).toThrow("SYNCTEX_NO_MATCH");
  });
  it("keeps left and right column coordinates distinct", () => {
    expect(parseForwardSync("Output:a.pdf\nPage:1\nx:72\ny:105")).toEqual({ page: 1, x: 72, y: 105 });
    expect(parseForwardSync("Output:a.pdf\nPage:1\nx:310\ny:105")).toEqual({ page: 1, x: 310, y: 105 });
    expect(syncTexRecords("Input:left.tex\nLine:2\nColumn:-1\nInput:right.tex\nLine:7\nColumn:3")).toHaveLength(2);
  });
  it("rejects missing and invalid pages", () => {
    for (const page of ["0", "-1", "NaN", "1.5"]) expect(() => parseForwardSync(`Page:${page}\nx:10\ny:20`)).toThrow();
  });
  it("discovers configured aux directories only inside the project", () => {
    const root = resolve("project");
    const directories = syncTexDirectories(root, "chapters/main.tex", ["-auxdir=cache", "-outdir", "pdf", "-aux-directory=../../outside"]);
    expect(directories).toContain(resolve(root, "cache"));
    expect(directories).toContain(resolve(root, "pdf"));
    expect(directories).not.toContain(resolve(root, "../../outside"));
  });
});
