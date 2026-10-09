import { useEffect, useRef, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n/index.js";

export function TableEditorDialog({ children, toolbar, onClose, style }: { children: ReactNode; toolbar: ReactNode; onClose(): void; style?: CSSProperties }) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.querySelector<HTMLButtonElement>(".table-editor-close")?.focus();
    return () => { document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, []);
  return createPortal(<div className="table-editor-backdrop" onClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()}>
    <section ref={dialog} style={style} className="table-editor-dialog" role="dialog" aria-modal="true" aria-label={t("table.expandedEditor")} onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Tab") {
        const targets = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), textarea, input, select, [tabindex='0']") ?? []).filter(target => target.getClientRects().length);
        const first = targets[0], last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <header><h2>{t("table.expandedEditor")}</h2><button className="table-editor-close" type="button" aria-label={t("common.close")} title={t("common.close")} onClick={onClose}>×</button></header>
      {toolbar && <div className="table-editor-tools">{toolbar}</div>}
      <div className="table-editor-content">{children}</div>
    </section>
  </div>, document.body);
}
