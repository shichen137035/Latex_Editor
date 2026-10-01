import { useEffect, useMemo, useRef, useState } from "react";
import type { AIAttachment, AIChangeSet, AIConversation, AIContextSnapshotFile, AIStatus, AIModelOption, AIMode } from "@latex-editor/contracts";
import { t } from "../i18n/index.js";
import { useSettings } from "../settings/service.js";
import { ConversationPicker } from "./ConversationPicker.js";
import { AIMessageContent } from "./AIMessageContent.js";
import { AIReasoning } from "./AIReasoning.js";
import "./ai.css";

const AI_LONG_INPUT_THRESHOLD = 12_000;
const AI_COMPOSER_MAX_HEIGHT = 320;

type Props = {
  projectId: string;
  projectRoot: string;
  overrides: AIContextSnapshotFile[];
  currentFile?: string;
  currentFileContent?: string;
  selectedText?: string;
  onApplyChanges(changes: AIChangeSet): Promise<void>;
  onReviewChanges?(changes: AIChangeSet[]): void;
  onOpenSettings(): void;
  onOpenFile?(path: string, line?: number): void;
};

export function AIView(props: Props) {
  const api = window.latexEditor?.ai;
  const preferences = useSettings();
  const [status, setStatus] = useState<AIStatus>();
  const [copilotStatus, setCopilotStatus] = useState<AIStatus>();
  const [models, setModels] = useState<AIModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<{ conversations: AIConversation[]; changeSets: AIChangeSet[] }>({ conversations: [], changeSets: [] });
  const [activeId, setActiveId] = useState<string>();
  const [mode, setMode] = useState<AIMode>(() => preferences.global("aiDefaultMode"));
  const [executable, setExecutable] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AIAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const longDraftFileRef = useRef<{ content: string; path: string } | undefined>(undefined);
  const [taskId, setTaskId] = useState<string>();
  const [includeSelection, setIncludeSelection] = useState(Boolean(props.selectedText));
  const [decisions, setDecisions] = useState<Record<string, "pending" | "accepted" | "rejected">>({});
  const [lastApplied, setLastApplied] = useState<AIChangeSet>();
  const [historyDeleting, setHistoryDeleting] = useState(false);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const activeIdRef = useRef(activeId);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followTranscriptRef = useRef(true);
  activeIdRef.current = activeId;
  const activeConversation = snapshot.conversations.find((item) => item.id === activeId);
  const activeMode = activeConversation?.mode ?? mode;
  const modeConversations = useMemo(() => snapshot.conversations.filter((item) => item.mode === activeMode), [snapshot.conversations, activeMode]);
  const activeStatus = activeMode === "chat" ? copilotStatus : status;
  const effortKey = activeMode === "chat" ? "aiCopilotReasoningEffort" : "aiReasoningEffort";
  const selectedModelId = preferences.global(activeMode === "chat" ? "aiCopilotModel" : "aiModel");
  const selectedModel = selectedModelId ? models.find((model) => model.id === selectedModelId) : models.find((model) => model.isDefault);
  const efforts = selectedModel?.supportedReasoningEfforts ?? [];
  const preferredEffort = preferences.global(effortKey);
  const selectedEffort = efforts.some((option) => option.effort === preferredEffort) ? preferredEffort : "";
  const effortLabel = (effort: string) => { const label = t(`ai.effort.${effort}`); return label === `ai.effort.${effort}` ? effort : label; };
  const activeChanges = useMemo(() => snapshot.changeSets.filter((item) => item.conversationId === activeId && (item.status === "pending" || item.status === "partially_accepted")), [snapshot.changeSets, activeId]);
  const latestMessageContent = activeConversation?.messages[activeConversation.messages.length - 1]?.content;
  const latestReasoning = activeConversation?.messages.at(-1)?.reasoning?.map((part) => part.text).join("\n");
  const responseRunning = Boolean(taskId) || Boolean(activeConversation?.messages.some((message) => message.status === "streaming"));

  useEffect(() => {
    if (!api) return;
    let active = true;
    const unsubscribeStatus = api.onStatus((next) => { if (active) setStatus(next); });
    const unsubscribeUpdate = api.onUpdate((update) => {
      if (!active) return;
      if (update.kind === "conversation") {
        const conversation = update.payload as AIConversation;
        setSnapshot((current) => ({ ...current, conversations: [conversation, ...current.conversations.filter((item) => item.id !== conversation.id)].sort((a, b) => b.updatedAt - a.updatedAt) }));
        if (conversation.id === activeIdRef.current && !conversation.messages.some((message) => message.status === "streaming")) setTaskId(undefined);
      } else {
        const changeSet = update.payload as AIChangeSet;
        setSnapshot((current) => ({ ...current, changeSets: [changeSet, ...current.changeSets.filter((item) => item.id !== changeSet.id)] }));
      }
    });
    void api.detect().then(async (detected) => {
      if (!active || !detected) return;
      setStatus(detected); setExecutable(detected.executablePath ?? "");
      if (detected.executablePath) void api.status().then((connected) => { if (active && connected) setStatus(connected); }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    void api.copilotStatus().then((detected) => { if (active && detected) setCopilotStatus(detected); }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; unsubscribeStatus(); unsubscribeUpdate(); };
  }, [api]);

  useEffect(() => {
    if (!api) return;
    let active = true;
    void api.conversations(props.projectId).then((value) => {
      if (!active || !value) return;
      setSnapshot(value);
      const first = value.conversations[0];
      setActiveId(first?.id);
      if (first) setMode(first.mode);
      else setMode(preferences.global("aiDefaultMode"));
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [api, props.projectId]);

  useEffect(() => {
    if (!api || activeStatus?.auth !== "signed_in") return;
    let active = true;
    setModelsLoading(true);
    setModels([]);
    const copilot = activeMode === "chat";
    void (copilot ? api.copilotModels() : api.models()).then((available) => {
      if (!active) return;
      const next = available ?? [];
      setModels(next);
      const preferenceKey = copilot ? "aiCopilotModel" : "aiModel";
      const selected = preferences.global(preferenceKey);
      if (next.length && selected && !next.some((model) => model.id === selected)) void preferences.set(preferenceKey, "");
    }).catch((reason: unknown) => { if (active) setError(messageOf(reason)); }).finally(() => { if (active) setModelsLoading(false); });
    return () => { active = false; };
  }, [api, preferences, activeMode, activeStatus?.auth]);

  useEffect(() => {
    if (!api || activeMode !== "chat" || copilotStatus?.auth !== "authenticating") return;
    let active = true;
    const timer = window.setInterval(() => {
      void api.copilotStatus().then((next) => {
        if (active && next) setCopilotStatus(next);
      }).catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      });
    }, 2500);
    return () => { active = false; window.clearInterval(timer); };
  }, [api, activeMode, copilotStatus?.auth]);

  useEffect(() => { setIncludeSelection(Boolean(props.selectedText)); }, [props.selectedText]);
  useEffect(() => { setAttachments([]); }, [props.projectId, activeId]);
  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    const resize = () => {
      const maxHeight = Math.min(AI_COMPOSER_MAX_HEIGHT, Math.max(100, window.innerHeight * 0.42));
      textarea.style.height = "auto";
      const contentHeight = textarea.scrollHeight;
      textarea.style.height = `${Math.min(contentHeight, maxHeight)}px`;
      textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [draft]);
  useEffect(() => { followTranscriptRef.current = true; }, [activeId]);
  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript && followTranscriptRef.current) transcript.scrollTop = transcript.scrollHeight;
  }, [activeId, activeConversation?.messages.length, latestMessageContent, latestReasoning, activeChanges.length, sending]);
  useEffect(() => { props.onReviewChanges?.(snapshot.changeSets.filter((item) => item.status === "pending" || item.status === "partially_accepted")); }, [snapshot.changeSets, props.onReviewChanges]);
  useEffect(() => {
    const listener = (event: Event) => { const id = (event as CustomEvent<string>).detail; setLastApplied((current) => current?.id === id ? undefined : current); };
    window.addEventListener("texweave:ai-undo-complete", listener);
    return () => window.removeEventListener("texweave:ai-undo-complete", listener);
  }, []);

  const runStatus = async (action: () => Promise<AIStatus | undefined>, connectAfter = false, provider: AIMode = activeMode) => {
    setBusy(true); setError("");
    try {
      const next = await action();
      if (next) {
        if (provider === "chat") setCopilotStatus(next);
        else { setStatus(next); setExecutable(next.executablePath ?? ""); }
        if (connectAfter && next.executablePath) { const connected = await api?.status(); if (connected) setStatus(connected); }
      }
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); }
  };

  const newConversation = async (requestedMode: AIMode) => {
    if (!api) return;
    setError("");
    try {
      const created = await api.createConversation(requestedMode, props.projectId);
      if (!created) return;
      setSnapshot((current) => ({ ...current, conversations: [created, ...current.conversations] }));
      setActiveId(created.id); setMode(requestedMode); setDraft("");
    } catch (reason) { setError(messageOf(reason)); }
  };

  const switchMode = async (requestedMode: AIMode) => {
    setMode(requestedMode);
    const matching = snapshot.conversations.find((item) => item.mode === requestedMode);
    if (matching) setActiveId(matching.id);
    else await newConversation(requestedMode);
  };

  const addAttachments = async () => {
    if (!api || attachmentsLoading || busy || responseRunning) return;
    const conversationId = activeId;
    const projectId = props.projectId;
    setAttachmentsLoading(true); setError("");
    try {
      const selected = await api.pickAttachments(projectId);
      if (activeIdRef.current === conversationId) setAttachments((current) => [...current, ...selected]);
    } catch (reason) { setError(messageOf(reason)); }
    finally { setAttachmentsLoading(false); }
  };

  const send = async () => {
    if (!api || (!draft.trim() && !attachments.length) || responseRunning || busy || attachmentsLoading) return;
    setBusy(true); setSending(true); setError("");
    try {
      const draftContent = draft.trim() || t("ai.attachmentPrompt");
      let messageContent = draftContent;
      if (draftContent.length > AI_LONG_INPUT_THRESHOLD) {
        const bridge = window.latexEditor;
        if (!bridge) throw new Error("The project file service is unavailable.");
        const relativePath = longDraftFileRef.current?.content === draftContent
          ? longDraftFileRef.current.path
          : `.texweave/ai-inputs/chat-input-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.txt`;
        if (!longDraftFileRef.current || longDraftFileRef.current.content !== draftContent) {
          await bridge.files.createFile(props.projectId, relativePath);
          longDraftFileRef.current = { content: draftContent, path: relativePath };
        }
        await bridge.files.write(props.projectId, relativePath, draftContent);
        messageContent = t("ai.longMessagePrompt", { path: relativePath });
      }
      let conversation = activeConversation;
      if (!conversation) {
        conversation = await api.createConversation(activeMode, props.projectId);
        if (!conversation) throw new Error("Could not create an AI conversation.");
        setSnapshot((current) => ({ ...current, conversations: [conversation!, ...current.conversations] }));
        setActiveId(conversation.id);
      }
      const contextText = includeSelection && props.selectedText ? `Current selection in ${props.currentFile ?? "the editor"}:\n${props.selectedText}` : undefined;
      const started = await api.send({ conversationId: conversation.id, projectId: props.projectId, content: messageContent, attachmentIds: attachments.map((item) => item.id), ...(contextText ? { contextText } : {}), overrides: props.overrides });
      if (started) { setTaskId(started.conversation.messages.some((message) => message.status === "streaming") ? started.taskId : undefined); setSnapshot((current) => ({ ...current, conversations: [started.conversation, ...current.conversations.filter((item) => item.id !== started.conversation.id)] })); }
      setDraft("");
      setAttachments([]);
      longDraftFileRef.current = undefined;
    } catch (reason) { setError(messageOf(reason)); }
    finally { setBusy(false); setSending(false); }
  };

  const cancel = async () => {
    if (!api || !taskId) return;
    try { await api.cancel(taskId); } catch (reason) { setError(messageOf(reason)); }
  };

  const applyChanges = async (changeSet: AIChangeSet, decisionOverrides: Record<string, "accepted" | "rejected"> = {}) => {
    const selectedSet: AIChangeSet = {
      ...changeSet,
      files: changeSet.files.map((file) => ({ ...file, hunks: file.hunks.filter((hunk) => hunk.decision === "pending").map((hunk) => ({ ...hunk, decision: decisionOverrides[hunk.id] ?? decisions[hunk.id] ?? hunk.decision })) })).filter((file) => file.hunks.some((hunk) => hunk.decision === "accepted")),
      status: "accepted"
    };
    if (!selectedSet.files.length) { setError(t("ai.acceptOneChange")); return; }
    try {
      await props.onApplyChanges(selectedSet);
      setLastApplied(selectedSet);
      const resolvedDecisions = Object.fromEntries(changeSet.files.flatMap((file) => file.hunks.flatMap((hunk) => {
        const decision = decisionOverrides[hunk.id] ?? decisions[hunk.id] ?? hunk.decision;
        return decision === "pending" ? [] : [[hunk.id, decision] as const];
      })));
      const resolved = await api?.resolveChangeSet(changeSet.id, resolvedDecisions, true);
      if (resolved) setSnapshot((current) => ({ ...current, changeSets: current.changeSets.map((item) => item.id === resolved.id ? resolved : item) }));
      setError("");
    } catch (reason) { setError(messageOf(reason)); }
  };

  const acceptAllChanges = (changeSet: AIChangeSet) => {
    const accepted = Object.fromEntries(changeSet.files.flatMap((file) => file.hunks.filter((hunk) => hunk.decision === "pending").map((hunk) => [hunk.id, "accepted" as const])));
    void applyChanges(changeSet, accepted);
  };
  const rejectChanges = async (changeSet: AIChangeSet) => {
    const rejected = Object.fromEntries(changeSet.files.flatMap((file) => file.hunks.map((hunk) => [hunk.id, "rejected"]))) as Record<string, "rejected">;
    const resolved = await api?.resolveChangeSet(changeSet.id, rejected, false);
    if (resolved) setSnapshot((current) => ({ ...current, changeSets: current.changeSets.map((item) => item.id === resolved.id ? resolved : item) }));
  };
  const undoLastApply = () => { if (lastApplied) window.dispatchEvent(new CustomEvent("texweave:ai-undo", { detail: lastApplied })); };
  const removeConversations = async (ids: string[]) => {
    if (!api || historyDeleting) return;
    const removed = new Set<string>();
    setHistoryDeleting(true);
    try {
      for (const id of ids) { await api.removeConversation(id); removed.add(id); }
    } finally {
      // Prune only confirmed deletions from the latest state, including when a
      // later deletion fails or a streaming update arrives during this batch.
      setSnapshot((current) => ({ conversations: current.conversations.filter((item) => !removed.has(item.id)), changeSets: current.changeSets.filter((item) => !removed.has(item.conversationId)) }));
      if (activeIdRef.current && removed.has(activeIdRef.current)) {
        setActiveId(snapshotRef.current.conversations.find((item) => !removed.has(item.id) && item.mode === activeMode)?.id);
        setMode(activeMode); setDraft("");
      }
      setHistoryDeleting(false);
    }
  };

  if (!api) return null;

  return <section className="generic-sidebar ai-sidebar">
    <header className="ai-sidebar-heading"><div><span className="ai-kicker">TEXWEAVE AI</span><h2>{t("ai.title")}</h2></div><span className={`ai-status-dot ${activeStatus?.auth === "signed_in" ? "ready" : ""}`} title={t(activeStatus?.auth === "signed_in" ? "ai.signedIn" : "ai.disconnected")}/></header>
    <div className="ai-mode-switch" role="tablist"><button role="tab" aria-selected={activeMode === "chat"} className={activeMode === "chat" ? "active" : ""} disabled={busy || historyDeleting || Boolean(taskId)} onClick={() => void switchMode("chat")}>{t("ai.copilot")}</button><button role="tab" aria-selected={activeMode === "codex"} className={activeMode === "codex" ? "active" : ""} disabled={busy || historyDeleting || Boolean(taskId)} onClick={() => void switchMode("codex")}>{t("ai.codex")}</button></div>
    {!activeStatus && <div className="ai-connect-scroll"><p>{t("ai.checking")}</p></div>}
    {activeStatus && activeStatus.auth !== "signed_in" && <div className="ai-connect-scroll"><div className="ai-connect-card">
      <strong>{activeMode === "chat" ? t(activeStatus.process === "not_detected" ? "ai.copilotRequired" : "ai.copilotConnectTitle") : t(activeStatus.process === "not_detected" ? "ai.codexRequired" : activeStatus.process === "crashed" ? "ai.connectionFailed" : "ai.connectTitle")}</strong>
      <p>{activeMode === "chat" ? t(activeStatus.process === "not_detected" ? "ai.copilotRequiredHint" : "ai.copilotConnectHint") : t(activeStatus.process === "not_detected" ? "ai.codexRequiredHint" : activeStatus.process === "crashed" ? "ai.connectionFailedHint" : "ai.connectHint")}</p>
      {activeMode === "codex" && activeStatus.executablePath && <small className="ai-cli-path" title={activeStatus.executablePath}>{t("ai.cliDetected")}<br/>{activeStatus.executablePath}</small>}
      {activeMode === "codex" && (activeStatus.process === "not_detected" || activeStatus.process === "crashed") && <label className="ai-executable-field">{t("ai.executablePath")}<input value={executable} onChange={(event) => setExecutable(event.target.value)} placeholder="codex.exe" spellCheck={false}/><button disabled={busy || !executable.trim()} onClick={() => void runStatus(() => api.setExecutable(executable.trim()), true, "codex")}>{t("ai.savePath")}</button></label>}
      {activeMode === "chat" && activeStatus.process === "not_detected" && <button className="primary-button" disabled={busy} onClick={() => void runStatus(() => api.installCopilot(), false, "chat")}>{t(busy ? "ai.installingCopilot" : "ai.installCopilot")}</button>}
      {activeMode === "chat" && activeStatus.executablePath && <button className="primary-button" disabled={busy || activeStatus.auth === "authenticating"} onClick={() => void runStatus(() => api.loginCopilot(), false, "chat")}>{t(activeStatus.auth === "authenticating" ? "ai.signingIn" : "ai.signInGitHub")}</button>}
      {activeMode === "codex" && activeStatus.process === "not_detected" && <button className="primary-button" disabled={busy} onClick={() => void runStatus(() => api.install(), true, "codex")}>{t(busy ? "ai.installing" : "ai.installCodex")}</button>}
      {activeMode === "codex" && activeStatus.process !== "not_detected" && <button className="primary-button" disabled={busy || activeStatus.process === "starting" || activeStatus.auth === "authenticating"} onClick={() => void runStatus(() => api.login(), false, "codex")}>{t(activeStatus.auth === "authenticating" ? "ai.signingIn" : "ai.signIn")}</button>}
      <button className="secondary-button ai-recheck" disabled={busy || (activeMode === "codex" && activeStatus.auth === "authenticating")} onClick={() => void runStatus(() => activeMode === "chat" ? api.copilotStatus() : api.detect(), false, activeMode)}>{t("ai.detectAgain")}</button>
    </div>{(error || activeStatus.error) && <div className="inline-error ai-error" role="alert">{error || activeStatus.error}</div>}</div>}
    {activeStatus?.auth === "signed_in" && <>
      <div className="ai-workspace-controls">
        <div className="ai-account-line"><span className="ai-avatar" aria-hidden="true">{activeMode === "chat" ? "GH" : "C"}</span><span className="ai-account-name" title={activeStatus.accountLabel ?? t("ai.signedIn")}>{activeStatus.accountLabel ?? t(activeMode === "chat" ? "ai.copilotAccount" : "ai.chatgptAccount")}</span><button className="ai-quiet-action" onClick={props.onOpenSettings}>{t("ai.settings")}</button><button className="ai-quiet-action" disabled={busy} onClick={() => void runStatus(() => activeMode === "chat" ? api.logoutCopilot() : api.logout(), false, activeMode)}>{t("ai.signOut")}</button></div>
        <ConversationPicker key={`${props.projectId}:${activeMode}`} conversations={modeConversations} activeId={activeId} disabled={busy || historyDeleting || Boolean(taskId)} protectedId={busy || taskId ? activeId : undefined} onSelect={(id) => { setActiveId(id); setMode(activeMode); }} onNew={() => void newConversation(activeMode)} onDelete={removeConversations}/>
      </div>
      <div ref={transcriptRef} className="ai-conversation-body" aria-live="polite" onScroll={(event) => { const element = event.currentTarget; followTranscriptRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80; }}>
        <div className="ai-message-list">{activeConversation?.messages.map((message) => <article key={message.id} className={`ai-message ${message.role} ${message.status ?? ""}`}>
          <small>{message.role === "user" ? t("ai.you") : message.role === "assistant" ? t("ai.assistant") : message.role}</small>
          {message.role === "assistant" && <AIReasoning message={message} projectRoot={props.projectRoot} onOpenFile={props.onOpenFile}/>}
          {message.content && <div className="ai-message-content"><AIMessageContent content={message.content} projectRoot={props.projectRoot} {...(props.onOpenFile ? { onOpenFile: props.onOpenFile } : {})}/></div>}
          {!!message.attachments?.length && <div className="ai-message-attachments">{message.attachments.map((attachment) => <span key={attachment.id} title={attachment.name}>▧ {attachment.name}</span>)}</div>}
        </article>)}{!activeConversation?.messages.length && !sending && <p className="ai-empty-chat">{t(activeMode === "chat" ? "ai.chatReady" : "ai.codexReady")}</p>}
        {sending && !activeConversation?.messages.some((message) => message.status === "streaming") && <div className="ai-task-status" role="status"><span className="ai-thinking-spinner" aria-hidden="true"/>{t("ai.thinking")}</div>}</div>
        {lastApplied && <div className="ai-undo-row"><span>{t("ai.changesApplied")}</span><button onClick={undoLastApply}>{t("ai.undoChanges")}</button></div>}
        {activeChanges.map((changeSet) => <section className="ai-change-set" key={changeSet.id}><header><strong>{t("ai.proposedChanges", { count: changeSet.files.length })}</strong><div><button onClick={() => acceptAllChanges(changeSet)}>{t("ai.acceptAll")}</button><button onClick={() => void rejectChanges(changeSet)}>{t("ai.rejectAll")}</button><button disabled={!changeSet.files.some((file) => file.hunks.some((hunk) => hunk.decision === "pending" && (decisions[hunk.id] ?? "pending") === "accepted"))} onClick={() => void applyChanges(changeSet)}>{t("ai.applyAccepted")}</button></div></header>{changeSet.files.map((file) => <div className="ai-file-change" key={file.path}><strong>{file.type.toUpperCase()} · {file.path}</strong>{file.hunks.map((hunk) => <div className="ai-hunk" key={hunk.id}><pre className="old">{hunk.oldText || "—"}</pre><pre className="new">{hunk.newText || "—"}</pre><div><button disabled={hunk.decision !== "pending"} className={decisions[hunk.id] === "accepted" || hunk.decision === "accepted" ? "selected" : ""} onClick={() => setDecisions((value) => ({ ...value, [hunk.id]: "accepted" }))}>{t("ai.accept")}</button><button disabled={hunk.decision !== "pending"} className={decisions[hunk.id] === "rejected" || hunk.decision === "rejected" ? "selected" : ""} onClick={() => setDecisions((value) => ({ ...value, [hunk.id]: "rejected" }))}>{t("ai.reject")}</button></div></div>)}</div>)}</section>)}
      </div>
      <footer className="ai-composer-dock">
        {props.selectedText && <div className="ai-context-options"><label><input type="checkbox" checked={includeSelection} onChange={(event) => setIncludeSelection(event.target.checked)}/>{t("ai.includeSelection")}</label></div>}
        {(error || activeStatus.error) && <div className="inline-error ai-error" role="alert">{error || activeStatus.error}</div>}
        {draft.trim().length > AI_LONG_INPUT_THRESHOLD && <div className="ai-long-input-note">{t("ai.longMessageHint")}</div>}
        <div className="ai-composer">
          <textarea ref={composerRef} rows={1} value={draft} onChange={(event) => { setDraft(event.target.value); if (longDraftFileRef.current?.content !== event.target.value.trim()) longDraftFileRef.current = undefined; }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} placeholder={t("ai.messagePlaceholder")} aria-label={t("ai.messagePlaceholder")}/>
          {attachments.length > 0 && <div className="ai-draft-attachments">{attachments.map((attachment) => <span className="ai-attachment-chip" key={attachment.id} title={`${attachment.name} · ${(attachment.size / 1024).toFixed(1)} KB`}><span>▧ {attachment.name}</span><button aria-label={t("ai.removeAttachment", { name: attachment.name })} disabled={sending} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}>×</button></span>)}</div>}
          <div className="ai-composer-actions">
            <button className="ai-add-attachment" title={t("ai.addAttachment")} aria-label={t("ai.addAttachment")} disabled={busy || attachmentsLoading || responseRunning} onClick={() => void addAttachments()}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
            <select className="ai-composer-model" aria-label={t("ai.model")} title={t("ai.model")} value={selectedModelId} disabled={modelsLoading || busy || responseRunning} onChange={(event) => void preferences.set(activeMode === "chat" ? "aiCopilotModel" : "aiModel", event.target.value)}><option value="">{t(modelsLoading ? "ai.loadingModels" : "ai.defaultModel")}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}{model.isDefault ? ` (${t("ai.recommended")})` : ""}</option>)}</select>
            <select className="ai-composer-effort" aria-label={t("ai.reasoningEffort")} title={t(efforts.length ? "ai.reasoningEffort" : "ai.reasoningUnavailable")} value={selectedEffort} disabled={modelsLoading || busy || responseRunning || !efforts.length} onChange={(event) => void preferences.set(effortKey, event.target.value)}><option value="">{t("ai.modelDefault")}</option>{efforts.map((option) => <option key={option.effort} value={option.effort}>{effortLabel(option.effort)}</option>)}</select>
            {responseRunning ? <button className="ai-send-button stopping" title={t("ai.stop")} aria-label={t("ai.stop")} disabled={!taskId} onClick={() => void cancel()}><svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2"/></svg></button> : <button className="ai-send-button" title={t("ai.send")} aria-label={t("ai.send")} disabled={busy || attachmentsLoading || (!draft.trim() && !attachments.length)} onClick={() => void send()}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"/></svg></button>}
          </div>
        </div>
      </footer>
    </>}
  </section>;
}

function messageOf(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason); }
