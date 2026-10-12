import { memo, useSyncExternalStore, useEffect, useState } from "react";
import type { AIMessage, AIResponsePart } from "@latex-editor/contracts";
import type { MathContext } from "../math/types.js";
import { getLocale, t } from "../i18n/index.js";
import { settings } from "../settings/service.js";
import { AIMessageContent } from "./AIMessageContent.js";
import { AIReasoning } from "./AIReasoning.js";

export const AIResponse = memo(function AIResponse({ message, projectRoot, mathContext, onOpenFile }: { message: AIMessage; projectRoot: string; mathContext?: MathContext; onOpenFile?: ((path: string, line?: number) => void) | undefined }) {
  useSyncExternalStore(settings.subscribe, getLocale, getLocale);
  const parts = message.responseParts ? groupAdjacentReasoningParts(message.responseParts) : undefined;
  const common = { projectRoot, ...(mathContext ? { mathContext } : {}), ...(onOpenFile ? { onOpenFile } : {}) };
  const recordedText = message.responseParts?.filter(part => part.kind === "text").map(part => part.text).join("\n\n") ?? "";
  const tail = recordedText && message.content.startsWith(recordedText) ? message.content.slice(recordedText.length).trim() : !recordedText ? message.content : "";
  return <>
    {parts?.length ? <>{parts.map((part, index) => part.kind === "reasoning"
      ? <AIReasoning key={`reasoning:${part.id}`} {...common} showStatus={false} message={{ ...message, content: "", status: message.status === "streaming" && index === parts.length - 1 && message.activity === "thinking" ? "streaming" : "complete", reasoning: [{ id: part.id, text: part.text, complete: part.sourceIds.every(id => message.reasoning?.find(reason => reason.id === id)?.complete ?? false) }] }}/>
      : <div className="ai-message-content" key={`text:${part.id}`}><AIMessageContent {...common} content={part.text}/></div>)}
      {tail && <div className="ai-message-content"><AIMessageContent {...common} content={tail}/></div>}
      <AIReasoning {...common} message={{ ...message, reasoning: [] }}/>
    </> : <><AIReasoning {...common} message={message}/>{message.content && <div className="ai-message-content"><AIMessageContent {...common} content={message.content}/></div>}</>}
    <AIWorkTime message={message}/>
  </>;
});

type DisplayResponsePart = AIResponsePart & { sourceIds: string[] };

function groupAdjacentReasoningParts(parts: AIResponsePart[]): DisplayResponsePart[] {
  const grouped: DisplayResponsePart[] = [];
  for (const part of parts) {
    const previous = grouped.at(-1);
    if (part.kind === "reasoning" && previous?.kind === "reasoning") {
      previous.text = [previous.text, part.text].filter(Boolean).join("\n\n");
      previous.sourceIds.push(part.id);
    } else {
      grouped.push({ ...part, sourceIds: [part.id] });
    }
  }
  return grouped;
}

function AIWorkTime({ message }: { message: AIMessage }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (message.status !== "streaming") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [message.id, message.status]);
  if (!message.completedAt && message.status !== "streaming") return null;
  const seconds = Math.max(0, Math.floor(((message.completedAt ?? now) - message.createdAt) / 1000));
  const duration = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return <small className="ai-work-time">{t("ai.workTime", { duration })}</small>;
}
