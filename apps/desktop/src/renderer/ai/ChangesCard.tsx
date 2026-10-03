import { useState } from "react";
import type { AIChangeSet } from "@latex-editor/contracts";
import { isAIStructureMetadataPath } from "@latex-editor/contracts/ai-paths";
import { t } from "../i18n/index.js";
import { hunkLineStats, isHunkApplied, pendingHunkIds } from "./changeOperations.js";

type Props = { changes: AIChangeSet; busy: boolean; onKeep(ids: string[]): void; onDiscard(ids: string[]): void; onView(path: string): void };
export function ChangesCard({ changes, busy, onKeep, onDiscard, onView }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [expandedPath, setExpandedPath] = useState<string>();
  const files = changes.files.filter(file => pendingHunkIds(file).length);
  const pending = files.flatMap(pendingHunkIds);
  const applied = files.some(file => file.hunks.some(hunk => hunk.decision === "pending" && isHunkApplied(hunk)));
  return <section className="ai-change-set">
    <header><strong>{t(applied ? "ai.editedFiles" : "ai.proposedChanges", { count: files.length })}</strong><div><button disabled={busy} onClick={() => onKeep(pending)}>{t("ai.keepAll")}</button><button disabled={busy} onClick={() => onDiscard(pending)}>{t(applied ? "ai.undoChanges" : "ai.rejectAll")}</button><button disabled={!files.length} onClick={() => files[0] && onView(files[0].path)}>{t("ai.viewChanges")}</button></div></header>
    {changes.autoApplyError && <p className="ai-change-error" role="alert">{t("ai.autoApplyConflict")} {changes.autoApplyError}</p>}
    {files.some((file) => isAIStructureMetadataPath(file.path)) && <p className="ai-change-error">{t("ai.structureReview")}</p>}
    {(expanded ? files : files.slice(0, 3)).map(file => {
      const pendingHunks = file.hunks.filter(hunk => hunk.decision === "pending");
      const stats = pendingHunks.map(hunkLineStats);
      const added = stats.reduce((sum, value) => sum + value.added, 0);
      const removed = stats.reduce((sum, value) => sum + value.removed, 0);
      const fileApplied = pendingHunks.some(isHunkApplied);
      return <div className="ai-file-change" key={file.path}>
        <div className="ai-file-summary"><button className="ai-change-path" title={file.path} onClick={() => onView(file.path)}>{file.path}</button><span className="ai-diff-count added">+{added}</span><span className="ai-diff-count removed">−{removed}</span><button className="ai-change-expand" aria-label={t("ai.reviewFile", { path: file.path })} aria-expanded={expandedPath === file.path} onClick={() => setExpandedPath(expandedPath === file.path ? undefined : file.path)}>⌄</button></div>
        {expandedPath === file.path && <div className="ai-file-review"><div className="ai-file-actions"><button disabled={busy} onClick={() => onKeep(pendingHunkIds(file))}>{t("ai.keepFile")}</button><button disabled={busy} onClick={() => onDiscard(pendingHunkIds(file))}>{t(fileApplied ? "ai.undoChanges" : "ai.reject")}</button></div>{pendingHunks.map(hunk => <div className="ai-hunk" key={hunk.id}><pre className="old">{hunk.oldText || "∅"}</pre><pre className="new">{hunk.newText || "∅"}</pre><div><button disabled={busy} onClick={() => onKeep([hunk.id])}>{t("ai.accept")}</button><button disabled={busy} onClick={() => onDiscard([hunk.id])}>{t(isHunkApplied(hunk) ? "ai.undoChanges" : "ai.reject")}</button></div></div>)}</div>}
      </div>;
    })}
    {files.length > 3 && <button className="ai-show-more" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? t("ai.showFewerFiles") : t("ai.showMoreFiles", { count: files.length - 3 })} <span aria-hidden="true">⌄</span></button>}
  </section>;
}
