import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n/index.js";

/** Render outside the scroll container so the last project's menu cannot be clipped. */
export function DirectoryActionMenu({ point, children, onClose }: { point: { x: number; y: number }; children: ReactNode; onClose(): void }) {
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(point);
  useLayoutEffect(() => {
    const menu = root.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    setPosition({ x: Math.max(8, Math.min(point.x, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(point.y, window.innerHeight - rect.height - 8)) });
  }, [point]);
  useLayoutEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest(".project-action-menu, .directory-more")) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", onClose);
    return () => { document.removeEventListener("pointerdown", dismiss); window.removeEventListener("keydown", escape); window.removeEventListener("resize", onClose); };
  }, [onClose]);
  return createPortal(<div ref={root} className="project-action-menu directory-action-menu" role="menu" aria-label={t("directory.moreActions")} style={{ left: position.x, top: position.y }}>{children}</div>, document.body);
}
