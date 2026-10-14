import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AIChangeSet, AIMessage } from "@latex-editor/contracts";
import { getLocale, t } from "../i18n/index.js";
import { settings } from "../settings/service.js";
import type { MathContext } from "../math/types.js";
import { AIMessageContent } from "./AIMessageContent.js";
import { AIResponse } from "./AIResponse.js";
import { ChangesCard } from "./ChangesCard.js";
import type { AIChangeReport } from "./changeReports.js";

export type AITranscriptActions = {
  keep(changes: AIChangeReport, ids: string[]): void;
  discard(changes: AIChangeReport, ids: string[]): void;
  view(changes: AIChangeSet, path: string): void;
  dismiss(changes: AIChangeReport): void;
  openFile(path: string, line?: number): void;
  startEdit(message: AIMessage): void;
  changeEdit(content: string): void;
  cancelEdit(): void;
  resend(messageId: string): void;
  error(reason: unknown): void;
};

type Props = {
  conversationId: string | undefined;
  messages: AIMessage[];
  changes: AIChangeReport[];
  projectRoot: string;
  mathContext: MathContext | undefined;
  readyKey: "ai.chatReady" | "ai.codexReady";
  busy: boolean;
  changesBusy: boolean;
  sending: boolean;
  responseRunning: boolean;
  hasQueuedMessages: boolean;
  editingMessageId: string | undefined;
  editedContent: string;
  actions: AITranscriptActions;
};

/** Composer and editor updates must not re-render or re-layout the transcript. */
export const AITranscript = memo(function AITranscript(props: Props) {
  useSyncExternalStore(settings.subscribe, getLocale, getLocale);
  const { messages, changes, actions } = props;
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const lastUserId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) if (messages[index]!.role === "user") return messages[index]!.id;
    return undefined;
  }, [messages]);
  const timeline = useMemo(() => [
    ...messages.map(message => ({ kind: "message" as const, createdAt: message.createdAt, message })),
    ...changes.map(changeSet => ({ kind: "changes" as const, createdAt: changeSet.createdAt, changeSet }))
  ].sort((a, b) => a.createdAt - b.createdAt), [messages, changes]);

  useLayoutEffect(() => {
    followRef.current = true;
    setAtBottom(true);
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      const transcript = transcriptRef.current;
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
      secondFrame = requestAnimationFrame(() => {
        const current = transcriptRef.current;
        if (current) current.scrollTop = current.scrollHeight;
      });
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [props.conversationId]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    const content = transcript?.firstElementChild;
    if (!transcript || !content) return;
    let frame: number | undefined;
    const schedule = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (followRef.current) transcript.scrollTop = transcript.scrollHeight;
        setAtBottom(transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 80);
      });
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(content);
    observer.observe(transcript);
    return () => { observer.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [props.conversationId]);

  return <div className="ai-transcript-shell">
    <div ref={transcriptRef} className="ai-conversation-body" aria-live="polite" onScroll={event => {
      const element = event.currentTarget;
      const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
      followRef.current = bottom;
      setAtBottom(bottom);
    }}>
      <div className="ai-message-list">
        {timeline.map(item => item.kind === "message" ? <TranscriptMessage key={`message:${item.message.id}`} message={item.message}
          projectRoot={props.projectRoot} mathContext={props.mathContext} actions={actions} busy={props.busy}
          canEdit={item.message.id === lastUserId && !props.hasQueuedMessages && !props.responseRunning && !props.sending}
          editing={item.message.id === props.editingMessageId} editedContent={item.message.id === props.editingMessageId ? props.editedContent : ""}/>
          : <ChangesCard key={`changes:${item.changeSet.id}`} changes={item.changeSet} fileStats={item.changeSet.fileStats} busy={props.changesBusy}
            onKeep={ids => actions.keep(item.changeSet, ids)} onDiscard={ids => actions.discard(item.changeSet, ids)}
            onView={path => actions.view(item.changeSet, path)} onDismiss={() => actions.dismiss(item.changeSet)}/>)}
        {!messages.length && !props.sending && <p className="ai-empty-chat">{t(props.readyKey)}</p>}
        {props.sending && props.responseRunning && !messages.some(message => message.status === "streaming") && <div className="ai-task-status" role="status"><span className="ai-thinking-spinner" aria-hidden="true"/>{t("ai.thinking")}</div>}
      </div>
    </div>
    {!atBottom && <button type="button" className="ai-scroll-bottom" title={t("ai.scrollToLatest")} aria-label={t("ai.scrollToLatest")} onClick={() => {
      followRef.current = true;
      setAtBottom(true);
      const transcript = transcriptRef.current;
      transcript?.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
    }}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15m-6-6 6 6 6-6"/></svg></button>}
  </div>;
});

const TranscriptMessage = memo(function TranscriptMessage({ message, projectRoot, mathContext, actions, busy, canEdit, editing, editedContent }: {
  message: AIMessage;
  projectRoot: string;
  mathContext: MathContext | undefined;
  actions: AITranscriptActions;
  busy: boolean;
  canEdit: boolean;
  editing: boolean;
  editedContent: string;
}) {
  useSyncExternalStore(settings.subscribe, getLocale, getLocale);
  const common = { projectRoot, ...(mathContext ? { mathContext } : {}), onOpenFile: actions.openFile };
  return <article className={`ai-message ${message.role} ${message.status ?? ""}`}>
    <div className="ai-message-heading"><small>{message.role === "user" ? t("ai.you") : message.role === "assistant" ? t("ai.assistant") : message.role}</small></div>
    {message.role === "assistant" && <AIResponse message={message} {...common}/>}
    {editing ? <div className="ai-message-edit"><textarea value={editedContent} onChange={event => actions.changeEdit(event.target.value)} aria-label={t("ai.editMessage")} autoFocus/><div><button type="button" disabled={busy || !editedContent.trim()} onClick={() => actions.resend(message.id)}>{t("ai.editResend")}</button><button type="button" disabled={busy} onClick={actions.cancelEdit}>{t("ai.cancelEdit")}</button></div></div>
      : message.role !== "assistant" && message.content && <div className="ai-message-content"><AIMessageContent content={message.content} {...common}/></div>}
    {!!message.attachments?.length && <div className="ai-message-attachments">{message.attachments.map(attachment => <span key={attachment.id} title={attachment.name}>▧ {attachment.name}</span>)}</div>}
    <div className="ai-message-actions"><button type="button" className="ai-edit-message" disabled={!message.content} title={t("editor.context.copy")} aria-label={t("editor.context.copy")} onClick={() => { void navigator.clipboard.writeText(message.content).catch(actions.error); }}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/></svg></button>
      {message.role === "user" && canEdit && !editing && <button type="button" className="ai-edit-message" disabled={busy} title={t("ai.editMessage")} aria-label={t("ai.editMessage")} onClick={() => actions.startEdit(message)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 15 11-11a2.8 2.8 0 0 1 4 4L8 19l-5 2zM13 6l5 5"/></svg></button>}
    </div>
  </article>;
});
