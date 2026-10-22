import { createElement, isValidElement, Children, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parsePreview } from "../../packages/editor-core/src/preview/parser.js";
import { PreviewDiagnostics } from "../../apps/desktop/src/renderer/preview/PreviewDiagnostics.js";
import type { PreviewDocument } from "../../packages/editor-core/src/preview/types.js";

function buttons(node: ReactNode): Array<{ onClick(): void }> {
  return Children.toArray(node).flatMap(child => {
    if (!isValidElement<{ children?: ReactNode; onClick(): void }>(child)) return [];
    return child.type === "button" ? [child.props] : buttons(child.props.children);
  });
}

describe("Preview recovery diagnostic locations", () => {
  it("locates crossing blocks at their opening marker with CRLF source offsets", () => {
    const source = "intro\r\n\\begin{quote}\r\n  \\begin{samepage}\r\ntext\r\n\\end{quote}\r\n\\end{samepage}";
    const document = parsePreview(source, "chapters/proof.tex", []);
    expect(document.diagnostics).toEqual(["Crossing block custom:samepage was rendered as fallback content."]);
    const detail = document.diagnosticDetails![0]!;
    expect(detail).toEqual({ message: document.diagnostics[0], source: {
      filePath: "chapters/proof.tex", startOffset: source.indexOf("\\begin{samepage}"), endOffset: source.length,
      startLine: 3, startColumn: 3, endLine: 6, endColumn: 15
    } });
    const onLocate = vi.fn();
    const rendered = PreviewDiagnostics({ document, heading: "Recovered", onLocate });
    const html = renderToStaticMarkup(rendered);
    expect(html).toContain("chapters/proof.tex:3:3");
    expect(html).toContain('type="button"');
    buttons(rendered)[0]!.onClick();
    expect(onLocate).toHaveBeenCalledExactlyOnceWith(detail.source);
  });

  it("reports exact locations for unmatched and unclosed markers", () => {
    const source = "first\n\\end{quote}\n\\]\n% tw:block-end\n%</texweave:disable>\n\\begin{samepage}\nbody";
    const document = parsePreview(source, "main.tex", []);
    expect(document.diagnosticDetails).toHaveLength(5);
    expect(document.diagnosticDetails!.map(detail => detail.source?.startLine)).toEqual([2, 3, 4, 5, 6]);
    for (const detail of document.diagnosticDetails!) {
      expect(detail.source?.filePath).toBe("main.tex");
      expect(detail.source?.startColumn).toBe(1);
      expect(detail.message).toBe(document.diagnostics[document.diagnosticDetails!.indexOf(detail)]);
    }
  });

  it("keeps legacy diagnostics readable without inventing source locations", () => {
    const document: PreviewDocument = { filePath: "main.tex", nodes: [], diagnostics: ["Configuration error"] };
    const html = renderToStaticMarkup(createElement(PreviewDiagnostics, { document, heading: "Recovered", onLocate: vi.fn() }));
    expect(html).toContain("Configuration error");
    expect(html).not.toContain("<button");
    expect(PreviewDiagnostics({ document: { ...document, diagnostics: [] }, heading: "Recovered" })).toBeNull();
  });
});
