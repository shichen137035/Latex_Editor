import { useState } from "react";
import type { AIChangeSet } from "@latex-editor/contracts";
import { isAIStructureMetadataPath } from "@latex-editor/contracts/ai-paths";
import { t } from "../i18n/index.js";
import { hunkLineStats, isHunkApplied, pendingHunkIds } from "./changeOperations.js";

type Props = { changes: AIChangeSet; fileStats?: Record<string, { added: number; removed: number }>; busy: boolean; onKeep(ids: string[]): void; onDiscard(ids: string[]): void; onView(path: string): void; onDismiss(): void };
export function ChangesCard({ changes, fileStats, busy, onKeep, onDiscard, onView, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedPath, setExpandedPath] = useState<string>();
  const files = changes.files.filter(file => pendingHunkIds(file).length);
  const pending = files.flatMap(file => file.hunks.filter(hunk => hunk.decision === "pending"));
  const applied = pending.filter(isHunkApplied).map(hunk => hunk.id);
  const unapplied = pending.filter(hunk => !isHunkApplied(hunk)).map(hunk => hunk.id);
  return <section className="ai-change-set">
    <header><strong>{t(applied.length ? "ai.editedFiles" : "ai.proposedChanges", { count: files.length })}</strong><div>
      {applied.length === 0 && unapplied.length > 0 && <button data-action="accept-all" disabled={busy} onClick={() => onKeep(unapplied)}>{t("ai.keepAll")}</button>}
      {applied.length > 0 && <button data-action="undo" disabled={busy} onClick={() => onDiscard(applied)}>{t("ai.undoChanges")}</button>}
      {unapplied.length > 0 && <button data-action="reject-all" disabled={busy} onClick={() => onDiscard(unapplied)}>{t("ai.rejectAll")}</button>}
      <button data-action="view-changes" disabled={!files.length} onClick={() => files[0] && onView(files[0].path)}>{t("ai.viewChanges")}</button>
      {applied.length > 0 && unapplied.length === 0 && <button className="ai-dismiss-report" data-action="dismiss-report" disabled={busy} title={t("ai.clearChangeReport")} aria-label={t("ai.clearChangeReport")} onClick={onDismiss}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button>}
    </div></header>
    {changes.autoApplyError && <p className="ai-change-error" role="alert">{t("ai.autoApplyConflict")} {changes.autoApplyError}</p>}
    {files.some((file) => isAIStructureMetadataPath(file.path)) && <p className="ai-change-error">{t("ai.structureReview")}</p>}
    {(expanded ? files : files.slice(0, 3)).map(file => {
      const pendingHunks = file.hunks.filter(hunk => hunk.decision === "pending");
      const { added, removed } = fileStats?.[file.path] ?? pendingHunks.reduce((sum, hunk) => {
        const stats = hunkLineStats(hunk);
        return { added: sum.added + stats.added, removed: sum.removed + stats.removed };
      }, { added: 0, removed: 0 });
      const fileApplied = pendingHunks.filter(isHunkApplied).map(hunk => hunk.id);
      const fileUnapplied = pendingHunks.filter(hunk => !isHunkApplied(hunk)).map(hunk => hunk.id);
      return <div className="ai-file-change" key={file.path}>
        <div className="ai-file-summary"><button className="ai-change-path" title={file.path} onClick={() => onView(file.path)}>{file.path}</button><span className="ai-diff-count added">+{added}</span><span className="ai-diff-count removed">−{removed}</span><button className="ai-change-expand" aria-label={t("ai.reviewFile", { path: file.path })} aria-expanded={expandedPath === file.path} onClick={() => setExpandedPath(expandedPath === file.path ? undefined : file.path)}>⌄</button></div>
        {expandedPath === file.path && <div className="ai-file-review"><div className="ai-file-actions">
          {fileUnapplied.length > 0 && <>{fileApplied.length === 0 && <button data-action="accept-file" disabled={busy} onClick={() => onKeep(fileUnapplied)}>{t("ai.keepFile")}</button>}<button data-action="reject-file" disabled={busy} onClick={() => onDiscard(fileUnapplied)}>{t("ai.reject")}</button></>}
          {fileApplied.length > 0 && <button data-action="undo" disabled={busy} onClick={() => onDiscard(fileApplied)}>{t("ai.undoChanges")}</button>}
        </div>{pendingHunks.map(hunk => <div className="ai-hunk" key={hunk.id}><pre className="old">{hunk.oldText || "∅"}</pre><pre className="new">{hunk.newText || "∅"}</pre><div>
          {isHunkApplied(hunk) ? <button data-action="undo" disabled={busy} onClick={() => onDiscard([hunk.id])}>{t("ai.undoChanges")}</button> : <><button data-action="accept" disabled={busy} onClick={() => onKeep([hunk.id])}>{t("ai.accept")}</button><button data-action="reject" disabled={busy} onClick={() => onDiscard([hunk.id])}>{t("ai.reject")}</button></>}
        </div></div>)}</div>}
      </div>;
    })}
    {files.length > 3 && <button className="ai-show-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? t("ai.showFewerFiles") : t("ai.showMoreFiles", { count: files.length - 3 })} <span aria-hidden="true">⌄</span></button>}
  </section>;
}
