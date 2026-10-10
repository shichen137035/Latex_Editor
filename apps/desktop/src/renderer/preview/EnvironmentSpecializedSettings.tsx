import { useEffect, useState } from "react";
import { t, type MessageKey } from "../i18n/index.js";
import type { EnvironmentBehavior, EnvironmentDefinition } from "./types.js";
import { environmentPreview, imageClickActions, previewNumericFields, previewRenderers, tableToolbarModes, validPreviewNumber, type PreviewNumericField } from "./environment-preview.js";

function PreviewNumber({ field, value, onChange }: { field: PreviewNumericField; value: number; onChange(value: number): void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => { const number = Number(draft); if (draft.trim() && validPreviewNumber(field, number)) onChange(number); else setDraft(String(value)); };
  return <input type="number" name={field} {...previewNumericFields[field]} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); commit(); } }}/>;
}

/** Specialized controls stay available at the bottom without crowding ordinary environment settings. */
export function EnvironmentSpecializedSettings({ definition, onChange }: { definition: EnvironmentDefinition; onChange(definition: EnvironmentDefinition): void }) {
  const configuration = environmentPreview(definition.id, definition);
  const updateBehavior = (patch: Partial<EnvironmentBehavior>) => onChange({ ...definition, behavior: { ...definition.behavior, ...patch } });
  const flag = (key: "showCaption" | "captionEditable" | "allowExpandedEditor" | "expandedToolbar" | "listItemEditing" | "listShowCount") => <label><span>{t(`environment.preview.${key}`)}</span><input type="checkbox" name={key} checked={configuration.behavior[key]} onChange={event => updateBehavior({ [key]: event.target.checked })}/></label>;
  const number = (field: PreviewNumericField) => <label key={field}><span>{t(`environment.preview.${field}` as MessageKey)}</span><PreviewNumber field={field} value={configuration.sizing[field]} onChange={value => onChange({ ...definition, style: { ...definition.style, [field]: value } })}/></label>;
  return <div className="environment-specialized-settings">
    <details data-preview-kind="advanced"><summary>{t("environment.preview.advanced")}</summary><div className="environment-specialized-body">
    <label><span>{t("environment.preview.renderer")}</span><select name="renderer" value={configuration.behavior.renderer} onChange={event => updateBehavior({ renderer: event.target.value as NonNullable<EnvironmentBehavior["renderer"]> })}>{previewRenderers.map(renderer => <option key={renderer} value={renderer}>{t(`environment.preview.renderer.${renderer}`)}</option>)}</select></label>
    <details data-preview-kind="list"><summary>{t("environment.preview.list")}</summary><div className="environment-form-grid">
      <label><span>{t("environment.preview.listStyle")}</span><select name="listStyle" value={configuration.behavior.listStyle} onChange={event => updateBehavior({ listStyle: event.target.value as NonNullable<EnvironmentBehavior["listStyle"]> })}>{["unordered", "ordered", "description"].map(value => <option key={value} value={value}>{t("environment.preview.listStyle." + value)}</option>)}</select></label>
      <label><span>{t("environment.preview.listMarker")}</span><select name="listMarker" value={configuration.behavior.listMarker} onChange={event => updateBehavior({ listMarker: event.target.value as NonNullable<EnvironmentBehavior["listMarker"]> })}>{["decimal", "lower-alpha", "lower-roman", "disc", "circle", "square", "none"].map(value => <option key={value} value={value}>{t("environment.preview.listMarker." + value)}</option>)}</select></label>
      <label><span>{t("environment.preview.listItemCommand")}</span><input name="listItemCommand" value={configuration.behavior.listItemCommand} onChange={event => { if (/^[A-Za-z@]+$/.test(event.target.value)) updateBehavior({ listItemCommand: event.target.value }); }}/></label>
      {flag("listItemEditing")}{flag("listShowCount")}
      <label><span>{t("environment.preview.blockHandler")}</span><input name="blockHandler" value={configuration.behavior.blockHandler || (configuration.renderer === "list" ? "builtin.list" : "")} onChange={event => { if (/^[a-zA-Z0-9._-]*$/.test(event.target.value)) updateBehavior({ blockHandler: event.target.value }); }}/></label>
    </div></details>
    <details data-preview-kind="figure"><summary>{t("environment.preview.figure")}</summary><div className="environment-form-grid">
      {flag("showCaption")}{flag("captionEditable")}
      <label><span>{t("environment.preview.imageClickAction")}</span><select name="imageClickAction" value={configuration.behavior.imageClickAction} onChange={event => updateBehavior({ imageClickAction: event.target.value as NonNullable<EnvironmentBehavior["imageClickAction"]> })}>{imageClickActions.map(action => <option key={action} value={action}>{t(`environment.preview.action.${action}`)}</option>)}</select></label>
      {(["captionFontSize", "imageMaxHeightVh", "imageGridMinWidth", "imageGridGap"] as const).map(number)}
    </div></details>
    <details data-preview-kind="table"><summary>{t("environment.preview.table")}</summary><div className="environment-form-grid">
      {flag("showCaption")}{flag("captionEditable")}{flag("allowExpandedEditor")}{flag("expandedToolbar")}
      <label><span>{t("environment.preview.tableToolbar")}</span><select name="tableToolbar" value={configuration.behavior.tableToolbar} onChange={event => updateBehavior({ tableToolbar: event.target.value as NonNullable<EnvironmentBehavior["tableToolbar"]> })}>{tableToolbarModes.map(mode => <option key={mode} value={mode}>{t(`environment.preview.toolbar.${mode}`)}</option>)}</select></label>
      {(["captionFontSize", "tableCellMaxHeightEm", "tableEditorMaxHeight", "tableExpandedFontSize"] as const).map(number)}
    </div></details>
    </div></details>
  </div>;
}
