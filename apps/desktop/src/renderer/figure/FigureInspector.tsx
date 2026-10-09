import { t } from "../i18n/index.js";
import { useEffect, useMemo, useState } from "react";
import { optionValue, parseFigure } from "./parser.js";
import { patchFigureSource } from "./patch.js";

export interface FigureSelection { fileId: string; start: number; end: number; source: string; imageIndex?: number }

export function FigureInspector({ selection, onChange, onLocate, onClose }: { selection: FigureSelection; onChange(source: string): void; onLocate?(imageIndex: number): void; onClose(): void }) {
  const [advanced, setAdvanced] = useState(false);
  const [imageIndex, setImageIndex] = useState(selection.imageIndex ?? 0);
  useEffect(() => setImageIndex(selection.imageIndex ?? 0), [selection.fileId, selection.start, selection.imageIndex]);
  const figure = useMemo(() => parseFigure(selection.source), [selection.source]);
  if (!figure) return null;
  const image = figure.images[Math.min(imageIndex, Math.max(0, figure.images.length - 1))];
  const patch = (value: Parameters<typeof patchFigureSource>[1]) => onChange(patchFigureSource(selection.source, value));
  return <aside className="figure-inspector" aria-label={t("ui.FigureInspector.figure_inspector")}><header><div><small>{t("ui.FigureInspector.image")}</small><strong>{figure.caption || image?.sourcePath || t("environment.figure")}</strong></div><button onClick={onClose}>×</button></header>
    <div className="figure-inspector-tabs"><button className={!advanced ? "active" : ""} onClick={() => setAdvanced(false)}>{t("ui.FigureInspector.properties")}</button><button className={advanced ? "active" : ""} onClick={() => setAdvanced(true)}>{t("settings.advanced")}</button></div>
    {advanced ? <textarea value={selection.source} spellCheck={false} onChange={(event) => onChange(event.target.value)}/> : <div className="figure-inspector-fields">
      {figure.partiallyEditable && <p className="figure-inspector-warning">{t("ui.FigureInspector.unknown_latex_was_preserved_only_supported_fields")}</p>}
      {figure.images.length > 1 && <div className="figure-image-selector">{figure.images.map((item, index) => <button className={index === imageIndex ? "active" : ""} key={item.id} title={item.sourcePath} onClick={() => setImageIndex(index)}>{index + 1}</button>)}</div>}
      {image && <><label><span>{t("shortcut.source")}</span><input value={image.sourcePath} onChange={(event) => patch({ imageIndex, sourcePath: event.target.value })}/></label>{onLocate && <button type="button" onClick={() => onLocate(imageIndex)}>{t("ui.FigureInspector.locate_or_replace_image")}</button>}<label><span>{t("ui.FigureInspector.width")}</span><input value={optionValue(image, "width") ?? ""} placeholder="0.8\\textwidth" onChange={(event) => patch({ imageIndex, width: event.target.value })}/></label><label><span>{t("ui.FigureInspector.height")}</span><input value={optionValue(image, "height") ?? ""} onChange={(event) => patch({ imageIndex, height: event.target.value })}/></label><label><span>{t("ui.FigureInspector.scale")}</span><input value={optionValue(image, "scale") ?? ""} onChange={(event) => patch({ imageIndex, scale: event.target.value })}/></label><label><span>{t("ui.FigureInspector.angle")}</span><input value={optionValue(image, "angle") ?? ""} onChange={(event) => patch({ imageIndex, angle: event.target.value })}/></label></>}
      {figure.environment !== "inline" && <><label><span>{t("ui.FigureInspector.placement")}</span><input value={figure.placement ?? ""} onChange={(event) => patch({ placement: event.target.value })}/></label><label><span>{t("ui.FigureInspector.alignment")}</span><select value={figure.alignment} onChange={(event) => patch({ alignment: event.target.value as typeof figure.alignment })}><option value="none">{t("ai.effort.none")}</option><option value="left">{t("ui.FigureInspector.left")}</option><option value="center">{t("ui.FigureInspector.center")}</option><option value="right">{t("ui.FigureInspector.right")}</option></select></label><label><span>{t("ui.FigureInspector.caption")}</span><input value={figure.caption ?? ""} onChange={(event) => patch({ caption: event.target.value })}/></label><label><span>{t("relation.label")}</span><input value={figure.label ?? ""} onChange={(event) => patch({ label: event.target.value })}/></label></>}
    </div>}
  </aside>;
}
