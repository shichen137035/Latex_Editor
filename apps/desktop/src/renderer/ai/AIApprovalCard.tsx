import type { AIApprovalRequest } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";

/** Keep the decision controls visible even when the preview is long or the panel is narrow. */
export function AIApprovalCard({ request, onResolve }: { request: AIApprovalRequest; onResolve(id: string, allow: boolean): Promise<void> }) {
  return <section className="ai-approval-card" role="alert">
    <div className="ai-approval-actions"><strong>{t("ai.approvalRequired")}</strong><button type="button" onClick={() => void onResolve(request.id, false)}>{t("ai.denyAction")}</button><button type="button" onClick={() => void onResolve(request.id, true)}>{t("ai.allowAction")}</button></div>
    <p>{request.description}</p>{request.command && <pre>{request.command}</pre>}{request.paths.length > 0 && <small>{request.paths.join("\n")}</small>}
  </section>;
}
