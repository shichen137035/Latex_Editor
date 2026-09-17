import { describe, expect, it } from "vitest";
import { scanLatex } from "../../packages/editor-core/src/index.js";

describe("development environment", () => {
  it("loads the backend modules", () => {
    expect(scanLatex("\\section{Ready}")).toEqual([
      { kind: "command", value: "section", line: 1, column: 1 }
    ]);
  });
});
