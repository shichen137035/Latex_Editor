import { expect, it } from "vitest";
import { builtinListHandler, blockHandler, registerBlockHandler, listItemOrdinals } from "../../apps/desktop/src/renderer/preview/block-handlers.js";
import { cloneEnvironmentDefinitions } from "../../apps/desktop/src/renderer/preview/environments.js";
import { environmentPreview } from "../../apps/desktop/src/renderer/preview/environment-preview.js";
import { serializeEnvironments } from "../../apps/desktop/src/renderer/preview/environmentConfig.js";

it("parses only owned top-level items, preserving nested lists and ignoring comments, escapes and groups", () => {
  const source = String.raw`\begin{enumerate}[label={\alph*)}]
% \item ignored
\item First {\item not-an-item} \\item text \itemsep=2pt
\begin{itemize}\item nested one\item nested two\end{itemize}
\item[{A [B]}] Second
\end{enumerate}`;
  const items = builtinListHandler.parse(source, 100, "item");
  expect(items).toHaveLength(2);
  expect(items[1]?.label).toBe("{A [B]}");
  expect(source.slice(items[0]!.startOffset - 100, items[0]!.endOffset - 100)).toContain("nested two");
  expect(source.slice(items[1]!.startOffset - 100, items[1]!.endOffset - 100)).toContain("Second");
  expect(items[0]!.endOffset).toBe(items[1]!.commandStart);
});

it("supports configured item commands, empty labels and balanced environment options", () => {
  const source = String.raw`\begin{tasks}[label={[nested]}]\task[] A\task[B] B\end{tasks}`;
  expect(builtinListHandler.parse(source, 0, "item")).toEqual([]);
  const items = builtinListHandler.parse(source, 0, "task");
  expect(items).toHaveLength(2);
  expect(items[0]!.label).toBe("");
  expect(items[1]!.label).toBe("B");
  const next = builtinListHandler.append(source, "task");
  expect(builtinListHandler.parse(next, 0, "task")).toHaveLength(3);
  expect(next).toContain("\\end{tasks}");
});

it("keeps automatic numbering across custom labels and virtualized rows", () => {
  const source = String.raw`\begin{enumerate}\item A\item[Special] B\item C\item[] D\item E\end{enumerate}`;
  const items = builtinListHandler.parse(source, 0, "item");
  expect(listItemOrdinals(items)).toEqual([1, 1, 2, 2, 3]);
  expect(listItemOrdinals(items).slice(2)).toEqual([2, 2, 3]);
});

it("resolves list handlers and marker behavior from configuration for renamed/custom blocks", () => {
  const definition = cloneEnvironmentDefinitions().find(item => item.id === "enumerate")!;
  definition.id = "custom-steps"; definition.builtIn = false;
  definition.behavior.listMarker = "lower-roman";
  definition.behavior.listItemCommand = "step";
  const resolved = environmentPreview(definition.id, definition);
  expect(resolved.renderer).toBe("list");
  expect(resolved.handler?.id).toBe("builtin.list");
  expect(resolved.behavior.listStyle).toBe("ordered");
  expect(serializeEnvironments([definition])).toContain('listItemCommand="step"');
  expect(serializeEnvironments([definition])).toContain('listMarker="lower-roman"');
  definition.behavior.blockHandler = "missing.plugin";
  expect(environmentPreview(definition.id, definition).renderer).toBe("content");
});

it("registers packaged handlers with cleanup instead of evaluating configuration scripts", () => {
  const handler = { ...builtinListHandler, id: "plugin.tasks" };
  const dispose = registerBlockHandler(handler);
  expect(blockHandler(handler.id)).toBe(handler);
  expect(() => registerBlockHandler(handler)).toThrow("already registered");
  dispose();
  expect(blockHandler(handler.id)).toBeUndefined();
});
