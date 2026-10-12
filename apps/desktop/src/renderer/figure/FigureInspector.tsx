import { t } from "../i18n/index.js";
import { useEffect, useMemo, useState } from "react";
import { optionValue, parseFigure } from "./parser.js";
import { patchFigureSource } from "./patch.js";
import { defaultImagePreferences, type ImagePreferences } from "@latex-editor/contracts";
import { figureLayout, resizeFigureLayout, swapFigureSlots, FigureLayoutError, gridDimension, type SubfigureSyntax } from "./layout.js";
import { FigureAsset } from "./FigurePreview.js";

export interface FigureSelection { fileId: string; start: number; end: number; source: string; imageIndex?: number; environmentId?: string }

export function FigureInspector({ selection, onChange, onLocate, onClose, api, projectId = "", graphicPaths = [], preferences = defaultImagePreferences, syntax = "subfigure", editable = true }: { selection: FigureSelection; onChange(source: string): void | Promise<void>; onLocate?(imageIndex: number): void; onClose(): void; api?: Window["latexEditor"]; projectId?: string; graphicPaths?: string[]; preferences?: ImagePreferences; syntax?: SubfigureSyntax; editable?: boolean }) {
  const [advanced, setAdvanced] = useState(false);
  const [imageIndex, setImageIndex] = useState(selection.imageIndex ?? 0);
  const [rows, setRows] = useState(1), [columns, setColumns] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [dragFrom, setDragFrom] = useState<number>(), [dropTarget, setDropTarget] = useState<number>();
  useEffect(() => setImageIndex(selection.imageIndex ?? 0), [selection.fileId, selection.start, selection.imageIndex]);
  const figure = useMemo(() => parseFigure(selection.source), [selection.source]);
  const layout = useMemo(() => figureLayout(selection.source), [selection.source]);
  useEffect(() => { setRows(layout?.rows ?? 1); setColumns(layout?.columns ?? 1); setError(""); }, [selection.source, layout]);
  if (!figure) return null;
  const selectedImageIndex = Math.min(imageIndex, Math.max(0, figure.images.length - 1));
  const image = figure.images[selectedImageIndex];
  const report = (reason: unknown) => setError(reason instanceof FigureLayoutError ? t(reason.reason === "capacity" ? "image.layout.capacity" : "image.layout.complex") : reason instanceof Error ? reason.message : String(reason));
  const change = (next: string) => { if (!editable || busy) return; try { void Promise.resolve(onChange(next)).catch(report); } catch (reason) { report(reason); } };
  const patch = (value: Parameters<typeof patchFigureSource>[1]) => change(patchFigureSource(selection.source, { ...value, ...(value.imageIndex !== undefined ? { imageIndex: selectedImageIndex } : {}) }));
  const applyLayout = async (nextRows = rows, nextColumns = columns) => {
    if (!editable || busy) return;
    try { const next = resizeFigureLayout(selection.source, nextRows, nextColumns, preferences, syntax); setBusy(true); await onChange(next); }
    catch (reason) { report(reason); setRows(layout?.rows ?? 1); setColumns(layout?.columns ?? 1); }
    finally { setBusy(false); }
  };
  const move = (from: number, to: number) => {
    if (!editable || busy) return;
    try { change(swapFigureSlots(selection.source, from, to)); setImageIndex(to); }
    catch (reason) { report(reason); }
  };
  const selectedSlot = Math.max(0, layout?.slots.findIndex(slot => slot.imageIndex === selectedImageIndex) ?? 0);
  const dragType = "application/x-texweave-figure-slot";
  const layoutControls = <section className="figure-layout-controls" aria-label={t("image.layout.title")}><strong>{t("image.layout.title")}</strong><label><span>{t("image.layout.order")}</span><select disabled={!editable || busy || !layout?.supported} value={`${rows}x${columns}`} onChange={event => { const [r, c] = event.target.value.split("x").map(Number); setRows(r!); setColumns(c!); void applyLayout(r, c); }}>{!["1x1", "1x2", "2x1", "2x2", "2x3", "3x2", "3x3"].includes(`${rows}x${columns}`) && <option value={`${rows}x${columns}`}>{rows} × {columns}</option>}{[[1,1],[1,2],[2,1],[2,2],[2,3],[3,2],[3,3]].map(([r,c]) => <option value={`${r}x${c}`} key={`${r}x${c}`}>{r === 1 && c === 1 ? t("image.layout.single") : `${r} × ${c}`}</option>)}</select></label>
        <div className="figure-layout-dimensions"><label><span>{t("ui.ImageInsertDialog.rows")}</span><input aria-label={t("ui.ImageInsertDialog.rows")} type="number" min={1} max={6} value={rows} disabled={!editable || busy} onChange={event => setRows(gridDimension(Number(event.target.value)))}/></label><label><span>{t("ui.ImageInsertDialog.columns")}</span><input aria-label={t("ui.ImageInsertDialog.columns")} type="number" min={1} max={6} value={columns} disabled={!editable || busy} onChange={event => setColumns(gridDimension(Number(event.target.value)))}/></label><button type="button" className="primary" disabled={!editable || busy || !layout?.supported} onClick={() => void applyLayout()}>{t("image.layout.apply")}</button></div>
        {!layout?.supported && <p className="figure-inspector-warning">{t("image.layout.complex")}</p>}
        {layout?.supported && <><p className="figure-layout-hint">{t("image.layout.dragHint")}</p><div className="figure-layout-slots" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))` }}>{layout.slots.map((slot, index) => <div key={slot.range.start} className={`figure-layout-slot${index === selectedSlot ? " selected" : ""}${dragFrom === index ? " dragging" : ""}${dropTarget === index ? " drop-target" : ""}`} data-figure-inspector-slot={index} tabIndex={0} title={slot.image?.sourcePath || t("image.layout.empty")} draggable={editable && !busy && Boolean(slot.image?.sourcePath)} onClick={() => setImageIndex(slot.imageIndex)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setImageIndex(slot.imageIndex); } }} onDragStart={event => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(dragType, JSON.stringify({ projectId, texPath: selection.fileId, source: selection.source, index })); setDragFrom(index); }} onDragEnd={() => { setDragFrom(undefined); setDropTarget(undefined); }} onDragOver={event => { if (editable && !busy && event.dataTransfer.types.includes(dragType)) { event.preventDefault(); event.stopPropagation(); setDropTarget(index); } }} onDragLeave={() => setDropTarget(undefined)} onDrop={event => {
          if (!editable || busy || !event.dataTransfer.types.includes(dragType)) return;
          event.preventDefault(); event.stopPropagation(); setDragFrom(undefined); setDropTarget(undefined);
          try { const value = JSON.parse(event.dataTransfer.getData(dragType)) as { projectId: string; texPath: string; source: string; index: number }; if (value.projectId === projectId && value.texPath === selection.fileId && value.source === selection.source && Number.isInteger(value.index)) move(value.index, index); } catch { /* Ignore foreign drag data. */ }
        }}><span className="figure-layout-slot-number">{index + 1}</span>{api && slot.image ? <FigureAsset api={api} projectId={projectId} texPath={selection.fileId} sourcePath={slot.image.sourcePath} graphicPaths={graphicPaths} width={undefined} {...(onLocate && editable ? { onChoose: () => onLocate(slot.imageIndex) } : {})}/> : <span>{slot.image?.sourcePath || t("image.layout.empty")}</span>}{editable && slot.image?.sourcePath && <button type="button" className="figure-layout-slot-remove" aria-label={t("image.layout.remove")} title={t("image.layout.remove")} onClick={event => { event.stopPropagation(); change(patchFigureSource(selection.source, { imageIndex: slot.imageIndex, sourcePath: "" })); setImageIndex(slot.imageIndex); }}>×</button>}</div>)}</div>{layout.slots.length > 1 && <label><span>{t("image.layout.position")}</span><select aria-label={t("image.layout.position")} value={selectedSlot} disabled={!editable || busy} onChange={event => move(selectedSlot, Number(event.target.value))}>{layout.slots.map((_, index) => <option value={index} key={index}>{Math.floor(index / layout.columns) + 1}, {index % layout.columns + 1}</option>)}</select></label>}</>}
        {error && <p className="figure-inspector-warning" role="alert">{error}</p>}
      </section>;
  return <aside className="figure-inspector" aria-label={t("ui.FigureInspector.figure_inspector")}><header><div><small>{t("ui.FigureInspector.image")}</small><strong>{figure.caption || image?.sourcePath || t("environment.figure")}</strong></div><button onClick={onClose}>×</button></header>
    <div className="figure-inspector-tabs"><button className={!advanced ? "active" : ""} onClick={() => setAdvanced(false)}>{t("ui.FigureInspector.properties")}</button><button className={advanced ? "active" : ""} onClick={() => setAdvanced(true)}>{t("settings.advanced")}</button></div>
    {advanced ? <textarea value={selection.source} readOnly={!editable} spellCheck={false} onChange={(event) => change(event.target.value)}/> : <fieldset className="figure-inspector-fields" disabled={!editable || busy} data-read-only={!editable}>
      {figure.partiallyEditable && <p className="figure-inspector-warning">{t("ui.FigureInspector.unknown_latex_was_preserved_only_supported_fields")}</p>}
      {figure.images.length > 1 && <div className="figure-image-selector">{figure.images.map((item, index) => <button className={index === selectedImageIndex ? "active" : ""} key={item.id} title={item.sourcePath} onClick={() => setImageIndex(index)}>{index + 1}</button>)}</div>}
      {image && <><label><span>{t("shortcut.source")}</span><input value={image.sourcePath} onChange={(event) => patch({ imageIndex, sourcePath: event.target.value })}/></label>{onLocate && <button type="button" onClick={() => onLocate(selectedImageIndex)}>{t("ui.FigureInspector.locate_or_replace_image")}</button>}{layoutControls}<label><span>{t("ui.FigureInspector.width")}</span><input value={optionValue(image, "width") ?? ""} placeholder="0.8\\textwidth" onChange={(event) => patch({ imageIndex, width: event.target.value })}/></label><label><span>{t("ui.FigureInspector.height")}</span><input value={optionValue(image, "height") ?? ""} onChange={(event) => patch({ imageIndex, height: event.target.value })}/></label><label><span>{t("ui.FigureInspector.scale")}</span><input value={optionValue(image, "scale") ?? ""} onChange={(event) => patch({ imageIndex, scale: event.target.value })}/></label><label><span>{t("ui.FigureInspector.angle")}</span><input value={optionValue(image, "angle") ?? ""} onChange={(event) => patch({ imageIndex, angle: event.target.value })}/></label></>}
      {figure.environment !== "inline" && <><label><span>{t("ui.FigureInspector.placement")}</span><input value={figure.placement ?? ""} onChange={(event) => patch({ placement: event.target.value })}/></label><label><span>{t("ui.FigureInspector.alignment")}</span><select value={figure.alignment} onChange={(event) => patch({ alignment: event.target.value as typeof figure.alignment })}><option value="none">{t("ai.effort.none")}</option><option value="left">{t("ui.FigureInspector.left")}</option><option value="center">{t("ui.FigureInspector.center")}</option><option value="right">{t("ui.FigureInspector.right")}</option></select></label><label><span>{t("ui.FigureInspector.caption")}</span><input value={figure.caption ?? ""} onChange={(event) => patch({ caption: event.target.value })}/></label><label><span>{t("relation.label")}</span><input value={figure.label ?? ""} onChange={(event) => patch({ label: event.target.value })}/></label></>}
      {!image && layoutControls}
    </fieldset>}
  </aside>;
}
