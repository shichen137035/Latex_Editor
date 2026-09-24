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
  return <aside className="figure-inspector" aria-label="Figure inspector"><header><div><small>IMAGE</small><strong>{figure.caption || image?.sourcePath || "Figure"}</strong></div><button onClick={onClose}>×</button></header>
    <div className="figure-inspector-tabs"><button className={!advanced ? "active" : ""} onClick={() => setAdvanced(false)}>Properties</button><button className={advanced ? "active" : ""} onClick={() => setAdvanced(true)}>Advanced</button></div>
    {advanced ? <textarea value={selection.source} spellCheck={false} onChange={(event) => onChange(event.target.value)}/> : <div className="figure-inspector-fields">
      {figure.partiallyEditable && <p className="figure-inspector-warning">Unknown LaTeX was preserved. Only supported fields are changed.</p>}
      {figure.images.length > 1 && <div className="figure-image-selector">{figure.images.map((item, index) => <button className={index === imageIndex ? "active" : ""} key={item.id} title={item.sourcePath} onClick={() => setImageIndex(index)}>{index + 1}</button>)}</div>}
      {image && <><label><span>Source</span><input value={image.sourcePath} onChange={(event) => patch({ imageIndex, sourcePath: event.target.value })}/></label>{onLocate && <button type="button" onClick={() => onLocate(imageIndex)}>Locate or replace image…</button>}<label><span>Width</span><input value={optionValue(image, "width") ?? ""} placeholder="0.8\\textwidth" onChange={(event) => patch({ imageIndex, width: event.target.value })}/></label><label><span>Height</span><input value={optionValue(image, "height") ?? ""} onChange={(event) => patch({ imageIndex, height: event.target.value })}/></label><label><span>Scale</span><input value={optionValue(image, "scale") ?? ""} onChange={(event) => patch({ imageIndex, scale: event.target.value })}/></label><label><span>Angle</span><input value={optionValue(image, "angle") ?? ""} onChange={(event) => patch({ imageIndex, angle: event.target.value })}/></label></>}
      {figure.environment !== "inline" && <><label><span>Placement</span><input value={figure.placement ?? ""} onChange={(event) => patch({ placement: event.target.value })}/></label><label><span>Alignment</span><select value={figure.alignment} onChange={(event) => patch({ alignment: event.target.value as typeof figure.alignment })}><option value="none">None</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label><span>Caption</span><input value={figure.caption ?? ""} onChange={(event) => patch({ caption: event.target.value })}/></label><label><span>Label</span><input value={figure.label ?? ""} onChange={(event) => patch({ label: event.target.value })}/></label></>}
    </div>}
  </aside>;
}
