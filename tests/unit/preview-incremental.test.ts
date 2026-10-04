import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENTS } from "../../apps/desktop/src/renderer/preview/environments.js";
import { createPreviewTransaction, tryIncrementalPreviewUpdate, type PreviewTextChange } from "../../apps/desktop/src/renderer/preview/incremental.js";
import { parsePreview } from "../../apps/desktop/src/renderer/preview/parser.js";
import { reusePreviewDocument } from "../../apps/desktop/src/renderer/preview/renderModel.js";
import type { PreviewDocument, PreviewNode } from "../../apps/desktop/src/renderer/preview/types.js";

const filePath = "main.tex";
const initialSource = String.raw`\begin{document}
\section{Introduction}
The estimator is consistent.

\begin{equation}x+y\end{equation}

Tail paragraph.
\end{document}`;

function comparable(document: PreviewDocument): unknown {
  const nodeValue = (node: PreviewNode): unknown => node.kind === "content"
    ? { kind: node.kind, source: node.source, raw: node.raw, origin: node.origin, contentType: node.contentType }
    : { kind: node.kind, source: node.source, body: node.body, origin: node.origin, environmentId: node.environmentId,
      semanticKind: node.semanticKind, title: node.title, latexLabel: node.latexLabel, labelSource: node.labelSource, autoLabel: node.autoLabel,
      children: node.children.map(nodeValue) };
  return { diagnostics: document.diagnostics, title: document.title, nodes: document.nodes.map(nodeValue) };
}

function applyChange(previousSource: string, document: PreviewDocument, change: PreviewTextChange) {
  const nextSource = previousSource.slice(0, change.from) + change.insertedText + previousSource.slice(change.to);
  const transaction = createPreviewTransaction(previousSource, nextSource, [change]);
  expect(transaction).toBeDefined();
  const result = tryIncrementalPreviewUpdate(document, previousSource, nextSource, filePath, DEFAULT_ENVIRONMENTS, transaction);
  if ("document" in result) expect(comparable(result.document)).toEqual(comparable(parsePreview(nextSource, filePath, DEFAULT_ENVIRONMENTS)));
  return { result, nextSource };
}

describe("incremental preview", () => {
  it("uses an editor transaction for a prose edit and keeps full-parser source ranges", () => {
    let id = 0;
    const previous = reusePreviewDocument(undefined, undefined, parsePreview(initialSource, filePath, DEFAULT_ENVIRONMENTS), initialSource, () => `visual:${++id}`);
    const start = initialSource.indexOf("consistent");
    const { result } = applyChange(initialSource, previous, { from: start, to: start + "consistent".length, insertedText: "strongly consistent" });
    expect("document" in result && result.mode).toBe("direct");
    if ("document" in result) {
      expect(result.changeSet.structureChanged).toBe(false);
      expect(result.changeSet.changedNodeIds.size).toBeGreaterThan(0);
    }
  });

  it("locally reparses an atomic math block containing LaTeX commands", () => {
    const previous = parsePreview(initialSource, filePath, DEFAULT_ENVIRONMENTS);
    const start = initialSource.indexOf("x+y");
    const { result } = applyChange(initialSource, previous, { from: start, to: start + 3, insertedText: String.raw`\frac{x}{y}+\theta` });
    expect("document" in result && result.mode).toBe("local-reparse");
  });

  it("finds a later sibling and retains untouched node objects for a same-length edit", () => {
    const previous = parsePreview(initialSource, filePath, DEFAULT_ENVIRONMENTS);
    const from = initialSource.indexOf("Tail paragraph");
    const { result } = applyChange(initialSource, previous, { from, to: from + 4, insertedText: "Last" });
    expect("document" in result && result.mode).toBe("direct");
    if ("document" in result) {
      const beforeSection = previous.nodes[0];
      const afterSection = result.document.nodes[0];
      expect(beforeSection?.kind).toBe("block");
      expect(afterSection?.kind).toBe("block");
      if (beforeSection?.kind === "block" && afterSection?.kind === "block") {
        expect(afterSection.children[0]).toBe(beforeSection.children[0]);
        expect(afterSection.children[1]).toBe(beforeSection.children[1]);
      }
    }
  });

  it("falls back for structural changes and invalid or multi-cursor transactions", () => {
    const previous = parsePreview(initialSource, filePath, DEFAULT_ENVIRONMENTS);
    const start = initialSource.indexOf("x+y");
    const structural = applyChange(initialSource, previous, { from: start, to: start, insertedText: String.raw`\begin{lemma}` }).result;
    expect("fallbackReason" in structural && structural.fallbackReason).toBe("structural-change");

    const next = initialSource.slice(0, start) + "z" + initialSource.slice(start);
    const invalid = tryIncrementalPreviewUpdate(previous, initialSource, next, filePath, DEFAULT_ENVIRONMENTS,
      { previousSource: initialSource, nextSource: next, changes: [{ from: start, to: start, insertedText: "wrong" }] });
    expect("fallbackReason" in invalid && invalid.fallbackReason).toBe("invalid-transaction");

    const changes = [{ from: start, to: start, insertedText: "z" }, { from: start + 2, to: start + 2, insertedText: "w" }];
    const multiNext = initialSource.slice(0, start) + "z" + initialSource.slice(start, start + 2) + "w" + initialSource.slice(start + 2);
    const multi = tryIncrementalPreviewUpdate(previous, initialSource, multiNext, filePath, DEFAULT_ENVIRONMENTS,
      createPreviewTransaction(initialSource, multiNext, changes));
    expect("fallbackReason" in multi && multi.fallbackReason).toBe("multi-edit");
  });

  it("does not patch a plain letter that completes a structural command", () => {
    const source = String.raw`\begin{document}
Before \sectio{New heading} after.
\end{document}`;
    const document = parsePreview(source, filePath, DEFAULT_ENVIRONMENTS);
    const at = source.indexOf("\\sectio") + "\\sectio".length;
    const { result } = applyChange(source, document, { from: at, to: at, insertedText: "n" });
    expect("fallbackReason" in result && result.fallbackReason).toBe("structural-change");
  });

  it("matches full parsing through repeated edits that shift later nodes", () => {
    let source = initialSource;
    let document = parsePreview(source, filePath, DEFAULT_ENVIRONMENTS);
    const replacements = ["reliable", "very reliable", "robust", "consistent", "asymptotically consistent"];
    for (const replacement of replacements) {
      const from = source.indexOf("The estimator is ") + "The estimator is ".length;
      const to = source.indexOf(".", from);
      const updated = applyChange(source, document, { from, to, insertedText: replacement });
      expect("document" in updated.result).toBe(true);
      if (!("document" in updated.result)) break;
      source = updated.nextSource;
      document = updated.result.document;
    }
  });
});
