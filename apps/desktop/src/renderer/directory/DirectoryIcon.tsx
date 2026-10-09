import type { ReactNode } from "react";

export type DirectoryIconName = "favorite" | "pin" | "selected" | "unchecked" | "more" | "previous" | "next" | "open" | "folder" | "locate" | "copy" | "rename" | "remove" | "delete" | "library" | "ascending" | "descending" | "compact" | "comfortable" | "close" | "sort";
const paths: Record<DirectoryIconName, ReactNode> = {
    favorite: <path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>,
    pin: <g transform="rotate(35 12 12)"><path d="M8 3h8M9 3v6l-3 4v2h12v-2l-3-4V3M12 15v6"/></g>,
    selected: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
    unchecked: <rect x="4" y="4" width="16" height="16" rx="3"/>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/></>,
    previous: <path d="m14 6-6 6 6 6"/>, next: <path d="m10 6 6 6-6 6"/>,
    open: <><path d="M14 3h7v7M21 3l-10 10M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/></>,
    folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>,
    locate: <><path d="M3 6V4h6l3 3h8v5M3 6v14h8"/><circle cx="16" cy="16" r="4"/><path d="m19 19 3 3"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></>,
    rename: <><path d="m4 15 11-11 5 5-11 11-6 1zM13 6l5 5"/></>,
    remove: <><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 12h10"/></>,
    delete: <><path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></>,
    library: <><path d="M4 3h4v18H4zM11 3h4v18h-4zM18 4l3 16"/></>,
    ascending: <path d="M12 20V4m-5 5 5-5 5 5"/>, descending: <path d="M12 4v16m-5-5 5 5 5-5"/>,
    compact: <path d="M4 5h16M4 10h16M4 15h16M4 20h16"/>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    sort: <path d="M8 4v16M5 7l3-3 3 3M16 20V4m-3 13 3 3 3-3"/>,
    comfortable: <><rect x="4" y="3" width="16" height="7" rx="1"/><rect x="4" y="14" width="16" height="7" rx="1"/></>
  };
export function DirectoryIcon({ name }: { name: DirectoryIconName }) {
  return <svg className={`directory-icon directory-icon-${name}`} aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

export function DirectoryCheckbox({ checked, label, onChange }: { checked: boolean; label: string; onChange(checked: boolean): void }) {
  return <label className={`directory-check${checked ? " checked" : ""}`} onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={label} checked={checked} onChange={event => onChange(event.target.checked)}/><DirectoryIcon name={checked ? "selected" : "unchecked"}/></label>;
}
