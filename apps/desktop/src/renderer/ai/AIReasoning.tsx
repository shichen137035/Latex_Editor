import { useEffect, useState } from "react";
import type { AIMessage } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { AIMessageContent } from "./AIMessageContent.js";

export function AIReasoning({ message, projectRoot, onOpenFile }: { message: AIMessage; projectRoot: string; onOpenFile?: ((path: string, line?: number) => void) | undefined }) {
  const running = message.status === "streaming";
  const [expanded, setExpanded] = useState(running);
  useEffect(() => { if (!running) setExpanded(false); }, [running]);
  const parts = message.reasoning?.filter((part) => part.text.trim()) ?? [];
  if (!running && !parts.length) return null;
  return <div className="ai-reasoning-area">
    {running && <div className="ai-task-status" role="status"><span className="ai-thinking-spinner" aria-hidden="true"/>{t(message.activity === "working" ? "ai.working" : message.activity === "responding" ? "ai.responding" : "ai.thinking")}</div>}
    {parts.length > 0 && <details className="ai-reasoning" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>{t("ai.thoughtSummary")}</summary>
      <div className="ai-reasoning-content">{parts.map((part) => <div key={part.id}><AIMessageContent content={part.text} projectRoot={projectRoot} {...(onOpenFile ? { onOpenFile } : {})}/></div>)}</div>
    </details>}
  </div>;
}
