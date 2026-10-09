import { useEffect, useRef, useState } from "react";
import { t } from "../i18n/index.js";
import { DirectoryIcon } from "./DirectoryIcon.js";

type Sort = "lastOpened" | "name" | "dateAdded" | "size";
const options: Sort[] = ["lastOpened", "name", "dateAdded", "size"];

export function DirectorySortMenu({ value, onChange }: { value: Sort; onChange(value: Sort): void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return <div ref={root} className="directory-sort-menu" onKeyDown={(event) => {
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    if (open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const items = Array.from(root.current!.querySelectorAll<HTMLButtonElement>("[role=menuitemradio]"));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }}>
    <button ref={trigger} className="directory-sort-trigger" aria-label={t("directory.sort")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
      <DirectoryIcon name="sort"/><span>{t(`directory.sort.${value}`)}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    {open && <div className="directory-sort-options" role="menu" aria-label={t("directory.sort")}>
      {options.map(option => <button key={option} role="menuitemradio" aria-checked={option === value} onClick={() => { onChange(option); setOpen(false); trigger.current?.focus(); }}>
        <span>{t(`directory.sort.${option}`)}</span>{option === value && <DirectoryIcon name="selected"/>}
      </button>)}
    </div>}
  </div>;
}
