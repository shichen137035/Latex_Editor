import { useEffect, useState } from "react";
import type { AIOperationReport } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";

/** Setting reports stay with the reply that produced them; project diffs retain their existing UI. */
export function AIOperations({ reports }: { reports: AIOperationReport[] }) {
  const [current, setCurrent] = useState(reports);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setCurrent(reports);
    void window.latexEditor?.capabilities.operations(reports.map(item => item.operationId)).then(saved => { if (active) setCurrent(reports.map(item => saved.find(next => next.operationId === item.operationId) ?? item)); }).catch(() => undefined);
    return () => { active = false; };
  }, [reports]);
  const undo = async (report: AIOperationReport) => {
    setBusy(report.operationId); setError("");
    try {
      await window.latexEditor!.capabilities.undo(report.operationId, report.projectId);
      setCurrent(items => items.map(item => item.operationId === report.operationId ? { ...item, status: "reverted" } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(undefined); }
  };
  return <div className="ai-setting-operations">{current.map(report => <section className="ai-setting-operation" key={report.operationId}>
    <div><strong>{report.title}</strong><span>{t(`ai.operation.${report.status}`)}</span></div>
    <code>{report.scope}: {JSON.stringify(report.before)} → {JSON.stringify(report.after)}</code>
    {report.status === "verified" && <button type="button" disabled={!!busy} onClick={() => void undo(report)}>{t("ai.undoChanges")}</button>}
  </section>)}{error && <p className="inline-error" role="alert">{error}</p>}</div>;
}
