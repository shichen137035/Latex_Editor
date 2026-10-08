import { useState } from "react";
import { readCollapsedOutline, writeCollapsedOutline } from "../collapseState.js";
import "./outline-list.css";

type OutlineItem = { title: string; level: number; line: number };

type OutlineRow = OutlineItem & { id: string; hasChildren: boolean; hidden: boolean };

function buildRows(items: OutlineItem[], collapsed: ReadonlySet<string>): OutlineRow[] {
  const ancestors: Array<{ id: string; level: number }> = [];
  const siblingCounts = new Map<string, number>();

  return items.map((item, index) => {
    while (ancestors.length > 0 && ancestors[ancestors.length - 1]!.level >= item.level) {
      ancestors.pop();
    }

    const parentId = ancestors[ancestors.length - 1]?.id ?? "";
    const siblingKey = JSON.stringify([parentId, item.level, item.title]);
    const occurrence = siblingCounts.get(siblingKey) ?? 0;
    siblingCounts.set(siblingKey, occurrence + 1);
    const id = `${siblingKey}:${occurrence}`;
    const hidden = ancestors.some((ancestor) => collapsed.has(ancestor.id));
    const hasChildren = index + 1 < items.length && items[index + 1]!.level > item.level;
    ancestors.push({ id, level: item.level });

    return { ...item, id, hidden, hasChildren };
  });
}

export function OutlineList({ items, projectId, filePath, onNavigate }: { items: OutlineItem[]; projectId: string; filePath: string; onNavigate(line: number): void }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsedOutline(projectId, filePath));
  const rows = buildRows(items, collapsed);

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeCollapsedOutline(projectId, filePath, next);
      return next;
    });
  };

  return <div className="outline-list">
    {rows.filter((row) => !row.hidden).map((row) => <div className="outline-row" key={row.id} style={{ paddingLeft: Math.max(0, row.level) * 15 }}>
      {row.hasChildren
        ? <button type="button" className="outline-toggle" aria-label={row.title} aria-expanded={!collapsed.has(row.id)} onClick={() => toggle(row.id)}>{collapsed.has(row.id) ? "▸" : "▾"}</button>
        : <span className="outline-toggle-spacer" aria-hidden="true" />}
      <button type="button" className="outline-title" title={row.title} onClick={() => onNavigate(row.line)}>{row.title}</button>
    </div>)}
  </div>;
}
