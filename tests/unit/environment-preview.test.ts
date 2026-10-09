import { expect, it } from "vitest";
import { cloneEnvironmentDefinitions } from "../../apps/desktop/src/renderer/preview/environments.js";
import { environmentPreview, imageClickAction, previewSizingStyle } from "../../apps/desktop/src/renderer/preview/environment-preview.js";
import { serializeEnvironments } from "../../apps/desktop/src/renderer/preview/environmentConfig.js";
import { mergeEnvironmentEdit } from "../../apps/desktop/src/renderer/preview/environmentEdits.js";

it("uses family configuration and explicit rendering policy instead of environment names", () => {
  const renamed = cloneEnvironmentDefinitions().find(item => item.id === "figure")!;
  renamed.id = "my-picture"; renamed.builtIn = false;
  expect(environmentPreview(renamed.id, renamed).renderer).toBe("figure");
  renamed.behavior.renderer = "content";
  expect(environmentPreview(renamed.id, renamed).renderer).toBe("content");
  expect(environmentPreview("table").renderer).toBe("table");
  expect(environmentPreview("inline-image").renderer).toBe("figure");
  expect(environmentPreview("align-star").renderer).toBe("math");
  expect(environmentPreview("algorithmic").renderer).toBe("content");
  expect(environmentPreview("lstlisting").renderer).toBe("code");
  expect(environmentPreview("unknown-environment").renderer).toBe("content");
});

it("honors configured caption/toolbar flags and resolves existing image editor preferences", () => {
  const definition = cloneEnvironmentDefinitions().find(item => item.id === "figure")!;
  expect(imageClickAction(environmentPreview(definition.id, definition), "source")).toBe("source");
  Object.assign(definition.behavior, { showCaption: false, captionEditable: false, tableToolbar: "hidden", allowExpandedEditor: false, expandedToolbar: false, imageClickAction: "inspect" });
  const config = environmentPreview(definition.id, definition);
  expect(config.behavior).toMatchObject({ showCaption: false, captionEditable: false, tableToolbar: "hidden", allowExpandedEditor: false, expandedToolbar: false });
  expect(imageClickAction(config, "gui")).toBe("inspect");
  definition.behavior.imageClickAction = "replace";
  definition.behavior.inlineEditable = false;
  expect(imageClickAction(environmentPreview(definition.id, definition), "gui")).toBe("inspect");
});

it("exports preview sizes/policy to XML and maps validated resource values to CSS", () => {
  const definition = cloneEnvironmentDefinitions().find(item => item.id === "table")!;
  Object.assign(definition.style, { tableExpandedFontSize: 22, tableEditorMaxHeight: 90, tableCellMaxHeightEm: 4, captionFontSize: 19 });
  definition.behavior.renderer = "table";
  expect(previewSizingStyle(environmentPreview(definition.id, definition).sizing)).toMatchObject({ "--preview-table-expanded-size": "22px", "--preview-table-editor-height": "90px", "--preview-table-cell-height": "4em", "--preview-caption-size": "19px" });
  expect(serializeEnvironments([definition])).toContain('tableExpandedFontSize="22"');
  expect(serializeEnvironments([definition])).toContain('renderer="table"');
  definition.style.tableEditorMaxHeight = NaN;
  expect(environmentPreview(definition.id, definition).sizing.tableEditorMaxHeight).toBe(180);
});

it("retains consecutive style and behavior edits while previous writes are being acknowledged", () => {
  const base = cloneEnvironmentDefinitions().find(item => item.id === "table")!;
  const size = { ...base, style: { ...base.style, titleFontSize: 32 } };
  const weight = { ...base, style: { ...base.style, titleFontWeight: 700 } };
  const merged = mergeEnvironmentEdit(base, weight, size);
  expect(merged.style).toMatchObject({ titleFontSize: 32, titleFontWeight: 700 });
  const acknowledged = mergeEnvironmentEdit(base, size, merged);
  expect(acknowledged.style.titleFontWeight).toBe(700);
  const caption = { ...base, behavior: { ...base.behavior, showCaption: false } };
  expect(mergeEnvironmentEdit(base, caption, merged)).toMatchObject({ style: { titleFontSize: 32, titleFontWeight: 700 }, behavior: { showCaption: false } });
});
