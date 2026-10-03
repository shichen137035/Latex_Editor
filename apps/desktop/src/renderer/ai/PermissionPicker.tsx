import { useEffect, useRef, useState } from "react";
import type { AIPermissionMode } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";

const modes: AIPermissionMode[] = ["ask", "auto", "full"];

export function PermissionPicker({ value, disabled, onChange }: { value: AIPermissionMode; disabled: boolean; onChange(mode: AIPermissionMode): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <div className={`ai-permission-picker compact ${value}`} ref={root}>
    <button className="ai-permission-trigger" type="button" aria-label={`${t("ai.permissions")}: ${t(`ai.permission.${value}`)}`} aria-expanded={open} aria-haspopup="menu" disabled={disabled} title={t(`ai.permission.${value}`)} onClick={() => setOpen(!open)}><PermissionIcon mode={value}/><span>{t(`ai.permission.${value}`)}</span><span aria-hidden="true">⌄</span></button>
    {open && <div className="ai-permission-menu" role="menu" aria-label={t("ai.permissions")}>{modes.map(mode => <button key={mode} type="button" role="menuitemradio" aria-checked={value === mode} className={mode} onClick={() => { if (mode === "full" && value !== "full" && !window.confirm(t("ai.permission.full.confirm"))) return; onChange(mode); setOpen(false); }}><PermissionIcon mode={mode}/><span>{t(`ai.permission.${mode}`)}</span><span className="ai-permission-check" aria-hidden="true">{value === mode ? "✓" : ""}</span></button>)}</div>}
  </div>;
}

function PermissionIcon({ mode }: { mode: AIPermissionMode }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{mode === "full" ? <><path d="m12 3 8 4v6c0 4-8 8-8 8s-8-4-8-8V7Z"/><path d="M12 8v5m0 3h.01"/></> : mode === "auto" ? <><path d="m12 3 8 4v6c0 4-8 8-8 8s-8-4-8-8V7Z"/><path d="m8 12 3 3 5-6"/></> : <><circle cx="12" cy="12" r="9"/><path d="M12 16h.01M9 9a3 3 0 1 1 4 3l-1 1"/></>}</svg>;
}
