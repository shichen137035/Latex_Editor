import { useEffect, useRef, useState, type CSSProperties } from "react";
import { t } from "../i18n/index.js";

type Effort = { effort: string };
type Props = { value: string; defaultEffort?: string | undefined; efforts: Effort[]; modelName: string; disabled: boolean; onChange(value: string): void };

export function ReasoningEffortPicker({ value, defaultEffort, efforts, modelName, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const label = (effort: string) => {
    const translated = t(`ai.effort.${effort}`);
    return translated === `ai.effort.${effort}` ? effort : translated;
  };
  const selectedLabel = value ? label(value) : t("ai.modelDefault");
  const effectiveEffort = value || defaultEffort || "medium";
  const defaultIndex = efforts.findIndex(option => option.effort === effectiveEffort);
  const sliderIndex = Math.max(0, defaultIndex);
  const sliderMax = Math.max(0, efforts.length - 1);
  const progress = sliderMax ? `${sliderIndex / sliderMax * 100}%` : "0%";

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setOpen(false);
      root.current?.querySelector<HTMLButtonElement>(".ai-effort-trigger")?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape, true); };
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  return <div className="ai-effort-picker" ref={root}>
    <button className="ai-effort-trigger" type="button" aria-label={`${t("ai.reasoningEffort")}: ${selectedLabel}`} aria-expanded={open} aria-haspopup="dialog" title={`${t("ai.reasoningEffort")}: ${selectedLabel}`} disabled={disabled || efforts.length === 0} onClick={() => setOpen(current => !current)}>
      <span>{selectedLabel}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && <div className="ai-effort-popover" role="dialog" aria-label={t("ai.reasoningEffort")}>
      <header className="ai-effort-heading">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.2 2.8 5.6 13h5.3l-.5 8.2L18.4 11h-5.3l.1-8.2Z"/></svg>
        <div><strong>{selectedLabel}</strong><small title={modelName}>{modelName} <span aria-hidden="true">›</span></small></div>
        <button className="ai-effort-reset" type="button" title={t("ai.modelDefault")} aria-label={`${t("ai.reasoningEffort")}: ${t("ai.modelDefault")}`} disabled={disabled || !value} onClick={() => { onChange(""); setOpen(false); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 1-2.35-5.65L20 8"/></svg>
        </button>
      </header>
      <div className="ai-effort-slider-wrap">
        <div className="ai-effort-slider-track" style={{ "--effort-progress": progress } as CSSProperties}/>
        <div className="ai-effort-ticks" aria-hidden="true">{efforts.map((option, index) => <i key={option.effort} className={index <= sliderIndex ? "active" : ""} style={{ left: `${sliderMax ? index / sliderMax * 100 : 0}%` }}/>)}</div>
        <input className="ai-effort-slider" type="range" min={0} max={sliderMax} step={1} value={sliderIndex} disabled={disabled || efforts.length < 2} aria-label={t("ai.reasoningEffort")} aria-valuetext={selectedLabel} onChange={event => { const option = efforts[Number(event.target.value)]; if (option) onChange(option.effort); }}/>
      </div>
    </div>}
  </div>;
}
