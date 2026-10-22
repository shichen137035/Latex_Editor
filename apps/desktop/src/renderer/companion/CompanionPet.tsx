import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useSettings } from "../settings/service.js";
import { t } from "../i18n/index.js";
import { commandBindings, commands, displayBinding } from "../settings/commands.js";
import { CompanionChat } from "./CompanionChat.js";
import "./companion.css";

const size = 64, margin = 16;
type Point = { x: number; y: number };
const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
const clamp = (point: Point, bounds: ReturnType<typeof viewport>): Point => ({
  x: Math.max(margin, Math.min(point.x, Math.max(margin, bounds.width - size - margin))),
  y: Math.max(margin, Math.min(point.y, Math.max(margin, bounds.height - size - 44)))
});

/** Global pet launcher; account state and conversation lifecycle live outside this view. */
export function CompanionPet({ disabled = false, onOpenSettings }: { disabled?: boolean; onOpenSettings(): void }) {
  const store = useSettings();
  const enabled = store.global("companionEnabled") && !disabled;
  const [open, setOpen] = useState(false);
  const [bounds, setBounds] = useState(viewport);
  const [position, setPosition] = useState<Point>();
  const root = useRef<HTMLElement>(null), launcher = useRef<HTMLButtonElement>(null), closer = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; start: Point; origin: Point; moved: boolean } | undefined>(undefined);
  const dragged = useRef(false);
  const point = clamp(position ?? { x: bounds.width - size - margin, y: bounds.height - size - 44 }, bounds);
  useEffect(() => {
    const resize = () => { const next = viewport(); setBounds(next); setPosition(current => current ? clamp(current, next) : undefined); };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => { if (!enabled) { setOpen(false); drag.current = undefined; } }, [enabled]);
  useEffect(() => commands.register("companion.chat", { when: () => enabled, execute: () => {
    setOpen(true);
    root.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  } }), [enabled]);
  useEffect(() => {
    if (!open) return;
    (root.current?.querySelector<HTMLTextAreaElement>("textarea") ?? closer.current)?.focus();
    const outside = (event: globalThis.PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation(); setOpen(false); launcher.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    root.current?.addEventListener("keydown", escape);
    const currentRoot = root.current;
    return () => { document.removeEventListener("pointerdown", outside); currentRoot?.removeEventListener("keydown", escape); };
  }, [open]);
  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    dragged.current = false;
    drag.current = { id: event.pointerId, start: { x: event.clientX, y: event.clientY }, origin: point, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) < 5) return;
    current.moved = true; dragged.current = true;
    setPosition(clamp({ x: current.origin.x + dx, y: current.origin.y + dy }, bounds));
  };
  if (!enabled) return null;
  const width = Math.min(440, Math.max(0, bounds.width - 2 * margin));
  const panelLeft = Math.max(margin, Math.min(point.x + size - width, bounds.width - width - margin));
  const panelAbove = point.y >= bounds.height / 2;
  return <aside className="companion-root" ref={root} aria-label={t("companion.title")}>
    {open && <section className="companion-panel" id="companion-panel" role="dialog" aria-label={t("companion.title")} style={{ left: panelLeft, width, maxHeight: Math.max(100, panelAbove ? point.y - 2 * margin : bounds.height - point.y - size - 2 * margin), ...(panelAbove ? { bottom: bounds.height - point.y + 12 } : { top: point.y + size + 12 }) }}>
      <header><strong>{t("companion.title")}</strong><button type="button" ref={closer} aria-label={t("common.close")} onClick={() => { setOpen(false); launcher.current?.focus(); }}>×</button></header>
      <small>{t("companion.globalChat")}</small>
      <CompanionChat onOpenSettings={onOpenSettings}/>
    </section>}
    <button type="button" ref={launcher} className="companion-pet" title={t("companion.hint", { shortcut: commandBindings("companion.chat").map(displayBinding).join(" / ") })} aria-label={t("companion.title")} aria-keyshortcuts={commandBindings("companion.chat").join(" ")} aria-expanded={open} aria-controls={open ? "companion-panel" : undefined}
      style={{ left: point.x, top: point.y }} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={event => { drag.current = undefined; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = undefined; dragged.current = true; }}
      onContextMenu={event => { event.preventDefault(); setOpen(true); root.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(); }}
      onClick={event => { if (dragged.current) { dragged.current = false; return; } if (event.detail === 0) setOpen(true); }}>
      <svg viewBox="0 0 64 64" aria-hidden="true"><path className="companion-ears" d="M10 25 9 7 27 17M54 25 55 7 37 17"/><rect className="companion-face" x="7" y="16" width="50" height="39" rx="17"/><rect className="companion-screen" x="14" y="24" width="36" height="21" rx="9"/><path className="companion-eyes" d="M24 32v4m16-4v4m-12 4q4 3 8 0"/><path className="companion-paws" d="M17 54v5m30-5v5"/></svg>
    </button>
  </aside>;
}
