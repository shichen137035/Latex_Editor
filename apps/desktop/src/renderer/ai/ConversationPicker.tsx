import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AIConversation } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";

type Props = {
  conversations: AIConversation[];
  activeId?: string | undefined;
  disabled: boolean;
  protectedId?: string | undefined;
  onSelect(id: string): void;
  onNew(): void;
  onRename(id: string, title: string): Promise<void>;
  onDelete(ids: string[]): Promise<void>;
};

export function ConversationPicker(props: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [placement, setPlacement] = useState({ left: 0, top: 0, width: 0, maxHeight: 380 });
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const active = props.conversations.find((item) => item.id === props.activeId);
  const canDelete = (item: AIConversation) => item.id !== props.protectedId && !item.messages.some((message) => message.status === "streaming");
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return props.conversations.filter((item) => !term || item.title.toLocaleLowerCase().includes(term)).slice().sort((a, b) => b.updatedAt - a.updatedAt);
  }, [props.conversations, query]);
  const selectedIds = props.conversations.filter((item) => selected.has(item.id) && canDelete(item)).map((item) => item.id);
  const visibleIds = filtered.filter(canDelete).map((item) => item.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const bounds = root.current?.getBoundingClientRect();
      if (!bounds) return;
      const height = Math.min(380, window.innerHeight - 24);
      const spaceBelow = window.innerHeight - bounds.bottom - 16;
      const above = spaceBelow < 220 && bounds.top > spaceBelow;
      setPlacement({ left: Math.max(8, Math.min(bounds.left, window.innerWidth - bounds.width - 8)), width: bounds.width, top: above ? Math.max(8, bounds.top - height - 6) : bounds.bottom + 6, maxHeight: above ? Math.min(height, bounds.top - 14) : Math.max(160, Math.min(height, spaceBelow)) });
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    search.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (confirmIds.length) setConfirmIds([]);
      else { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open, confirmIds.length]);

  const requestDelete = (ids: string[]) => { setError(""); setConfirmIds(ids); };
  const remove = async () => {
    if (deleting || !confirmIds.length) return;
    setDeleting(true); setError("");
    try {
      await props.onDelete(confirmIds);
      setSelected((current) => new Set([...current].filter((id) => !confirmIds.includes(id))));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeleting(false); setConfirmIds([]); }
  };
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const week = new Date(today); week.setDate(today.getDate() - 6);
  const groups = [
    { key: "today", items: filtered.filter((item) => item.updatedAt >= today.getTime()) },
    { key: "yesterday", items: filtered.filter((item) => item.updatedAt >= yesterday.getTime() && item.updatedAt < today.getTime()) },
    { key: "week", items: filtered.filter((item) => item.updatedAt >= week.getTime() && item.updatedAt < yesterday.getTime()) },
    { key: "older", items: filtered.filter((item) => item.updatedAt < week.getTime()) }
  ];
  const title = (item: AIConversation) => item.title === "New chat" ? t("ai.newChat") : item.title;
  const rename = async () => {
    if (!active || !name.trim() || saving) return;
    setSaving(true); setError("");
    try { await props.onRename(active.id, name.trim()); setRenaming(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  return <div className="ai-conversation-management" ref={root}>
    <div className="ai-conversation-toolbar">
    <button ref={trigger} className="ai-history-trigger" type="button" aria-label={t("ai.history.manage")} aria-expanded={open} aria-haspopup="dialog" disabled={deleting} onClick={() => { setConfirmIds([]); setError(""); setOpen(!open); }}>
      <span>{active ? title(active) : t("ai.recentChats")}</span><small>{props.conversations.length}</small><span aria-hidden="true">⌄</span>
    </button>
    <button className="ai-rename-chat" type="button" aria-label={t("ai.renameChat")} title={t("ai.renameChat")} disabled={props.disabled || deleting || !active} onClick={() => { setOpen(false); setName(active?.title ?? ""); setError(""); setRenaming(!renaming); }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z M13 6l5 5"/></svg></button>
    <button className="ai-new-chat" type="button" aria-label={t("ai.newChat")} title={t("ai.newChat")} disabled={props.disabled || deleting} onClick={() => { setOpen(false); setRenaming(false); props.onNew(); }}><span aria-hidden="true">+</span> {t("ai.newConversationShort")}</button>
    </div>
    {renaming && <form className="ai-rename-form" onSubmit={event => { event.preventDefault(); void rename(); }}><input autoFocus maxLength={120} aria-label={t("ai.conversationName")} value={name} onFocus={event => event.target.select()} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setRenaming(false); } }}/><button type="submit" disabled={saving || !name.trim()} title={t("common.save")} aria-label={t("common.save")}>✓</button><button type="button" disabled={saving} aria-label={t("project.cancel")} onClick={() => setRenaming(false)}>×</button>{error && <small role="alert">{error}</small>}</form>}
    {open && createPortal(<section ref={panel} className="ai-history-panel" role="dialog" aria-label={t("ai.history.manage")} style={placement}>
      <header><strong>{t("ai.history.manage")}</strong><button type="button" className="ai-history-close" aria-label={t("ai.history.close")} onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button></header>
      <input ref={search} type="search" className="ai-history-search" placeholder={t("ai.history.search")} aria-label={t("ai.history.search")} value={query} onChange={(event) => { setQuery(event.target.value); setConfirmIds([]); }}/>
      <div className="ai-history-list">
        {!filtered.length && <p className="ai-history-empty">{t("ai.history.empty")}</p>}
        {groups.filter((group) => group.items.length).map((group) => <div key={group.key} className="ai-history-group"><h3>{t(`ai.history.${group.key}`)}</h3>{group.items.map((item) => <div key={item.id} className={`ai-history-row${item.id === props.activeId ? " active" : ""}`}>
          <input type="checkbox" aria-label={t("ai.history.select", { title: title(item) })} checked={selected.has(item.id)} disabled={deleting || !canDelete(item)} onChange={() => toggle(item.id)}/>
          <button type="button" className="ai-history-open" disabled={deleting || props.disabled} title={title(item)} onClick={() => { props.onSelect(item.id); setOpen(false); trigger.current?.focus(); }}><strong>{title(item)}</strong><span><time dateTime={new Date(item.updatedAt).toISOString()}>{new Date(item.updatedAt).toLocaleDateString(document.documentElement.lang || undefined, { month: "short", day: "numeric" })}</time> · {t("ai.history.messages", { count: item.messages.filter((message) => message.role === "user").length })}</span></button>
          <button type="button" className="ai-history-delete" aria-label={t("ai.history.deleteOne", { title: title(item) })} title={t("ai.history.delete")} disabled={deleting || !canDelete(item)} onClick={() => requestDelete([item.id])}><TrashIcon/></button>
        </div>)}</div>)}
      </div>
      {error && <p className="ai-history-error" role="alert">{error}</p>}
      {confirmIds.length ? <div className="ai-history-confirm" role="alert"><p>{t("ai.history.confirm", { count: confirmIds.length })}</p><div><button type="button" disabled={deleting} onClick={() => setConfirmIds([])}>{t("ai.history.cancel")}</button><button type="button" className="ai-history-danger" disabled={deleting} onClick={() => void remove()}>{t(deleting ? "ai.history.deleting" : "ai.history.delete")}</button></div></div> : <footer><label><input type="checkbox" checked={allVisibleSelected} disabled={deleting || !visibleIds.length} onChange={() => setSelected((current) => { const next = new Set(current); for (const id of visibleIds) { if (allVisibleSelected) next.delete(id); else next.add(id); } return next; })}/>{t("ai.history.selectAll")}</label><button type="button" className="ai-history-danger" disabled={deleting || !selectedIds.length} onClick={() => requestDelete(selectedIds)}>{t("ai.history.deleteSelected", { count: selectedIds.length })}</button></footer>}
    </section>, document.body)}
  </div>;
}

function TrashIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/></svg>;
}
