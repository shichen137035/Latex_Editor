import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n/index.js";

type Effort = { effort: string };
type Props = { value: string; defaultEffort?: string | undefined; efforts: Effort[]; modelName: string; disabled: boolean; onChange(value: string): void };
type PopoverPosition = { left: number; top: number; width: number; maxHeight: number };

export function ReasoningEffortPicker({ value, defaultEffort, efforts, modelName, disabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState<PopoverPosition>();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
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
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !popover.current?.contains(target)) setOpen(false);
    };
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

  useLayoutEffect(() => {
    if (!open) { setPopoverPosition(undefined); return; }
    const updatePosition = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(252, Math.max(0, window.innerWidth - 16));
      const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8));
      const height = popover.current?.offsetHeight ?? 112;
      const spaceAbove = anchor.top - 14;
      const spaceBelow = window.innerHeight - anchor.bottom - 14;
      const above = spaceAbove >= height || spaceAbove >= spaceBelow;
      const maxHeight = Math.max(76, (above ? spaceAbove : spaceBelow) - 8);
      const visibleHeight = Math.min(height, maxHeight);
      const top = above
        ? Math.max(8, anchor.top - visibleHeight - 8)
        : Math.min(window.innerHeight - visibleHeight - 8, anchor.bottom + 8);
      setPopoverPosition(current => current?.left === left && current.top === top && current.width === width && current.maxHeight === maxHeight
        ? current
        : { left, top, width, maxHeight });
    };
    updatePosition();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updatePosition);
    if (trigger.current) observer?.observe(trigger.current);
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, selectedLabel, modelName]);

  return <div className="ai-effort-picker" ref={root}>
    <button ref={trigger} className="ai-effort-trigger" type="button" aria-label={`${t("ai.reasoningEffort")}: ${selectedLabel}`} aria-expanded={open} aria-haspopup="dialog" title={`${t("ai.reasoningEffort")}: ${selectedLabel}`} disabled={disabled || efforts.length === 0} onClick={() => setOpen(current => !current)}>
      <span>{selectedLabel}</span><span aria-hidden="true">⌄</span>
    </button>
    {open && createPortal(<div ref={popover} className="ai-effort-popover" role="dialog" aria-label={t("ai.reasoningEffort")} style={{ ...(popoverPosition ?? {}), ...(!popoverPosition ? { visibility: "hidden" } : {}) } as CSSProperties}>
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
    </div>, document.body)}
  </div>;
}
