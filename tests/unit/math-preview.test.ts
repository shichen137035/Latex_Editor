import { describe, expect, it } from "vitest";
import { MathMacroRegistry, parseMacroDefinitions } from "../../apps/desktop/src/renderer/math/MathMacroRegistry.js";
import { MathNodeIndex, parseMathNodes } from "../../apps/desktop/src/renderer/math/MathNodeLocator.js";
import { extractMathExpression, MathRenderService } from "../../apps/desktop/src/renderer/math/MathRenderService.js";
import { tokenizeInlineSource } from "../../apps/desktop/src/renderer/preview/inlineSource.js";

describe("v0.3.1 project math context", () => {
  it("parses arguments, follows local files, and applies definitions in source order", () => {
    expect(parseMacroDefinitions("\\newcommand{\\norm}[1]{\\lVert #1\\rVert}", "macros.tex")[0]).toMatchObject({ name: "\\norm", argumentCount: 1, replacement: "\\lVert #1\\rVert" });
    const registry = new MathMacroRegistry();
    const context = registry.rebuild([
      { path: "main.tex", content: "\\input{macros}\n\\usepackage{localmath}\n\\renewcommand{\\E}{Y}" },
      { path: "macros.tex", content: "\\newcommand{\\E}{\\mathbb{E}}\n\\providecommand{\\Var}{\\operatorname{Var}}" },
      { path: "localmath.sty", content: "\\DeclareMathOperator{\\Cov}{Cov}" }
    ], "main.tex");
    expect(context.macros).toMatchObject({ "\\E": "Y", "\\Var": "\\operatorname{Var}", "\\Cov": "\\operatorname{Cov}" });
  });

  it("uses the same renderer for custom macros and visible invalid input", () => {
    const renderer = new MathRenderService();
    expect(renderer.render("\\E[X]", { macros: { "\\E": "\\mathbb{E}" }, operators: {}, sourceVersion: 1 }, { displayMode: false }).error).toBeUndefined();
    const invalid = renderer.render("\\frac{x}{", { macros: {}, operators: {}, sourceVersion: 1 }, { displayMode: true });
    expect(invalid.error?.recoverable).toBe(true);
    expect(invalid.html).toContain("katex-error");
  });

  it("renders parameterized arrow macros such as p-convergence", () => {
    const registry = new MathMacroRegistry();
    const context = registry.rebuild([{ path: "main.tex", content: String.raw`\newcommand{\pto}{\xrightarrow{p}}` }], "main.tex");
    expect(context.macros["\\pto"]).toBe(String.raw`\xrightarrow{p}`);
    const result = new MathRenderService().render(String.raw`X_n\pto X`, context, { displayMode: false, throwOnError: false });
    expect(result.error).toBeUndefined();
    expect(result.html).toContain("x-arrow");
    expect(result.html).toContain("→");
    expect(result.html).toContain("<mi>p</mi>");
    const inlineFormula = tokenizeInlineSource(String.raw`$X_n\pto X$`).find(token => token.kind === "math");
    expect(inlineFormula?.value).toBe(String.raw`X_n\pto X`);
    expect(new MathRenderService().render(inlineFormula!.value, context, { displayMode: false, throwOnError: false }).html).toContain("x-arrow");
  });
});

describe("v0.3.1 math node index", () => {
  it("indexes thousands of formulas while suppressing nested math ranges", () => {
    const formula = "\\[\\begin{aligned}x&=y\\end{aligned}\\]\n";
    const source = formula.repeat(10_000);
    const nodes = parseMathNodes(source);
    expect(nodes).toHaveLength(10_000);
    expect(nodes[0]?.kind).toBe("display-bracket");
    expect(nodes.at(-1)?.end).toBe(source.length - 1);
  });

  it("ignores commented delimiters, including closing delimiters inside active math", () => {
    expect(parseMathNodes(String.raw`% \[x=y\]
% \begin{equation}x=y\end{equation}`)).toEqual([]);
    for (const [open, close] of [["\\[", "\\]"], ["\\(", "\\)"], ["$$", "$$"]]) {
      const source = `${open}x=y\n% ${close}\nz=w${close}`;
      const nodes = parseMathNodes(source);
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.end).toBe(source.length);
    }
  });

  it("detects inline, display, and environment formulas and locates by offset", () => {
    const source = "Text $x+y$ and \\(z\\).\n\\[a+b\\]\n\\begin{align}c&=d\\end{align}";
    const nodes = parseMathNodes(source);
    expect(nodes.map((item) => item.kind)).toEqual(["inline-dollar", "inline-paren", "display-bracket", "environment"]);
    const offset = source.indexOf("x+y") + 1;
    expect(MathNodeIndex.fromSource(source).findMathNodeAtOffset(offset)).toMatchObject({ kind: "inline-dollar", displayMode: false });
  });

  it("keeps an outer display formula as the editable unit and extracts wrappers", () => {
    const source = "\\[\\begin{cases}x&>0\\end{cases}\\]";
    expect(parseMathNodes(source)).toHaveLength(1);
    expect(parseMathNodes(source)[0]?.kind).toBe("display-bracket");
    expect(extractMathExpression("\\begin{equation}\nx+y\n\\end{equation}")).toEqual({ expression: "x+y", displayMode: true });
  });
});
