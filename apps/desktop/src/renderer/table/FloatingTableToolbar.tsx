import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

export function FloatingTableToolbar({ anchor, children }: { anchor: RefObject<HTMLElement | null>; children: ReactNode }) {
  const toolbar = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number; visible: boolean }>();
  useLayoutEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const target = anchor.current, tools = toolbar.current;
      if (!target || !tools) return;
      const block = target.closest<HTMLElement>(".preview-block") ?? target;
      const bounds = block.getBoundingClientRect();
      tools.style.maxWidth = `${Math.min(window.innerWidth - 16, bounds.width)}px`;
      const size = tools.getBoundingClientRect();
      // Anchor above the whole block, including its heading. Do not clamp down
      // onto the heading when the block scrolls past the top of the viewport.
      const top = bounds.top - size.height - 12;
      const next = { left: Math.max(8, Math.min(window.innerWidth - size.width - 8, bounds.left + (bounds.width - size.width) / 2)), top, visible: top + size.height > 0 && bounds.top < window.innerHeight };
      setPosition(previous => previous?.left === next.left && previous.top === next.top && previous.visible === next.visible ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    if (anchor.current) observer.observe(anchor.current);
    const block = anchor.current?.closest<HTMLElement>(".preview-block");
    if (block) observer.observe(block);
    if (toolbar.current) observer.observe(toolbar.current);
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    update();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("scroll", schedule, true); window.removeEventListener("resize", schedule); };
  }, [anchor]);
  return createPortal(<div ref={toolbar} className="table-floating-tools" style={{ left: position?.left ?? 8, top: position?.top ?? 8, visibility: position?.visible ? "visible" : "hidden" }} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>{children}</div>, document.body);
}
